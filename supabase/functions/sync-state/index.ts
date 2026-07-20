import { json, options, publicError } from '../_shared/http.ts';
import { adminClient, authenticatedUser, authenticationStatus } from '../_shared/supabase.ts';

function safeState(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Estado inválido.');
  const source = structuredClone(input as Record<string, unknown>);
  delete source.account;
  delete source.cloudUserId;
  delete source.profile;
  delete source.demo;
  if (Array.isArray(source.attendances)) {
    source.attendances = source.attendances.slice(0, 10_000).map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
      const attendance = { ...(item as Record<string, unknown>) };
      attendance.evidenceAvailable = Boolean(attendance.evidence || attendance.evidenceDocumentId || attendance.evidenceAvailable);
      attendance.evidence = '';
      attendance.evidenceRemoteUrl = '';
      return attendance;
    });
  }
  if (Array.isArray(source.invoices)) {
    source.invoices = source.invoices.slice(0, 100).map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
      const invoice = { ...(item as Record<string, unknown>) };
      invoice.documentUrl = '';
      return invoice;
    });
  }
  if (Array.isArray(source.workplaces)) source.workplaces = source.workplaces.slice(0, 500);
  if (Array.isArray(source.feedbacks)) source.feedbacks = source.feedbacks.slice(-100);
  return source;
}

Deno.serve(async (request) => {
  const preflight = options(request);
  if (preflight) return preflight;
  if (request.method !== 'POST') return publicError(request, 'Método não permitido.', 405);

  try {
    const user = await authenticatedUser(request);
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || 'load');
    const admin = adminClient();
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('role, selected_plan, access_status, trial_ends_at')
      .eq('id', user.id)
      .single();
    if (profileError || !profile) return publicError(request, 'Conta não encontrada.', 404);
    if (profile.role !== 'admin' && profile.access_status !== 'active') {
      return publicError(request, 'Acesso inativo.', 403);
    }

    if (action === 'load') {
      const { data, error } = await admin
        .from('user_app_states')
        .select('state, version, updated_at')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return json(request, { state: data?.state || null, version: data?.version || 0, updatedAt: data?.updated_at || null });
    }

    if (action !== 'save') return publicError(request, 'Ação inválida.');
    const state = safeState(body.state);
    const serialized = JSON.stringify(state);
    if (serialized.length > 2_000_000) return publicError(request, 'Os dados excedem o limite de sincronização.', 413);

    const { data: previous } = await admin
      .from('user_app_states')
      .select('version')
      .eq('user_id', user.id)
      .maybeSingle();
    const version = Number(previous?.version || 0) + 1;
    const { data, error } = await admin
      .from('user_app_states')
      .upsert({ user_id: user.id, state, version }, { onConflict: 'user_id' })
      .select('version, updated_at')
      .single();
    if (error) throw error;
    return json(request, { saved: true, version: data.version, updatedAt: data.updated_at });
  } catch (error) {
    console.error('sync-state', error);
    return publicError(request, 'Não foi possível sincronizar os dados.', authenticationStatus(error, 500));
  }
});
