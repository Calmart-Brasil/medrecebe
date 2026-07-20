function configuredOrigins(): string[] {
  const configured = Deno.env.get('APP_ORIGINS') || Deno.env.get('APP_ORIGIN') || 'https://medrecebe.com.br,https://www.medrecebe.com.br,https://calmart-brasil.github.io';
  return configured.split(',').map((value) => value.trim().replace(/\/$/, '')).filter(Boolean);
}

export function allowedOrigin(request: Request): string {
  const allowed = configuredOrigins();
  const origin = request.headers.get('origin') || '';
  if (!origin) return allowed[0] || '';
  const normalized = origin.replace(/\/$/, '');
  return allowed.includes(normalized) ? normalized : '';
}

export function corsHeaders(request: Request): HeadersInit {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
  const origin = allowedOrigin(request);
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

export function json(request: Request, body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

export function options(request: Request): Response | null {
  if (request.method !== 'OPTIONS') return null;
  if (request.headers.get('origin') && !allowedOrigin(request)) {
    return new Response('Origin not allowed', { status: 403, headers: { Vary: 'Origin' } });
  }
  return new Response('ok', { headers: corsHeaders(request) });
}

export function publicError(request: Request, message: string, status = 400, extraHeaders: Record<string, string> = {}): Response {
  return json(request, { error: message }, status, extraHeaders);
}
