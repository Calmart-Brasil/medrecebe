const API = 'https://api.mercadopago.com';

function token(): string {
  const value = Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN');
  if (!value) throw new Error('MERCADO_PAGO_ACCESS_TOKEN não configurado');
  return value;
}

export async function mercadoPago<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.message || payload?.error || `O provedor de pagamentos respondeu ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export interface MercadoPagoSubscription {
  id: string;
  init_point?: string;
  status: string;
  external_reference?: string;
  payer_email?: string;
  next_payment_date?: string;
}

export function accessFromSubscription(status: string): 'active' | 'pending_payment' | 'past_due' | 'canceled' {
  if (status === 'authorized') return 'active';
  if (status === 'paused') return 'past_due';
  if (status === 'cancelled' || status === 'canceled') return 'canceled';
  return 'pending_payment';
}
