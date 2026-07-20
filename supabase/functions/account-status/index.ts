import { reconcileUserBilling } from '../_shared/billing.ts';
import { json, options, publicError } from '../_shared/http.ts';
import { mercadoPago } from '../_shared/mercado-pago.ts';
import { adminClient, authenticatedUser, authenticationStatus } from '../_shared/supabase.ts';

Deno.serve(async (request) => {
  const preflight = options(request);
  if (preflight) return preflight;
  if (request.method !== 'POST') return publicError(request, 'Método não permitido.', 405);

  try {
    const user = await authenticatedUser(request);
    const admin = adminClient();
    let { data: profile, error } = await admin
      .from('profiles')
      .select('id, full_name, email, cpf_last4, role, access_status, selected_plan, manual_access_until, manual_access_lifetime, suspension_scheduled_at, suspension_reason, forced_suspension_at')
      .eq('id', user.id)
      .single();
    if (error || !profile) return publicError(request, 'Conta não encontrada.', 404);

    let { data: subscription } = await admin
      .from('subscriptions')
      .select('id, status, amount_cents, currency, current_period_end, last_payment_at, provider_subscription_id, created_at, plan_code')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .maybeSingle();

    const scheduledTimeBeforeSync = Date.parse(profile.suspension_scheduled_at || '');
    const scheduledAccessActive = Number.isFinite(scheduledTimeBeforeSync) && scheduledTimeBeforeSync > Date.now();
    if (profile.role !== 'admin' && subscription?.provider_subscription_id && !scheduledAccessActive) {
      try {
        await reconcileUserBilling(user.id, subscription.provider_subscription_id, subscription.created_at, Number(subscription.amount_cents) / 100);
        const [profileResult, subscriptionResult] = await Promise.all([
          admin
            .from('profiles')
            .select('id, full_name, email, cpf_last4, role, access_status, selected_plan, manual_access_until, manual_access_lifetime, suspension_scheduled_at, suspension_reason, forced_suspension_at')
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

    if (profile.role !== 'admin' && subscription?.status === 'authorized' && subscription.provider_subscription_id && Number(subscription.amount_cents) !== 3990) {
      try {
        await mercadoPago(`/preapproval/${encodeURIComponent(subscription.provider_subscription_id)}`, {
          method: 'PUT',
          body: JSON.stringify({ auto_recurring: { transaction_amount: 39.9, currency_id: 'BRL', end_date: null } }),
        });
        await Promise.all([
          admin.from('subscriptions').update({ amount_cents: 3990, plan_code: 'standard' }).eq('id', subscription.id),
          admin.from('profiles').update({ selected_plan: 'standard' }).eq('id', profile.id),
        ]);
        subscription.amount_cents = 3990;
        subscription.plan_code = 'standard';
        profile.selected_plan = 'standard';
      } catch (priceError) {
        console.error('account-status price normalization', priceError);
      }
    }

    const scheduledTime = Date.parse(profile.suspension_scheduled_at || '');
    const scheduledSuspensionDue = profile.role !== 'admin' && Number.isFinite(scheduledTime) && scheduledTime <= Date.now();
    const scheduledPeriodActive = profile.role !== 'admin' && Number.isFinite(scheduledTime) && scheduledTime > Date.now();
    const shouldEvaluateAccess = profile.role !== 'admin' && !['suspended', 'canceled', 'past_due'].includes(profile.access_status);
    const manualAccessActive = profile.role !== 'admin' && (profile.manual_access_lifetime || Date.parse(profile.manual_access_until || '') > Date.now());
    const effectiveAccess = scheduledSuspensionDue
      ? 'suspended'
      : shouldEvaluateAccess
        ? subscription?.status === 'authorized' || manualAccessActive || scheduledPeriodActive ? 'active' : 'pending_payment'
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
        manualAccessUntil: profile.manual_access_until,
        manualAccessLifetime: profile.manual_access_lifetime,
        suspensionScheduledAt: profile.suspension_scheduled_at,
        suspensionReason: profile.suspension_reason,
        forcedSuspensionAt: profile.forced_suspension_at,
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
    return publicError(request, 'Não foi possível consultar a conta.', authenticationStatus(error, 500));
  }
});
