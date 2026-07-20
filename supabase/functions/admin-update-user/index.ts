import { cpfHash, isValidCpf, onlyDigits } from '../_shared/cpf.ts';
import { json, options, publicError } from '../_shared/http.ts';
import { cancelPreapproval, mercadoPago } from '../_shared/mercado-pago.ts';
import { adminClient, requireAdmin, authenticationStatus } from '../_shared/supabase.ts';

const durationUnits = new Set(['days', 'weeks', 'months', 'years', 'lifetime']);

function grantEnd(value: number, unit: string): string | null {
  if (unit === 'lifetime') return null;
  const end = new Date();
  if (unit === 'days') end.setUTCDate(end.getUTCDate() + value);
  if (unit === 'weeks') end.setUTCDate(end.getUTCDate() + value * 7);
  if (unit === 'months') end.setUTCMonth(end.getUTCMonth() + value);
  if (unit === 'years') end.setUTCFullYear(end.getUTCFullYear() + value);
  return end.toISOString();
}

function paidPeriodEnd(subscription: Record<string, unknown> | null): string | null {
  const providerEnd = String(subscription?.current_period_end || '');
  if (Number.isFinite(Date.parse(providerEnd)) && Date.parse(providerEnd) > Date.now()) return providerEnd;
  const lastPayment = String(subscription?.last_payment_at || '');
  if (!Number.isFinite(Date.parse(lastPayment))) return null;
  const end = new Date(lastPayment);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return end.toISOString();
}

