const cloud = window.MedRecebeCloud;
const $ = (selector, root = document) => root.querySelector(selector);

const statusLabels = {
  pending_payment: 'Pagamento pendente',
  active: 'Ativo',
  past_due: 'Inadimplente',
  suspended: 'Suspenso',
  canceled: 'Cancelado',
};

let currentUsers = new Map();

function digits(value = '') { return String(value).replace(/\D/g, '').slice(0, 14); }
function formatCpf(value = '') {
  return digits(value).slice(0, 11).replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2');
}
function escapeHtml(value = '') {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
function date(value) { return value ? new Intl.DateTimeFormat('pt-BR').format(new Date(value)) : '—'; }
function dateTime(value) { return value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'; }
function subscriptionLabel(status = '') {
  return ({ authorized: 'Autorizada', pending: 'Pendente', paused: 'Pausada', canceled: 'Cancelada', cancelled: 'Cancelada' })[status] || status || 'Sem assinatura';
}
function freemiumActive(user) {
  return Boolean(user.manualAccessLifetime) || Date.parse(user.manualAccessUntil || '') > Date.now();
}
function accessLabel(user) {
  if (user.role === 'admin') return 'Administrador';
  if (freemiumActive(user)) return user.manualAccessLifetime ? 'Freemium vitalício' : 'Freemium';
  return user.subscription?.status === 'authorized' ? 'Plano único' : 'Sem plano ativo';
}
function validityLabel(user) {
  if (user.suspensionScheduledAt && Date.parse(user.suspensionScheduledAt) > Date.now()) return `Suspende em ${date(user.suspensionScheduledAt)}`;
  if (user.manualAccessLifetime) return 'Vitalício';
  if (Date.parse(user.manualAccessUntil || '') > Date.now()) return date(user.manualAccessUntil);
  return user.subscription?.current_period_end ? date(user.subscription.current_period_end) : '—';
}

function showLogin(message = '') {
  $('#admin-app').hidden = true;
  $('#admin-login').hidden = false;
  $('#admin-login-error').textContent = message;
}

function showApp(account) {
  $('#admin-login').hidden = true;
  $('#admin-app').hidden = false;
  $('#admin-name').textContent = account.profile.fullName;
}

async function loadUsers() {
  const status = $('#admin-status');
  status.textContent = 'Carregando clientes…';
  try {
    const result = await cloud.adminUsers({ search: $('#admin-search').value.trim(), page: 1, perPage: 100 });
    currentUsers = new Map(result.users.map((user) => [user.id, user]));
    $('#metric-total').textContent = result.metrics.total;
    $('#metric-active').textContent = result.metrics.active;
    $('#metric-freemium').textContent = result.metrics.freemium;
    $('#metric-scheduled').textContent = result.metrics.scheduledSuspensions;
    $('#metric-past-due').textContent = result.metrics.pastDue;
    $('#metric-suspended').textContent = result.metrics.suspended;
    $('#admin-empty').hidden = result.users.length > 0;
    $('#admin-users').innerHTML = result.users.map((user) => {
      if (user.role === 'admin') {
        return `<tr><td><span class="user-cell"><strong>${escapeHtml(user.fullName)}</strong><small>${escapeHtml(user.email)}</small></span></td><td>•••.${escapeHtml(user.cpfLast4)}</td><td><span class="pill">Administrador</span></td><td>—</td><td><span class="pill active">Protegido</span></td><td>—</td><td>${date(user.createdAt)}</td><td><span class="pill">Somente sistema</span></td></tr>`;
      }
      const scheduled = Date.parse(user.suspensionScheduledAt || '') > Date.now();
      const statusText = scheduled ? 'Suspensão agendada' : statusLabels[user.accessStatus] || user.accessStatus;
      const statusClass = scheduled ? 'scheduled' : user.accessStatus;
      return `<tr><td><span class="user-cell"><strong>${escapeHtml(user.fullName)}</strong><small>${escapeHtml(user.email)}</small></span></td><td>•••.${escapeHtml(user.cpfLast4)}</td><td><span class="pill">${escapeHtml(accessLabel(user))}</span></td><td><span class="pill">${escapeHtml(subscriptionLabel(user.subscription?.status))}</span></td><td><span class="pill ${statusClass}">${escapeHtml(statusText)}</span></td><td>${escapeHtml(validityLabel(user))}</td><td>${date(user.createdAt)}</td><td><span class="actions"><button class="secondary" data-user-edit="${user.id}" type="button">Gerenciar</button></span></td></tr>`;
    }).join('');
    status.textContent = `${result.count} cliente(s) encontrado(s).`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Não foi possível carregar os clientes.';
  }
}

function durationFields(prefix, unit = 'days', value = 7) {
  return `<div class="duration-grid"><label>Período<input id="${prefix}-duration-value" type="number" min="1" max="3650" value="${value}" ${unit === 'lifetime' ? 'disabled' : ''}/></label><label>Unidade<select id="${prefix}-duration-unit"><option value="days" ${unit === 'days' ? 'selected' : ''}>Dias</option><option value="weeks" ${unit === 'weeks' ? 'selected' : ''}>Semanas</option><option value="months" ${unit === 'months' ? 'selected' : ''}>Meses</option><option value="years" ${unit === 'years' ? 'selected' : ''}>Anos</option><option value="lifetime" ${unit === 'lifetime' ? 'selected' : ''}>Vitalício</option></select></label></div>`;
}

function openCreateUser() {
  $('#admin-modal-root').innerHTML = `<div class="admin-modal-wrap"><section class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="create-title"><header><div><span>NOVO ACESSO</span><h2 id="create-title">Criar usuário Freemium</h2></div><button data-modal-close type="button">×</button></header><form id="create-user-form" class="admin-form"><label>Nome completo<input id="create-name" autocomplete="name" required/></label><div class="two-columns"><label>E-mail<input id="create-email" type="email" autocomplete="email" required/></label><label>CPF<input id="create-cpf" inputmode="numeric" maxlength="14" required/></label></div><label>Senha provisória<input id="create-password" type="password" minlength="8" autocomplete="new-password" required/></label><div class="form-section"><h3>Validade Freemium</h3><p>O acesso é liberado sem cobrança pelo período definido.</p>${durationFields('create')}</div><div class="modal-error" id="create-error"></div><div class="modal-actions"><button class="primary" type="submit">Criar e liberar acesso</button><button class="secondary" data-modal-close type="button">Cancelar</button></div></form></section></div>`;
}

function openUserEditor(userId) {
  const user = currentUsers.get(userId);
  if (!user || user.role === 'admin') return;
  const durationUnit = user.manualAccessLifetime ? 'lifetime' : 'days';
  $('#admin-modal-root').innerHTML = `<div class="admin-modal-wrap"><section class="admin-modal wide" role="dialog" aria-modal="true" aria-labelledby="edit-title"><header><div><span>CLIENTE •••.${escapeHtml(user.cpfLast4)}</span><h2 id="edit-title">Gerenciar ${escapeHtml(user.fullName)}</h2></div><button data-modal-close type="button">×</button></header><div class="admin-form"><form id="edit-profile-form" class="form-section"><h3>Dados cadastrais</h3><div class="two-columns"><label>Nome completo<input id="edit-name" value="${escapeHtml(user.fullName)}" required/></label><label>E-mail<input id="edit-email" type="email" value="${escapeHtml(user.email)}" required/></label></div><label>Novo CPF (somente para correção)<input id="edit-cpf" inputmode="numeric" maxlength="14" placeholder="Deixe vazio para manter •••.${escapeHtml(user.cpfLast4)}"/></label><button class="primary" type="submit">Salvar correções</button></form><form id="freemium-form" class="form-section"><h3>Concessão Freemium</h3><p>${freemiumActive(user) ? `Ativa até ${escapeHtml(validityLabel(user))}.` : 'Nenhuma concessão Freemium ativa.'}</p>${durationFields('edit', durationUnit)}<div class="inline-actions"><button class="primary" type="submit">Aplicar período</button>${freemiumActive(user) ? '<button class="secondary" data-admin-action="revoke_freemium" type="button">Revogar Freemium</button>' : ''}</div></form><section class="form-section warning-zone"><h3>Suspensão</h3><p>A suspensão comum preserva o acesso até o fim do período já pago. A suspensão forçada é imediata e deve ser reservada a infrações às regras de uso.</p><div class="inline-actions">${user.suspensionScheduledAt ? '<button class="secondary" data-admin-action="clear_suspension" type="button">Cancelar suspensão agendada</button>' : '<button class="secondary" data-admin-action="schedule_suspension" type="button">Programar suspensão</button>'}<button class="danger" data-admin-action="force_suspension" type="button">Forçar suspensão imediata</button></div></section><section class="form-section danger-zone"><h3>Excluir cliente</h3><p>Exclui o login e os dados sincronizados. Esta ação não pode ser desfeita.</p><button class="danger" data-admin-action="delete_user" type="button">Excluir cadastro definitivamente</button></section><div class="modal-error" id="edit-error"></div><div class="modal-actions"><button class="secondary" data-modal-close type="button">Fechar</button></div></div></section></div>`;
  $('#admin-modal-root').dataset.userId = userId;
}

async function runUserAction(action, userId) {
  const user = currentUsers.get(userId);
  if (!user) return;
  if (action === 'schedule_suspension') {
    if (!confirm(`Programar a suspensão de ${user.fullName}?\n\nO acesso continuará disponível até o fim do período mensal já pago. A cobrança recorrente será encerrada agora e o bloqueio ocorrerá somente na data de vencimento.`)) return;
  }
  if (action === 'force_suspension') {
    const confirmation = prompt(`Suspensão imediata por infração\n\nO acesso de ${user.fullName} será encerrado agora, sem restituição proporcional quando permitido pelos Termos e pela legislação aplicável.\n\nDigite SUSPENDER para confirmar.`);
    if (confirmation !== 'SUSPENDER') return;
  }
  if (action === 'delete_user') {
    const confirmation = prompt(`Excluir definitivamente ${user.fullName}?\n\nLogin e dados sincronizados serão removidos. Digite EXCLUIR para confirmar.`);
    if (confirmation !== 'EXCLUIR') return;
  }
  try {
    await cloud.adminUpdateUser({ userId, action, ...(action === 'delete_user' ? { confirm: true } : {}) });
    $('#admin-modal-root').innerHTML = '';
    await loadUsers();
  } catch (error) {
    $('#edit-error').textContent = error instanceof Error ? error.message : 'Não foi possível concluir a ação.';
  }
}

$('#admin-cpf').addEventListener('input', (event) => { event.target.value = formatCpf(event.target.value); });
$('#admin-login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#admin-login-button');
  button.disabled = true;
  button.textContent = 'Verificando…';
  $('#admin-login-error').textContent = '';
  try {
    if (!cloud?.isEnabled()) throw new Error('O backend administrativo ainda não foi configurado.');
    const account = await cloud.login(digits($('#admin-cpf').value), $('#admin-password').value);
    if (account.profile.role !== 'admin') {
      await cloud.logout();
      throw new Error('Esta conta não possui acesso administrativo.');
    }
    showApp(account);
    await loadUsers();
  } catch (error) {
    showLogin(error instanceof Error ? error.message : 'Não foi possível entrar.');
  } finally {
    button.disabled = false;
    button.textContent = 'Entrar no painel';
  }
});

