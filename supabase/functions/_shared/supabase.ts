import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} não configurado`);
  return value;
}

export function publicKey(): string {
  return Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || required('SUPABASE_ANON_KEY');
}

export function publicClient(): SupabaseClient {
  return createClient(required('SUPABASE_URL'), publicKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function adminClient(): SupabaseClient {
  const key = Deno.env.get('SUPABASE_SECRET_KEY') || required('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(required('SUPABASE_URL'), key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function authenticatedUser(request: Request): Promise<User> {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new Error('Sessão ausente');
  const { data, error } = await publicClient().auth.getUser(token);
  if (error || !data.user) throw new Error('Sessão inválida ou expirada');
  return data.user;
}

export async function requireAdmin(request: Request): Promise<User> {
  const user = await authenticatedUser(request);
  const { data, error } = await adminClient().from('profiles').select('role').eq('id', user.id).single();
  if (error || data?.role !== 'admin') throw new Error('Acesso administrativo não autorizado');
  return user;
}

function jwtPayload(request: Request): Record<string, unknown> {
  try {
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const encoded = token.split('.')[1] || '';
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    return JSON.parse(atob(normalized));
  } catch {
    return {};
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function requireAdminMfa(request: Request): Promise<User> {
  const user = await requireAdmin(request);
  if (jwtPayload(request).aal === 'aal2') return user;
  const proof = request.headers.get('x-admin-mfa') || '';
  if (proof.length < 32) throw new Error('Confirme o segundo fator para acessar o painel administrativo');
  const { data, error } = await adminClient()
    .from('admin_mfa_sessions')
    .select('id')
    .eq('user_id', user.id)
    .eq('proof_hash', await sha256(proof))
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error || !data) throw new Error('A confirmação em duas etapas expirou');
  return user;
}
