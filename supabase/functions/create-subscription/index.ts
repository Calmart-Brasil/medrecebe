import { json, options, publicError } from '../_shared/http.ts';
import { mercadoPago, type MercadoPagoSubscription } from '../_shared/mercado-pago.ts';
import { adminClient, authenticatedUser } from '../_shared/supabase.ts';

const PLAN = { code: 'standard', amount: 39.9, amountCents: 3990, reason: 'MedRecebe - Assinatura mensal' } as const;

Deno.serve(async (request) => {
  const preflight = options(request);
  if (preflight) return preflight;
  if (request.method !== 'POST') return publicError(request, 'Método não permitido.', 405);
  try {
    const user = await authenticatedUser(request);
    const admin = adminClient();
    const { data: profile, error: profileError } = await admin.from('profiles').select('id, email, role, access_status').eq('id', user.id).single();
    if (profileError || !profile) return publicError(request, 'Conta não encontrada.', 404);
    if (profile.role === 'admin') return json(request, { adminAccess: true });
    if (profile.access_status === 'suspended') return publicError(request, 'Acesso suspenso. Fale com o suporte.', 403);

    const { data: current } = await admin.from('subscriptions').select('id, status, checkout_url, provider_subscription_id, amount_cents').eq('user_id', user.id).eq('is_current', true).maybeSingle();
    if (current?.status === 'authorized' && current.provider_subscription_id) {
      if (Number(current.amount_cents) !== PLAN.amountCents) {
        await mercadoPago(`/preapproval/${encodeURIComponent(current.provider_subscription_id)}`, { method: 'PUT', body: JSON.stringify({ auto_recurring: { transaction_amount: PLAN.amount, currency_id: 'BRL', end_date: null } }) });
        await admin.from('subscriptions').update({ plan_code: PLAN.code, amount_cents: PLAN.amountCents }).eq('id', current.id);
      }
      await admin.from('profiles').update({ selected_plan: PLAN.code, access_status: 'active' }).eq('id', user.id);
      return json(request, { active: true, planCode: PLAN.code });
    }
    if (current?.status === 'pending' && current.checkout_url && Number(current.amount_cents) === PLAN.amountCents) return json(request, { checkoutUrl: current.checkout_url, reused: true, planCode: PLAN.code });
    if (current?.status === 'pending' && current.provider_subscription_id) {
      await mercadoPago(`/preapproval/${encodeURIComponent(current.provider_subscription_id)}`, { method: 'PUT', body: JSON.stringify({ status: 'canceled' }) }).catch(() => undefined);
    }

    const appUrl = new URL(Deno.env.get('APP_URL') || 'https://medrecebe.com.br/app.html');
    appUrl.search = '';
    appUrl.hash = '';
    const subscription = await mercadoPago<MercadoPagoSubscription>('/preapproval', {
      method: 'POST',
      body: JSON.stringify({ reason: PLAN.reason, external_reference: user.id, payer_email: profile.email, auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: PLAN.amount, currency_id: 'BRL' }, back_url: appUrl.toString(), status: 'pending' }),
    });
    if (!subscription.init_point) throw new Error('O provedor não retornou o link de pagamento');
    await admin.from('subscriptions').update({ is_current: false }).eq('user_id', user.id).eq('is_current', true);
    const { error: insertError } = await admin.from('subscriptions').insert({ user_id: user.id, provider_subscription_id: subscription.id, status: subscription.status, checkout_url: subscription.init_point, plan_code: PLAN.code, amount_cents: PLAN.amountCents });
    if (insertError) throw insertError;
    await admin.from('profiles').update({ selected_plan: PLAN.code }).eq('id', user.id);
    return json(request, { checkoutUrl: subscription.init_point, planCode: PLAN.code });
  } catch (error) {
    console.error('create-subscription', error);
    return publicError(request, 'Não foi possível iniciar a assinatura. Tente novamente.', 500);
  }
});
