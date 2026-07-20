import { json, options, publicError } from '../_shared/http.ts';
import { adminClient, requireAdmin, authenticationStatus } from '../_shared/supabase.ts';

Deno.serve(async (request) => {
  const preflight = options(request);
  if (preflight) return preflight;
  if (request.method !== 'POST') return publicError(request, 'Método não permitido.', 405);

  try {
    await requireAdmin(request);
    const body = await request.json().catch(() => ({}));
    const search = String(body.search || '').trim().slice(0, 80);
    const safeSearch = search.replace(/[%_,().]/g, ' ').replace(/\s+/g, ' ').trim();
    const page = Math.max(1, Number(body.page) || 1);
    const perPage = Math.min(100, Math.max(10, Number(body.perPage) || 30));
    const from = (page - 1) * perPage;
    const admin = adminClient();

    let query = admin
      .from('profiles')
      .select('id, full_name, email, cpf_last4, role, access_status, selected_plan, manual_access_until, manual_access_lifetime, suspension_scheduled_at, suspension_reason, forced_suspension_at, created_at, updated_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + perPage - 1);
    if (safeSearch) {
      const cpfSuffix = safeSearch.replace(/\D/g, '').slice(-4);
      const filters = [`full_name.ilike.%${safeSearch}%`, `email.ilike.%${safeSearch}%`];
      if (cpfSuffix.length === 4) filters.push(`cpf_last4.eq.${cpfSuffix}`);
      query = query.or(filters.join(','));
    }
    const { data: profiles, count, error } = await query;
    if (error) throw error;

    const ids = (profiles || []).map((profile) => profile.id);
    const { data: subscriptions } = ids.length
      ? await admin
          .from('subscriptions')
          .select('user_id, status, amount_cents, current_period_end, last_payment_at, plan_code, refunded_at, canceled_at')
          .in('user_id', ids)
          .eq('is_current', true)
      : { data: [] };
    const byUser = new Map((subscriptions || []).map((subscription) => [subscription.user_id, subscription]));

    const [{ data: allProfiles }, { data: allCurrentSubscriptions }] = await Promise.all([
      admin.from('profiles').select('id, access_status, role, manual_access_until, manual_access_lifetime, suspension_scheduled_at'),
      admin.from('subscriptions').select('user_id, status').eq('is_current', true),
    ]);
    const paidUsers = new Set((allCurrentSubscriptions || []).filter((item) => item.status === 'authorized').map((item) => item.user_id));
    const metrics = (allProfiles || []).reduce(
      (result, profile) => {
        result.total += profile.role === 'user' ? 1 : 0;
        if (profile.role === 'user' && profile.access_status === 'active') result.active += 1;
        if (profile.role === 'user' && profile.access_status === 'past_due') result.pastDue += 1;
        if (profile.role === 'user' && profile.access_status === 'suspended') result.suspended += 1;
        const freemium = profile.manual_access_lifetime || Date.parse(profile.manual_access_until || '') > Date.now();
        if (profile.role === 'user' && freemium && !paidUsers.has(profile.id)) result.freemium += 1;
        if (profile.role === 'user' && Date.parse(profile.suspension_scheduled_at || '') > Date.now()) result.scheduledSuspensions += 1;
        return result;
      },
      { total: 0, active: 0, freemium: 0, scheduledSuspensions: 0, pastDue: 0, suspended: 0 },
    );

    return json(request, {
      users: (profiles || []).map((profile) => ({
        id: profile.id,
        fullName: profile.full_name,
        email: profile.email,
        cpfLast4: profile.cpf_last4,
        role: profile.role,
        accessStatus: profile.access_status,
        planCode: profile.selected_plan,
        manualAccessUntil: profile.manual_access_until,
        manualAccessLifetime: profile.manual_access_lifetime,
        suspensionScheduledAt: profile.suspension_scheduled_at,
        suspensionReason: profile.suspension_reason,
        forcedSuspensionAt: profile.forced_suspension_at,
        createdAt: profile.created_at,
        updatedAt: profile.updated_at,
        subscription: byUser.get(profile.id) || null,
      })),
      count: count || 0,
      page,
      perPage,
      metrics,
    });
  } catch (error) {
    console.error('admin-users', error);
    return publicError(request, 'Não foi possível consultar os usuários.', authenticationStatus(error, 500));
  }
});
