import { cpfHash, isValidCpf, onlyDigits } from '../_shared/cpf.ts';
import { json, options, publicError } from '../_shared/http.ts';
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

Deno.serve(async (request) => {
  const preflight = options(request);
  if (preflight) return preflight;
  if (request.method !== 'POST') return publicError(request, 'Método não permitido.', 405);

  try {
    const adminUser = await requireAdmin(request);
    const body = await request.json().catch(() => ({}));
    const fullName = String(body.fullName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const cpf = onlyDigits(String(body.cpf || ''));
    const password = String(body.password || '');
    const durationUnit = String(body.durationUnit || 'days');
    const durationValue = Math.max(1, Math.min(3650, Number(body.durationValue) || 0));

    if (fullName.length < 3) return publicError(request, 'Informe o nome completo.', 400);
    if (!/^\S+@\S+\.\S+$/.test(email)) return publicError(request, 'Informe um e-mail válido.', 400);
    if (!isValidCpf(cpf)) return publicError(request, 'Informe um CPF válido.', 400);
    if (password.length < 8) return publicError(request, 'A senha provisória deve ter pelo menos oito caracteres.', 400);
    if (!durationUnits.has(durationUnit)) return publicError(request, 'Validade Freemium inválida.', 400);
    if (durationUnit !== 'lifetime' && !Number.isFinite(durationValue)) return publicError(request, 'Informe a duração do acesso.', 400);

    const admin = adminClient();
    const digest = await cpfHash(cpf);
    const [{ data: duplicateEmail }, { data: duplicateCpf }] = await Promise.all([
      admin.from('profiles').select('id').eq('email', email).maybeSingle(),
      admin.from('profiles').select('id').eq('cpf_hash', digest).maybeSingle(),
    ]);
    if (duplicateEmail || duplicateCpf) return publicError(request, 'Já existe um usuário com este e-mail ou CPF.', 409);

    const { data: auth, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (authError || !auth.user) return publicError(request, authError?.message || 'Não foi possível criar o acesso.', 400);

    const lifetime = durationUnit === 'lifetime';
    const manualAccessUntil = grantEnd(durationValue, durationUnit);
    const { error: profileError } = await admin.from('profiles').insert({
      id: auth.user.id,
      full_name: fullName,
      email,
      cpf_hash: digest,
      cpf_last4: cpf.slice(-4),
      selected_plan: 'standard',
      access_status: 'active',
      manual_access_until: manualAccessUntil,
      manual_access_lifetime: lifetime,
      trial_ends_at: null,
    });
    if (profileError) {
      await admin.auth.admin.deleteUser(auth.user.id);
      throw profileError;
    }

    await admin.from('admin_audit_log').insert({
      admin_user_id: adminUser.id,
      target_user_id: auth.user.id,
      action: 'freemium_user_created',
      next_value: { fullName, email, durationUnit, durationValue: lifetime ? null : durationValue, manualAccessUntil, lifetime },
    });

    return json(request, { created: true, userId: auth.user.id, manualAccessUntil, lifetime }, 201);
  } catch (error) {
    console.error('admin-create-user', error);
    return publicError(request, 'Não foi possível criar o usuário.', authenticationStatus(error, 500));
  }
});
