import { cpfHash, isValidCpf, onlyDigits } from '../_shared/cpf.ts';
import { json, options, publicError } from '../_shared/http.ts';
import { adminClient, publicClient } from '../_shared/supabase.ts';

Deno.serve(async (request) => {
  const preflight = options(request);
  if (preflight) return preflight;
  if (request.method !== 'POST') return publicError(request, 'Método não permitido.', 405);

  try {
    const body = await request.json();
    const fullName = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const cpf = onlyDigits(String(body.cpf || ''));
    const password = String(body.password || '');
    const planCode = body.planCode === 'web' ? 'web' : 'mobile';

    if (fullName.length < 3) return publicError(request, 'Informe seu nome completo.');
    if (!isValidCpf(cpf)) return publicError(request, 'Informe um CPF válido.');
    if (!/^\S+@\S+\.\S+$/.test(email)) return publicError(request, 'Informe um e-mail válido.');
    if (password.length < 8) return publicError(request, 'A senha deve ter pelo menos oito caracteres.');

    const admin = adminClient();
    const digest = await cpfHash(cpf);
    const { data: existing } = await admin.from('profiles').select('id').eq('cpf_hash', digest).maybeSingle();
    if (existing) return publicError(request, 'Já existe um acesso para este CPF.', 409);

    const { data: auth, error: authError } = await publicClient().auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (authError || !auth.user) return publicError(request, authError?.message || 'Não foi possível criar o acesso.', 400);
    if (Array.isArray(auth.user.identities) && auth.user.identities.length === 0) {
      return publicError(request, 'Já existe uma conta para este e-mail.', 409);
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

    return json(request, {
      requiresEmailConfirmation: !auth.session,
      session: auth.session
        ? {
            accessToken: auth.session.access_token,
            refreshToken: auth.session.refresh_token,
            expiresAt: auth.session.expires_at,
          }
        : null,
      profile: {
        id: auth.user.id,
        fullName,
        email,
        cpfLast4: cpf.slice(-4),
        role: 'user',
        accessStatus: 'pending_payment',
        planCode,
        trialEndsAt: null,
      },
      subscription: null,
    }, 201);
  } catch (error) {
    console.error('register', error);
    return publicError(request, 'Não foi possível concluir o cadastro. Tente novamente.', 500);
  }
});