$('#admin-search-form').addEventListener('submit', (event) => { event.preventDefault(); void loadUsers(); });
$('#admin-refresh').addEventListener('click', () => void loadUsers());
$('#admin-create-user').addEventListener('click', openCreateUser);
$('#admin-logout').addEventListener('click', async () => { await cloud.logout(); showLogin(); });
$('#admin-users').addEventListener('click', (event) => {
  const button = event.target.closest('[data-user-edit]');
  if (button) openUserEditor(button.dataset.userEdit);
});

$('#admin-modal-root').addEventListener('input', (event) => {
  if (['create-cpf', 'edit-cpf'].includes(event.target.id)) event.target.value = formatCpf(event.target.value);
});
$('#admin-modal-root').addEventListener('change', (event) => {
  if (!event.target.id.endsWith('-duration-unit')) return;
  const input = $(`#${event.target.id.replace('-unit', '-value')}`);
  if (input) input.disabled = event.target.value === 'lifetime';
});
$('#admin-modal-root').addEventListener('click', (event) => {
  if (event.target.closest('[data-modal-close]')) $('#admin-modal-root').innerHTML = '';
  const actionButton = event.target.closest('[data-admin-action]');
  if (actionButton) void runUserAction(actionButton.dataset.adminAction, $('#admin-modal-root').dataset.userId);
});
$('#admin-modal-root').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (event.target.id === 'create-user-form') {
    const error = $('#create-error');
    error.textContent = '';
    try {
      await cloud.adminCreateUser({ fullName: $('#create-name').value.trim(), email: $('#create-email').value.trim(), cpf: digits($('#create-cpf').value), password: $('#create-password').value, durationValue: Number($('#create-duration-value').value), durationUnit: $('#create-duration-unit').value });
      $('#admin-modal-root').innerHTML = '';
      await loadUsers();
    } catch (caught) { error.textContent = caught instanceof Error ? caught.message : 'Não foi possível criar o usuário.'; }
  }
  if (event.target.id === 'edit-profile-form') {
    const userId = $('#admin-modal-root').dataset.userId;
    try {
      await cloud.adminUpdateUser({ userId, action: 'update_profile', fullName: $('#edit-name').value.trim(), email: $('#edit-email').value.trim(), cpf: digits($('#edit-cpf').value) });
      $('#admin-modal-root').innerHTML = '';
      await loadUsers();
    } catch (caught) { $('#edit-error').textContent = caught instanceof Error ? caught.message : 'Não foi possível salvar.'; }
  }
  if (event.target.id === 'freemium-form') {
    const userId = $('#admin-modal-root').dataset.userId;
    try {
      await cloud.adminUpdateUser({ userId, action: 'grant_freemium', durationValue: Number($('#edit-duration-value').value), durationUnit: $('#edit-duration-unit').value });
      $('#admin-modal-root').innerHTML = '';
      await loadUsers();
    } catch (caught) { $('#edit-error').textContent = caught instanceof Error ? caught.message : 'Não foi possível aplicar o período.'; }
  }
});

async function boot() {
  if (!cloud?.isEnabled()) return showLogin('Configure o Supabase para ativar o painel.');
  try {
    const account = await cloud.restore();
    if (!account || account.profile.role !== 'admin') return showLogin();
    showApp(account);
    await loadUsers();
  } catch {
    showLogin();
  }
}

void boot();
