export function allowedOrigin(request: Request): string {
  const configured = Deno.env.get('APP_ORIGINS') || Deno.env.get('APP_ORIGIN') || 'https://calmart-brasil.github.io';
  const allowed = configured.split(',').map((value) => value.trim().replace(/\/$/, '')).filter(Boolean);
  const origin = request.headers.get('origin') || '';
  return allowed.includes(origin) ? origin : allowed[0];
}

export function corsHeaders(request: Request): HeadersInit {
  return {
    'Access-Control-Allow-Origin': allowedOrigin(request),
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-admin-mfa',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

export function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function options(request: Request): Response | null {
  return request.method === 'OPTIONS' ? new Response('ok', { headers: corsHeaders(request) }) : null;
}

export function publicError(request: Request, message: string, status = 400): Response {
  return json(request, { error: message }, status);
}
