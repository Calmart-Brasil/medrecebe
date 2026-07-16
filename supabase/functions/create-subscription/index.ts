import { json, options, publicError } from '../_shared/http.ts';
import { mercadoPago, type MercadoPagoSubscription } from '../_shared/mercado-pago.ts';
import { adminClient, authenticatedUser } from '../_shared/supabase.ts';

Deno.serve(async (request) => {
  const preflight = options(request);
  if (preflight) return preflight;
  if (request.method !== 'POST') return publicError(request, 'Método não permitido.', 405);

  try {
    const user = await authenticatedUser(request);
    const admin = adminClient();
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, email, role, access_status')
      .eq('id', user.id)
      .single();
    if (profileError || !profile) return publicError(request, 'Conta não encontrada.', 404);
    if (profile.role === 'admin') return json(request, { adminAccess: true });
    if (profile.access_status === 'suspended') return publicError(request, 'Acesso suspenso. Fale com o suporte.', 403);

    const { data: current } = await admin
      .from('subscriptions')
      .select('id, status, checkout_url')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .maybeSingle();
    if (current?.status === 'authorized') return json(request, { active: true });
    if (current?.status === 'pending' && current.checkout_url) {
      return json(request, { checkoutUrl: current.checkout_url, reused: true });
    }

    const appUrl = Deno.env.get('APP_URL') || 'https://calmart-brasil.github.io/medrecebe/';
    const endDate = new Date();
    endDate.setUTCFullYear(endDate.getUTCFullYear() + 10);
    const subscription = await mercadoPago<MercadoPagoSubscription>('/preapproval', {
      method: 'POST',
      body: JSON.stringify({
        reason: 'MedRecebe - Assinatura mensal',
        external_reference: user.id,
        payer_email: profile.email,
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          end_date: endDate.toISOString(),
          transaction_amount: 29.9,
          currency_id: 'BRL',
        },
        back_url: `${appUrl}?billing=return`,
        status: 'pending',
      }),
    });
    if (!subscription.init_point) throw new Error('O Mercado Pago não retornou o link de pagamento');

    await admin.from('subscriptions').update({ is_current: false }).eq('user_id', user.id).eq('is_current', true);
    const { error: insertError } = await admin.from('subscriptions').insert({
      user_id: user.id,
      provider_subscription_id: subscription.id,
      status: subscription.status,
      checkout_url: subscription.init_point,
    });
    if (insertError) throw insertError;

    return json(request, { checkoutUrl: subscription.init_point });
  } catch (error) {
    console.error('create-subscription', error);
    return publicError(request, 'Não foi possível iniciar a assinatura. Tente novamente.', 500);
  }
});
