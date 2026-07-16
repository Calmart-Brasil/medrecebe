const APP_KEY = 'medrecebe.beta.app.v1';
const SESSION_KEY = 'medrecebe.beta.session.v1';
const DEMO_CPF = '52998224725';
const DEMO_PASSWORD = 'Teste@123';
const FEEDBACK_EMAIL = 'feedback@medrecebe.com.br';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const screen = $('#screen');
const modalRoot = $('#modal-root');
const cloud = window.MedRecebeCloud;

let authMode = 'login';
let currentRoute = 'home';
let selectedWorkplaceId = '';
let selectedReconciliationGroup = '';
let selectedChannelWorkplace = '';
let feedbackRating = 5;
let deferredInstallPrompt = null;
let toastTimer = 0;
let draftWorkplace = null;
let editingModalityIndex = null;
let attendanceDraft = null;
let cloudAccount = null;
let activeStateKey = APP_KEY;

const TITLES = {
  home: 'Início',
  attendance: 'Novo atendimento',
  dashboard: 'Dashboard',
  workplaces: 'Locais e repasses',
  reconciliation: 'Conciliação',
  feedback: 'Feedback',
  account: 'Conta e instalação',
};

const DEFAULT_MESSAGE = `Olá,

Solicito, por gentileza, a conferência dos atendimentos relacionados abaixo, cujo pagamento estava previsto para o período informado e ainda não foi identificado.

Local: {{local}}
Período de crédito: {{periodo}}
Quantidade de atendimentos: {{quantidade}}
Valor total contabilizado: {{valor}}

{{detalhes}}

Peço a confirmação do recebimento e a previsão de regularização.

Atenciosamente,
{{medico}}`;

let appState = loadState(activeStateKey);

function emptyState() {
  return {
    account: null,
    profile: null,
    workplaces: [],
    attendances: [],
    reconciliationMessage: DEFAULT_MESSAGE,
    feedbacks: [],
    demo: false,
  };
}

function loadState(storageKey = activeStateKey) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey));
    if (parsed && Array.isArray(parsed.workplaces) && Array.isArray(parsed.attendances)) {
      return { ...emptyState(), ...parsed };
    }
  } catch {
    // Um armazenamento inválido é substituído por uma base limpa.
  }
  return emptyState();
}

function saveState() {
  try {
    localStorage.setItem(activeStateKey, JSON.stringify(appState));
    return true;
  } catch {
    showToast('O armazenamento local está cheio. Remova fotos antigas e tente novamente.');
    return false;
  }
}

async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    // Alguns navegadores não oferecem persistência explícita; o localStorage continua entre acessos.
  }
}

function activateSession() {
  try {
    localStorage.setItem(SESSION_KEY, 'active');
    return true;
  } catch {
    showToast('Não foi possível manter a sessão neste aparelho. Verifique as permissões do navegador.');
    return false;
  }
}

