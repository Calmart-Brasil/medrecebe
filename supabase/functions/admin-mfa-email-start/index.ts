import { json, options, publicError } from '../_shared/http.ts';
import { adminClient, publicClient, requireAdmin } from '../_shared/supabase.ts';

function maskedEmail(email: string): string {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(2, name.length - 2))}@${domain}`;
}

Deno.serve(async (request) => {
  const preflight = options(request);
  if (preflight) return preflight;
  if (request.method !== 'POST') return publicError(request, 'Método não permitido.', 405);

  try {
    const user = await requireAdmin(request);
    const admin = adminClient();
    const { data: profile, error } = await admin.from('profiles').select('email').eq('id', user.id).single();
    if (error || !profile?.email) return publicError(request, 'Conta administrativa não encontrada.', 404);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error: challengeError } = await admin
      .from('admin_mfa_email_challenges')
      .upsert({ user_id: user.id, expires_at: expiresAt, created_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (challengeError) throw challengeError;
    const { error: otpError } = await publicClient().auth.signInWithOtp({
      email: profile.email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${Deno.env.get('APP_URL') || 'https://www.medrecebe.com.br'}/admin.html?mfa=email`,
      },
    });
    if (otpError) throw otpError;
    return json(request, { sent: true, email: profile.email, maskedEmail: maskedEmail(profile.email), expiresAt });
  } catch (error) {
    console.error('admin-mfa-email-start', error);
    return publicError(request, 'Não foi possível enviar a confirmação por e-mail.', 403);
  }
});
