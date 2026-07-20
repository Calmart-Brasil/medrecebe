import { cpfHash, isValidCpf, onlyDigits } from '../_shared/cpf.ts';
import { json, options, publicError } from '../_shared/http.ts';
import { clientAddress, consumeRateLimit } from '../_shared/rate-limit.ts';
import { adminClient, publicClient } from '../_shared/supabase.ts';

const GENERIC_MESSAGE = 'Se houver uma conta para este CPF, enviaremos as instruções ao e-mail cadastrado.';

function recoveryRedirectUrl(): string {
  const configured = Deno.env.get('APP_URL') || 'https://medrecebe.com.br/app.html';
  const url = new URL(configured);
  url.pathname = url.pathname.endsWith('.html') ? url.pathname : `${url.pathname.replace(/\/$/, '')}/app.html`;
  url.search = '';
  url.hash = '';
  url.searchParams.set('reset-password', '1');
  return url.toString();
}

async function accepted(request: Request, startedAt: number): Promise<Response> {
  const minimumDuration = 700 + Math.floor(Math.random() * 150);
  const remaining = minimumDuration - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  return json(request, { accepted: true, message: GENERIC_MESSAGE }, 202);
}

Deno.serve(async (request) => {
  const preflight = options(request);
  if (preflight) return preflight;
  if (request.method !== 'POST') return publicError(request, 'Método não permitido.', 405);

  const startedAt = Date.now();
  try {
    const body = await request.json().catch(() => ({}));
    const cpf = onlyDigits(String(body.cpf || ''));
    const accountSubject = cpf || 'invalid';
    const [ipLimit, accountLimit] = await Promise.all([
      consumeRateLimit('password_reset_ip', clientAddress(request), 10, 60 * 60, 60 * 60),
      consumeRateLimit('password_reset_account', accountSubject, 3, 60 * 60, 60 * 60),
    ]);
    if (!ipLimit.allowed || !accountLimit.allowed) {
      const retryAfter = Math.max(ipLimit.retryAfterSeconds, accountLimit.retryAfterSeconds, 1);
      return publicError(
        request,
        'Muitas solicitações. Aguarde antes de tentar novamente.',
        429,
        { 'Retry-After': String(retryAfter) },
      );
    }

    if (!isValidCpf(cpf)) return accepted(request, startedAt);

    const digest = await cpfHash(cpf);
    const { data: profile, error: profileError } = await adminClient()
      .from('profiles')
      .select('email')
      .eq('cpf_hash', digest)
      .maybeSingle();
    if (profileError) throw profileError;

    if (profile?.email) {
      const { error: resetError } = await publicClient().auth.resetPasswordForEmail(profile.email, {
        redirectTo: recoveryRedirectUrl(),
      });
      if (resetError) console.error('password reset delivery unavailable', { code: resetError.code, status: resetError.status });
    }

    return accepted(request, startedAt);
  } catch (error) {
    console.error('request-password-reset unavailable', error instanceof Error ? { name: error.name, message: error.message } : 'unknown');
    return accepted(request, startedAt);
  }
});