function id(prefix) {
  return `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function onlyDigits(value = '') {
  return value.replace(/\D/g, '').slice(0, 11);
}

function formatCpf(value = '') {
  return onlyDigits(value)
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
}

function isValidCpf(value) {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (length) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(cpf[index]) * (length + 1 - index);
    const result = (sum * 10) % 11;
    return result === 10 ? 0 : result;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

async function hashPassword(password, salt) {
  const bytes = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function dateOnly(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDate(value) {
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function nextBusinessDay(date, direction = 1) {
  const result = new Date(date);
  while ([0, 6].includes(result.getDay())) result.setDate(result.getDate() + direction);
  return result;
}

function calculateDueDate(serviceDate, rule) {
  const date = parseDate(serviceDate);
  let due = new Date(date);
  switch (rule.kind) {
    case 'calendar_days':
      due = addDays(date, Number(rule.days) || 0);
      break;
    case 'advance':
      due = addDays(date, -(Number(rule.days) || 0));
      break;
    case 'first_business_day_next_month':
      due = nextBusinessDay(new Date(date.getFullYear(), date.getMonth() + 1, 1, 12));
      break;
    case 'last_business_day_next_month':
      due = nextBusinessDay(new Date(date.getFullYear(), date.getMonth() + 2, 0, 12), -1);
      break;
    case 'weekly': {
      const daysToNextMonday = date.getDay() === 0 ? 1 : 8 - date.getDay();
      due = addDays(date, daysToNextMonday + (Number(rule.weekday) || 5) - 1);
      break;
    }
    case 'custom': {
      if (rule.basis === 'end_of_week') due = addDays(date, (7 - date.getDay()) % 7);
      if (rule.basis === 'end_of_month') due = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
      const offset = Number(rule.offset) || 0;
      if (rule.unit === 'weeks') due = addDays(due, offset * 7);
      else if (rule.unit === 'months') {
        const originalDay = due.getDate();
        due = new Date(due.getFullYear(), due.getMonth() + offset, 1, 12);
        due.setDate(Math.min(originalDay, new Date(due.getFullYear(), due.getMonth() + 1, 0, 12).getDate()));
      } else due = addDays(due, offset);

      if (rule.adjustment === 'next_business_day') due = nextBusinessDay(due);
      if (rule.adjustment === 'previous_business_day') due = nextBusinessDay(due, -1);
      if (rule.adjustment === 'first_business_day') due = nextBusinessDay(new Date(due.getFullYear(), due.getMonth(), 1, 12));
      if (rule.adjustment === 'last_business_day') due = nextBusinessDay(new Date(due.getFullYear(), due.getMonth() + 1, 0, 12), -1);
      break;
    }
    default:
      break;
  }
  return dateOnly(due);
}

function describeRule(rule) {
  const weekdays = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
  const labels = {
    immediate: 'À vista, na data do atendimento',
    first_business_day_next_month: 'Primeiro dia útil do mês seguinte',
    last_business_day_next_month: 'Último dia útil do mês seguinte',
  };
  if (labels[rule.kind]) return labels[rule.kind];
  if (rule.kind === 'calendar_days') return `${rule.days || 0} dias corridos após o atendimento`;
  if (rule.kind === 'advance') return `${rule.days || 0} dias antes do atendimento`;
  if (rule.kind === 'weekly') return `${weekdays[rule.weekday || 5]} da semana seguinte`;
  if (rule.kind === 'custom') return rule.contractualText || 'Regra personalizada estruturada';
  return 'Regra de pagamento';
}

function currency(cents = 0) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function displayDate(value) {
  return new Intl.DateTimeFormat('pt-BR').format(parseDate(value));
}

function monthLabel(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const text = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(year, monthNumber - 1, 1, 12));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function isPastOrToday(value) {
  return parseDate(value).getTime() <= parseDate(dateOnly()).getTime();
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 3400);
}

function demoState(passwordHash, salt) {
  const workplaces = [
    {
      id: 'work-clinica-demo',
      name: 'Clínica Horizonte',
      address: 'Av. Paulista, 1000 — São Paulo/SP',
      reconciliationEmail: 'financeiro@clinicahorizonte.exemplo',
      reconciliationCc: '',
      active: true,
      modalities: [
        { id: 'mod-plano-demo', name: 'Plano Saúde Mais', type: 'plan', amountCents: 18500, rule: { kind: 'calendar_days', days: 30 }, active: true },
        { id: 'mod-particular-demo', name: 'Consulta particular', type: 'private', amountCents: 42000, rule: { kind: 'immediate' }, active: true },
      ],
    },
    {
      id: 'work-hospital-demo',
      name: 'Hospital São Lucas',
      address: 'Rua das Flores, 240 — São Paulo/SP',
      reconciliationEmail: 'repasses@saolucas.exemplo',
      reconciliationCc: '',
      active: true,
      modalities: [
        { id: 'mod-plantao-demo', name: 'Plantão clínico', type: 'private', amountCents: 98000, rule: { kind: 'first_business_day_next_month' }, active: true },
        { id: 'mod-proc-demo', name: 'Procedimento ambulatorial', type: 'plan', amountCents: 31500, rule: { kind: 'weekly', weekday: 5 }, active: true },
      ],
    },
  ];
  const makeAttendance = (attendanceId, workplace, modality, daysAgo) => {
    const occurredAt = dateOnly(addDays(new Date(), -daysAgo));
    return {
      id: attendanceId,
      workplaceId: workplace.id,
      modalityId: modality.id,
      modalityName: modality.name,
      occurredAt,
      dueAt: calculateDueDate(occurredAt, modality.rule),
      amountCents: modality.amountCents,
      evidence: '',
      notes: 'Registro fictício para avaliação do beta.',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
  };
  return {
    ...emptyState(),
    account: { cpf: DEMO_CPF, passwordHash, salt },
    profile: { name: 'Dra. Ana Martins', cpf: DEMO_CPF, email: 'ana.martins@exemplo.com' },
    workplaces,
    attendances: [
      makeAttendance('att-demo-1', workplaces[0], workplaces[0].modalities[0], 43),
      makeAttendance('att-demo-2', workplaces[0], workplaces[0].modalities[0], 36),
      makeAttendance('att-demo-3', workplaces[1], workplaces[1].modalities[0], 13),
      makeAttendance('att-demo-4', workplaces[1], workplaces[1].modalities[1], 8),
    ],
    demo: true,
  };
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isCloudMode() {
  return Boolean(cloud?.isEnabled());
}

function cloudAccessAllowed() {
  return !isCloudMode() || cloudAccount?.profile?.role === 'admin' || cloudAccount?.profile?.accessStatus === 'active';
}

function applyCloudAccount(result, cpf = '') {
  cloudAccount = result;
  activeStateKey = `${APP_KEY}.user.${result.profile.id}`;
  appState = loadState(activeStateKey);
  appState.profile = {
    name: result.profile.fullName,
    email: result.profile.email,
    cpf: cpf || appState.profile?.cpf || `*******${result.profile.cpfLast4}`,
  };
  appState.cloudUserId = result.profile.id;
  saveState();
  activateSession();
  if (cloudAccessAllowed()) showApp();
  else showBilling();
}

function showBilling() {
  $('#login-view').hidden = true;
  $('#app-view').hidden = true;
  $('#billing-view').hidden = false;
  closeDrawer();
  const status = cloudAccount?.profile?.accessStatus || 'pending_payment';
  const messages = {
    pending_payment: ['Ative seu acesso para registrar atendimentos e acompanhar seus repasses.', 'Aguardando a assinatura mensal de R$ 29,90.'],
    past_due: ['Não conseguimos confirmar a última mensalidade.', 'Atualize o pagamento no Mercado Pago para restabelecer o acesso.'],
    canceled: ['Sua assinatura não está ativa.', 'Faça uma nova assinatura para voltar a usar o MedRecebe.'],
    suspended: ['Este acesso foi suspenso pelo administrador.', 'Entre em contato com o suporte antes de tentar um novo pagamento.'],
  };
  const [lead, detail] = messages[status] || messages.pending_payment;
  $('#billing-lead').textContent = lead;
  $('#billing-status').textContent = detail;
  $('#billing-subscribe').hidden = status === 'suspended';
  $('#billing-refresh').hidden = status === 'suspended';
}

function showLogin() {
  $('#app-view').hidden = true;
  $('#billing-view').hidden = true;
  $('#login-view').hidden = false;
  closeDrawer();
}

function showApp() {
  if (!cloudAccessAllowed()) return showBilling();
  $('#login-view').hidden = true;
  $('#billing-view').hidden = true;
  $('#app-view').hidden = false;
  $('#drawer-name').textContent = appState.profile?.name || 'Médico';
  $('#drawer-email').textContent = appState.profile?.email || 'Dados neste aparelho';
  $('#drawer-avatar').textContent = (appState.profile?.name || 'M').trim().charAt(0).toUpperCase();
  navigate(currentRoute);
}

function openDrawer() {
  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
  $('#drawer-backdrop').hidden = false;
}

function closeDrawer() {
  $('#drawer').classList.remove('open');
  $('#drawer').setAttribute('aria-hidden', 'true');
  $('#drawer-backdrop').hidden = true;
}

function navigate(route) {
  currentRoute = route;
  closeDrawer();
  $('#header-title').textContent = TITLES[route] || 'MedRecebe';
  $('#header-action').textContent = route === 'attendance' ? '‹' : '☰';
  $('#header-action').setAttribute('aria-label', route === 'attendance' ? 'Voltar' : 'Abrir menu');
  $$('[data-nav]').forEach((button) => button.classList.toggle('active', button.dataset.nav === route));
  renderRoute();
  screen.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function pageHeading(eyebrow, title, subtitle) {
  return `<header><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1 class="page-title">${escapeHtml(title)}</h1><p class="page-subtitle">${escapeHtml(subtitle)}</p></header>`;
}

function emptyCard(title, description, button = '') {
  return `<div class="card empty"><span class="round-icon">＋</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p>${button}</div>`;
}

function renderRoute() {
  switch (currentRoute) {
    case 'attendance':
      renderAttendance();
      break;
    case 'dashboard':
      renderDashboard();
      break;
    case 'workplaces':
      renderWorkplaces();
      break;
    case 'reconciliation':
      renderReconciliation();
      break;
    case 'feedback':
      renderFeedback();
      break;
    case 'account':
      renderAccount();
      break;
    default:
      renderHome();
  }
}

function renderHome() {
  const pending = appState.attendances.filter((attendance) => attendance.status !== 'paid');
  const total = pending.reduce((sum, attendance) => sum + attendance.amountCents, 0);
  const active = appState.workplaces.filter((workplace) => workplace.active);
  const firstName = (appState.profile?.name || 'Doutor(a)').split(/\s+/)[0];
  const install = isStandalone()
    ? ''
    : `<div class="card install-card"><span class="install-icon">⇧</span><div><strong>Instale este beta</strong><p>Adicione à Tela de Início para abrir como aplicativo e usar offline.</p></div><button class="link-button" data-action="install" type="button">Como instalar</button></div>`;
  const cards = active.length
    ? active
        .map((workplace) => {
          const modalities = workplace.modalities.filter((modality) => modality.active);
          return `<button class="card location-card" data-action="open-attendance" data-id="${workplace.id}" type="button" ${modalities.length ? '' : 'disabled'}>
            <span class="round-icon">＋</span><span class="location-copy"><strong>${escapeHtml(workplace.name)}</strong><small>${escapeHtml(workplace.address || 'Endereço não informado')}</small><em>${modalities.length} ${modalities.length === 1 ? 'modalidade ativa' : 'modalidades ativas'}</em></span><span class="chevron">›</span>
          </button>`;
        })
        .join('')
    : emptyCard('Nenhum local cadastrado', 'Adicione o local, as modalidades, os valores e as regras de pagamento.', '<button class="button primary small" data-action="new-workplace" type="button">Cadastrar primeiro local</button>');

  screen.innerHTML = `<div class="screen-stack">
    ${pageHeading(`Olá, ${firstName}`, 'Registrar atendimento', 'Escolha onde você atendeu para fazer um novo registro.')}
    ${install}
    <div class="card summary-card"><span class="summary-main"><small>A RECEBER</small><strong>${currency(total)}</strong></span><span class="summary-count"><strong>${pending.length}</strong><small>atendimentos</small></span></div>
    <h2 class="section-title">Onde foi o atendimento?</h2><div class="location-list">${cards}</div>
    ${appState.demo ? '<div class="notice warning demo-notice">Você está vendo dados fictícios. Use-os livremente para explorar o beta.</div>' : ''}
  </div>`;
}

function renderDashboard() {
  const receivables = appState.attendances.filter((attendance) => attendance.status !== 'paid');
  const overdue = receivables.filter((attendance) => isPastOrToday(attendance.dueAt));
  const inReconciliation = receivables.filter((attendance) => attendance.status === 'in_reconciliation');
  const total = receivables.reduce((sum, attendance) => sum + attendance.amountCents, 0);
  const workplaceCards = appState.workplaces
    .map((workplace) => {
      const items = receivables.filter((attendance) => attendance.workplaceId === workplace.id);
      const nextDue = [...items].sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0]?.dueAt;
      const workplaceTotal = items.reduce((sum, attendance) => sum + attendance.amountCents, 0);
      const overdueCount = items.filter((attendance) => isPastOrToday(attendance.dueAt)).length;
      return `<article class="card workplace-summary"><div class="card-head"><span class="round-icon">⌂</span><div><h3>${escapeHtml(workplace.name)}</h3><p>${items.length} ${items.length === 1 ? 'atendimento' : 'atendimentos'} a receber</p></div>${overdueCount ? `<span class="badge overdue">${overdueCount} venc.</span>` : ''}</div><div class="value-row"><span><small>Valor a receber</small><strong>${currency(workplaceTotal)}</strong></span><span><small>Próximo crédito</small><b>${nextDue ? displayDate(nextDue) : '—'}</b></span></div></article>`;
    })
    .join('');
  const dueGroups = groupDueDates(receivables);
  const dueCards = dueGroups
    .map((group) => `<article class="card location-card"><span class="location-copy"><strong>${escapeHtml(group.workplaceName)}</strong><small>Previsto em ${displayDate(group.dueAt)} • ${group.ids.length} atend.</small><em>${currency(group.totalCents)}</em></span><button class="button secondary small" data-action="mark-paid" data-ids="${group.ids.join(',')}" type="button">Recebido</button></article>`)
    .join('');

  screen.innerHTML = `<div class="screen-stack">
    ${pageHeading('Visão geral', 'Dashboard', 'Valores calculados pelas regras cadastradas em cada modalidade.')}
    <div class="card summary-card"><div style="width:100%"><span class="summary-main"><small>TOTAL A RECEBER</small><strong>${currency(total)}</strong></span><div class="metrics"><span class="metric"><strong>${receivables.length}</strong><small>PENDENTES</small></span><span class="metric overdue"><strong>${overdue.length}</strong><small>VENCIDOS</small></span><span class="metric"><strong>${inReconciliation.length}</strong><small>EM CONCILIAÇÃO</small></span></div></div></div>
    <h2 class="section-title">Por local de trabalho</h2><div class="list">${workplaceCards || emptyCard('Ainda não há dados', 'Cadastre um local e comece a registrar atendimentos.')}</div>
    ${dueCards ? `<h2 class="section-title">Confirmar créditos</h2><div class="list">${dueCards}</div>` : ''}
    <p class="muted" style="text-align:center;font-size:10px">Dias úteis consideram fins de semana. O beta não consulta feriados bancários.</p>
  </div>`;
}

function groupDueDates(receivables) {
  const groups = new Map();
  receivables.filter((attendance) => isPastOrToday(attendance.dueAt)).forEach((attendance) => {
    const workplace = appState.workplaces.find((item) => item.id === attendance.workplaceId);
    const key = `${attendance.workplaceId}:${attendance.dueAt}`;
    const group = groups.get(key) || { id: key, workplaceName: workplace?.name || 'Local não disponível', dueAt: attendance.dueAt, totalCents: 0, ids: [] };
    group.totalCents += attendance.amountCents;
    group.ids.push(attendance.id);
    groups.set(key, group);
  });
  return [...groups.values()].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

function renderWorkplaces() {
  const cards = appState.workplaces
    .map((workplace) => {
      const modes = workplace.modalities.slice(0, 3).map((modality) => `<div class="modality-line"><span><strong>${escapeHtml(modality.name)}</strong><small>${escapeHtml(describeRule(modality.rule))}</small></span><b>${currency(modality.amountCents)}</b></div>`).join('');
      return `<article class="card workplace-summary"><div class="card-head"><span class="round-icon">⌂</span><div><h3>${escapeHtml(workplace.name)}</h3><p>${escapeHtml(workplace.address || 'Endereço não informado')}</p></div><span class="badge ${workplace.active ? '' : 'inactive'}">${workplace.active ? 'Ativo' : 'Inativo'}</span></div><div class="modality-lines">${modes || '<p class="muted">Nenhuma modalidade cadastrada.</p>'}</div><div class="row-actions"><button class="danger-link" data-action="toggle-workplace" data-id="${workplace.id}" type="button">${workplace.active ? 'Desativar' : 'Reativar'}</button><button class="button secondary small" data-action="edit-workplace" data-id="${workplace.id}" type="button">Editar cadastro</button></div></article>`;
    })
    .join('');
  screen.innerHTML = `<div class="screen-stack">${pageHeading('Cadastros', 'Locais e repasses', 'Configure locais, modalidades, valores e regras de crédito.')}<button class="button primary" data-action="new-workplace" type="button">Adicionar local de trabalho</button><h2 class="section-title">Locais cadastrados</h2><div class="list">${cards || emptyCard('Comece pelo primeiro local', 'Cada local pode ter várias modalidades e prazos diferentes.')}</div></div>`;
}

function renderAttendance() {
  const workplace = appState.workplaces.find((item) => item.id === selectedWorkplaceId);
  if (!workplace) return navigate('home');
  if (!attendanceDraft) attendanceDraft = { occurredAt: dateOnly(), modalityId: workplace.modalities.find((item) => item.active)?.id || '', notes: '', evidence: '' };
  const modality = workplace.modalities.find((item) => item.id === attendanceDraft.modalityId);
  const dueAt = modality ? calculateDueDate(attendanceDraft.occurredAt, modality.rule) : '';
  const choices = workplace.modalities.filter((item) => item.active).map((item) => `<label class="choice"><input type="radio" name="modality" value="${item.id}" ${item.id === attendanceDraft.modalityId ? 'checked' : ''}/><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(describeRule(item.rule))}</small></span><b>${currency(item.amountCents)}</b></label>`).join('');
  const photo = attendanceDraft.evidence
    ? `<img class="photo-preview" src="${attendanceDraft.evidence}" alt="Prévia do comprovante"/><button class="button secondary small" data-action="remove-photo" type="button">Remover foto</button>`
    : `<span class="round-icon">▣</span><strong>Fotografe a prova do atendimento</strong><p>Evite incluir dados clínicos desnecessários. A imagem ficará neste aparelho.</p><label class="button primary small file-button">Abrir câmera<input id="evidence-input" type="file" accept="image/*" capture="environment"/></label>`;
  screen.innerHTML = `<form class="screen-stack" id="attendance-form">${pageHeading('Novo registro', workplace.name, 'Adicione o comprovante e classifique a modalidade do repasse.')}<label>Data do atendimento<input id="attendance-date" type="date" value="${attendanceDraft.occurredAt}" required/></label><h2 class="section-title">Comprovante</h2><div class="attendance-photo">${photo}</div><h2 class="section-title">Modalidade de repasse</h2><div class="choice-list">${choices}</div><label>Observação (opcional)<textarea id="attendance-notes" placeholder="Inclua somente informações necessárias.">${escapeHtml(attendanceDraft.notes)}</textarea></label>${modality ? `<div class="card summary-card"><span class="summary-main"><small>VALOR CONTABILIZADO</small><strong>${currency(modality.amountCents)}</strong></span><span class="summary-count"><small>CRÉDITO</small><strong style="font-size:14px">${displayDate(dueAt)}</strong></span></div>` : ''}<div class="action-grid"><button class="button secondary" data-action="cancel-attendance" type="button">Cancelar</button><button class="button primary" type="submit">Salvar</button></div></form>`;
}

function renderReconciliation() {
  const groups = reconciliationGroups();
  if (!selectedChannelWorkplace) selectedChannelWorkplace = appState.workplaces[0]?.id || '';
  const channel = appState.workplaces.find((item) => item.id === selectedChannelWorkplace);
  if (!selectedReconciliationGroup || !groups.some((group) => group.id === selectedReconciliationGroup)) selectedReconciliationGroup = groups[0]?.id || '';
  const options = appState.workplaces.map((workplace) => `<option value="${workplace.id}" ${workplace.id === selectedChannelWorkplace ? 'selected' : ''}>${escapeHtml(workplace.name)}</option>`).join('');
  const groupCards = groups.map((group) => `<button class="card group-card ${group.id === selectedReconciliationGroup ? 'selected' : ''}" data-action="select-reconciliation" data-id="${group.id}" type="button"><span class="group-check">${group.id === selectedReconciliationGroup ? '✓' : ''}</span><span><h3>${escapeHtml(group.workplace.name)}</h3><p>${monthLabel(group.month)}</p><small>${group.attendances.length} atend. • ${group.attachments} comprov.</small></span><b>${currency(group.totalCents)}</b></button>`).join('');
  const selected = groups.find((group) => group.id === selectedReconciliationGroup);
  screen.innerHTML = `<div class="screen-stack">${pageHeading('Conferência de pagamentos', 'Conciliação', 'Configure o canal, selecione um grupo vencido e abra a mensagem no seu e-mail.')}<h2 class="section-title">Canal oficial</h2>${channel ? `<form class="card settings" id="channel-form"><label>Local<select id="channel-workplace">${options}</select></label><label>E-mail oficial<input id="channel-email" type="email" value="${escapeHtml(channel.reconciliationEmail)}" placeholder="repasses@local.com.br"/></label><label>Cópia (opcional)<input id="channel-cc" value="${escapeHtml(channel.reconciliationCc || '')}" placeholder="gestor@local.com.br"/></label><label>Mensagem padrão<textarea id="channel-message">${escapeHtml(appState.reconciliationMessage)}</textarea></label><p class="field-hint">Tokens: {{local}}, {{periodo}}, {{quantidade}}, {{valor}}, {{detalhes}} e {{medico}}.</p><button class="button secondary small" type="submit">Salvar canal e mensagem</button></form>` : '<div class="notice warning">Cadastre um local antes de configurar a conciliação.</div>'}<h2 class="section-title">Grupos prontos para conciliar</h2><div class="list">${groupCards || emptyCard('Nenhum repasse vencido', 'Quando um grupo ultrapassar a data prevista sem baixa, ele aparecerá aqui.')}</div>${selected ? `<div class="card summary-card"><span class="summary-main"><small>SELECIONADO</small><strong>${currency(selected.totalCents)}</strong><small>${selected.attendances.length} atendimentos • ${monthLabel(selected.month)}</small></span></div><button class="button primary" data-action="open-reconciliation-email" type="button">Abrir solicitação no e-mail</button><div class="notice warning">Limitação deste beta web: o e-mail é preenchido, mas os comprovantes precisam ser anexados manualmente. O TestFlight usará anexos nativos.</div>` : ''}</div>`;
}

function reconciliationGroups() {
  const map = new Map();
  appState.attendances.filter((attendance) => attendance.status === 'pending' && isPastOrToday(attendance.dueAt)).forEach((attendance) => {
    const workplace = appState.workplaces.find((item) => item.id === attendance.workplaceId);
    if (!workplace) return;
    const month = attendance.dueAt.slice(0, 7);
    const key = `${workplace.id}:${month}`;
    const group = map.get(key) || { id: key, workplace, month, attendances: [], totalCents: 0, attachments: 0 };
    group.attendances.push(attendance);
    group.totalCents += attendance.amountCents;
    if (attendance.evidence) group.attachments += 1;
    map.set(key, group);
  });
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

function renderFeedback() {
  const history = appState.feedbacks.slice(-3).reverse().map((feedback) => `<div class="feedback-item"><strong>${feedback.rating}/5 • ${escapeHtml(feedback.area)}</strong><br/>${escapeHtml(feedback.message)}<br/><small>${new Date(feedback.createdAt).toLocaleString('pt-BR')}</small></div>`).join('');
  screen.innerHTML = `<div class="screen-stack">${pageHeading('Ajude a construir', 'Enviar feedback', 'Conte o que funcionou, o que confundiu e o que precisa melhorar antes do TestFlight.')}<form class="card feedback-form" id="feedback-form"><label>Nota para esta experiência</label><div class="rating" role="group" aria-label="Nota de 1 a 5">${[1, 2, 3, 4, 5].map((value) => `<button class="${value === feedbackRating ? 'selected' : ''}" data-action="rate-feedback" data-value="${value}" type="button">${value}</button>`).join('')}</div><label>Área avaliada<select id="feedback-area"><option>Experiência geral</option><option>Registro de atendimento</option><option>Dashboard</option><option>Cadastros e regras</option><option>Conciliação</option><option>Instalação no iPhone</option></select></label><label>Seu comentário<textarea id="feedback-message" required placeholder="Ex.: não entendi como escolher a regra de pagamento…"></textarea></label><label>Seu e-mail (opcional)<input id="feedback-contact" type="email" value="${escapeHtml(appState.profile?.email || '')}"/></label><button class="button primary" type="submit">Preparar e-mail de feedback</button><p class="field-hint">O beta abrirá o Mail para você revisar e enviar. Uma cópia fica no histórico local.</p></form>${history ? `<h2 class="section-title">Feedbacks preparados neste aparelho</h2><div class="feedback-history">${history}</div>` : ''}</div>`;
}

function renderAccount() {
  const subscriptionLabels = {
    active: 'Assinatura ativa',
    pending_payment: 'Pagamento pendente',
    past_due: 'Mensalidade pendente',
    suspended: 'Acesso suspenso',
    canceled: 'Assinatura cancelada',
  };
  const accessStatus = cloudAccount?.profile?.accessStatus;
  const cloudSection = isCloudMode()
    ? `<h2 class="section-title">Plano e acesso</h2><div class="card workplace-summary"><div class="card-head"><span class="round-icon">✓</span><div><h3>Plano Profissional</h3><p>R$ 29,90 por mês • Mercado Pago</p></div><span class="badge ${accessStatus === 'active' ? '' : 'inactive'}">${escapeHtml(subscriptionLabels[accessStatus] || 'Em configuração')}</span></div></div>${cloudAccount?.profile?.role === 'admin' ? '<a class="button primary" href="./admin.html">Abrir painel administrativo</a>' : ''}`
    : '';
  const deleteLabel = isCloudMode() ? 'Excluir dados salvos neste aparelho' : 'Excluir conta e dados deste beta';
  screen.innerHTML = `<div class="screen-stack">${pageHeading('Perfil neste aparelho', 'Conta e instalação', 'Gerencie seu acesso e instale o atalho na Tela de Início.')}<div class="card card-head"><span class="avatar">${escapeHtml((appState.profile?.name || 'M').charAt(0))}</span><div><h3>${escapeHtml(appState.profile?.name || 'Médico')}</h3><p>${formatCpf(appState.profile?.cpf || '')}<br/>${escapeHtml(appState.profile?.email || '')}</p></div></div>${cloudSection}<div class="notice success"><strong>Dados salvos neste aparelho</strong><br/>Fechar o MedRecebe ou o Safari não apaga seus cadastros ou atendimentos.</div><h2 class="section-title">Instalação</h2><div class="card install-card"><span class="install-icon">${isStandalone() ? '✓' : '⇧'}</span><div><strong>${isStandalone() ? 'Beta instalado' : 'Adicionar à Tela de Início'}</strong><p>${isStandalone() ? 'Você está usando o modo aplicativo.' : 'Abra no Safari e instale o atalho para usar offline.'}</p></div>${isStandalone() ? '' : '<button class="link-button" data-action="install" type="button">Ver passos</button>'}</div><h2 class="section-title">Privacidade e suporte</h2><div class="card account-links"><a class="account-link" href="./privacidade.html" target="_blank" rel="noopener">Política de Privacidade <span>›</span></a><a class="account-link" href="./suporte.html" target="_blank" rel="noopener">Ajuda e suporte <span>›</span></a></div><button class="button secondary" data-action="logout" type="button">Sair</button><button class="button danger" data-action="delete-beta-data" type="button">${deleteLabel}</button><p class="muted" style="text-align:center;font-size:9px">MedRecebe • Beta web 1.2</p></div>`;
}

function openInstallModal() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.finally(() => (deferredInstallPrompt = null));
    return;
  }
  modalRoot.innerHTML = `<div class="modal-wrap"><section class="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="install-title"><header class="modal-header"><button data-action="close-modal" type="button">Fechar</button><h2 id="install-title">Instalar no iPhone</h2><span></span></header><div class="modal-body"><div class="notice">Use o Safari. Outros navegadores no iPhone podem não mostrar a opção correta.</div><div class="install-steps"><div class="install-step"><div><strong>Abra o menu Compartilhar</strong><p>Toque no ícone de compartilhar do Safari.</p></div></div><div class="install-step"><div><strong>Adicionar à Tela de Início</strong><p>Role a lista de ações e escolha esta opção.</p></div></div><div class="install-step"><div><strong>Ative “Abrir como App da Web”</strong><p>Toque em Adicionar. O ícone MedRecebe aparecerá na Home Screen.</p></div></div></div><div class="notice success">Depois da primeira abertura online, o aplicativo também funciona sem internet.</div></div></section></div>`;
}

