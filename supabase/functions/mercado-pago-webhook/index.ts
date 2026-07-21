import { WebhookSignatureValidator } from 'npm:mercadopago@2';

import { syncPayment, syncPreapproval } from '../_shared/billing.ts';
import { mercadoPago } from '../_shared/mercado-pago.ts';
import { adminClient } from '../_shared/supabase.ts';

interface WebhookBody {
  id?: string | number;
  action?: string;
  type?: string;
  date_created?: string;
  data?: { id?: string | number };
}

async function syncAuthorizedPayment(paymentId: string): Promise<void> {
  const admin = adminClient();
  const payment = await mercadoPago<Record<string, unknown>>(`/authorized_payments/${encodeURIComponent(paymentId)}`);
  const preapprovalId = String(payment.preapproval_id || '');
  if (!preapprovalId) throw new Error('Fatura sem preapproval_id');
  const approved = payment.status === 'approved' || payment.status === 'processed';
  const { data: subscription, error: subscriptionError } = await admin
    .from('subscriptions')
    .select('id, user_id')
    .eq('provider_subscription_id', preapprovalId)
    .maybeSingle();
  if (subscriptionError) throw subscriptionError;
  if (!subscription) {
    await syncPreapproval(preapprovalId);
    return;
  }
  const subscriptionUpdate: Record<string, string> = {
    status: approved ? 'authorized' : String(payment.status || 'rejected'),
  };
  if (approved) subscriptionUpdate.last_payment_at = String(payment.date_created || new Date().toISOString());
  const { error: updateError } = await admin.from('subscriptions').update(subscriptionUpdate).eq('id', subscription.id);
  if (updateError) throw updateError;
  const { error: profileError } = await admin
    .from('profiles')
    .update({ access_status: approved ? 'active' : 'past_due', ...(approved ? { selected_plan: 'standard' } : {}) })
    .eq('id', subscription.user_id);
  if (profileError) throw profileError;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const url = new URL(request.url);
  const body = (await request.json().catch(() => ({}))) as WebhookBody;
  const dataId = String(url.searchParams.get('data.id') || url.searchParams.get('data_id') || body.data?.id || '');
  const eventType = String(body.type || url.searchParams.get('type') || 'unknown');
  const xSignature = request.headers.get('x-signature') || '';
  const xRequestId = request.headers.get('x-request-id') || '';
  const secret = Deno.env.get('MERCADO_PAGO_WEBHOOK_SECRET') || '';
  let signatureValid = false;

  try {
    if (!secret || !dataId || !xSignature || !xRequestId) throw new Error('Assinatura do webhook ausente');
    const validation = WebhookSignatureValidator.validate({ xSignature, xRequestId, dataId, secret });
    if (validation === false) throw new Error('Assinatura do webhook inválida');
    signatureValid = true;
  } catch (error) {
    console.error('mercado-pago-webhook signature', error);
  }

  // Uma notificação de pagamento também é autenticada consultando o ID diretamente
  // na conta do provedor de pagamentos. Isso mantém a liberação disponível caso a
  // entrega use uma assinatura desatualizada, sem confiar nos dados recebidos no body.
  let paymentAlreadySynced = false;
  if (!signatureValid) {
    if (eventType !== 'payment' || !dataId) return new Response('Unauthorized', { status: 401 });
    try {
      await syncPayment(dataId);
      paymentAlreadySynced = true;
    } catch (error) {
      console.error('mercado-pago-webhook payment verification', error);
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const providerEventId = `${eventType}:${dataId}:${body.action || body.id || body.date_created || xRequestId}`;
  const admin = adminClient();
  const { data: existing, error: existingError } = await admin
    .from('billing_events')
    .select('id, processed_at')
    .eq('provider_event_id', providerEventId)
    .maybeSingle();
  if (existingError) return new Response('Could not inspect event', { status: 500 });
  if (existing?.processed_at) return new Response('ok', { status: 200 });

  if (!existing) {
    const { error } = await admin.from('billing_events').insert({
      provider_event_id: providerEventId,
      event_type: eventType,
      payload: body,
    });
    if (error) return new Response('Could not persist event', { status: 500 });
  }

  try {
    if (eventType === 'subscription_preapproval') await syncPreapproval(dataId);
    else if (eventType === 'subscription_authorized_payment') await syncAuthorizedPayment(dataId);
    else if (eventType === 'payment' && !paymentAlreadySynced) await syncPayment(dataId);

    await admin
      .from('billing_events')
      .update({ processed_at: new Date().toISOString(), processing_error: null })
      .eq('provider_event_id', providerEventId);
    return new Response('ok', { status: 200 });
  } catch (error) {
    console.error('mercado-pago-webhook processing', error);
    await admin
      .from('billing_events')
      .update({ processing_error: error instanceof Error ? error.message : String(error) })
      .eq('provider_event_id', providerEventId);
    return new Response('retry', { status: 500 });
  }
});
