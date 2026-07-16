import { accessFromSubscription, mercadoPago, type MercadoPagoSubscription } from './mercado-pago.ts';
import { adminClient } from './supabase.ts';

const MONTHLY_AMOUNT = 29.9;

interface MercadoPagoPayment {
  id?: string | number;
  status?: string;
  external_reference?: string;
  preapproval_id?: string;
  transaction_amount?: number;
  date_approved?: string;
  date_created?: string;
}

interface MercadoPagoPaymentSearch {
  results?: MercadoPagoPayment[];
}

function assertNoError(error: unknown): void {
  if (error) throw error;
}

export async function syncPreapproval(preapprovalId: string, expectedUserId = ''): Promise<MercadoPagoSubscription> {
  const admin = adminClient();
  const subscription = await mercadoPago<MercadoPagoSubscription>(`/preapproval/${encodeURIComponent(preapprovalId)}`);
  const userId = String(subscription.external_reference || '');
  if (!userId) throw new Error('Assinatura sem external_reference');
  if (expectedUserId && userId !== expectedUserId) throw new Error('Assinatura não pertence ao usuário autenticado');

  const { data: current, error: currentError } = await admin
    .from('subscriptions')
    .select('id')
    .eq('provider_subscription_id', subscription.id)
    .maybeSingle();
  assertNoError(currentError);

  if (current) {
    const { error } = await admin
      .from('subscriptions')
      .update({
        status: subscription.status,
        current_period_end: subscription.next_payment_date || null,
      })
      .eq('id', current.id);
    assertNoError(error);
  } else {
    const { error: previousError } = await admin
      .from('subscriptions')
      .update({ is_current: false })
      .eq('user_id', userId)
      .eq('is_current', true);
    assertNoError(previousError);
    const { error } = await admin.from('subscriptions').insert({
      user_id: userId,
      provider_subscription_id: subscription.id,
      status: subscription.status,
      current_period_end: subscription.next_payment_date || null,
    });
    assertNoError(error);
  }

  const { error: profileError } = await admin
    .from('profiles')
    .update({ access_status: accessFromSubscription(subscription.status) })
    .eq('id', userId);
  assertNoError(profileError);
  return subscription;
}

export async function syncPayment(paymentId: string, expectedUserId = ''): Promise<MercadoPagoPayment> {
  const payment = await mercadoPago<MercadoPagoPayment>(`/v1/payments/${encodeURIComponent(paymentId)}`);
  const userId = String(payment.external_reference || '');
  if (!userId) throw new Error('Pagamento sem external_reference');
  if (expectedUserId && userId !== expectedUserId) throw new Error('Pagamento não pertence ao usuário autenticado');
  if (Number(payment.transaction_amount || 0) !== MONTHLY_AMOUNT) throw new Error('Valor do pagamento não corresponde ao plano MedRecebe');

  const approved = payment.status === 'approved';
  const admin = adminClient();
  const subscriptionUpdate: Record<string, string> = {
    status: approved ? 'authorized' : String(payment.status || 'rejected'),
  };
  if (approved) subscriptionUpdate.last_payment_at = String(payment.date_approved || payment.date_created || new Date().toISOString());

  let updateQuery = admin
    .from('subscriptions')
    .update(subscriptionUpdate)
    .eq('user_id', userId)
    .eq('is_current', true);
  if (payment.preapproval_id) updateQuery = updateQuery.eq('provider_subscription_id', payment.preapproval_id);
  const { error: subscriptionError } = await updateQuery;
  assertNoError(subscriptionError);

  const { error: profileError } = await admin
    .from('profiles')
    .update({ access_status: approved ? 'active' : 'past_due' })
    .eq('id', userId);
  assertNoError(profileError);
  return payment;
}

export async function reconcileUserBilling(userId: string, preapprovalId: string, subscriptionCreatedAt = ''): Promise<void> {
  const subscription = await syncPreapproval(preapprovalId, userId);
  if (subscription.status !== 'pending') return;

  const query = new URLSearchParams({
    external_reference: userId,
    sort: 'date_created',
    criteria: 'desc',
    limit: '10',
  });
  const payments = await mercadoPago<MercadoPagoPaymentSearch>(`/v1/payments/search?${query.toString()}`);
  const subscriptionTime = Date.parse(subscriptionCreatedAt || '');
  const approved = (payments.results || []).find((payment) => {
    if (payment.status !== 'approved' || Number(payment.transaction_amount || 0) !== MONTHLY_AMOUNT) return false;
    if (payment.preapproval_id && payment.preapproval_id !== preapprovalId) return false;
    const paymentTime = Date.parse(payment.date_approved || payment.date_created || '');
    return !Number.isFinite(subscriptionTime) || (Number.isFinite(paymentTime) && paymentTime >= subscriptionTime - 300_000);
  });
  if (approved?.id) await syncPayment(String(approved.id), userId);
}
