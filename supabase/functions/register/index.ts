import { cpfHash, isValidCpf, onlyDigits } from '../_shared/cpf.ts';
import { json, options, publicError } from '../_shared/http.ts';
import { clientAddress, consumeRateLimit } from '../_shared/rate-limit.ts';
import { adminClient, publicClient } from '../_shared/supabase.ts';

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
    const planCode = 'standard';

    if (fullName.length < 3) return publicError(request, 'Informe seu nome completo.');
    if (!isValidCpf(cpf)) return publicError(request, 'Informe um CPF válido.');
    if (!/^\S+@\S+\.\S+$/.test(email)) return publicError(request, 'Informe um e-mail válido.');
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
      options: { data: { full_name: fullName } },
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
      selected_plan: planCode,
      trial_ends_at: null,
      access_status: 'pending_payment',
    });
    if (profileError) {
      await admin.auth.admin.deleteUser(auth.user.id);
      throw profileError;
    }

    return accepted(request, startedAt);
  } catch (error) {
    console.error('register', error);
    return publicError(request, 'Não foi possível concluir o cadastro. Tente novamente.', 500);
  }
});
