import { json, options, publicError } from '../_shared/http.ts';
import { mercadoPago } from '../_shared/mercado-pago.ts';
import { adminClient, authenticatedUser } from '../_shared/supabase.ts';

interface Payment {
  id?: string | number;
  status?: string;
  transaction_amount?: number;
  date_approved?: string;
  date_created?: string;
}

interface PaymentSearch { results?: Payment[] }

Deno.serve(async (request) => {
  const preflight = options(request);
  if (preflight) return preflight;
  if (request.method !== 'POST') return publicError(request, 'Método não permitido.', 405);

  try {
    const user = await authenticatedUser(request);
    const admin = adminClient();
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, role, trial_ends_at')
      .eq('id', user.id)
      .single();
    if (profileError || !profile) return publicError(request, 'Conta não encontrada.', 404);
    if (profile.role === 'admin') return publicError(request, 'A conta administrativa não possui assinatura.', 400);

    const { data: subscription, error: subscriptionError } = await admin
      .from('subscriptions')
      .select('id, provider_subscription_id, status, amount_cents, last_payment_at, refunded_at')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .maybeSingle();
    if (subscriptionError) throw subscriptionError;

    if (!subscription?.provider_subscription_id) {
      await admin.from('profiles').update({ access_status: 'canceled', trial_ends_at: new Date().toISOString() }).eq('id', user.id);
      return json(request, { canceled: true, refunded: false, trialCanceled: true });
    }

    await mercadoPago(`/preapproval/${encodeURIComponent(subscription.provider_subscription_id)}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'canceled' }),
    });

    let refunded = Boolean(subscription.refunded_at);
    let refundPending = false;
    const lastPaymentTime = Date.parse(subscription.last_payment_at || '');
    const withinCoolingOff = Number.isFinite(lastPaymentTime) && Date.now() - lastPaymentTime <= 7 * 24 * 60 * 60 * 1000;
    let providerPaymentId = '';

    if (withinCoolingOff && !refunded) {
      const query = new URLSearchParams({ external_reference: user.id, sort: 'date_created', criteria: 'desc', limit: '10' });
      const payments = await mercadoPago<PaymentSearch>(`/v1/payments/search?${query.toString()}`);
      const expectedAmount = Number(subscription.amount_cents) / 100;
      const payment = (payments.results || []).find((item) => {
        const paymentTime = Date.parse(item.date_approved || item.date_created || '');
        return item.status === 'approved'
          && Number(item.transaction_amount) === expectedAmount
          && Number.isFinite(paymentTime)
          && paymentTime >= lastPaymentTime - 300_000;
      });
      if (payment?.id) {
        providerPaymentId = String(payment.id);
        try {
          await mercadoPago(`/v1/payments/${encodeURIComponent(providerPaymentId)}/refunds`, {
            method: 'POST',
            headers: { 'X-Idempotency-Key': `medrecebe-cancel-${subscription.id}` },
          });
          refunded = true;
        } catch (refundError) {
          console.error('cancel-subscription refund', refundError);
          refundPending = true;
        }
      } else refundPending = true;
    }

    const now = new Date().toISOString();
    const { error: updateError } = await admin
      .from('subscriptions')
      .update({
        status: 'canceled',
        canceled_at: now,
        provider_payment_id: providerPaymentId || null,
        refunded_at: refunded ? now : null,
      })
      .eq('id', subscription.id);
    if (updateError) throw updateError;
    await admin.from('profiles').update({ access_status: 'canceled' }).eq('id', user.id);
    return json(request, { canceled: true, refunded, refundPending, withinCoolingOff });
  } catch (error) {
    console.error('cancel-subscription', error);
    return publicError(request, 'Não foi possível concluir o cancelamento agora. Nenhuma nova tentativa será feita sem sua confirmação.', 500);
  }
});
