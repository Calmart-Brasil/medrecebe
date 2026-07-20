import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';

export class AuthenticationError extends Error {}
export class AuthorizationError extends Error {}

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
  if (!token) throw new AuthenticationError('Sessão ausente');
  const { data, error } = await publicClient().auth.getUser(token);
  if (error || !data.user) throw new AuthenticationError('Sessão inválida ou expirada');
  let sessionId = '';
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
    sessionId = String(JSON.parse(atob(padded)).session_id || '');
  } catch {
    throw new AuthenticationError('Sessão inválida ou expirada');
  }
  if (!sessionId) throw new AuthenticationError('Sessão inválida ou expirada');
  const { data: sessionActive, error: sessionError } = await adminClient().rpc('is_auth_session_active', {
    p_session_id: sessionId,
    p_user_id: data.user.id,
  });
  if (sessionError || sessionActive !== true) throw new AuthenticationError('Sessão inválida ou expirada');
  return data.user;
}

export async function requireAdmin(request: Request): Promise<User> {
  const user = await authenticatedUser(request);
  const { data, error } = await adminClient().from('profiles').select('role').eq('id', user.id).single();
  if (error || data?.role !== 'admin') throw new AuthorizationError('Acesso administrativo não autorizado');
  return user;
}

export function authenticationStatus(error: unknown, fallback: number): number {
  if (error instanceof AuthenticationError) return 401;
  if (error instanceof AuthorizationError) return 403;
  return fallback;
}