function newWorkplace() {
  draftWorkplace = { id: id('work'), name: '', address: '', reconciliationEmail: '', reconciliationCc: '', active: true, modalities: [] };
  editingModalityIndex = null;
  renderWorkplaceModal();
}

function editWorkplace(workplaceId) {
  const workplace = appState.workplaces.find((item) => item.id === workplaceId);
  if (!workplace) return;
  draftWorkplace = structuredClone(workplace);
  editingModalityIndex = null;
  renderWorkplaceModal();
}

function renderWorkplaceModal() {
  const modalityRows = draftWorkplace.modalities.map((modality, index) => `<div class="editor-row"><span><strong>${escapeHtml(modality.name)} • ${currency(modality.amountCents)}</strong><small>${escapeHtml(describeRule(modality.rule))}</small></span><span><button data-action="edit-modality" data-index="${index}" type="button">Editar</button><button data-action="delete-modality" data-index="${index}" type="button">Excluir</button></span></div>`).join('');
  const editing = editingModalityIndex === null ? null : draftWorkplace.modalities[editingModalityIndex];
  const modality = editing || { name: '', type: 'plan', amountCents: 0, rule: { kind: 'calendar_days', days: 30 } };
  modalRoot.innerHTML = `<div class="modal-wrap"><section class="modal-sheet" role="dialog" aria-modal="true"><header class="modal-header"><button data-action="close-modal" type="button">Cancelar</button><h2>${appState.workplaces.some((item) => item.id === draftWorkplace.id) ? 'Editar local' : 'Novo local'}</h2><button data-action="save-workplace" type="button">Salvar</button></header><div class="modal-body"><div class="form-grid"><label>Nome do local<input id="work-name" value="${escapeHtml(draftWorkplace.name)}" placeholder="Ex.: Clínica Horizonte"/></label><label>Endereço<input id="work-address" value="${escapeHtml(draftWorkplace.address)}" placeholder="Rua, número e cidade"/></label><label>E-mail oficial para conciliação<input id="work-email" type="email" value="${escapeHtml(draftWorkplace.reconciliationEmail)}" placeholder="financeiro@clinica.com.br"/></label><label>E-mail em cópia<input id="work-cc" value="${escapeHtml(draftWorkplace.reconciliationCc || '')}" placeholder="gestor@clinica.com.br"/></label></div><h3 class="section-title">Modalidades</h3><div class="modalities-editor">${modalityRows || '<div class="notice warning">Cadastre pelo menos uma modalidade.</div>'}</div><div class="modality-form"><h3>${editing ? 'Editar modalidade' : 'Adicionar modalidade'}</h3><label>Nome<input id="mod-name" value="${escapeHtml(modality.name)}" placeholder="Ex.: Unimed ou particular"/></label><div class="inline-grid"><label>Tipo<select id="mod-type"><option value="plan" ${modality.type === 'plan' ? 'selected' : ''}>Plano</option><option value="private" ${modality.type === 'private' ? 'selected' : ''}>Particular</option></select></label><label>Valor (R$)<input id="mod-value" inputmode="decimal" value="${modality.amountCents ? (modality.amountCents / 100).toFixed(2).replace('.', ',') : ''}" placeholder="0,00"/></label></div><label>Regra<select id="mod-rule">${ruleOptions(modality.rule.kind)}</select></label><div id="rule-fields">${ruleFields(modality.rule)}</div><button class="button secondary small" data-action="save-modality" type="button">${editing ? 'Atualizar modalidade' : 'Adicionar modalidade'}</button></div><div class="notice">Na regra personalizada, guarde o texto contratual e confira o exemplo de vencimento antes de salvar.</div></div></section></div>`;
}

