import { json, options, publicError } from '../_shared/http.ts';
import { adminClient, authenticatedUser } from '../_shared/supabase.ts';

Deno.serve(async (request) => {
  const preflight = options(request);
  if (preflight) return preflight;
  if (request.method !== 'POST') return publicError(request, 'Método não permitido.', 405);

  try {
    const user = await authenticatedUser(request);
    const admin = adminClient();
    const { data: profile, error } = await admin
      .from('profiles')
      .select('id, full_name, email, cpf_last4, role, access_status')
      .eq('id', user.id)
      .single();
    if (error || !profile) return publicError(request, 'Conta não encontrada.', 404);

    const { data: subscription } = await admin
      .from('subscriptions')
      .select('id, status, amount_cents, currency, current_period_end, last_payment_at')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .maybeSingle();

    return json(request, {
      profile: {
        id: profile.id,
        fullName: profile.full_name,
        email: profile.email,
        cpfLast4: profile.cpf_last4,
        role: profile.role,
        accessStatus: profile.access_status,
      },
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            amountCents: subscription.amount_cents,
            currency: subscription.currency,
            currentPeriodEnd: subscription.current_period_end,
            lastPaymentAt: subscription.last_payment_at,
          }
        : null,
    });
  } catch (error) {
    console.error('account-status', error);
    return publicError(request, error instanceof Error ? error.message : 'Sessão inválida.', 401);
  }
});
