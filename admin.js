const cloud = window.MedRecebeCloud;
const $ = (selector) => document.querySelector(selector);

const statusLabels = {
  pending_payment: 'Pagamento pendente',
  active: 'Ativo',
  past_due: 'Inadimplente',
  suspended: 'Suspenso',
  canceled: 'Cancelado',
};

function digits(value = '') { return value.replace(/\D/g, '').slice(0, 11); }
function formatCpf(value = '') {
  return digits(value).replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2');
}
function escapeHtml(value = '') {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
function date(value) { return value ? new Intl.DateTimeFormat('pt-BR').format(new Date(value)) : '—'; }

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
  status.textContent = 'Carregando usuários…';
  try {
    const result = await cloud.adminUsers({ search: $('#admin-search').value.trim(), page: 1, perPage: 100 });
    $('#metric-total').textContent = result.metrics.total;
    $('#metric-active').textContent = result.metrics.active;
    $('#metric-trial').textContent = result.metrics.trial;
    $('#metric-past-due').textContent = result.metrics.pastDue;
    $('#metric-suspended').textContent = result.metrics.suspended;
    $('#admin-empty').hidden = result.users.length > 0;
    $('#admin-users').innerHTML = result.users.map((user) => {
      const subscription = user.subscription?.status || 'sem assinatura';
      const plan = user.planCode === 'web' ? 'Web' : 'Mobile';
      const trial = Date.parse(user.trialEndsAt || '') > Date.now() && user.subscription?.status !== 'authorized';
      const actions = user.role === 'admin'
        ? '<span class="pill">Administrador</span>'
        : user.accessStatus === 'active'
          ? `<button class="danger" data-user-action="suspended" data-user-id="${user.id}" data-user-name="${escapeHtml(user.fullName)}">Suspender</button>`
          : `<button class="primary" data-user-action="active" data-user-id="${user.id}" data-user-name="${escapeHtml(user.fullName)}">Liberar acesso</button>`;
      return `<tr><td><span class="user-cell"><strong>${escapeHtml(user.fullName)}</strong><small>${escapeHtml(user.email)}</small></span></td><td>•••.${escapeHtml(user.cpfLast4)}</td><td><span class="pill">${plan}${trial ? ' • teste' : ''}</span></td><td><span class="pill">${escapeHtml(subscription)}</span></td><td><span class="pill ${user.accessStatus}">${escapeHtml(statusLabels[user.accessStatus] || user.accessStatus)}</span></td><td>${date(user.createdAt)}</td><td><span class="actions">${actions}</span></td></tr>`;
    }).join('');
    status.textContent = `${result.count} usuário(s) encontrado(s).`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Não foi possível carregar os usuários.';
  }
}

$('#admin-cpf').addEventListener('input', (event) => { event.target.value = formatCpf(event.target.value); });
$('#admin-login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#admin-login-button');
  button.disabled = true;
  button.textContent = 'Entrando…';
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
$('#admin-logout').addEventListener('click', async () => { await cloud.logout(); showLogin(); });
$('#admin-users').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-user-action]');
  if (!button) return;
  const next = button.dataset.userAction;
  const verb = next === 'active' ? 'liberar' : 'suspender';
  if (!confirm(`Deseja ${verb} o acesso de ${button.dataset.userName}?`)) return;
  button.disabled = true;
  try {
    await cloud.adminUpdateUser({ userId: button.dataset.userId, accessStatus: next });
    await loadUsers();
  } catch (error) {
    $('#admin-status').textContent = error instanceof Error ? error.message : 'Não foi possível atualizar o usuário.';
    button.disabled = false;
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
