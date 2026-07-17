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