function ruleOptions(selected) {
  const options = [
    ['calendar_days', 'Dias corridos'], ['immediate', 'À vista'], ['advance', 'Antecipado'],
    ['first_business_day_next_month', '1º dia útil do mês seguinte'], ['last_business_day_next_month', 'Último dia útil do mês seguinte'],
    ['weekly', 'Dia da semana seguinte'], ['custom', 'Regra personalizada'],
  ];
  return options.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}

function ruleFields(rule) {
  if (['calendar_days', 'advance'].includes(rule.kind)) return `<label>Quantidade de dias<input id="rule-days" inputmode="numeric" value="${Number(rule.days) || 0}"/></label>`;
  if (rule.kind === 'weekly') return `<label>Dia da semana<select id="rule-weekday">${[['1', 'Segunda'], ['2', 'Terça'], ['3', 'Quarta'], ['4', 'Quinta'], ['5', 'Sexta']].map(([value, label]) => `<option value="${value}" ${Number(value) === Number(rule.weekday || 5) ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`;
  if (rule.kind === 'custom') return `<div class="form-grid"><label>Data-base<select id="rule-basis"><option value="service_date" ${rule.basis === 'service_date' ? 'selected' : ''}>Data do atendimento</option><option value="end_of_week" ${rule.basis === 'end_of_week' ? 'selected' : ''}>Fim da semana</option><option value="end_of_month" ${rule.basis === 'end_of_month' ? 'selected' : ''}>Fim do mês</option></select></label><div class="inline-grid"><label>Deslocamento<input id="rule-offset" inputmode="numeric" value="${Number(rule.offset) || 0}"/></label><label>Unidade<select id="rule-unit"><option value="days" ${rule.unit === 'days' ? 'selected' : ''}>Dias</option><option value="weeks" ${rule.unit === 'weeks' ? 'selected' : ''}>Semanas</option><option value="months" ${rule.unit === 'months' ? 'selected' : ''}>Meses</option></select></label></div><label>Ajuste<select id="rule-adjustment"><option value="none">Sem ajuste</option><option value="next_business_day" ${rule.adjustment === 'next_business_day' ? 'selected' : ''}>Próximo dia útil</option><option value="previous_business_day" ${rule.adjustment === 'previous_business_day' ? 'selected' : ''}>Dia útil anterior</option><option value="first_business_day" ${rule.adjustment === 'first_business_day' ? 'selected' : ''}>1º dia útil do mês</option><option value="last_business_day" ${rule.adjustment === 'last_business_day' ? 'selected' : ''}>Último dia útil do mês</option></select></label><label>Texto acordado<textarea id="rule-text" placeholder="Descreva fielmente a cláusula.">${escapeHtml(rule.contractualText || '')}</textarea></label></div>`;
  return '<p class="field-hint">A data prevista será calculada automaticamente.</p>';
}

function preserveWorkplaceFields() {
  if (!draftWorkplace || !$('#work-name')) return;
  draftWorkplace.name = $('#work-name').value;
  draftWorkplace.address = $('#work-address').value;
  draftWorkplace.reconciliationEmail = $('#work-email').value;
  draftWorkplace.reconciliationCc = $('#work-cc').value;
}

function readRuleForm() {
  const kind = $('#mod-rule').value;
  const rule = { kind };
  if (['calendar_days', 'advance'].includes(kind)) rule.days = Number($('#rule-days').value) || 0;
  if (kind === 'weekly') rule.weekday = Number($('#rule-weekday').value) || 5;
  if (kind === 'custom') Object.assign(rule, { basis: $('#rule-basis').value, offset: Number($('#rule-offset').value) || 0, unit: $('#rule-unit').value, adjustment: $('#rule-adjustment').value, contractualText: $('#rule-text').value.trim() });
  return rule;
}

function parseMoney(value) {
  const normalized = value.replace(/\s/g, '').replace(/R\$/gi, '').replace(/\./g, '').replace(',', '.');
  return Math.round((Number(normalized) || 0) * 100);
}

async function compressImage(file) {
  const image = new Image();
  image.src = URL.createObjectURL(file);
  if (image.decode) await image.decode();
  else await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
  });
  const max = 1100;
  const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(image.src);
  return canvas.toDataURL('image/jpeg', 0.68);
}

function prepareReconciliationEmail() {
  const group = reconciliationGroups().find((item) => item.id === selectedReconciliationGroup);
  if (!group) return;
  if (!group.workplace.reconciliationEmail || group.workplace.reconciliationEmail.endsWith('.exemplo')) {
    showToast('Cadastre um e-mail oficial válido antes de abrir a solicitação.');
    selectedChannelWorkplace = group.workplace.id;
    return;
  }
  const details = group.attendances.map((attendance, index) => `${index + 1}. ${displayDate(attendance.occurredAt)} — ${attendance.modalityName} — ${currency(attendance.amountCents)}`).join('\n');
  let body = appState.reconciliationMessage;
  const tokens = { '{{local}}': group.workplace.name, '{{periodo}}': monthLabel(group.month), '{{quantidade}}': String(group.attendances.length), '{{valor}}': currency(group.totalCents), '{{detalhes}}': details, '{{medico}}': appState.profile.name };
  Object.entries(tokens).forEach(([token, value]) => (body = body.split(token).join(value)));
  const subject = `Conciliação de repasses — ${group.workplace.name} — ${monthLabel(group.month)}`;
  const cc = group.workplace.reconciliationCc ? `&cc=${encodeURIComponent(group.workplace.reconciliationCc)}` : '';
  window.location.href = `mailto:${encodeURIComponent(group.workplace.reconciliationEmail)}?subject=${encodeURIComponent(subject)}${cc}&body=${encodeURIComponent(body)}`;
}

function bindEvents() {
  $('#auth-cpf').addEventListener('input', (event) => (event.target.value = formatCpf(event.target.value)));
  $('#auth-toggle').addEventListener('click', () => {
    authMode = authMode === 'login' ? 'register' : 'login';
    const register = authMode === 'register';
    $('#register-fields').hidden = !register;
    $('#auth-title').textContent = register ? 'Criar meu acesso' : 'Boas-vindas';
    $('#auth-description').textContent = register
      ? isCloudMode()
        ? 'Cadastre seus dados para criar sua conta MedRecebe.'
        : 'Cadastre seus dados reais. A conta permanecerá salva neste aparelho.'
      : isCloudMode()
        ? 'Entre com o CPF e a senha da sua conta MedRecebe.'
        : 'Entre com o CPF e a senha cadastrados neste aparelho.';
    $('#auth-submit').textContent = register ? 'Criar acesso e entrar' : 'Entrar';
    $('#auth-toggle').textContent = register ? 'Já tenho acesso' : 'Primeiro uso? Criar meu acesso';
    $('#demo-entry').hidden = register || isCloudMode();
    $('#auth-password').autocomplete = register ? 'new-password' : 'current-password';
    $('#auth-error').textContent = '';
  });

  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    void requestPersistentStorage();
    const cpf = onlyDigits($('#auth-cpf').value);
    const password = $('#auth-password').value;
    const error = $('#auth-error');
    const submit = $('#auth-submit');
    error.textContent = '';
    if (isCloudMode()) {
      submit.disabled = true;
      submit.textContent = 'Aguarde…';
      try {
        if (authMode === 'register') {
          const name = $('#auth-name').value.trim();
          const email = $('#auth-email').value.trim().toLowerCase();
          if (name.length < 3) throw new Error('Informe seu nome completo.');
          if (!isValidCpf(cpf)) throw new Error('Informe um CPF válido.');
          if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Informe um e-mail válido.');
          if (password.length < 8) throw new Error('A senha deve ter pelo menos oito caracteres.');
          const result = await cloud.register({ name, email, cpf, password });
          if (result.requiresEmailConfirmation) {
            authMode = 'login';
            $('#register-fields').hidden = true;
            $('#auth-title').textContent = 'Confirme seu e-mail';
            $('#auth-description').textContent = 'Depois da confirmação, entre com seu CPF e senha.';
            $('#auth-toggle').textContent = 'Primeiro uso? Criar meu acesso';
            error.textContent = 'Cadastro criado. Confirme o e-mail enviado e depois entre com CPF e senha.';
            return;
          }
          applyCloudAccount(result, cpf);
        } else {
          applyCloudAccount(await cloud.login(cpf, password), cpf);
        }
      } catch (caught) {
        error.textContent = caught instanceof Error ? caught.message : 'Não foi possível concluir o acesso.';
      } finally {
        submit.disabled = false;
        submit.textContent = authMode === 'register' ? 'Criar acesso e entrar' : 'Entrar';
      }
      return;
    }
    if (authMode === 'register') {
      const name = $('#auth-name').value.trim();
      const email = $('#auth-email').value.trim().toLowerCase();
      if (name.length < 3) return (error.textContent = 'Informe seu nome completo.');
      if (!isValidCpf(cpf)) return (error.textContent = 'Informe um CPF válido.');
      if (!/^\S+@\S+\.\S+$/.test(email)) return (error.textContent = 'Informe um e-mail válido.');
      if (password.length < 8) return (error.textContent = 'A senha deve ter pelo menos oito caracteres.');
      const salt = id('salt');
      appState = { ...emptyState(), account: { cpf, salt, passwordHash: await hashPassword(password, salt) }, profile: { name, cpf, email } };
      if (!saveState()) return (error.textContent = 'Não foi possível salvar seu acesso neste aparelho. Verifique o espaço disponível e tente novamente.');
    } else {
      if (!appState.account) return (error.textContent = 'Acesso não encontrado. Crie seu acesso ou use a demonstração.');
      const hash = await hashPassword(password, appState.account.salt);
      if (cpf !== appState.account.cpf || hash !== appState.account.passwordHash) return (error.textContent = 'CPF ou senha incorretos.');
    }
    if (!activateSession()) return;
    showApp();
  });

  $('#demo-entry').addEventListener('click', async () => {
    void requestPersistentStorage();
    const salt = id('demo-salt');
    appState = demoState(await hashPassword(DEMO_PASSWORD, salt), salt);
    if (!saveState() || !activateSession()) return;
    showApp();
  });

  $('#billing-subscribe').addEventListener('click', async () => {
    const button = $('#billing-subscribe');
    button.disabled = true;
    button.textContent = 'Abrindo Mercado Pago…';
    try {
      const result = await cloud.createSubscription();
      if (result.active || result.adminAccess) {
        const restored = await cloud.restore();
        if (restored) applyCloudAccount(restored);
        return;
      }
      if (!result.checkoutUrl) throw new Error('Link de pagamento indisponível.');
      window.location.assign(result.checkoutUrl);
    } catch (caught) {
      $('#billing-status').textContent = caught instanceof Error ? caught.message : 'Não foi possível abrir o pagamento.';
      button.disabled = false;
      button.textContent = 'Assinar com cartão';
    }
  });

  $('#billing-refresh').addEventListener('click', async () => {
    const button = $('#billing-refresh');
    button.disabled = true;
    button.textContent = 'Verificando…';
    try {
      const restored = await cloud.restore();
      if (restored) applyCloudAccount(restored);
      if (!cloudAccessAllowed()) $('#billing-status').textContent = 'O pagamento ainda está em processamento. Tente novamente em alguns instantes.';
    } catch (caught) {
      $('#billing-status').textContent = caught instanceof Error ? caught.message : 'Não foi possível verificar o pagamento.';
    } finally {
      button.disabled = false;
      button.textContent = 'Já paguei — verificar acesso';
    }
  });

  $('#billing-logout').addEventListener('click', logout);

  $('#header-action').addEventListener('click', () => (currentRoute === 'attendance' ? navigate('home') : openDrawer()));
  $('#feedback-shortcut').addEventListener('click', () => navigate('feedback'));
  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#drawer-backdrop').addEventListener('click', closeDrawer);
  $('#logout-button').addEventListener('click', logout);

  document.addEventListener('click', handleClick);
  document.addEventListener('submit', handleSubmit);
  document.addEventListener('change', handleChange);
  document.addEventListener('input', handleInput);
}

function handleClick(event) {
  const nav = event.target.closest('[data-nav]');
  if (nav) return navigate(nav.dataset.nav);
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action, id: targetId, ids, index, value } = target.dataset;
  if (action === 'install') openInstallModal();
  if (action === 'close-modal') modalRoot.innerHTML = '';
  if (action === 'new-workplace') newWorkplace();
  if (action === 'edit-workplace') editWorkplace(targetId);
  if (action === 'toggle-workplace') {
    const workplace = appState.workplaces.find((item) => item.id === targetId);
    if (workplace) workplace.active = !workplace.active;
    saveState();
    renderWorkplaces();
  }
  if (action === 'open-attendance') {
    selectedWorkplaceId = targetId;
    attendanceDraft = null;
    navigate('attendance');
  }
  if (action === 'cancel-attendance') navigate('home');
  if (action === 'remove-photo') {
    attendanceDraft.evidence = '';
    renderAttendance();
  }
  if (action === 'mark-paid') {
    if (confirm('Confirmar que este grupo foi recebido?')) {
      const selectedIds = ids.split(',');
      appState.attendances.forEach((attendance) => {
        if (selectedIds.includes(attendance.id)) attendance.status = 'paid';
      });
      saveState();
      renderDashboard();
    }
  }
  if (action === 'select-reconciliation') {
    selectedReconciliationGroup = targetId;
    renderReconciliation();
  }
  if (action === 'open-reconciliation-email') prepareReconciliationEmail();
  if (action === 'rate-feedback') {
    feedbackRating = Number(value);
    $$('.rating button').forEach((button) => button.classList.toggle('selected', Number(button.dataset.value) === feedbackRating));
  }
  if (action === 'logout') logout();
  if (action === 'delete-beta-data' && confirm(isCloudMode() ? 'Excluir deste aparelho os cadastros, atendimentos, fotos e feedbacks?' : 'Excluir conta, cadastros, atendimentos, fotos e feedbacks deste beta?')) {
    localStorage.removeItem(activeStateKey);
    localStorage.removeItem(SESSION_KEY);
    appState = emptyState();
    if (isCloudMode()) logout();
    else showLogin();
  }
  if (action === 'edit-modality') {
    preserveWorkplaceFields();
    editingModalityIndex = Number(index);
    renderWorkplaceModal();
  }
  if (action === 'delete-modality') {
    preserveWorkplaceFields();
    draftWorkplace.modalities.splice(Number(index), 1);
    editingModalityIndex = null;
    renderWorkplaceModal();
  }
  if (action === 'save-modality') saveModality();
  if (action === 'save-workplace') saveWorkplace();
}

function handleChange(event) {
  if (event.target.id === 'mod-rule') $('#rule-fields').innerHTML = ruleFields({ kind: event.target.value });
  if (currentRoute === 'attendance' && attendanceDraft && event.target.id === 'attendance-date') {
    attendanceDraft.occurredAt = event.target.value;
    renderAttendance();
  }
  if (currentRoute === 'attendance' && attendanceDraft && event.target.name === 'modality') {
    attendanceDraft.modalityId = event.target.value;
    renderAttendance();
  }
  if (event.target.id === 'channel-workplace') {
    selectedChannelWorkplace = event.target.value;
    renderReconciliation();
  }
  if (event.target.id === 'evidence-input' && event.target.files[0]) {
    const file = event.target.files[0];
    if (!file.type.startsWith('image/')) return showToast('Escolha uma imagem válida.');
    if (file.size > 15 * 1024 * 1024) return showToast('A foto é muito grande. Escolha uma imagem de até 15 MB.');
    compressImage(file)
      .then((dataUrl) => {
        attendanceDraft.evidence = dataUrl;
        renderAttendance();
      })
      .catch(() => showToast('Não foi possível preparar esta foto.'));
  }
}

function handleInput(event) {
  if (currentRoute !== 'attendance' || !attendanceDraft) return;
  if (event.target.id === 'attendance-date') attendanceDraft.occurredAt = event.target.value;
  if (event.target.id === 'attendance-notes') attendanceDraft.notes = event.target.value;
  if (event.target.name === 'modality') attendanceDraft.modalityId = event.target.value;
}

function handleSubmit(event) {
  if (event.target.id === 'attendance-form') {
    event.preventDefault();
    const modality = appState.workplaces.find((item) => item.id === selectedWorkplaceId)?.modalities.find((item) => item.id === attendanceDraft.modalityId);
    if (!attendanceDraft.evidence) return showToast('Adicione a foto do comprovante.');
    if (!modality) return showToast('Selecione a modalidade de repasse.');
    const attendance = { id: id('att'), workplaceId: selectedWorkplaceId, modalityId: modality.id, modalityName: modality.name, occurredAt: attendanceDraft.occurredAt, dueAt: calculateDueDate(attendanceDraft.occurredAt, modality.rule), amountCents: modality.amountCents, evidence: attendanceDraft.evidence, notes: attendanceDraft.notes.trim(), status: 'pending', createdAt: new Date().toISOString() };
    appState.attendances.unshift(attendance);
    if (!saveState()) {
      appState.attendances.shift();
      return;
    }
    attendanceDraft = null;
    navigate('home');
    showToast('Atendimento salvo e adicionado ao Dashboard.');
  }
  if (event.target.id === 'channel-form') {
    event.preventDefault();
    const workplace = appState.workplaces.find((item) => item.id === selectedChannelWorkplace);
    if (!workplace) return;
    workplace.reconciliationEmail = $('#channel-email').value.trim().toLowerCase();
    workplace.reconciliationCc = $('#channel-cc').value.trim().toLowerCase();
    appState.reconciliationMessage = $('#channel-message').value.trim();
    saveState();
    showToast('Canal e mensagem salvos neste aparelho.');
  }
  if (event.target.id === 'feedback-form') {
    event.preventDefault();
    const feedback = { rating: feedbackRating, area: $('#feedback-area').value, message: $('#feedback-message').value.trim(), contact: $('#feedback-contact').value.trim(), createdAt: new Date().toISOString() };
    if (!feedback.message) return;
    appState.feedbacks.push(feedback);
    saveState();
    const context = `\n\n--- Contexto automático ---\nNota: ${feedback.rating}/5\nÁrea: ${feedback.area}\nTela: ${currentRoute}\nLocais: ${appState.workplaces.length}\nAtendimentos: ${appState.attendances.length}\nModo instalado: ${isStandalone() ? 'sim' : 'não'}\nDispositivo: ${navigator.userAgent}\nContato: ${feedback.contact || 'não informado'}`;
    window.location.href = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(`Feedback Beta MedRecebe — ${feedback.area} — ${feedback.rating}/5`)}&body=${encodeURIComponent(feedback.message + context)}`;
    renderFeedback();
  }
}

