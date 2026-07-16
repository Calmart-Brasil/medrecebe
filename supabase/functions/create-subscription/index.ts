import { json, options, publicError } from '../_shared/http.ts';
import { mercadoPago, type MercadoPagoSubscription } from '../_shared/mercado-pago.ts';
import { adminClient, authenticatedUser } from '../_shared/supabase.ts';

const plans = {
  mobile: { amount: 29.9, amountCents: 2990, reason: 'MedRecebe Mobile - Assinatura mensal' },
  web: { amount: 59.9, amountCents: 5990, reason: 'MedRecebe Web - Assinatura mensal' },
} as const;

Deno.serve(async (request) => {
  const preflight = options(request);
  if (preflight) return preflight;
  if (request.method !== 'POST') return publicError(request, 'Método não permitido.', 405);

  try {
    const user = await authenticatedUser(request);
    const admin = adminClient();
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, email, role, access_status, selected_plan')
      .eq('id', user.id)
      .single();
    if (profileError || !profile) return publicError(request, 'Conta não encontrada.', 404);
    if (profile.role === 'admin') return json(request, { adminAccess: true });
    if (profile.access_status === 'suspended') return publicError(request, 'Acesso suspenso. Fale com o suporte.', 403);

    const body = await request.json().catch(() => ({}));
    const planCode = body.planCode === 'web' ? 'web' : body.planCode === 'mobile' ? 'mobile' : profile.selected_plan;
    const plan = plans[planCode as keyof typeof plans] || plans.mobile;

    const { data: current } = await admin
      .from('subscriptions')
      .select('id, status, checkout_url, provider_subscription_id, plan_code')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .maybeSingle();
    if (current?.status === 'authorized' && current.plan_code === planCode) return json(request, { active: true, planCode });
    if (current?.status === 'authorized' && current.provider_subscription_id) {
      await mercadoPago(`/preapproval/${encodeURIComponent(current.provider_subscription_id)}`, {
        method: 'PUT',
        body: JSON.stringify({ auto_recurring: { transaction_amount: plan.amount, currency_id: 'BRL' } }),
      });
      await admin
        .from('subscriptions')
        .update({ plan_code: planCode, amount_cents: plan.amountCents })
        .eq('id', current.id);
      await admin.from('profiles').update({ selected_plan: planCode, access_status: 'active' }).eq('id', user.id);
      return json(request, { active: true, planCode, planChanged: true });
    }
    if (current?.status === 'pending' && current.checkout_url && current.plan_code === planCode) {
      return json(request, { checkoutUrl: current.checkout_url, reused: true });
    }

    if (current?.status === 'pending' && current.provider_subscription_id) {
      await mercadoPago(`/preapproval/${encodeURIComponent(current.provider_subscription_id)}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'canceled' }),
      }).catch(() => undefined);
    }

    const appUrl = new URL(Deno.env.get('APP_URL') || 'https://medrecebe.com.br/app.html');
    appUrl.search = '';
    appUrl.hash = '';
    const endDate = new Date();
    endDate.setUTCFullYear(endDate.getUTCFullYear() + 10);
    const subscription = await mercadoPago<MercadoPagoSubscription>('/preapproval', {
      method: 'POST',
      body: JSON.stringify({
        reason: plan.reason,
        external_reference: user.id,
        payer_email: profile.email,
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          end_date: endDate.toISOString(),
          transaction_amount: plan.amount,
          currency_id: 'BRL',
        },
        back_url: appUrl.toString(),
        status: 'pending',
      }),
    });
    if (!subscription.init_point) throw new Error('O provedor não retornou o link de pagamento');

    await admin.from('subscriptions').update({ is_current: false }).eq('user_id', user.id).eq('is_current', true);
    const { error: insertError } = await admin.from('subscriptions').insert({
      user_id: user.id,
      provider_subscription_id: subscription.id,
      status: subscription.status,
      checkout_url: subscription.init_point,
      plan_code: planCode,
      amount_cents: plan.amountCents,
    });
    if (insertError) throw insertError;

    await admin.from('profiles').update({ selected_plan: planCode }).eq('id', user.id);

    return json(request, { checkoutUrl: subscription.init_point, planCode });
  } catch (error) {
    console.error('create-subscription', error);
    return publicError(request, 'Não foi possível iniciar a assinatura. Tente novamente.', 500);
  }
});
