const API = 'https://api.mercadopago.com';

export class MercadoPagoError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MercadoPagoError';
  }
}

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
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = payload?.message || payload?.error || `O provedor de pagamentos respondeu ${response.status}`;
    throw new MercadoPagoError(String(message), response.status, payload);
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

export async function cancelPreapproval(providerId: string): Promise<void> {
  if (!providerId) return;
  const path = `/preapproval/${encodeURIComponent(providerId)}`;
  let current: MercadoPagoSubscription;
  try {
    current = await mercadoPago<MercadoPagoSubscription>(path);
  } catch (error) {
    if (error instanceof MercadoPagoError && error.status === 404) return;
    throw error;
  }
  if (current.status === 'cancelled' || current.status === 'canceled') return;

  let lastError: unknown;
  for (const status of ['cancelled', 'canceled'] as const) {
    try {
      await mercadoPago(path, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      return;
    } catch (error) {
      lastError = error;
      const invalidStatus = error instanceof MercadoPagoError
        && error.status === 400
        && /invalid preapproval status/i.test(error.message);
      if (!invalidStatus) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Não foi possível cancelar a assinatura.');
}

export function accessFromSubscription(status: string): 'active' | 'pending_payment' | 'past_due' | 'canceled' {
  if (status === 'authorized') return 'active';
  if (status === 'paused') return 'past_due';
  if (status === 'cancelled' || status === 'canceled') return 'canceled';
  return 'pending_payment';
}
