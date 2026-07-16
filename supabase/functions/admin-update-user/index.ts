import { json, options, publicError } from '../_shared/http.ts';
import { adminClient, requireAdmin } from '../_shared/supabase.ts';

const allowedStatuses = new Set(['pending_payment', 'active', 'past_due', 'suspended', 'canceled']);

Deno.serve(async (request) => {
  const preflight = options(request);
  if (preflight) return preflight;
  if (request.method !== 'POST') return publicError(request, 'Método não permitido.', 405);

  try {
    const adminUser = await requireAdmin(request);
    const body = await request.json();
    const targetUserId = String(body.userId || '');
    const accessStatus = String(body.accessStatus || '');
    if (!targetUserId || !allowedStatuses.has(accessStatus)) return publicError(request, 'Atualização inválida.');

    const admin = adminClient();
    const { data: previous, error: lookupError } = await admin
      .from('profiles')
      .select('id, role, access_status')
      .eq('id', targetUserId)
      .single();
    if (lookupError || !previous) return publicError(request, 'Usuário não encontrado.', 404);
    if (previous.role === 'admin') return publicError(request, 'Contas administrativas não podem ser alteradas por esta tela.', 403);

    const { data: updated, error: updateError } = await admin
      .from('profiles')
      .update({ access_status: accessStatus })
      .eq('id', targetUserId)
      .select('id, access_status, updated_at')
      .single();
    if (updateError) throw updateError;

    await admin.from('admin_audit_log').insert({
      admin_user_id: adminUser.id,
      target_user_id: targetUserId,
      action: 'access_status_changed',
      previous_value: { accessStatus: previous.access_status },
      next_value: { accessStatus },
    });

    return json(request, { user: { id: updated.id, accessStatus: updated.access_status, updatedAt: updated.updated_at } });
  } catch (error) {
    console.error('admin-update-user', error);
    return publicError(request, error instanceof Error ? error.message : 'Não foi possível atualizar o acesso.', 403);
  }
});
