import { adminClient } from './supabase.ts';

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

function requestAddress(request: Request): string {
  const cloudflare = request.headers.get('cf-connecting-ip')?.trim();
  if (cloudflare) return cloudflare.slice(0, 128);
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded.slice(0, 128);
  const direct = request.headers.get('x-real-ip')?.trim();
  return (direct || 'unknown').slice(0, 128);
}

async function hashedKey(scope: string, value: string): Promise<string> {
  const pepper = Deno.env.get('RATE_LIMIT_PEPPER') || Deno.env.get('CPF_PEPPER');
  if (!pepper) throw new Error('RATE_LIMIT_PEPPER ou CPF_PEPPER nao configurado');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${scope}:${value}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function clientAddress(request: Request): string {
  return requestAddress(request);
}

export async function consumeRateLimit(
  scope: string,
  subject: string,
  limit: number,
  windowSeconds: number,
  blockSeconds: number,
): Promise<RateLimitResult> {
  try {
    const keyHash = await hashedKey(scope, subject || 'empty');
    const { data, error } = await adminClient().rpc('consume_security_rate_limit', {
      p_scope: scope,
      p_key_hash: keyHash,
      p_limit: limit,
      p_window_seconds: windowSeconds,
      p_block_seconds: blockSeconds,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return {
      allowed: row?.allowed !== false,
      retryAfterSeconds: Math.max(0, Number(row?.retry_after_seconds || 0)),
    };
  } catch (error) {
    // Falha aberta evita indisponibilidade total caso o contador esteja temporariamente fora do ar.
    console.error('security rate limit unavailable', { scope, error });
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export async function clearRateLimit(scope: string, subject: string): Promise<void> {
  try {
    const keyHash = await hashedKey(scope, subject || 'empty');
    const { error } = await adminClient().rpc('clear_security_rate_limit', {
      p_scope: scope,
      p_key_hash: keyHash,
    });
    if (error) throw error;
  } catch (error) {
    console.error('security rate limit cleanup unavailable', { scope, error });
  }
}