function saveModality() {
  preserveWorkplaceFields();
  const name = $('#mod-name').value.trim();
  const amountCents = parseMoney($('#mod-value').value);
  const rule = readRuleForm();
  if (!name || amountCents <= 0) return showToast('Informe nome e valor da modalidade.');
  if (rule.kind === 'custom' && !rule.contractualText) return showToast('Registre o texto acordado na regra personalizada.');
  const existing = editingModalityIndex === null ? null : draftWorkplace.modalities[editingModalityIndex];
  const modality = { id: existing?.id || id('mod'), name, type: $('#mod-type').value, amountCents, rule, active: true };
  if (editingModalityIndex === null) draftWorkplace.modalities.push(modality);
  else draftWorkplace.modalities[editingModalityIndex] = modality;
  editingModalityIndex = null;
  renderWorkplaceModal();
}

function saveWorkplace() {
  preserveWorkplaceFields();
  if (!draftWorkplace.name.trim()) return showToast('Informe o nome do local.');
  if (!draftWorkplace.modalities.length) return showToast('Cadastre pelo menos uma modalidade.');
  const exists = appState.workplaces.some((item) => item.id === draftWorkplace.id);
  if (exists) appState.workplaces = appState.workplaces.map((item) => (item.id === draftWorkplace.id ? structuredClone(draftWorkplace) : item));
  else appState.workplaces.push(structuredClone(draftWorkplace));
  saveState();
  modalRoot.innerHTML = '';
  renderWorkplaces();
  showToast('Local e modalidades salvos.');
}

function logout() {
  if (isCloudMode()) void cloud.logout();
  cloudAccount = null;
  localStorage.removeItem(SESSION_KEY);
  activeStateKey = APP_KEY;
  appState = loadState(APP_KEY);
  currentRoute = 'home';
  showLogin();
}

async function boot() {
  bindEvents();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
  });
  if (isCloudMode()) {
    $('#demo-entry').hidden = true;
    $('#auth-description').textContent = 'Entre com o CPF e a senha da sua conta MedRecebe.';
    try {
      const restored = await cloud.restore();
      if (restored) applyCloudAccount(restored);
      else showLogin();
    } catch {
      showLogin();
    }
    return;
  }
  if (localStorage.getItem(SESSION_KEY) === 'active' && appState.profile && appState.account) showApp();
  else showLogin();
}

void boot();