async function updateProviderSubscriptionStatus(providerId: string, status: 'authorized' | 'paused'): Promise<void> {
  if (!providerId) return;
  await mercadoPago(`/preapproval/${encodeURIComponent(providerId)}`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}

Deno.serve(async (request) => {
  const preflight = options(request);
  if (preflight) return preflight;
  if (request.method !== 'POST') return publicError(request, 'Método não permitido.', 405);

  try {
    const adminUser = await requireAdmin(request);
    const body = await request.json().catch(() => ({}));
    const targetUserId = String(body.userId || '');
    const action = String(body.action || '');
    if (!targetUserId || !action) return publicError(request, 'Atualização inválida.', 400);

    const admin = adminClient();
    const { data: previous, error: lookupError } = await admin
      .from('profiles')
      .select('id, role, full_name, email, cpf_last4, access_status, manual_access_until, manual_access_lifetime, suspension_scheduled_at, suspension_reason, forced_suspension_at')
      .eq('id', targetUserId)
      .single();
    if (lookupError || !previous) return publicError(request, 'Usuário não encontrado.', 404);
    if (previous.role === 'admin') return publicError(request, 'Contas administrativas não podem ser alteradas por esta tela.', 403);

    const { data: subscription } = await admin
      .from('subscriptions')
      .select('id, status, provider_subscription_id, current_period_end, last_payment_at')
      .eq('user_id', targetUserId)
      .eq('is_current', true)
      .maybeSingle();

    let changes: Record<string, unknown> = {};
    let auditAction = action;
    let auditNext: Record<string, unknown> = {};

    if (action === 'delete_user') {
      if (body.confirm !== true) return publicError(request, 'Confirme a exclusão definitiva do cadastro.', 400);
      await cancelPreapproval(String(subscription?.provider_subscription_id || ''));
      await admin.from('admin_audit_log').insert({
        admin_user_id: adminUser.id,
        target_user_id: targetUserId,
        action: 'user_deleted',
        previous_value: previous,
        next_value: { deleted: true },
      });
      const { error: deleteError } = await admin.auth.admin.deleteUser(targetUserId);
      if (deleteError) throw deleteError;
      return json(request, { deleted: true, userId: targetUserId });
    }

    if (action === 'update_profile') {
      const fullName = String(body.fullName || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const cpf = onlyDigits(String(body.cpf || ''));
      if (fullName.length < 3) return publicError(request, 'Informe o nome completo.', 400);
      if (!/^\S+@\S+\.\S+$/.test(email)) return publicError(request, 'Informe um e-mail válido.', 400);
      const { data: duplicateEmail } = await admin.from('profiles').select('id').eq('email', email).neq('id', targetUserId).maybeSingle();
      if (duplicateEmail) return publicError(request, 'Este e-mail já está em uso.', 409);
      changes = { full_name: fullName, email };
      if (cpf) {
        if (!isValidCpf(cpf)) return publicError(request, 'Informe um CPF válido.', 400);
        const digest = await cpfHash(cpf);
        const { data: duplicateCpf } = await admin.from('profiles').select('id').eq('cpf_hash', digest).neq('id', targetUserId).maybeSingle();
        if (duplicateCpf) return publicError(request, 'Este CPF já está em uso.', 409);
        changes.cpf_hash = digest;
        changes.cpf_last4 = cpf.slice(-4);
      }
      const { error: authError } = await admin.auth.admin.updateUserById(targetUserId, {
        email,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (authError) throw authError;
      auditNext = { fullName, email, cpfChanged: Boolean(cpf) };
    } else if (action === 'grant_freemium') {
      const durationUnit = String(body.durationUnit || 'days');
      const durationValue = Math.max(1, Math.min(3650, Number(body.durationValue) || 0));
      if (!durationUnits.has(durationUnit)) return publicError(request, 'Validade Freemium inválida.', 400);
      const lifetime = durationUnit === 'lifetime';
      const manualAccessUntil = grantEnd(durationValue, durationUnit);
      changes = {
        access_status: 'active',
        manual_access_until: manualAccessUntil,
        manual_access_lifetime: lifetime,
        suspension_scheduled_at: null,
        suspension_reason: null,
        forced_suspension_at: null,
      };
      auditNext = { durationUnit, durationValue: lifetime ? null : durationValue, manualAccessUntil, lifetime };
    } else if (action === 'revoke_freemium') {
      const paidAccess = subscription?.status === 'authorized';
      changes = { manual_access_until: null, manual_access_lifetime: false, access_status: paidAccess ? 'active' : 'pending_payment' };
      auditNext = { accessStatus: changes.access_status };
    } else if (action === 'schedule_suspension') {
      const suspensionAt = paidPeriodEnd(subscription);
      if (!suspensionAt) return publicError(request, 'Não foi possível identificar o fim do período pago. Use a suspensão imediata somente quando houver infração.', 409);
      await updateProviderSubscriptionStatus(String(subscription?.provider_subscription_id || ''), 'paused');
      if (subscription?.id) {
        await admin.from('subscriptions').update({ status: 'paused' }).eq('id', subscription.id);
      }
      changes = {
        access_status: 'active',
        suspension_scheduled_at: suspensionAt,
        suspension_reason: 'administrative_end_of_cycle',
        forced_suspension_at: null,
        manual_access_until: null,
        manual_access_lifetime: false,
      };
      auditNext = { suspensionAt, reason: 'administrative_end_of_cycle' };
    } else if (action === 'force_suspension') {
      await cancelPreapproval(String(subscription?.provider_subscription_id || ''));
      if (subscription?.id) {
        await admin.from('subscriptions').update({ status: 'canceled', canceled_at: new Date().toISOString() }).eq('id', subscription.id);
      }
      const forcedAt = new Date().toISOString();
      changes = {
        access_status: 'suspended',
        suspension_scheduled_at: null,
        suspension_reason: 'terms_violation',
        forced_suspension_at: forcedAt,
        manual_access_until: null,
        manual_access_lifetime: false,
      };
      auditNext = { forcedAt, reason: 'terms_violation', proportionalRefund: false };
    } else if (action === 'clear_suspension') {
      if (subscription?.status === 'paused' && subscription.provider_subscription_id) {
        await updateProviderSubscriptionStatus(String(subscription.provider_subscription_id), 'authorized');
        await admin.from('subscriptions').update({ status: 'authorized', canceled_at: null }).eq('id', subscription.id);
        subscription.status = 'authorized';
      }
      const paidAccess = subscription?.status === 'authorized';
      const freemiumAccess = previous.manual_access_lifetime || Date.parse(previous.manual_access_until || '') > Date.now();
      changes = {
        access_status: paidAccess || freemiumAccess ? 'active' : 'pending_payment',
        suspension_scheduled_at: null,
        suspension_reason: null,
        forced_suspension_at: null,
      };
      auditNext = { accessStatus: changes.access_status };
    } else {
      return publicError(request, 'Ação administrativa inválida.', 400);
    }

    const { data: updated, error: updateError } = await admin
      .from('profiles')
      .update(changes)
      .eq('id', targetUserId)
      .select('id, full_name, email, cpf_last4, access_status, manual_access_until, manual_access_lifetime, suspension_scheduled_at, suspension_reason, forced_suspension_at, updated_at')
      .single();
    if (updateError) throw updateError;

    await admin.from('admin_audit_log').insert({
      admin_user_id: adminUser.id,
      target_user_id: targetUserId,
      action: auditAction,
      previous_value: previous,
      next_value: auditNext,
    });

    return json(request, { user: updated });
  } catch (error) {
    console.error('admin-update-user', error);
    return publicError(request, 'Não foi possível atualizar o usuário.', authenticationStatus(error, 500));
  }
});
