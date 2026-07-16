import { json, options, publicError } from '../_shared/http.ts';
import { adminClient, requireAdmin } from '../_shared/supabase.ts';

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  const preflight = options(request);
  if (preflight) return preflight;
  if (request.method !== 'POST') return publicError(request, 'Método não permitido.', 405);

  try {
    const user = await requireAdmin(request);
    const admin = adminClient();
    const { data: challenge, error } = await admin
      .from('admin_mfa_email_challenges')
      .select('user_id, expires_at')
      .eq('user_id', user.id)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error || !challenge) return publicError(request, 'A confirmação por e-mail expirou. Solicite um novo código.', 401);

    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const proof = base64Url(bytes);
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    const { error: insertError } = await admin.from('admin_mfa_sessions').insert({
      user_id: user.id,
      proof_hash: await sha256(proof),
      expires_at: expiresAt,
    });
    if (insertError) throw insertError;
    await admin.from('admin_mfa_email_challenges').delete().eq('user_id', user.id);
    await admin.from('admin_mfa_sessions').delete().eq('user_id', user.id).lt('expires_at', new Date().toISOString());
    return json(request, { verified: true, proof, expiresAt });
  } catch (error) {
    console.error('admin-mfa-email-complete', error);
    return publicError(request, error instanceof Error ? error.message : 'Não foi possível concluir a confirmação.', 403);
  }
});
