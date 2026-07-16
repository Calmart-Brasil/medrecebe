import { cpfHash, isValidCpf, onlyDigits } from '../_shared/cpf.ts';
import { json, options, publicError } from '../_shared/http.ts';
import { adminClient, publicClient } from '../_shared/supabase.ts';

Deno.serve(async (request) => {
  const preflight = options(request);
  if (preflight) return preflight;
  if (request.method !== 'POST') return publicError(request, 'Método não permitido.', 405);

  try {
    const body = await request.json();
    const cpf = onlyDigits(String(body.cpf || ''));
    const password = String(body.password || '');
    if (!isValidCpf(cpf) || !password) return publicError(request, 'CPF ou senha incorretos.', 401);

    const admin = adminClient();
    const digest = await cpfHash(cpf);
    const { data: profile } = await admin
      .from('profiles')
      .select('id, full_name, email, cpf_last4, role, access_status, selected_plan, manual_access_until, manual_access_lifetime, suspension_scheduled_at, suspension_reason, forced_suspension_at')
      .eq('cpf_hash', digest)
      .maybeSingle();

    if (!profile) return publicError(request, 'CPF ou senha incorretos.', 401);
    const scheduledTime = Date.parse(profile.suspension_scheduled_at || '');
    if (profile.role !== 'admin' && Number.isFinite(scheduledTime) && scheduledTime <= Date.now()) {
      await admin.from('profiles').update({ access_status: 'suspended' }).eq('id', profile.id);
      profile.access_status = 'suspended';
    }
    if (profile.access_status === 'suspended') return publicError(request, 'CPF ou senha incorretos.', 401);

    const { data: auth, error: authError } = await publicClient().auth.signInWithPassword({
      email: profile.email,
      password,
    });
    if (authError || !auth.session) return publicError(request, 'CPF ou senha incorretos.', 401);

    const { data: subscription } = await admin
      .from('subscriptions')
      .select('id, status, amount_cents, currency, current_period_end, last_payment_at, plan_code')
      .eq('user_id', profile.id)
      .eq('is_current', true)
      .maybeSingle();

    const manualAccessActive = profile.role !== 'admin' && (profile.manual_access_lifetime || Date.parse(profile.manual_access_until || '') > Date.now());
    const scheduledPeriodActive = profile.role !== 'admin' && Number.isFinite(scheduledTime) && scheduledTime > Date.now();
    const shouldEvaluateAccess = profile.role !== 'admin' && !['suspended', 'canceled', 'past_due'].includes(profile.access_status);
    const effectiveAccess = shouldEvaluateAccess
      ? subscription?.status === 'authorized' || manualAccessActive || scheduledPeriodActive ? 'active' : 'pending_payment'
      : profile.access_status;
    if (effectiveAccess !== profile.access_status) {
      await admin.from('profiles').update({ access_status: effectiveAccess }).eq('id', profile.id);
    }

    return json(request, {
      session: {
        accessToken: auth.session.access_token,
        refreshToken: auth.session.refresh_token,
        expiresAt: auth.session.expires_at,
      },
      profile: {
        id: profile.id,
        fullName: profile.full_name,
        email: profile.email,
        cpfLast4: profile.cpf_last4,
        role: profile.role,
        accessStatus: effectiveAccess,
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
    console.error('login-cpf', error);
    return publicError(request, 'Não foi possível entrar agora. Tente novamente.', 500);
  }
});
