import { WebhookSignatureValidator } from 'npm:mercadopago@2';

import { mercadoPago, accessFromSubscription, type MercadoPagoSubscription } from '../_shared/mercado-pago.ts';
import { adminClient } from '../_shared/supabase.ts';

interface WebhookBody {
  id?: string | number;
  action?: string;
  type?: string;
  date_created?: string;
  data?: { id?: string | number };
}

async function syncPreapproval(preapprovalId: string): Promise<void> {
  const admin = adminClient();
  const subscription = await mercadoPago<MercadoPagoSubscription>(`/preapproval/${encodeURIComponent(preapprovalId)}`);
  const userId = subscription.external_reference;
  if (!userId) throw new Error('Assinatura sem external_reference');
  const accessStatus = accessFromSubscription(subscription.status);

  const { data: current } = await admin
    .from('subscriptions')
    .select('id')
    .eq('provider_subscription_id', subscription.id)
    .maybeSingle();

  if (current) {
    await admin
      .from('subscriptions')
      .update({
        status: subscription.status,
        current_period_end: subscription.next_payment_date || null,
      })
      .eq('id', current.id);
  } else {
    await admin.from('subscriptions').update({ is_current: false }).eq('user_id', userId).eq('is_current', true);
    await admin.from('subscriptions').insert({
      user_id: userId,
      provider_subscription_id: subscription.id,
      status: subscription.status,
      current_period_end: subscription.next_payment_date || null,
    });
  }

  await admin.from('profiles').update({ access_status: accessStatus }).eq('id', userId);
}

async function syncAuthorizedPayment(paymentId: string): Promise<void> {
  const admin = adminClient();
  const payment = await mercadoPago<Record<string, unknown>>(`/authorized_payments/${encodeURIComponent(paymentId)}`);
  const preapprovalId = String(payment.preapproval_id || '');
  if (!preapprovalId) throw new Error('Fatura sem preapproval_id');
  const approved = payment.status === 'approved' || payment.status === 'processed';
  const { data: subscription } = await admin
    .from('subscriptions')
    .select('id, user_id')
    .eq('provider_subscription_id', preapprovalId)
    .maybeSingle();
  if (!subscription) {
    await syncPreapproval(preapprovalId);
    return;
  }
  const subscriptionUpdate: Record<string, string> = {
    status: approved ? 'authorized' : String(payment.status || 'rejected'),
  };
  if (approved) subscriptionUpdate.last_payment_at = String(payment.date_created || new Date().toISOString());
  await admin
    .from('subscriptions')
    .update(subscriptionUpdate)
    .eq('id', subscription.id);
  await admin
    .from('profiles')
    .update({ access_status: approved ? 'active' : 'past_due' })
    .eq('id', subscription.user_id);
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const url = new URL(request.url);
  const body = (await request.json().catch(() => ({}))) as WebhookBody;
  const dataId = String(url.searchParams.get('data.id') || url.searchParams.get('data_id') || body.data?.id || '');
  const xSignature = request.headers.get('x-signature') || '';
  const xRequestId = request.headers.get('x-request-id') || '';
  const secret = Deno.env.get('MERCADO_PAGO_WEBHOOK_SECRET') || '';

  try {
    if (!secret || !dataId || !xSignature || !xRequestId) throw new Error('Assinatura do webhook ausente');
    WebhookSignatureValidator.validate({ xSignature, xRequestId, dataId, secret });
  } catch (error) {
    console.error('mercado-pago-webhook signature', error);
    return new Response('Unauthorized', { status: 401 });
  }

  const eventType = String(body.type || url.searchParams.get('type') || 'unknown');
  const providerEventId = `${eventType}:${dataId}:${body.action || body.id || body.date_created || xRequestId}`;
  const admin = adminClient();
  const { data: existing } = await admin
    .from('billing_events')
    .select('id, processed_at')
    .eq('provider_event_id', providerEventId)
    .maybeSingle();
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
    else if (eventType === 'payment') {
      const payment = await mercadoPago<Record<string, unknown>>(`/v1/payments/${encodeURIComponent(dataId)}`);
      const userId = String(payment.external_reference || '');
      if (userId) {
        const approved = payment.status === 'approved';
        await admin.from('profiles').update({ access_status: approved ? 'active' : 'past_due' }).eq('id', userId);
        if (approved) {
          await admin
            .from('subscriptions')
            .update({ last_payment_at: String(payment.date_approved || new Date().toISOString()) })
            .eq('user_id', userId)
            .eq('is_current', true);
        }
      }
    }

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
