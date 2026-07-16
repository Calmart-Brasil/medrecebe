import { reconcileUserBilling } from '../_shared/billing.ts';
import { json, options, publicError } from '../_shared/http.ts';
import { adminClient, authenticatedUser } from '../_shared/supabase.ts';

Deno.serve(async (request) => {
  const preflight = options(request);
  if (preflight) return preflight;
  if (request.method !== 'POST') return publicError(request, 'Método não permitido.', 405);

  try {
    const user = await authenticatedUser(request);
    const admin = adminClient();
    let { data: profile, error } = await admin
      .from('profiles')
      .select('id, full_name, email, cpf_last4, role, access_status, selected_plan, trial_ends_at')
      .eq('id', user.id)
      .single();
    if (error || !profile) return publicError(request, 'Conta não encontrada.', 404);

    let { data: subscription } = await admin
      .from('subscriptions')
      .select('id, status, amount_cents, currency, current_period_end, last_payment_at, provider_subscription_id, created_at, plan_code')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .maybeSingle();

    if (profile.role !== 'admin' && subscription?.provider_subscription_id) {
      try {
        await reconcileUserBilling(user.id, subscription.provider_subscription_id, subscription.created_at, Number(subscription.amount_cents) / 100);
        const [profileResult, subscriptionResult] = await Promise.all([
          admin
            .from('profiles')
            .select('id, full_name, email, cpf_last4, role, access_status, selected_plan, trial_ends_at')
            .eq('id', user.id)
            .single(),
          admin
            .from('subscriptions')
            .select('id, status, amount_cents, currency, current_period_end, last_payment_at, provider_subscription_id, created_at, plan_code')
            .eq('user_id', user.id)
            .eq('is_current', true)
            .maybeSingle(),
        ]);
        if (profileResult.data) profile = profileResult.data;
        if (subscriptionResult.data) subscription = subscriptionResult.data;
      } catch (reconciliationError) {
        console.error('account-status reconciliation', reconciliationError);
      }
    }

    const trialActive = profile.role !== 'admin' && subscription?.status !== 'authorized' && Date.parse(profile.trial_ends_at || '') > Date.now();
    const shouldEvaluateAccess = profile.role !== 'admin' && !['suspended', 'canceled', 'past_due'].includes(profile.access_status);
    const effectiveAccess = shouldEvaluateAccess
      ? subscription?.status === 'authorized' || trialActive ? 'active' : 'pending_payment'
      : profile.access_status;
    if (effectiveAccess !== profile.access_status) {
      await admin.from('profiles').update({ access_status: effectiveAccess }).eq('id', profile.id);
      profile.access_status = effectiveAccess;
    }

    return json(request, {
      profile: {
        id: profile.id,
        fullName: profile.full_name,
        email: profile.email,
        cpfLast4: profile.cpf_last4,
        role: profile.role,
        accessStatus: profile.access_status,
        planCode: profile.selected_plan,
        trialEndsAt: profile.trial_ends_at,
      },
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            amountCents: subscription.amount_cents,
            currency: subscription.currency,
            currentPeriodEnd: subscription.current_period_end,
            lastPaymentAt: subscription.last_payment_at,
            planCode: subscription.plan_code,
          }
        : null,
    });
  } catch (error) {
    console.error('account-status', error);
    return publicError(request, error instanceof Error ? error.message : 'Sessão inválida.', 401);
  }
});
