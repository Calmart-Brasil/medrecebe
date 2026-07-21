import { cpfHash, isValidCpf, onlyDigits } from '../_shared/cpf.ts';
import { json, options, publicError } from '../_shared/http.ts';
import { clientAddress, consumeRateLimit } from '../_shared/rate-limit.ts';
import { isValidPhone, normalizePhoneCountryCode, normalizePhoneNumber } from '../_shared/phone.ts';
import { normalizeSpecialties } from '../_shared/medical-specialties.ts';
import { adminClient, publicClient } from '../_shared/supabase.ts';

const UFS = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);

function normalizeCrmNumber(value: unknown): string {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 13);
}

async function accepted(request: Request, startedAt: number): Promise<Response> {
  const minimumDuration = 600 + Math.floor(Math.random() * 150);
  const remaining = minimumDuration - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  return json(request, {
    accepted: true,
    requiresLogin: true,
    message: 'Cadastro recebido. Confirme seu e-mail, se solicitado, e entre com CPF e senha.',
  }, 202, { 'Cache-Control': 'no-store' });
}

Deno.serve(async (request) => {
  const preflight = options(request);
  if (preflight) return preflight;
  if (request.method !== 'POST') return publicError(request, 'Método não permitido.', 405);

  try {
    const startedAt = Date.now();
    const body = await request.json().catch(() => ({}));
    const fullName = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const cpf = onlyDigits(String(body.cpf || ''));
    const password = String(body.password || '');
    const phoneCountryCode = normalizePhoneCountryCode(String(body.phoneCountryCode || '+55'));
    const phoneNumber = normalizePhoneNumber(String(body.phoneNumber || ''));
    const crmUf = String(body.crmUf || '').trim().toUpperCase();
    const crmNumber = normalizeCrmNumber(body.crmNumber);
    const specialties = normalizeSpecialties(body.specialties);
    const planCode = 'freemium';

    if (fullName.length < 3) return publicError(request, 'Informe seu nome completo.');
    if (!isValidCpf(cpf)) return publicError(request, 'Informe um CPF válido.');
    if (!/^\S+@\S+\.\S+$/.test(email)) return publicError(request, 'Informe um e-mail válido.');
    if (!isValidPhone(phoneCountryCode, phoneNumber)) return publicError(request, 'Informe um celular válido com DDD.');
    if (!UFS.has(crmUf)) return publicError(request, 'Selecione a UF do CRM.');
    if (!/^(EME)?[0-9]{1,10}P?$/.test(crmNumber)) return publicError(request, 'Informe um número de CRM válido.');
    if (password.length < 8) return publicError(request, 'A senha deve ter pelo menos oito caracteres.');

    const [ipLimit, cpfLimit, emailLimit] = await Promise.all([
      consumeRateLimit('register_ip', clientAddress(request), 10, 60 * 60, 60 * 60),
      consumeRateLimit('register_cpf', cpf, 3, 60 * 60, 60 * 60),
      consumeRateLimit('register_email', email, 3, 60 * 60, 60 * 60),
    ]);
    if (!ipLimit.allowed || !cpfLimit.allowed || !emailLimit.allowed) {
      const retryAfter = Math.max(ipLimit.retryAfterSeconds, cpfLimit.retryAfterSeconds, emailLimit.retryAfterSeconds, 1);
      return publicError(
        request,
        'Muitas tentativas. Aguarde e tente novamente.',
        429,
        { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' },
      );
    }

    const admin = adminClient();
    const digest = await cpfHash(cpf);
    const { data: existing } = await admin.from('profiles').select('id').eq('cpf_hash', digest).maybeSingle();
    if (existing) return accepted(request, startedAt);

    const { data: auth, error: authError } = await publicClient().auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, phone_country_code: phoneCountryCode, phone_number: phoneNumber } },
    });
    if (authError || !auth.user) {
      console.error('register auth', { code: authError?.code, status: authError?.status });
      return accepted(request, startedAt);
    }
    if (Array.isArray(auth.user.identities) && auth.user.identities.length === 0) {
      return accepted(request, startedAt);
    }

    const { error: profileError } = await admin.from('profiles').insert({
      id: auth.user.id,
      full_name: fullName,
      email,
      cpf_hash: digest,
      cpf_last4: cpf.slice(-4),
      phone_country_code: phoneCountryCode,
      phone_number: phoneNumber,
      selected_plan: planCode,
      trial_ends_at: null,
      access_status: 'active',
    });
    if (profileError) {
      await admin.auth.admin.deleteUser(auth.user.id);
      throw profileError;
    }

    const { error: professionalProfileError } = await admin.from('professional_profiles').insert({
      user_id: auth.user.id,
      opportunity_uf: crmUf,
      opportunity_radius_km: 100,
    });
    if (professionalProfileError) {
      await admin.auth.admin.deleteUser(auth.user.id);
      throw professionalProfileError;
    }
    const { data: registration, error: registrationError } = await admin.from('professional_registrations').insert({
      user_id: auth.user.id,
      crm_uf: crmUf,
      crm_number: crmNumber,
      is_primary: true,
      registration_status: 'self_reported',
      verification_source: 'self_reported',
    }).select('id').single();
    if (registrationError || !registration) {
      await admin.auth.admin.deleteUser(auth.user.id);
      throw registrationError || new Error('Registro profissional não criado');
    }
    if (specialties.length) {
      const { error: specialtiesError } = await admin.from('professional_specialties').insert(specialties.map((item) => ({
        user_id: auth.user.id,
        registration_id: registration.id,
        specialty_code: item.code,
        specialty_name: item.name,
        rqe_number: item.rqeNumber || null,
        verification_status: 'self_reported',
        verification_source: 'self_reported',
        confirmed_by_user: true,
      })));
      if (specialtiesError) {
        await admin.auth.admin.deleteUser(auth.user.id);
        throw specialtiesError;
      }
    }

    return accepted(request, startedAt);
  } catch (error) {
    console.error('register', error);
    return publicError(request, 'Não foi possível concluir o cadastro. Tente novamente.', 500);
  }
});
