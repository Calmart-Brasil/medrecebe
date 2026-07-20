const APP_KEY = 'medrecebe.beta.app.v1';
const SESSION_KEY = 'medrecebe.beta.session.v1';
const DEMO_CPF = '52998224725';
const DEMO_PASSWORD = 'Teste@123';
const FEEDBACK_EMAIL = 'ti@calmart.com.br';
const INSTITUTION_DIRECTORY_URL = './data/institution-directory-rmsp.json?v=20260717';
const CNPJ_CARD_URL = 'https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/cnpj.aspx';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const screen = $('#screen');
const modalRoot = $('#modal-root');
const cloud = window.MedRecebeCloud;

let authMode = 'login';
let recoveryAccessToken = '';
let recoveryLinkError = '';
let currentRoute = 'dashboard';
let selectedWorkplaceId = '';
let selectedReconciliationGroup = '';
let selectedChannelWorkplace = '';
let selectedInvoiceId = '';
let feedbackRating = 5;
let deferredInstallPrompt = null;
let toastTimer = 0;
let draftWorkplace = null;
let editingModalityIndex = null;
let attendanceDraft = null;
let editingAttendanceId = '';
let attendanceHistoryExpanded = false;
let attendanceRenderTimer = 0;
let cloudAccount = null;
let activeStateKey = APP_KEY;
let selectedPlanCode = 'standard';
let cloudSyncTimer = 0;
let cloudHydrating = false;
let cloudStateDirty = false;
let cloudHydrationSequence = 0;
let evidenceSyncRunning = false;
let institutionDirectory = [];
let institutionDirectoryMeta = null;
let institutionDirectoryPromise = null;
let pendingInvoiceWorkplaceId = '';

const TITLES = {
  home: 'Início',
  attendance: 'Novo atendimento',
  dashboard: 'Dashboard',
  workplaces: 'Locais e repasses',
  reconciliation: 'Conciliação',
  feedback: 'Feedback',
  account: 'Mais',
  cancellation: 'Cancelamento',
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
    invoices: [],
    reconciliationMessage: DEFAULT_MESSAGE,
    feedbacks: [],
    demo: false,
  };
}

function normalizeState(input) {
  const state = { ...emptyState(), ...(input || {}) };
  state.workplaces = Array.isArray(state.workplaces) ? state.workplaces : [];
  const sourceAttendances = Array.isArray(state.attendances) ? state.attendances : [];
  const associatedIds = new Set(sourceAttendances.filter((item) => item?.isAssociatedConsultation).map((item) => item.sourceAttendanceId));
  const normalized = [];
  sourceAttendances.forEach((attendance) => {
    if (!attendance || typeof attendance !== 'object') return;
    const quantity = attendanceQuantity(attendance);
    const workplace = state.workplaces.find((item) => item.id === attendance.workplaceId);
    const sourceModality = workplace?.modalities?.find((item) => item.id === attendance.modalityId);
    const shouldSeparate = (attendance.modalityType === 'recurring' || sourceModality?.type === 'recurring')
      && attendance.includeConsultation
      && attendance.consultationModalityId
      && Number(attendance.consultationAmountCents) > 0
      && !attendance.consultationSeparated
      && !associatedIds.has(attendance.id);
    if (!shouldSeparate) {
      normalized.push(attendance);
      return;
    }
    const consultation = workplace?.modalities?.find((item) => item.id === attendance.consultationModalityId);
    const baseAmountCents = Number(attendance.baseAmountCents) || Math.max(0, Number(attendance.unitAmountCents || 0) - Number(attendance.consultationAmountCents || 0));
    const consultationAmountCents = Number(attendance.consultationAmountCents || consultation?.amountCents || 0);
    normalized.push({
      ...attendance,
      amountCents: baseAmountCents * quantity,
      unitAmountCents: baseAmountCents,
      baseAmountCents,
      consultationSeparated: true,
    });
    normalized.push({
      id: `consultation-${attendance.id}`,
      recordId: attendanceRecordId(attendance),
      workplaceId: attendance.workplaceId,
      modalityId: attendance.consultationModalityId,
      modalityName: attendance.consultationModalityName || consultation?.name || 'Consulta associada',
      modalityType: consultation?.type || 'plan',
      quantity,
      occurredAt: attendance.occurredAt,
      dueAt: consultation ? calculateDueDate(attendance.occurredAt, consultation.rule) : attendance.dueAt,
      amountCents: consultationAmountCents * quantity,
      unitAmountCents: consultationAmountCents,
      baseAmountCents: consultationAmountCents,
      evidence: '',
      notes: '',
      patientReference: '',
      medication: '',
      includeConsultation: false,
      consultationAmountCents: 0,
      status: attendance.status,
      createdAt: attendance.createdAt,
      updatedAt: attendance.updatedAt || attendance.createdAt,
      isAssociatedConsultation: true,
      sourceAttendanceId: attendance.id,
      sourceModalityId: attendance.modalityId,
    });
  });
  state.attendances = normalized;
  state.invoices = Array.isArray(state.invoices) ? state.invoices : [];
  state.feedbacks = Array.isArray(state.feedbacks) ? state.feedbacks : [];
  state.schemaVersion = 3;
  return state;
}

function loadState(storageKey = activeStateKey) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey));
    if (parsed && Array.isArray(parsed.workplaces) && Array.isArray(parsed.attendances)) {
      const normalized = normalizeState(parsed);
      if (normalized.profile?.cpf) {
        const last4 = onlyDigits(normalized.profile.cpf).slice(-4);
        normalized.profile = { ...normalized.profile, cpf: `•••.•••.•••-${last4.padStart(4, '•')}` };
        localStorage.setItem(storageKey, JSON.stringify(normalized));
      }
      return normalized;
    }
  } catch {
    // Um armazenamento inválido é substituído por uma base limpa.
  }
  return emptyState();
}

function saveState() {
  try {
    localStorage.setItem(activeStateKey, JSON.stringify(appState));
    if (!cloudHydrating && isCloudMode()) {
      cloudStateDirty = true;
      localStorage.setItem(`${activeStateKey}.dirty`, '1');
    }
    scheduleCloudSync();
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

function attendanceQuantity(attendance) {
  const quantity = Number(attendance?.quantity);
  return Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
}

function attendanceRecordId(attendance) {
  return attendance?.recordId || attendance?.id || '';
}

function attendanceCount(attendances) {
  return attendances.reduce((total, attendance) => total + attendanceQuantity(attendance), 0);
}

function attendanceRecordLines(recordId) {
  return appState.attendances.filter((attendance) => attendanceRecordId(attendance) === recordId);
}

function attendanceRecordEvidence(lines) {
  const attendance = lines.find((item) => item.evidence || item.evidenceRemoteUrl);
  return attendance?.evidence || attendance?.evidenceRemoteUrl || '';
}

function attendanceRecordDocument(lines) {
  const attendance = lines.find((item) => item.evidence || item.evidenceRemoteUrl || item.evidenceDocumentId);
  return attendance ? {
    id: attendance.evidenceDocumentId || '',
    source: attendance.evidence || attendance.evidenceRemoteUrl || '',
    remoteUrl: attendance.evidenceRemoteUrl || '',
    syncStatus: attendance.evidenceSyncStatus || (attendance.evidenceDocumentId ? 'synced' : attendance.evidence ? 'pending' : ''),
    fileName: attendance.evidenceFileName || 'comprovante.jpg',
    mimeType: attendance.evidenceMimeType || 'image/jpeg',
  } : { id: '', source: '', remoteUrl: '', syncStatus: '', fileName: 'comprovante.jpg', mimeType: 'image/jpeg' };
}

function preferredConsultationModality(modalities) {
  return modalities.find((item) => /consulta/i.test(item.name || '')) || null;
}

function newAttendanceDraft(workplace) {
  const firstModality = workplace.modalities.find((item) => item.active);
  return {
    occurredAt: dateOnly(),
    items: firstModality ? { [firstModality.id]: { quantity: 1 } } : {},
    notes: '',
    evidence: '',
    evidenceDocumentId: '',
    evidenceSyncStatus: '',
    evidenceFileName: 'comprovante.jpg',
    evidenceMimeType: 'image/jpeg',
    evidenceChanged: false,
  };
}

function selectedAttendanceItems(workplace, draft = attendanceDraft) {
  return workplace.modalities
    .filter((modality) => modality.active || Number(draft?.items?.[modality.id]?.quantity) > 0)
    .map((modality) => ({ modality, draft: draft?.items?.[modality.id] || {} }))
    .filter(({ draft: item }) => Number(item.quantity) > 0);
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

function cnpjDigits(value = '') {
  return String(value).replace(/\D/g, '').slice(0, 14);
}

function formatCnpj(value = '') {
  return cnpjDigits(value)
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function isValidCnpj(value) {
  const cnpj = cnpjDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calculate = (length) => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + Number(cnpj[index]) * weight, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return calculate(12) === Number(cnpj[12]) && calculate(13) === Number(cnpj[13]);
}

function normalizeDirectoryText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function loadInstitutionDirectory() {
  if (institutionDirectory.length) return institutionDirectory;
  if (institutionDirectoryPromise) return institutionDirectoryPromise;
  institutionDirectoryPromise = fetch(INSTITUTION_DIRECTORY_URL)
    .then((response) => {
      if (!response.ok) throw new Error('Diretório institucional indisponível.');
      return response.json();
    })
    .then((payload) => {
      institutionDirectoryMeta = payload.meta || null;
      institutionDirectory = (payload.institutions || []).map((institution) => ({
        ...institution,
        tradeName: institution.tradeName || institution.name || '',
        searchKey: normalizeDirectoryText(`${institution.tradeName || ''} ${institution.name} ${institution.legalName} ${institution.city} ${institution.payerCnpj} ${institution.cnes}`),
      }));
      return institutionDirectory;
    })
    .catch((error) => {
      institutionDirectoryPromise = null;
      throw error;
    });
  return institutionDirectoryPromise;
}

function directorySelectionMarkup() {
  if (!draftWorkplace?.cnes) return '<div id="institution-selected"></div>';
  const sourceLabel = draftWorkplace.payerCnpjSource === 'maintainer' ? 'CNPJ da mantenedora' : 'CNPJ do estabelecimento';
  const tradeName = draftWorkplace.directoryTradeName || draftWorkplace.name || 'Instituição selecionada';
  const legalName = draftWorkplace.directoryLegalName || draftWorkplace.payerLegalName || '';
  const alternate = draftWorkplace.establishmentCnpj && draftWorkplace.maintainerCnpj && draftWorkplace.establishmentCnpj !== draftWorkplace.maintainerCnpj
    ? `<small>Mantenedora: ${formatCnpj(draftWorkplace.maintainerCnpj)}</small>`
    : '';
  const updated = institutionDirectoryMeta?.sourceUpdatedAt || draftWorkplace.directoryUpdatedAt || 'base oficial vigente';
  return `<div id="institution-selected" class="directory-selected"><div><span class="directory-badge">CNES ${escapeHtml(draftWorkplace.cnes)}</span><strong>${escapeHtml(tradeName)}</strong>${legalName ? `<small>Razão social: ${escapeHtml(legalName)}</small>` : ''}<small>${escapeHtml(draftWorkplace.directoryTypeName || 'Estabelecimento de saúde')} · ${escapeHtml(sourceLabel)}</small><small>Base CNES atualizada em ${escapeHtml(updated)}</small>${alternate}</div><a href="${CNPJ_CARD_URL}" target="_blank" rel="noopener">Consultar comprovante oficial do CNPJ</a><p>Confirme no contrato ou na Nota Fiscal se este é o CNPJ que efetivamente realiza o repasse. Os campos continuam editáveis.</p></div>`;
}

function renderInstitutionSearchResults(query = '') {
  const resultsRoot = $('#institution-results');
  const statusRoot = $('#institution-directory-status');
  if (!resultsRoot || !statusRoot) return;
  const normalized = normalizeDirectoryText(query);
  const cnpjQuery = cnpjDigits(query);
  if (!normalized && !cnpjQuery) {
    resultsRoot.innerHTML = '';
    statusRoot.textContent = institutionDirectoryMeta
      ? `${institutionDirectoryMeta.total} locais e empresas em ${institutionDirectoryMeta.municipalities} municípios. Fonte: CNES.`
      : 'Digite ao menos duas letras para pesquisar.';
    return;
  }
  if (normalized.length < 2 && cnpjQuery.length < 3) {
    resultsRoot.innerHTML = '';
    statusRoot.textContent = 'Digite ao menos duas letras ou três números do CNPJ.';
    return;
  }
  const tokens = normalized.split(' ').filter(Boolean);
  const matches = institutionDirectory
    .filter((institution) => (cnpjQuery.length >= 3 && institution.payerCnpj.includes(cnpjQuery)) || tokens.every((token) => institution.searchKey.includes(token)))
    .slice(0, 10);
  statusRoot.textContent = matches.length
    ? 'Selecione uma instituição para preencher o cadastro.'
    : 'Nenhum resultado. Você ainda pode preencher os campos manualmente.';
  resultsRoot.innerHTML = matches.map((institution) => `<button class="directory-result" data-action="select-directory-institution" data-id="${escapeHtml(institution.id)}" type="button"><span><strong>${escapeHtml(institution.tradeName || institution.name)}</strong><small>Razão social: ${escapeHtml(institution.legalName)}</small><small>${escapeHtml(institution.typeName)} · ${escapeHtml(institution.city)}</small></span><span><b>${formatCnpj(institution.payerCnpj)}</b><small>CNES ${escapeHtml(institution.cnes)}</small></span></button>`).join('');
}

function selectDirectoryInstitution(institutionId) {
  const institution = institutionDirectory.find((item) => item.id === institutionId);
  if (!institution || !draftWorkplace) return;
  preserveWorkplaceFields();
  Object.assign(draftWorkplace, {
    name: institution.tradeName || institution.name,
    address: institution.address,
    payerCnpj: institution.payerCnpj,
    payerLegalName: institution.legalName,
    directoryId: institution.id,
    directoryCategory: institution.category,
    directoryTypeName: institution.typeName,
    directoryTradeName: institution.tradeName || institution.name,
    directoryLegalName: institution.legalName,
    directoryUpdatedAt: institutionDirectoryMeta?.sourceUpdatedAt || '',
    cnes: institution.cnes,
    payerCnpjSource: institution.payerCnpjSource,
    establishmentCnpj: institution.establishmentCnpj,
    maintainerCnpj: institution.maintainerCnpj,
  });
  $('#work-name').value = draftWorkplace.name;
  $('#work-legal-name').value = draftWorkplace.payerLegalName;
  $('#work-cnpj').value = formatCnpj(draftWorkplace.payerCnpj);
  $('#work-address').value = draftWorkplace.address;
  $('#institution-search').value = '';
  $('#institution-results').innerHTML = '';
  const selectedRoot = $('#institution-selected');
  if (selectedRoot) selectedRoot.outerHTML = directorySelectionMarkup();
  showToast('Dados preenchidos pelo CNES. Confirme o CNPJ pagador antes de salvar.');
}

function normalizeLegalName(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\b(SA|S A|LTDA|EIRELI|ME|EPP)\b/g, '')
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase();
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

function isPast(value) {
  return parseDate(value).getTime() < parseDate(dateOnly()).getTime();
}

function isDueToday(value) {
  return value === dateOnly();
}

function attendanceStatusLabel(attendance) {
  if (attendance.status === 'paid') return 'Recebido';
  if (attendance.status === 'in_reconciliation') return 'Em conciliação';
  if (isPast(attendance.dueAt)) return `Vencido em ${displayDate(attendance.dueAt)}`;
  if (isDueToday(attendance.dueAt)) return 'Vence hoje';
  return `Crédito em ${displayDate(attendance.dueAt)}`;
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
      payerCnpj: '12345678000195',
      payerLegalName: 'Clínica Horizonte Serviços Médicos Ltda.',
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
      payerCnpj: '11222333000181',
      payerLegalName: 'Hospital São Lucas S.A.',
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
      recordId: attendanceId,
      workplaceId: workplace.id,
      modalityId: modality.id,
      modalityName: modality.name,
      occurredAt,
      dueAt: calculateDueDate(occurredAt, modality.rule),
      amountCents: modality.amountCents,
      quantity: 1,
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

function cloudPlanCode() {
  return cloudAccount?.subscription?.planCode || cloudAccount?.profile?.planCode || 'standard';
}

function isDesktopComputer() {
  return window.matchMedia('(min-width: 900px)').matches;
}

function planAllowsDevice() {
  return true;
}

function cloudAccessAllowed() {
  return !isCloudMode() || cloudAccount?.profile?.role === 'admin' || (cloudAccount?.profile?.accessStatus === 'active' && planAllowsDevice());
}

function cloudStatePayload() {
  const payload = { ...appState, account: null, cloudUserId: undefined, demo: false };
  delete payload.profile;
  return payload;
}

function applyCloudDocuments(documents = []) {
  const attendanceDocuments = new Map(documents.filter((item) => item.documentType === 'attendance_evidence').map((item) => [item.recordId, item]));
  const hydratedRecords = new Set();
  appState.attendances = appState.attendances.map((attendance) => {
    const recordId = attendanceRecordId(attendance);
    const document = attendanceDocuments.get(recordId);
    if (hydratedRecords.has(recordId)) return attendance;
    hydratedRecords.add(recordId);
    if (!document) {
      const hasLocalEvidence = String(attendance.evidence || '').startsWith('data:');
      return {
        ...attendance,
        evidenceDocumentId: hasLocalEvidence ? attendance.evidenceDocumentId : '',
        evidenceRemoteUrl: '',
        evidenceSyncStatus: hasLocalEvidence ? 'pending' : '',
        evidenceAvailable: hasLocalEvidence,
      };
    }
    return {
      ...attendance,
      evidenceDocumentId: document.id,
      evidenceRemoteUrl: document.signedUrl,
      evidenceFileName: document.fileName,
      evidenceMimeType: document.mimeType,
      evidenceSyncStatus: 'synced',
      evidenceAvailable: true,
    };
  });
  const invoiceDocuments = new Map(documents.filter((item) => item.documentType === 'invoice').map((item) => [item.recordId, item]));
  appState.invoices = (appState.invoices || []).map((invoice) => {
    const document = invoiceDocuments.get(invoice.id);
    return document ? {
      ...invoice,
      documentId: document.id,
      documentUrl: document.signedUrl,
      documentMimeType: document.mimeType,
      documentSyncStatus: 'synced',
    } : { ...invoice, documentId: '', documentUrl: '', documentSyncStatus: '' };
  });
}

async function refreshCloudDocuments() {
  if (!isCloudMode() || cloudAccount?.profile?.accessStatus !== 'active') return [];
  const result = await cloud.listDocuments();
  const documents = Array.isArray(result.documents) ? result.documents : [];
  applyCloudDocuments(documents);
  localStorage.setItem(activeStateKey, JSON.stringify(appState));
  return documents;
}

async function syncEvidenceForRecord(recordId) {
  if (!isCloudMode()) return null;
  const lines = attendanceRecordLines(recordId);
  const localLine = lines.find((item) => String(item.evidence || '').startsWith('data:'));
  if (!localLine) return null;
  const documentId = localLine.evidenceDocumentId || `evidence-${recordId}`;
  lines.forEach((item) => {
    item.evidenceSyncStatus = 'uploading';
    if (item === localLine) item.evidenceDocumentId = documentId;
  });
  try {
    const result = await cloud.uploadDocument({
      documentId,
      recordId,
      documentType: 'attendance_evidence',
      fileName: localLine.evidenceFileName || 'comprovante.jpg',
      mimeType: localLine.evidenceMimeType || 'image/jpeg',
      dataBase64: localLine.evidence.split(',').pop(),
    });
    const document = result.document;
    lines.forEach((item, index) => {
      item.evidenceSyncStatus = 'synced';
      item.evidenceAvailable = true;
      if (index === 0) {
        item.evidence = '';
        item.evidenceDocumentId = document.id;
        item.evidenceRemoteUrl = document.signedUrl;
        item.evidenceFileName = document.fileName;
        item.evidenceMimeType = document.mimeType;
      }
    });
    saveState();
    return document;
  } catch (error) {
    lines.forEach((item) => (item.evidenceSyncStatus = 'pending'));
    saveState();
    throw error;
  }
}

async function syncPendingEvidence() {
  if (evidenceSyncRunning || !isCloudMode() || cloudAccount?.profile?.accessStatus !== 'active' || !navigator.onLine) return;
  const pending = new Map();
  appState.attendances.forEach((attendance) => {
    const recordId = attendanceRecordId(attendance);
    if (String(attendance.evidence || '').startsWith('data:') && attendance.evidenceSyncStatus !== 'synced') pending.set(recordId, attendance);
  });
  if (!pending.size) return;
  evidenceSyncRunning = true;
  showToast(`${pending.size} ${pending.size === 1 ? 'comprovante será sincronizado' : 'comprovantes serão sincronizados'} em segundo plano.`);
  let failures = 0;
  for (const recordId of pending.keys()) {
    try {
      await syncEvidenceForRecord(recordId);
    } catch {
      failures += 1;
    }
  }
  evidenceSyncRunning = false;
  if (!failures) showToast('Comprovantes disponíveis em todos os seus dispositivos.');
  else showToast(`${failures} ${failures === 1 ? 'comprovante aguarda' : 'comprovantes aguardam'} uma conexão estável.`);
  if (!$('#app-view').hidden) renderRoute();
}

function scheduleCloudSync() {
  if (cloudHydrating || !isCloudMode() || cloudAccount?.profile?.accessStatus !== 'active') return;
  window.clearTimeout(cloudSyncTimer);
  cloudSyncTimer = window.setTimeout(() => {
    cloud.saveState(cloudStatePayload())
      .then(() => {
        cloudStateDirty = false;
        localStorage.removeItem(`${activeStateKey}.dirty`);
      })
      .catch(() => {
        cloudStateDirty = true;
        localStorage.setItem(`${activeStateKey}.dirty`, '1');
      });
  }, 1200);
}

function mergeStateCollections(remoteItems = [], localItems = []) {
  const merged = new Map();
  [...remoteItems, ...localItems].forEach((item) => {
    if (!item?.id) return;
    const previous = merged.get(item.id);
    const previousTime = Date.parse(previous?.updatedAt || previous?.createdAt || 0) || 0;
    const itemTime = Date.parse(item.updatedAt || item.createdAt || 0) || 0;
    if (!previous || itemTime >= previousTime) merged.set(item.id, item);
  });
  return [...merged.values()];
}

function mergeUnsyncedLocalState(remoteState, localState) {
  return {
    ...remoteState,
    workplaces: mergeStateCollections(remoteState.workplaces, localState.workplaces),
    attendances: mergeStateCollections(remoteState.attendances, localState.attendances),
    invoices: mergeStateCollections(remoteState.invoices, localState.invoices),
    feedbacks: mergeStateCollections(remoteState.feedbacks, localState.feedbacks),
    reconciliationMessage: localState.reconciliationMessage || remoteState.reconciliationMessage,
  };
}

async function hydrateCloudState() {
  if (!isCloudMode() || cloudAccount?.profile?.accessStatus !== 'active') return;
  cloudHydrating = true;
  window.clearTimeout(cloudSyncTimer);
  try {
    const result = await cloud.loadState();
    if (result.state) {
      const localState = appState;
      const localEvidence = new Map();
      appState.attendances.forEach((attendance) => {
        if (attendance.evidence) localEvidence.set(attendanceRecordId(attendance), {
          evidence: attendance.evidence,
          evidenceDocumentId: attendance.evidenceDocumentId || '',
          evidenceFileName: attendance.evidenceFileName || 'comprovante.jpg',
          evidenceMimeType: attendance.evidenceMimeType || 'image/jpeg',
          evidenceSyncStatus: attendance.evidenceSyncStatus || 'pending',
        });
      });
      const hydratedEvidence = new Set();
      const needsStateMigration = Number(result.state.schemaVersion || 0) < 3;
      const sourceState = cloudStateDirty ? mergeUnsyncedLocalState(result.state, localState) : result.state;
      appState = normalizeState({
        ...emptyState(),
        ...sourceState,
        profile: appState.profile,
        cloudUserId: cloudAccount.profile.id,
        attendances: (sourceState.attendances || []).map((attendance) => {
          const recordId = attendanceRecordId(attendance);
          const local = !hydratedEvidence.has(recordId) ? localEvidence.get(recordId) : null;
          if (local) hydratedEvidence.add(recordId);
          return { ...attendance, ...(local || {}), evidence: local?.evidence || '' };
        }),
      });
      try {
        await refreshCloudDocuments();
      } catch {
        // O estado financeiro continua disponível mesmo quando os arquivos aguardam reconexão.
      }
      localStorage.setItem(activeStateKey, JSON.stringify(appState));
      if (needsStateMigration || cloudStateDirty) {
        await cloud.saveState(cloudStatePayload());
        cloudStateDirty = false;
        localStorage.removeItem(`${activeStateKey}.dirty`);
      }
    } else {
      await cloud.saveState(cloudStatePayload());
      cloudStateDirty = false;
      localStorage.removeItem(`${activeStateKey}.dirty`);
    }
  } catch {
    showToast('A sincronização com o PC será retomada quando a conexão estiver disponível.');
  } finally {
    cloudHydrating = false;
    void syncPendingEvidence();
  }
}

function returnedFromCheckout() {
  const parameters = new URLSearchParams(window.location.search);
  return parameters.has('preapproval_id') || window.location.search.includes('billing=return');
}

function clearBillingReturnUrl() {
  const cleanUrl = new URL(window.location.href);
  cleanUrl.search = '';
  cleanUrl.hash = '';
  window.history.replaceState({}, document.title, cleanUrl.toString());
}

async function reconcileBillingReturn(initialAccount) {
  let restored = initialAccount;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) {
      $('#billing-status').textContent = 'Pagamento recebido. Confirmando a liberação do seu acesso…';
      await new Promise((resolve) => window.setTimeout(resolve, 1500 * attempt));
      restored = await cloud.restore();
    }
    if (restored) applyCloudAccount(restored);
    if (cloudAccessAllowed()) {
      clearBillingReturnUrl();
      showToast('Pagamento confirmado. Seu acesso está liberado.');
      return true;
    }
  }
  showBilling();
  $('#billing-status').textContent = 'Seu pagamento foi recebido e continua sendo confirmado. Use “Já paguei” para tentar novamente.';
  return false;
}

function applyCloudAccount(result, cpf = '') {
  cloudAccount = result;
  selectedPlanCode = cloudPlanCode();
  document.body.classList.toggle('web-plan', isDesktopComputer());
  activeStateKey = `${APP_KEY}.user.${result.profile.id}`;
  appState = loadState(activeStateKey);
  cloudStateDirty = localStorage.getItem(`${activeStateKey}.dirty`) === '1';
  appState.profile = {
    name: result.profile.fullName,
    email: result.profile.email,
    cpf: `•••.•••.•••-${String(result.profile.cpfLast4 || cpf.slice(-4)).padStart(4, '•')}`,
  };
  appState.cloudUserId = result.profile.id;
  localStorage.setItem(activeStateKey, JSON.stringify(appState));
  activateSession();
  if (!cloudAccessAllowed()) return showBilling();
  const hydrationSequence = ++cloudHydrationSequence;
  showCloudLoading();
  void hydrateCloudState().finally(() => {
    if (hydrationSequence === cloudHydrationSequence && cloudAccessAllowed()) showApp();
  });
}

function showBilling() {
  $('#login-view').hidden = true;
  $('#app-view').hidden = true;
  $('#billing-view').hidden = false;
  closeDrawer();
  const status = cloudAccount?.profile?.accessStatus || 'pending_payment';
  const messages = {
    pending_payment: ['Ative seu acesso para registrar atendimentos e acompanhar seus repasses.', 'Conclua a contratação mensal do plano único.'],
    past_due: ['Não conseguimos confirmar a última mensalidade.', 'Atualize o pagamento para restabelecer o acesso.'],
    canceled: ['Sua assinatura não está ativa.', 'Faça uma nova assinatura para voltar a usar o MedRecebe.'],
    suspended: ['Este acesso foi suspenso pelo administrador.', 'Entre em contato com o suporte antes de tentar um novo pagamento.'],
  };
  const [lead, detail] = messages[status] || messages.pending_payment;
  $('#billing-lead').textContent = lead;
  $('#billing-status').textContent = detail;
  $('#billing-price-value').textContent = 'R$ 39,90';
  $('#billing-plan-name').textContent = 'PLANO ÚNICO';
  $('#billing-subscribe').textContent = 'Continuar';
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
  document.body.classList.toggle('web-plan', isDesktopComputer());
  $('#login-view').hidden = true;
  $('#billing-view').hidden = true;
  $('#app-view').hidden = false;
  $('#drawer-name').textContent = appState.profile?.name || 'Médico';
  $('#drawer-email').textContent = appState.profile?.email || 'Dados neste aparelho';
  $('#drawer-avatar').textContent = (appState.profile?.name || 'M').trim().charAt(0).toUpperCase();
  if (new URLSearchParams(window.location.search).get('action') === 'cancel') currentRoute = 'cancellation';
  navigate(currentRoute);
}

function showCloudLoading() {
  document.body.classList.toggle('web-plan', isDesktopComputer());
  $('#login-view').hidden = true;
  $('#billing-view').hidden = true;
  $('#app-view').hidden = false;
  $('#header-title').textContent = 'MedRecebe';
  screen.innerHTML = '<div class="sync-loading" role="status"><span class="sync-spinner" aria-hidden="true"></span><strong>Sincronizando seus dados</strong><p>Carregando atendimentos e documentos protegidos.</p></div>';
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
  document.body.dataset.route = route;
  closeDrawer();
  $('#header-title').textContent = TITLES[route] || 'MedRecebe';
  const subpage = ['attendance', 'cancellation'].includes(route);
  $('#header-action').textContent = subpage ? '‹' : '☰';
  $('#header-action').setAttribute('aria-label', subpage ? 'Voltar' : 'Abrir menu');
  const activeNavRoute = route === 'attendance' ? 'home' : ['feedback', 'cancellation'].includes(route) ? 'account' : route;
  $$('[data-nav]').forEach((button) => button.classList.toggle('active', button.dataset.nav === activeNavRoute));
  renderRoute();
  screen.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function pageHeading(eyebrow, title, subtitle) {
  return `<header class="page-heading">${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ''}<h1 class="page-title">${escapeHtml(title)}</h1>${subtitle ? `<p class="page-subtitle">${escapeHtml(subtitle)}</p>` : ''}</header>`;
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
    case 'cancellation':
      renderCancellation();
      break;
    default:
      renderHome();
  }
}

function renderHome() {
  const pending = appState.attendances.filter((attendance) => attendance.status !== 'paid');
  const total = pending.reduce((sum, attendance) => sum + attendance.amountCents, 0);
  const active = appState.workplaces.filter((workplace) => workplace.active);
  const lastWorkplaceId = [...appState.attendances].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]?.workplaceId || '';
  const orderedWorkplaces = [...active].sort((a, b) => Number(b.id === lastWorkplaceId) - Number(a.id === lastWorkplaceId));
  const cards = orderedWorkplaces.length
    ? orderedWorkplaces
        .map((workplace) => {
          const modalities = workplace.modalities.filter((modality) => modality.active);
          return `<button class="card location-card" data-action="open-attendance" data-id="${workplace.id}" type="button" ${modalities.length ? '' : 'disabled'}>
            <span class="round-icon">＋</span><span class="location-copy"><strong>${escapeHtml(workplace.name)}</strong><small>${escapeHtml(workplace.address || 'Endereço não informado')}</small><em>${workplace.id === lastWorkplaceId ? 'Usado por último' : `${modalities.length} ${modalities.length === 1 ? 'modalidade' : 'modalidades'}`}</em></span><span class="chevron">›</span>
          </button>`;
        })
        .join('')
    : emptyCard('Nenhum local cadastrado', 'Cadastre seu primeiro pagador para começar.', '<button class="button primary small" data-action="new-workplace" type="button">Cadastrar local</button>');

  screen.innerHTML = `<div class="screen-stack">
    ${pageHeading('', 'Registrar atendimento', '')}
    <div class="overview-grid"><div class="card summary-card"><span class="summary-main"><small>A RECEBER</small><strong>${currency(total)}</strong><span class="desktop-summary-note">Atendimentos ainda não recebidos</span></span><span class="summary-count"><strong>${attendanceCount(pending)}</strong><small>atendimentos</small></span></div><div class="card desktop-stat"><span class="round-icon">⌂</span><div><small>LOCAIS</small><strong>${active.length}</strong></div></div><button class="card desktop-action" data-action="new-workplace" type="button"><span>＋</span><div><small>ATALHO</small><strong>Novo local</strong></div></button></div>
    <div class="section-heading compact"><h2 class="section-title">Local do atendimento</h2><button class="link-button" data-action="new-workplace" type="button">Novo local</button></div><div class="location-list">${cards}</div>
    ${appState.demo ? '<div class="notice warning demo-notice">Demonstração com dados fictícios.</div>' : ''}
  </div>`;
}

function dashboardAttendanceDetails(attendances, { showWorkplace = false } = {}) {
  if (!attendances.length) return '<p class="dashboard-detail-empty">Nenhum atendimento neste grupo.</p>';
  return `<div class="dashboard-detail-list">${[...attendances]
    .sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)))
    .map((attendance) => {
      const workplace = appState.workplaces.find((item) => item.id === attendance.workplaceId);
      const context = [
        showWorkplace ? workplace?.name : '',
        `Realizado em ${displayDate(attendance.occurredAt)}`,
        attendanceStatusLabel(attendance),
        attendance.patientReference || '',
      ].filter(Boolean).join(' • ');
      return `<div class="dashboard-detail-row"><span><strong>${attendanceQuantity(attendance)} × ${escapeHtml(attendance.modalityName)}</strong><small>${escapeHtml(context)}</small>${attendance.evidenceRemoteUrl ? `<a href="${escapeHtml(attendance.evidenceRemoteUrl)}" target="_blank" rel="noopener">Abrir comprovante</a>` : ''}</span><b>${currency(attendance.amountCents)}</b></div>`;
    })
    .join('')}</div>`;
}

function renderDashboard() {
  const receivables = appState.attendances.filter((attendance) => attendance.status !== 'paid');
  const pending = receivables.filter((attendance) => attendance.status === 'pending');
  const overdue = pending.filter((attendance) => isPast(attendance.dueAt));
  const dueToday = pending.filter((attendance) => isDueToday(attendance.dueAt));
  const upcoming = pending.filter((attendance) => !isPast(attendance.dueAt) && !isDueToday(attendance.dueAt));
  const inReconciliation = receivables.filter((attendance) => attendance.status === 'in_reconciliation');
  const total = receivables.reduce((sum, attendance) => sum + attendance.amountCents, 0);
  const statusBreakdown = [
    ['A vencer', upcoming],
    ['Vence hoje', dueToday],
    ['Vencidos', overdue],
    ['Em conciliação', inReconciliation],
  ].map(([label, items]) => `<div class="dashboard-status-row"><span><strong>${label}</strong><small>${attendanceCount(items)} ${attendanceCount(items) === 1 ? 'atendimento' : 'atendimentos'}</small></span><b>${currency(items.reduce((sum, item) => sum + item.amountCents, 0))}</b></div>`).join('');
  const workplaceCards = appState.workplaces
    .map((workplace) => {
      const items = receivables.filter((attendance) => attendance.workplaceId === workplace.id);
      const nextDue = [...items].sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0]?.dueAt;
      const workplaceTotal = items.reduce((sum, attendance) => sum + attendance.amountCents, 0);
      const quantity = attendanceCount(items);
      const overdueCount = attendanceCount(items.filter((attendance) => attendance.status === 'pending' && isPast(attendance.dueAt)));
      return `<details class="card workplace-summary dashboard-expandable"><summary><div class="card-head"><span class="round-icon">⌂</span><div><h3>${escapeHtml(workplace.name)}</h3><p>${quantity} ${quantity === 1 ? 'atendimento' : 'atendimentos'} • Toque para detalhar</p></div>${overdueCount ? `<span class="badge overdue">${overdueCount} venc.</span>` : ''}</div><div class="value-row"><span><small>A RECEBER</small><strong>${currency(workplaceTotal)}</strong></span><span><small>MAIS PRÓXIMO</small><b>${nextDue ? displayDate(nextDue) : '—'}</b></span></div></summary><div class="dashboard-expanded-content"><h4>Atendimentos em aberto</h4>${dashboardAttendanceDetails(items)}<button class="button secondary small" data-action="open-attendance" data-id="${workplace.id}" type="button">Registrar neste local</button></div></details>`;
    })
    .join('');
  const dueGroups = groupDueDates(pending);
  const dueCards = dueGroups
    .map((group) => {
      const items = pending.filter((attendance) => group.ids.includes(attendance.id));
      return `<details class="card dashboard-expandable due-expandable"><summary class="location-card"><span class="location-copy"><strong>${escapeHtml(group.workplaceName)}</strong><small>${isDueToday(group.dueAt) ? 'Vence hoje' : `Vencido em ${displayDate(group.dueAt)}`} • ${group.quantity} atend. • Toque para detalhar</small><em>${currency(group.totalCents)}</em></span></summary><div class="dashboard-expanded-content">${dashboardAttendanceDetails(items)}<button class="button secondary small" data-action="mark-paid" data-ids="${group.ids.join(',')}" type="button">Marcar grupo como recebido</button></div></details>`;
    })
    .join('');

  screen.innerHTML = `<div class="screen-stack">
    ${pageHeading('', 'Dashboard', '')}
    <div class="dashboard-overview"><details class="card summary-card dashboard-expandable dashboard-total-card"><summary><div><span class="summary-main"><small>TOTAL A RECEBER</small><strong>${currency(total)}</strong><span class="desktop-summary-note">Toque para ver a composição</span></span><div class="metrics"><span class="metric"><strong>${attendanceCount(pending)}</strong><small>EM ABERTO</small></span><span class="metric"><strong>${attendanceCount(dueToday)}</strong><small>VENCE HOJE</small></span><span class="metric overdue"><strong>${attendanceCount(overdue)}</strong><small>VENCIDOS</small></span><span class="metric"><strong>${attendanceCount(inReconciliation)}</strong><small>EM CONCILIAÇÃO</small></span></div></div></summary><div class="dashboard-expanded-content dashboard-status-list">${statusBreakdown}</div></details><details class="card dashboard-insight dashboard-expandable"><summary><span class="round-icon">⇄</span><small>VENCIDOS</small><strong>${currency(overdue.reduce((sum, item) => sum + item.amountCents, 0))}</strong><span class="dashboard-tap-hint">Ver detalhes</span></summary><div class="dashboard-expanded-content">${dashboardAttendanceDetails(overdue, { showWorkplace: true })}<button class="button secondary small" data-nav="reconciliation" type="button">Abrir conciliação</button></div></details></div>
    <div class="dashboard-columns">${dueCards ? `<section class="attention-panel"><h2 class="section-title">Requer sua atenção</h2><div class="list due-list">${dueCards}</div></section>` : ''}<section class="locations-panel"><h2 class="section-title">Por local</h2><div class="list">${workplaceCards || emptyCard('Ainda não há dados', 'Cadastre um local para começar.')}</div></section></div>
  </div>`;
}

function groupDueDates(receivables) {
  const groups = new Map();
  receivables.filter((attendance) => attendance.status === 'pending' && (isPast(attendance.dueAt) || isDueToday(attendance.dueAt))).forEach((attendance) => {
    const workplace = appState.workplaces.find((item) => item.id === attendance.workplaceId);
    const key = `${attendance.workplaceId}:${attendance.dueAt}`;
    const group = groups.get(key) || { id: key, workplaceName: workplace?.name || 'Local não disponível', dueAt: attendance.dueAt, totalCents: 0, quantity: 0, ids: [] };
    group.totalCents += attendance.amountCents;
    group.quantity += attendanceQuantity(attendance);
    group.ids.push(attendance.id);
    groups.set(key, group);
  });
  return [...groups.values()].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

function renderWorkplaces() {
  const cards = appState.workplaces
    .map((workplace) => {
      const modes = workplace.modalities.slice(0, 3).map((modality) => `<div class="modality-line"><span><strong>${escapeHtml(modality.name)}</strong><small>${escapeHtml(describeRule(modality.rule))}</small></span><b>${currency(modality.amountCents)}</b></div>`).join('');
      const remaining = Math.max(0, workplace.modalities.length - 3);
      return `<article class="card workplace-summary"><div class="card-head"><span class="round-icon">⌂</span><div><h3>${escapeHtml(workplace.name)}</h3><p>${escapeHtml(workplace.payerLegalName || 'Razão Social não informada')}<br/>${workplace.payerCnpj ? `CNPJ ${formatCnpj(workplace.payerCnpj)}` : 'CNPJ não informado'}<br/>${escapeHtml(workplace.address || 'Endereço não informado')}</p></div><span class="badge ${workplace.active ? '' : 'inactive'}">${workplace.active ? 'Ativo' : 'Inativo'}</span></div><div class="modality-lines">${modes || '<p class="muted">Nenhuma modalidade cadastrada.</p>'}${remaining ? `<p class="field-hint">+ ${remaining} ${remaining === 1 ? 'modalidade cadastrada' : 'modalidades cadastradas'}</p>` : ''}</div><div class="row-actions"><button class="danger-link" data-action="toggle-workplace" data-id="${workplace.id}" type="button">${workplace.active ? 'Desativar' : 'Reativar'}</button><button class="button secondary small" data-action="edit-workplace" data-id="${workplace.id}" type="button">Editar cadastro</button></div></article>`;
    })
    .join('');
  screen.innerHTML = `<div class="screen-stack">${pageHeading('', 'Locais e repasses', '')}<button class="button primary" data-action="new-workplace" type="button">Adicionar local</button><div class="list">${cards || emptyCard('Comece pelo primeiro local', 'Cadastre o pagador e suas modalidades.')}</div></div>`;
}

function renderAttendance() {
  const workplace = appState.workplaces.find((item) => item.id === selectedWorkplaceId);
  if (!workplace) return navigate('home');
  if (!attendanceDraft) attendanceDraft = newAttendanceDraft(workplace);
  if (!attendanceDraft.items) {
    const legacyItem = attendanceDraft.modalityId ? {
      quantity: 1,
      patientReference: attendanceDraft.patientReference || '',
      medication: attendanceDraft.medication || '',
      includeConsultation: Boolean(attendanceDraft.includeConsultation),
      consultationModalityId: attendanceDraft.consultationModalityId || '',
    } : null;
    attendanceDraft.items = legacyItem ? { [attendanceDraft.modalityId]: legacyItem } : {};
  }
  const availableModalities = workplace.modalities.filter((item) => item.active || Number(attendanceDraft.items[item.id]?.quantity) > 0);
  const choices = availableModalities.map((item) => {
    const quantity = Math.max(0, Number(attendanceDraft.items[item.id]?.quantity) || 0);
    return `<article class="choice modality-quantity-choice ${quantity ? 'selected' : ''}"><label class="modality-check"><input type="checkbox" name="modality" value="${item.id}" ${quantity ? 'checked' : ''}/><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(modalityTypeLabel(item))}</small></span></label><b>${currency(item.amountCents)}</b><details class="modality-rule"><summary>Ver prazo</summary><p>${escapeHtml(describeRule(item.rule))}</p></details>${quantity ? `<div class="quantity-row"><span>Qtd.</span><div class="quantity-stepper"><button data-action="decrease-attendance-quantity" data-id="${item.id}" type="button" aria-label="Diminuir quantidade de ${escapeHtml(item.name)}">−</button><input class="attendance-quantity-input" data-modality-id="${item.id}" type="number" inputmode="numeric" min="1" max="999" value="${quantity}" aria-label="Quantidade de ${escapeHtml(item.name)}"/><button data-action="increase-attendance-quantity" data-id="${item.id}" type="button" aria-label="Aumentar quantidade de ${escapeHtml(item.name)}">+</button></div><strong>${currency(item.amountCents * quantity)}</strong></div>` : ''}</article>`;
  }).join('');
  const selectedItems = selectedAttendanceItems(workplace);
  const itemSummaries = selectedItems.map(({ modality, draft }) => {
    const quantity = attendanceQuantity(draft);
    const consultationOptions = workplace.modalities.filter((item) => item.active && item.id !== modality.id && item.type !== 'recurring');
    let consultation = draft.includeConsultation ? consultationOptions.find((item) => item.id === draft.consultationModalityId) : null;
    if (draft.includeConsultation && !consultation) {
      consultation = preferredConsultationModality(consultationOptions);
      draft.consultationModalityId = consultation?.id || '';
    }
    const unitCents = modality.amountCents + (consultation?.amountCents || 0);
    return {
      modality,
      draft,
      consultation,
      quantity,
      unitCents,
      amountCents: unitCents * quantity,
      dueAt: calculateDueDate(attendanceDraft.occurredAt, modality.rule),
      consultationDueAt: consultation ? calculateDueDate(attendanceDraft.occurredAt, consultation.rule) : '',
    };
  });
  const totalCents = itemSummaries.reduce((sum, item) => sum + item.amountCents, 0);
  const totalQuantity = itemSummaries.reduce((sum, item) => sum + item.quantity * (item.consultation ? 2 : 1), 0);
  const dueDates = [...new Set(itemSummaries.flatMap((item) => [item.dueAt, item.consultationDueAt]).filter(Boolean))];
  const evidenceStatus = attendanceDraft.evidenceSyncStatus === 'synced'
    ? '<small class="evidence-status synced">✓ Disponível em todos os dispositivos</small>'
    : attendanceDraft.evidenceSyncStatus === 'uploading'
      ? '<small class="evidence-status">Sincronizando comprovante…</small>'
      : attendanceDraft.evidence
        ? '<small class="evidence-status pending">Aguardando sincronização</small>'
        : '';
  const photo = attendanceDraft.evidence
    ? `<img class="photo-preview" src="${escapeHtml(attendanceDraft.evidence)}" alt="Prévia do comprovante"/>${evidenceStatus}<div class="photo-source-actions"><label class="button secondary small file-button">Tirar outra foto<input class="evidence-input" type="file" accept="image/*" capture="environment"/></label><label class="button secondary small file-button">Galeria<input class="evidence-input" type="file" accept="image/*"/></label><button class="danger-link" data-action="remove-photo" type="button">Remover</button></div>`
    : `<strong>Adicionar comprovante</strong><p>Uma foto pode incluir vários atendimentos.</p><div class="photo-source-actions"><label class="button primary small file-button">Tirar foto<input class="evidence-input" type="file" accept="image/*" capture="environment"/></label><label class="button secondary small file-button">Galeria<input class="evidence-input" type="file" accept="image/*"/></label></div>`;
  const recurringFields = itemSummaries.filter(({ modality }) => modality.type === 'recurring').map(({ modality, draft }) => {
    const consultationOptions = workplace.modalities.filter((item) => item.active && item.id !== modality.id && item.type !== 'recurring');
    if (draft.includeConsultation && !consultationOptions.some((item) => item.id === draft.consultationModalityId)) draft.consultationModalityId = preferredConsultationModality(consultationOptions)?.id || '';
    return `<div class="card recurring-fields"><h2 class="section-title">Receita recorrente • ${escapeHtml(modality.name)}</h2><label>Identificação do paciente<input data-recurring-patient="${modality.id}" value="${escapeHtml(draft.patientReference || '')}" placeholder="Use iniciais ou um código interno" required/></label><label>Medicamento ou tratamento<input data-recurring-medication="${modality.id}" value="${escapeHtml(draft.medication || '')}" placeholder="Ex.: imunobiológico ou medicamento oncológico" required/></label><label class="toggle-choice"><input class="recurring-consultation" data-modality-id="${modality.id}" type="checkbox" ${draft.includeConsultation ? 'checked' : ''} ${consultationOptions.length ? '' : 'disabled'}/><span><strong>Contabilizar também uma consulta por atendimento</strong><small>${consultationOptions.length ? 'A consulta terá valor, quantidade e prazo próprios no Dashboard.' : 'Cadastre uma modalidade de consulta neste local para usar esta opção.'}</small></span></label>${draft.includeConsultation && consultationOptions.length ? `<label>Modalidade da consulta<select class="recurring-consultation-modality" data-modality-id="${modality.id}"><option value="">Selecione a consulta</option>${consultationOptions.map((item) => `<option value="${item.id}" ${item.id === draft.consultationModalityId ? 'selected' : ''}>${escapeHtml(item.name)} • ${currency(item.amountCents)}</option>`).join('')}</select></label>` : ''}</div>`;
  }).join('');
  const recordGroups = new Map();
  appState.attendances.filter((item) => item.workplaceId === workplace.id).forEach((item) => {
    const recordId = attendanceRecordId(item);
    const group = recordGroups.get(recordId) || [];
    group.push(item);
    recordGroups.set(recordId, group);
  });
  const allRecorded = [...recordGroups.entries()].sort(([, a], [, b]) => String(b[0]?.createdAt).localeCompare(String(a[0]?.createdAt)));
  const visibleRecords = attendanceHistoryExpanded ? allRecorded.slice(0, 50) : allRecorded.slice(0, 3);
  const recorded = visibleRecords.map(([recordId, lines]) => {
    const first = lines[0];
    const document = attendanceRecordDocument(lines);
    const recordTotal = lines.reduce((sum, item) => sum + item.amountCents, 0);
    const recordQuantity = attendanceCount(lines);
    const lineRows = lines.map((item) => `<div class="attendance-record-line"><span><strong>${attendanceQuantity(item)} × ${escapeHtml(item.modalityName)}</strong>${item.patientReference ? `<small>${escapeHtml(item.patientReference)} • ${escapeHtml(item.medication || '')}</small>` : ''}</span><span><b>${currency(item.amountCents)}</b><small>${escapeHtml(attendanceStatusLabel(item))}</small></span></div>`).join('');
    return `<details class="card attendance-record"><summary><span><strong>${displayDate(first.occurredAt)}</strong><small>${recordQuantity} ${recordQuantity === 1 ? 'atendimento' : 'atendimentos'}</small></span><span><b>${currency(recordTotal)}</b><small>Ver detalhes</small></span></summary><div class="attendance-record-body">${first.notes ? `<p>${escapeHtml(first.notes)}</p>` : ''}<div class="attendance-record-lines">${lineRows}</div>${document.remoteUrl ? `<a class="button secondary small" href="${escapeHtml(document.remoteUrl)}" target="_blank" rel="noopener">Abrir comprovante sincronizado</a>` : document.syncStatus === 'pending' ? '<p class="field-hint">O comprovante será enviado quando houver conexão.</p>' : ''}<div class="row-actions"><button class="button secondary small" data-action="edit-attendance" data-id="${recordId}" type="button">Editar</button><button class="danger-link" data-action="delete-attendance" data-id="${recordId}" type="button">Excluir</button></div></div></details>`;
  }).join('');
  const summaryLines = itemSummaries.flatMap((item) => {
    const base = `<div class="attendance-summary-line"><span>${item.quantity} × ${escapeHtml(item.modality.name)}</span><span>${currency(item.modality.amountCents * item.quantity)} • ${displayDate(item.dueAt)}</span></div>`;
    if (!item.consultation) return [base];
    return [base, `<div class="attendance-summary-line"><span>${item.quantity} × ${escapeHtml(item.consultation.name)} <small>(associada)</small></span><span>${currency(item.consultation.amountCents * item.quantity)} • ${displayDate(item.consultationDueAt)}</span></div>`];
  }).join('');
  const historyToggle = allRecorded.length > 3 ? `<button class="link-button attendance-history-toggle" data-action="toggle-attendance-history" type="button">${attendanceHistoryExpanded ? 'Mostrar menos' : `Ver todos (${allRecorded.length})`}</button>` : '';
  screen.innerHTML = `<div class="screen-stack"><form class="screen-stack" id="attendance-form">${pageHeading('', workplace.name, editingAttendanceId ? 'Editando registro' : '')}<label>Data<input id="attendance-date" type="date" value="${attendanceDraft.occurredAt}" required/></label><h2 class="section-title">Comprovante</h2><div class="attendance-photo">${photo}</div><div class="section-heading compact"><h2 class="section-title">Modalidade de repasse</h2>${totalQuantity ? `<span class="badge">${totalQuantity} atend.</span>` : ''}</div><div class="choice-list">${choices}</div>${recurringFields}<label>Observação (opcional)<textarea id="attendance-notes" placeholder="Adicionar observação">${escapeHtml(attendanceDraft.notes)}</textarea></label><div class="attendance-checkout">${itemSummaries.length ? `<div class="card attendance-total-card"><div class="attendance-total-head"><span><small>TOTAL</small><strong>${currency(totalCents)}</strong><em>${totalQuantity} ${totalQuantity === 1 ? 'atendimento' : 'atendimentos'}</em></span><span><small>PREVISÃO</small><strong>${dueDates.length === 1 ? displayDate(dueDates[0]) : `${dueDates.length} datas`}</strong></span></div><details class="attendance-breakdown"><summary>Ver composição</summary><div class="attendance-summary-lines">${summaryLines}</div></details></div>` : ''}<div class="attendance-actions"><button class="button primary" type="submit">${editingAttendanceId ? 'Salvar correção' : 'Salvar'}</button><button class="text-button" data-action="cancel-attendance" type="button">Cancelar</button></div></div></form><section class="attendance-history-section"><div class="section-heading compact"><h2 class="section-title">Atendimentos</h2><span class="badge">${allRecorded.length}</span></div><div class="list">${recorded || emptyCard('Nenhum atendimento', 'Seus registros aparecerão aqui.')}</div>${historyToggle}</section></div>`;
}

function legalNameMatches(registeredName, extractedNames = []) {
  const registered = normalizeLegalName(registeredName);
  return Boolean(registered) && extractedNames.some((name) => {
    const extracted = normalizeLegalName(name);
    return extracted.length >= 6 && (extracted.includes(registered) || registered.includes(extracted));
  });
}

function recordInvoiceAnalysis(analysis, invoiceId = id('invoice'), document = null) {
  const extractedCnpjs = Array.isArray(analysis.cnpjs) ? analysis.cnpjs.map(cnpjDigits) : [];
  const matchedPayerIds = Array.isArray(analysis.matchedPayerIds) ? analysis.matchedPayerIds : [];
  const workplace = appState.workplaces.find((item) => matchedPayerIds.includes(item.id))
    || appState.workplaces.find((item) => extractedCnpjs.includes(cnpjDigits(item.payerCnpj)) && legalNameMatches(item.payerLegalName, analysis.legalNames));
  const groups = workplace ? reconciliationGroups().filter((group) => group.workplace.id === workplace.id) : [];
  const amountCents = Number.isFinite(Number(analysis.amountCents)) ? Number(analysis.amountCents) : null;
  const group = amountCents === null
    ? groups[0]
    : groups.sort((a, b) => Math.abs(a.totalCents - amountCents) - Math.abs(b.totalCents - amountCents))[0];
  const differenceCents = group && amountCents !== null ? amountCents - group.totalCents : null;
  const status = !workplace ? 'payer_not_matched' : !group ? 'group_not_found' : differenceCents === 0 ? 'matched' : 'divergent';
  const record = {
    id: invoiceId,
    fileName: String(analysis.fileName || 'Nota Fiscal'),
    invoiceNumber: String(analysis.invoiceNumber || ''),
    issuedAt: String(analysis.issuedAt || ''),
    amountCents,
    cnpjs: extractedCnpjs,
    legalNames: Array.isArray(analysis.legalNames) ? analysis.legalNames.slice(0, 6) : [],
    suggestedPayerCnpj: cnpjDigits(analysis.suggestedPayerCnpj || extractedCnpjs[0] || ''),
    suggestedPayerLegalName: String(analysis.suggestedPayerLegalName || analysis.legalNames?.[0] || ''),
    workplaceId: workplace?.id || '',
    workplaceName: workplace?.name || '',
    groupId: group?.id || '',
    expectedCents: group?.totalCents ?? null,
    differenceCents,
    status,
    analyzedAt: new Date().toISOString(),
    documentId: document?.id || '',
    documentUrl: document?.signedUrl || '',
    documentMimeType: document?.mimeType || '',
    documentSyncStatus: document ? 'synced' : '',
  };
  appState.invoices = [record, ...(appState.invoices || [])].slice(0, 30);
  selectedInvoiceId = record.id;
  if (group) selectedReconciliationGroup = group.id;
  saveState();
  return record;
}

function reconcileStoredInvoice(invoice, preferredWorkplace = null) {
  if (!invoice) return null;
  const extractedCnpjs = Array.isArray(invoice.cnpjs) ? invoice.cnpjs.map(cnpjDigits) : [];
  const workplace = preferredWorkplace
    || appState.workplaces.find((item) => extractedCnpjs.includes(cnpjDigits(item.payerCnpj)) && legalNameMatches(item.payerLegalName, invoice.legalNames));
  const groups = workplace ? reconciliationGroups().filter((group) => group.workplace.id === workplace.id) : [];
  const amountCents = Number.isFinite(Number(invoice.amountCents)) ? Number(invoice.amountCents) : null;
  const group = amountCents === null
    ? groups[0]
    : [...groups].sort((a, b) => Math.abs(a.totalCents - amountCents) - Math.abs(b.totalCents - amountCents))[0];
  const differenceCents = group && amountCents !== null ? amountCents - group.totalCents : null;
  Object.assign(invoice, {
    workplaceId: workplace?.id || '',
    workplaceName: workplace?.name || '',
    groupId: group?.id || '',
    expectedCents: group?.totalCents ?? null,
    differenceCents,
    status: !workplace ? 'payer_not_matched' : !group ? 'group_not_found' : differenceCents === 0 ? 'matched' : 'divergent',
    analyzedAt: new Date().toISOString(),
  });
  selectedInvoiceId = invoice.id;
  if (workplace) selectedChannelWorkplace = workplace.id;
  if (group) selectedReconciliationGroup = group.id;
  return invoice;
}

function invoiceCard(invoice) {
  if (!invoice) return '';
  const status = {
    matched: ['success', 'Valores coincidem', 'A Nota Fiscal corresponde ao total contabilizado do grupo selecionado.'],
    divergent: ['warning', 'Divergência encontrada', `A Nota Fiscal difere ${currency(Math.abs(invoice.differenceCents || 0))} do total contabilizado.`],
    group_not_found: ['warning', 'Pagador identificado', 'O local foi encontrado, mas não há grupo vencido para comparar.'],
    payer_not_matched: ['warning', 'Pagador não identificado', 'Confira se o CNPJ e a Razão Social do pagador estão iguais ao documento.'],
  }[invoice.status] || ['warning', 'Conferência pendente', 'Revise os dados extraídos.'];
  const unmatchedAction = invoice.status === 'payer_not_matched'
    ? '<button class="button primary small" data-action="create-workplace-from-invoice" data-id="' + invoice.id + '" type="button">Cadastrar local pela Nota Fiscal</button>'
    : '';
  return `<article class="card workplace-summary invoice-result-card"><div class="card-head"><span class="round-icon">NF</span><div><h3>${escapeHtml(status[1])}</h3><p>${escapeHtml(invoice.fileName)}${invoice.invoiceNumber ? ` • Nota ${escapeHtml(invoice.invoiceNumber)}` : ''}${invoice.workplaceName ? `<br/>${escapeHtml(invoice.workplaceName)}` : ''}</p></div><div class="invoice-card-actions"><span class="badge ${status[0] === 'success' ? '' : 'inactive'}">${status[0] === 'success' ? 'CONCILIADO' : 'REVISAR'}</span><button class="invoice-delete" data-action="delete-invoice" data-id="${invoice.id}" type="button" aria-label="Apagar Nota Fiscal anexada" title="Apagar anexo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 14h10l1-14M10 11v6m4-6v6"/></svg></button></div></div><div class="value-row"><span><small>VALOR DA NOTA</small><strong>${invoice.amountCents === null ? 'Não identificado' : currency(invoice.amountCents)}</strong></span><span><small>CONTABILIZADO</small><b>${invoice.expectedCents === null ? '—' : currency(invoice.expectedCents)}</b></span></div><p class="field-hint">${escapeHtml(status[2])}</p>${unmatchedAction}${invoice.documentUrl ? `<a class="button secondary small" href="${escapeHtml(invoice.documentUrl)}" target="_blank" rel="noopener">Abrir Nota Fiscal</a>` : ''}</article>`;
}

function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',').pop() || '');
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

async function analyzeInvoiceFile(file) {
  const name = String(file?.name || 'nota-fiscal');
  const extension = name.split('.').pop()?.toLowerCase();
  if (!['pdf', 'xml'].includes(extension) && !['application/pdf', 'text/xml', 'application/xml'].includes(file.type)) {
    throw new Error('Escolha uma Nota Fiscal em PDF ou XML.');
  }
  if (file.size > 5 * 1024 * 1024) throw new Error('Escolha um arquivo de até 5 MB.');
  if (!isCloudMode()) throw new Error('A leitura automática requer uma conta MedRecebe conectada.');
  const invoiceId = id('invoice');
  const documentId = `document-${invoiceId}`;
  const mimeType = file.type || (extension === 'xml' ? 'application/xml' : 'application/pdf');
  const dataBase64 = await fileAsBase64(file);
  const analysis = await cloud.analyzeInvoice({
    fileName: name,
    mimeType,
    dataBase64,
    payers: appState.workplaces.map((workplace) => ({ id: workplace.id, cnpj: cnpjDigits(workplace.payerCnpj), legalName: workplace.payerLegalName })),
  });
  if (analysis.isInvoice !== true) throw new Error('O arquivo não foi reconhecido como uma Nota Fiscal válida.');
  const uploaded = await cloud.uploadDocument({ documentId, recordId: invoiceId, documentType: 'invoice', fileName: name, mimeType, dataBase64 });
  return recordInvoiceAnalysis(analysis, invoiceId, uploaded.document);
}

function renderReconciliation() {
  const groups = reconciliationGroups();
  if (!selectedReconciliationGroup || !groups.some((group) => group.id === selectedReconciliationGroup)) selectedReconciliationGroup = groups[0]?.id || '';
  const selected = groups.find((group) => group.id === selectedReconciliationGroup);
  if (selected && (!selectedChannelWorkplace || selectedChannelWorkplace !== selected.workplace.id)) selectedChannelWorkplace = selected.workplace.id;
  if (!selectedChannelWorkplace) selectedChannelWorkplace = appState.workplaces[0]?.id || '';
  const channel = appState.workplaces.find((item) => item.id === selectedChannelWorkplace);
  const options = appState.workplaces.map((workplace) => `<option value="${workplace.id}" ${workplace.id === selectedChannelWorkplace ? 'selected' : ''}>${escapeHtml(workplace.name)}</option>`).join('');
  const groupCards = groups.map((group) => `<button class="card group-card ${group.id === selectedReconciliationGroup ? 'selected' : ''}" data-action="select-reconciliation" data-id="${group.id}" type="button"><span class="group-check">${group.id === selectedReconciliationGroup ? '✓' : ''}</span><span><h3>${escapeHtml(group.workplace.name)}</h3><p>${monthLabel(group.month)}</p><small>${group.quantity} atend. • ${group.attachments} comprov. ${group.status === 'in_reconciliation' ? '• Em conciliação' : ''}</small></span><b>${currency(group.totalCents)}</b></button>`).join('');
  const latestInvoice = (appState.invoices || []).find((invoice) => invoice.id === selectedInvoiceId) || appState.invoices?.[0];
  const documentLinks = selected ? [...selected.documents.values()].map((document, index) => document.remoteUrl ? `<a class="button secondary small" href="${escapeHtml(document.remoteUrl)}" target="_blank" rel="noopener">Abrir comprovante ${index + 1}</a>` : '').join('') : '';
  screen.innerHTML = `<div class="screen-stack">${pageHeading('Conferência de pagamentos', 'Conciliação', 'Envie uma Nota Fiscal para identificar o pagador e comparar automaticamente os valores.')}<h2 class="section-title">Conferir Nota Fiscal</h2><div class="card settings"><label class="button primary file-button">Selecionar Nota Fiscal<input id="invoice-file" type="file" accept="application/pdf,application/xml,text/xml,.pdf,.xml"/></label></div>${invoiceCard(latestInvoice)}<h2 class="section-title">Canal oficial</h2>${channel ? `<form class="card settings" id="channel-form"><label>Local<select id="channel-workplace">${options}</select></label><label>E-mail oficial<input id="channel-email" type="email" value="${escapeHtml(channel.reconciliationEmail)}" placeholder="repasses@local.com.br"/></label><label>Cópia (opcional)<input id="channel-cc" value="${escapeHtml(channel.reconciliationCc || '')}" placeholder="gestor@local.com.br"/></label><label>Mensagem padrão<textarea id="channel-message">${escapeHtml(appState.reconciliationMessage)}</textarea></label><p class="field-hint">Tokens: {{local}}, {{periodo}}, {{quantidade}}, {{valor}}, {{detalhes}} e {{medico}}.</p><button class="button secondary small" type="submit">Salvar canal e mensagem</button></form>` : '<div class="notice warning">Cadastre um local antes de configurar a conciliação.</div>'}<h2 class="section-title">Grupos para conciliar</h2><div class="list">${groupCards || emptyCard('Nenhum repasse vencido', 'O vencimento de hoje só aparecerá aqui a partir de amanhã, se não houver baixa.')}</div>${selected ? `<div class="card summary-card"><span class="summary-main"><small>${selected.status === 'in_reconciliation' ? 'EM CONCILIAÇÃO' : 'SELECIONADO'}</small><strong>${currency(selected.totalCents)}</strong><small>${selected.quantity} atendimentos • ${monthLabel(selected.month)}</small></span></div>${documentLinks ? `<div class="document-actions">${documentLinks}</div>` : '<div class="notice warning">Este grupo ainda não possui comprovante sincronizado.</div>'}<div class="reconciliation-send-actions"><button class="button primary" data-action="share-reconciliation" type="button">Enviar conciliação</button><button class="button secondary reconciliation-export" data-action="export-reconciliation-pdf" type="button">Exportar PDF</button></div>` : ''}</div>`;
}

function reconciliationGroups() {
  const map = new Map();
  appState.attendances.filter((attendance) => ['pending', 'in_reconciliation'].includes(attendance.status) && isPast(attendance.dueAt)).forEach((attendance) => {
    const workplace = appState.workplaces.find((item) => item.id === attendance.workplaceId);
    if (!workplace) return;
    const month = attendance.dueAt.slice(0, 7);
    const key = `${workplace.id}:${month}`;
    const group = map.get(key) || { id: key, workplace, month, attendances: [], totalCents: 0, quantity: 0, evidenceRecordIds: new Set(), documents: new Map(), attachments: 0, status: 'pending' };
    group.attendances.push(attendance);
    group.totalCents += attendance.amountCents;
    group.quantity += attendanceQuantity(attendance);
    const recordId = attendanceRecordId(attendance);
    const document = attendanceRecordDocument(attendanceRecordLines(recordId));
    if (document.source || document.id) {
      group.evidenceRecordIds.add(recordId);
      group.documents.set(recordId, document);
    }
    group.attachments = group.evidenceRecordIds.size;
    if (attendance.status === 'in_reconciliation') group.status = 'in_reconciliation';
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
    ? `<h2 class="section-title">Plano e acesso</h2><div class="card workplace-summary"><div class="card-head"><span class="round-icon">✓</span><div><h3>Plano único</h3><p>R$ 39,90 por mês</p></div><span class="badge ${accessStatus === 'active' ? '' : 'inactive'}">${escapeHtml(subscriptionLabels[accessStatus] || 'Em configuração')}</span></div><p class="field-hint">Cadastros, regras e atendimentos são sincronizados entre o celular e o computador.</p></div>`
    : '';
  const deleteLabel = isCloudMode() ? 'Excluir dados salvos neste aparelho' : 'Excluir conta e dados locais';
  screen.innerHTML = `<div class="screen-stack">${pageHeading('', 'Mais', '')}<div class="card card-head"><span class="avatar">${escapeHtml((appState.profile?.name || 'M').charAt(0))}</span><div><h3>${escapeHtml(appState.profile?.name || 'Médico')}</h3><p>${formatCpf(appState.profile?.cpf || '')}<br/>${escapeHtml(appState.profile?.email || '')}</p></div></div>${cloudSection}<div class="notice success"><strong>Dados e documentos sincronizados</strong><br/>Comprovantes e Notas Fiscais ficam disponíveis nos seus dispositivos autenticados.</div><h2 class="section-title">Aplicativo</h2><div class="card install-card"><span class="install-icon">${isStandalone() ? '✓' : '⇧'}</span><div><strong>${isStandalone() ? 'MedRecebe instalado' : 'Adicionar à Tela de Início'}</strong><p>${isStandalone() ? 'Você está usando o modo aplicativo.' : 'Instale pelo Safari para abrir como aplicativo.'}</p></div>${isStandalone() ? '' : '<button class="link-button" data-action="install" type="button">Ver passos</button>'}</div><h2 class="section-title">Ajuda e preferências</h2><div class="card account-links"><button class="account-link" data-nav="feedback" type="button">Enviar feedback <span>›</span></button><a class="account-link" href="./privacidade.html" target="_blank" rel="noopener">Política de Privacidade <span>›</span></a><a class="account-link" href="./termos.html" target="_blank" rel="noopener">Termos de Uso <span>›</span></a><a class="account-link" href="./cancelamento.html" target="_blank" rel="noopener">Política de cancelamento e reembolso <span>›</span></a><a class="account-link" href="./suporte.html" target="_blank" rel="noopener">Ajuda e suporte <span>›</span></a></div><button class="button secondary" data-action="logout" type="button">Sair</button><button class="button danger" data-action="delete-beta-data" type="button">${deleteLabel}</button><p class="muted" style="text-align:center">MedRecebe • versão web 2.3</p></div>`;
}

function cancellationBackup() {
  return {
    product: 'MedRecebe',
    exportedAt: new Date().toISOString(),
    profile: appState.profile,
    workplaces: appState.workplaces,
    attendances: appState.attendances,
    invoices: appState.invoices || [],
  };
}

async function prepareCancellationBackup() {
  const file = new File([JSON.stringify(cancellationBackup(), null, 2)], `backup-medrecebe-${dateOnly()}.json`, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title: 'Backup MedRecebe', text: `Envie este backup para ${appState.profile?.email || 'seu próprio e-mail'}.`, files: [file] });
    return;
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = file.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  const body = `Seu backup MedRecebe foi preparado e baixado como ${file.name}. Anexe o arquivo a esta mensagem e envie para manter uma cópia no seu próprio e-mail.`;
  window.location.href = `mailto:${encodeURIComponent(appState.profile?.email || '')}?subject=${encodeURIComponent('Backup dos dados MedRecebe')}&body=${encodeURIComponent(body)}`;
}

function renderCancellation() {
  if (!isCloudMode()) return navigate('account');
  screen.innerHTML = `<div class="screen-stack">${pageHeading('Política e encerramento', 'Solicitar cancelamento', 'Revise as condições antes de confirmar o encerramento da recorrência.')}<div class="notice warning"><strong>Antes de continuar</strong><br/>Dentro dos 7 primeiros dias da contratação, o sistema solicita o reembolso integral do pagamento elegível. Depois desse prazo, o cancelamento impede cobranças futuras, sem restituição proporcional do ciclo iniciado.</div><label class="card backup-choice"><input id="cancel-backup" type="checkbox" checked/><span><strong>Preparar backup para meu e-mail</strong><small>O MedRecebe criará um arquivo com locais, modalidades, atendimentos e conciliações. No iPhone, o Safari abrirá o compartilhamento para você escolher o Mail e enviar ao próprio endereço.</small></span></label><div class="card settings"><p><strong>E-mail cadastrado:</strong> ${escapeHtml(appState.profile?.email || '')}</p><p class="field-hint">O backup registra também o catálogo dos comprovantes e Notas Fiscais sincronizados. Revise o conteúdo antes de enviá-lo.</p></div><button class="button primary" data-action="confirm-cancel-subscription" type="button">Confirmar cancelamento</button><button class="button secondary" data-action="cancel-cancellation" type="button">Voltar sem cancelar</button></div>`;
}

async function performCancellation(button) {
  if (!confirm('Confirmar o cancelamento da assinatura? A recorrência será encerrada e esta ação poderá bloquear o acesso após a conclusão.')) return;
  button.disabled = true;
  button.textContent = 'Cancelando…';
  const wantsBackup = Boolean($('#cancel-backup')?.checked);
  try {
    const result = await cloud.cancelSubscription();
    if (wantsBackup) {
      try { await prepareCancellationBackup(); } catch (backupError) { showToast('Cancelamento concluído. O compartilhamento do backup não foi finalizado.'); }
    }
    const restored = await cloud.restore();
    if (restored) applyCloudAccount(restored);
    const message = result.refunded
      ? 'Assinatura cancelada e reembolso solicitado.'
      : result.refundPending
        ? 'Assinatura cancelada. O reembolso será conferido pelo suporte.'
        : 'Assinatura cancelada. Não haverá novas cobranças.';
    showToast(message);
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Confirmar cancelamento';
    showToast(error instanceof Error ? error.message : 'Não foi possível cancelar agora.');
  }
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
  pendingInvoiceWorkplaceId = '';
  draftWorkplace = { id: id('work'), name: '', address: '', payerCnpj: '', payerLegalName: '', reconciliationEmail: '', reconciliationCc: '', active: true, modalities: [] };
  editingModalityIndex = null;
  renderWorkplaceModal();
}

function editWorkplace(workplaceId) {
  const workplace = appState.workplaces.find((item) => item.id === workplaceId);
  if (!workplace) return;
  pendingInvoiceWorkplaceId = '';
  draftWorkplace = structuredClone(workplace);
  editingModalityIndex = null;
  renderWorkplaceModal();
}

function invoicePayerSuggestion(invoice) {
  const payerCnpj = cnpjDigits(invoice?.suggestedPayerCnpj || invoice?.cnpjs?.[0] || '');
  const payerLegalName = String(invoice?.suggestedPayerLegalName || invoice?.legalNames?.[0] || '').trim();
  return { payerCnpj, payerLegalName };
}

function newWorkplaceFromInvoice(invoiceId) {
  const invoice = (appState.invoices || []).find((item) => item.id === invoiceId);
  if (!invoice) return showToast('A Nota Fiscal não está mais disponível.');
  const suggestion = invoicePayerSuggestion(invoice);
  pendingInvoiceWorkplaceId = invoice.id;
  draftWorkplace = {
    id: id('work'),
    name: suggestion.payerLegalName || 'Novo local',
    address: '',
    payerCnpj: suggestion.payerCnpj,
    payerLegalName: suggestion.payerLegalName,
    reconciliationEmail: '',
    reconciliationCc: '',
    active: true,
    modalities: [],
  };
  editingModalityIndex = null;
  renderWorkplaceModal();
}

function renderWorkplaceModal() {
  const sourceInvoice = (appState.invoices || []).find((item) => item.id === pendingInvoiceWorkplaceId);
  const invoiceNotice = sourceInvoice
    ? `<div class="notice success"><strong>Cadastro iniciado pela Nota Fiscal</strong><br/>Revise o CNPJ e a Razão Social extraídos, informe o nome do local e cadastre ao menos uma modalidade. Ao salvar, você voltará automaticamente para a Conciliação.</div>`
    : '';
  const modalityRows = draftWorkplace.modalities.map((modality, index) => `<div class="editor-row"><span><strong>${escapeHtml(modality.name)} • ${currency(modality.amountCents)}</strong><small>${escapeHtml(modalityTypeLabel(modality))} • ${escapeHtml(describeRule(modality.rule))}</small></span><span><button data-action="edit-modality" data-index="${index}" type="button">Editar</button><button data-action="delete-modality" data-index="${index}" type="button">Excluir</button></span></div>`).join('');
  const editing = editingModalityIndex === null ? null : draftWorkplace.modalities[editingModalityIndex];
  const modality = editing || { name: '', type: 'plan', amountCents: 0, rule: { kind: 'calendar_days', days: 30 } };
  modalRoot.innerHTML = `<div class="modal-wrap"><section class="modal-sheet" role="dialog" aria-modal="true"><header class="modal-header simple"><span></span><h2>${appState.workplaces.some((item) => item.id === draftWorkplace.id) ? 'Editar local' : 'Novo local'}</h2><button data-action="close-modal" aria-label="Fechar" type="button">×</button></header><div class="modal-body">${invoiceNotice}<div class="form-grid"><label>Nome do local<input id="work-name" value="${escapeHtml(draftWorkplace.name)}" placeholder="Ex.: Clínica Horizonte"/></label><label>Razão Social do pagador<input id="work-legal-name" value="${escapeHtml(draftWorkplace.payerLegalName || '')}" placeholder="Razão Social exibida na Nota Fiscal"/></label><label>CNPJ do pagador<input id="work-cnpj" inputmode="numeric" maxlength="18" value="${formatCnpj(draftWorkplace.payerCnpj || '')}" placeholder="00.000.000/0000-00"/></label><label>Endereço<input id="work-address" value="${escapeHtml(draftWorkplace.address)}" placeholder="Rua, número e cidade"/></label><label>E-mail oficial para conciliação<input id="work-email" type="email" value="${escapeHtml(draftWorkplace.reconciliationEmail)}" placeholder="financeiro@clinica.com.br"/></label><label>E-mail em cópia<input id="work-cc" value="${escapeHtml(draftWorkplace.reconciliationCc || '')}" placeholder="gestor@clinica.com.br"/></label></div><div class="notice">O CNPJ e a Razão Social são usados para identificar automaticamente o pagador na Nota Fiscal.</div><div class="modality-form"><h3>${editing ? 'Editar modalidade' : 'Adicionar modalidade'}</h3><label>Nome<input id="mod-name" value="${escapeHtml(modality.name)}" placeholder="Ex.: Consulta, Unimed ou imunobiológico"/></label><div class="inline-grid"><label>Tipo<select id="mod-type"><option value="plan" ${modality.type === 'plan' ? 'selected' : ''}>Plano</option><option value="private" ${modality.type === 'private' ? 'selected' : ''}>Particular</option><option value="recurring" ${modality.type === 'recurring' ? 'selected' : ''}>Receita recorrente</option><option value="custom" ${modality.type === 'custom' ? 'selected' : ''}>Personalizado</option></select></label><label>Valor (R$)<input id="mod-value" inputmode="decimal" value="${modality.amountCents ? (modality.amountCents / 100).toFixed(2).replace('.', ',') : ''}" placeholder="0,00"/></label></div><label id="mod-custom-type-wrap" ${modality.type === 'custom' ? '' : 'hidden'}>Nome do tipo personalizado<input id="mod-custom-type" value="${escapeHtml(modality.customType || '')}" placeholder="Ex.: Teleinterconsulta"/></label>${modality.type === 'recurring' ? '<div class="notice success">No atendimento, será possível identificar o paciente, o medicamento e contabilizar também uma consulta.</div>' : ''}<label>Regra de pagamento<select id="mod-rule">${ruleOptions(modality.rule.kind)}</select></label><div id="rule-fields">${ruleFields(modality.rule)}</div><button class="button secondary small" data-action="save-modality" type="button">${editing ? 'Atualizar modalidade' : 'Adicionar e continuar'}</button><p class="field-hint">A modalidade é adicionada automaticamente à lista abaixo e o formulário permanece disponível para o próximo cadastro.</p></div><h3 class="section-title">Modalidades cadastradas</h3><div class="modalities-editor">${modalityRows || '<div class="notice warning">Cadastre pelo menos uma modalidade.</div>'}</div><div class="modal-final-actions"><button class="button primary" data-action="save-workplace" type="button">Salvar</button><button class="button secondary" data-action="close-modal" type="button">Cancelar</button></div></div></section></div>`;
  const workNameInput = $('#work-name');
  const workNameLabel = workNameInput?.closest('label');
  if (workNameLabel?.firstChild) workNameLabel.firstChild.textContent = 'Nome fantasia / nome do local';
  if (workNameInput) workNameInput.placeholder = 'Ex.: Hospital São Paulo';
  const workplaceFormGrid = $('.form-grid', modalRoot);
  workplaceFormGrid?.insertAdjacentHTML('beforebegin', `<section class="institution-directory"><div class="directory-heading"><span class="round-icon">⌕</span><div><h3>Buscar hospital ou empresa</h3><p>Consulte nome fantasia, razão social e dados oficiais do CNES.</p></div></div><label>Nome fantasia, razão social, cidade, CNPJ ou CNES<input id="institution-search" autocomplete="off" placeholder="Ex.: A.C.Camargo, Fundação Antonio Prudente ou CNPJ"/></label><p class="field-hint" id="institution-directory-status">Carregando diretório institucional…</p><div class="directory-results" id="institution-results" role="listbox"></div>${directorySelectionMarkup()}</section>`);
  void loadInstitutionDirectory()
    .then(() => {
      if ($('#institution-search')) renderInstitutionSearchResults($('#institution-search').value);
    })
    .catch(() => {
      const status = $('#institution-directory-status');
      if (status) status.textContent = 'A busca automática está indisponível agora. O preenchimento manual continua disponível.';
    });
}

function modalityTypeLabel(modality) {
  if (modality.type === 'plan') return 'Plano';
  if (modality.type === 'private') return 'Particular';
  if (modality.type === 'recurring') return 'Receita recorrente';
  if (modality.type === 'custom') return modality.customType || 'Personalizado';
  return 'Modalidade';
}

function ruleOptions(selected) {
  const options = [
    ['calendar_days', 'Dias corridos'], ['immediate', 'À vista'], ['advance', 'Antecipado'],
    ['first_business_day_next_month', '1º dia útil do mês seguinte'], ['last_business_day_next_month', 'Último dia útil do mês seguinte'],
  ];
  if (selected === 'weekly') options.push(['weekly', 'Regra legada: dia da semana seguinte']);
  if (selected === 'custom') options.push(['custom', 'Regra legada personalizada']);
  return options.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}

function ruleFields(rule) {
  if (['calendar_days', 'advance'].includes(rule.kind)) return `<label>Quantidade de dias<input id="rule-days" inputmode="numeric" value="${Number(rule.days) || 0}"/></label>`;
  if (rule.kind === 'weekly') return `<label>Dia da semana<select id="rule-weekday">${[['1', 'Segunda'], ['2', 'Terça'], ['3', 'Quarta'], ['4', 'Quinta'], ['5', 'Sexta']].map(([value, label]) => `<option value="${value}" ${Number(value) === Number(rule.weekday || 5) ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`;
  if (rule.kind === 'custom') return `<div class="form-grid"><div class="notice warning">Esta é uma regra legada. Ela continua disponível para preservar cadastros existentes, mas não aparece em novas modalidades.</div><label>Data-base<select id="rule-basis"><option value="service_date" ${rule.basis === 'service_date' ? 'selected' : ''}>Data do atendimento</option><option value="end_of_week" ${rule.basis === 'end_of_week' ? 'selected' : ''}>Fim da semana</option><option value="end_of_month" ${rule.basis === 'end_of_month' ? 'selected' : ''}>Fim do mês</option></select></label><div class="inline-grid"><label>Deslocamento<input id="rule-offset" inputmode="numeric" value="${Number(rule.offset) || 0}"/></label><label>Unidade<select id="rule-unit"><option value="days" ${rule.unit === 'days' ? 'selected' : ''}>Dias</option><option value="weeks" ${rule.unit === 'weeks' ? 'selected' : ''}>Semanas</option><option value="months" ${rule.unit === 'months' ? 'selected' : ''}>Meses</option></select></label></div><label>Ajuste<select id="rule-adjustment"><option value="none">Sem ajuste</option><option value="next_business_day" ${rule.adjustment === 'next_business_day' ? 'selected' : ''}>Próximo dia útil</option><option value="previous_business_day" ${rule.adjustment === 'previous_business_day' ? 'selected' : ''}>Dia útil anterior</option><option value="first_business_day" ${rule.adjustment === 'first_business_day' ? 'selected' : ''}>1º dia útil do mês</option><option value="last_business_day" ${rule.adjustment === 'last_business_day' ? 'selected' : ''}>Último dia útil do mês</option></select></label><label>Texto acordado (opcional)<textarea id="rule-text">${escapeHtml(rule.contractualText || '')}</textarea></label></div>`;
  return '<p class="field-hint">A data prevista será calculada automaticamente.</p>';
}

function preserveWorkplaceFields() {
  if (!draftWorkplace || !$('#work-name')) return;
  draftWorkplace.name = $('#work-name').value;
  draftWorkplace.payerLegalName = $('#work-legal-name').value;
  draftWorkplace.payerCnpj = cnpjDigits($('#work-cnpj').value);
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

function reconciliationContent(group) {
  const details = group.attendances.map((attendance, index) => `${index + 1}. ${displayDate(attendance.occurredAt)} — ${attendanceQuantity(attendance)} × ${attendance.modalityName} — ${currency(attendance.amountCents)}`).join('\n');
  let body = appState.reconciliationMessage;
  let pdfBody = appState.reconciliationMessage;
  const tokens = { '{{local}}': group.workplace.name, '{{periodo}}': monthLabel(group.month), '{{quantidade}}': String(group.quantity), '{{valor}}': currency(group.totalCents), '{{detalhes}}': details, '{{medico}}': appState.profile.name };
  Object.entries(tokens).forEach(([token, value]) => {
    body = body.split(token).join(value);
    pdfBody = pdfBody.split(token).join(token === '{{detalhes}}' ? 'Consulte o detalhamento consolidado a seguir.' : value);
  });
  const subject = `Conciliação de repasses — ${group.workplace.name} — ${monthLabel(group.month)}`;
  const shareText = `Solicitação de conciliação de repasses\n${group.workplace.name} • ${monthLabel(group.month)}\n${group.quantity} atendimentos • ${currency(group.totalCents)}\n\nO resumo e os comprovantes seguem no PDF gerado pelo MedRecebe.`;
  return { body, pdfBody, details, subject, shareText };
}

function markReconciliationRequested(group) {
  const requestedAt = new Date().toISOString();
  group.attendances.forEach((attendance) => {
    attendance.status = 'in_reconciliation';
    attendance.reconciliationRequestedAt = requestedAt;
  });
  saveState();
}

async function blobAsReconciliationJpeg(blob) {
  if (!blob.type.startsWith('image/')) throw new Error('O comprovante não é uma imagem válida.');
  const objectUrl = URL.createObjectURL(blob);
  let image;
  try {
    if ('createImageBitmap' in window) image = await createImageBitmap(blob);
    else {
      image = new Image();
      image.src = objectUrl;
      if (image.decode) await image.decode();
      else await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
      });
    }
    const originalWidth = image.width || image.naturalWidth;
    const originalHeight = image.height || image.naturalHeight;
    if (!originalWidth || !originalHeight) throw new Error('O comprovante não possui dimensões válidas.');
    const scale = Math.min(1, 1400 / Math.max(originalWidth, originalHeight));
    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.round(originalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const jpeg = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Falha ao preparar o comprovante.')), 'image/jpeg', 0.72));
    canvas.width = 1;
    canvas.height = 1;
    return { bytes: new Uint8Array(await jpeg.arrayBuffer()), width, height };
  } finally {
    if (typeof image?.close === 'function') image.close();
    URL.revokeObjectURL(objectUrl);
  }
}

async function reconciliationAttachments(group) {
  const attachments = [];
  let omitted = 0;
  const documents = [...group.documents.entries()];
  for (let index = 0; index < documents.length; index += 1) {
    const [recordId, document] = documents[index];
    const source = document.source || document.remoteUrl;
    if (!source) {
      omitted += 1;
      continue;
    }
    try {
      const response = await fetch(source);
      if (!response.ok) throw new Error('Comprovante indisponível.');
      const image = await blobAsReconciliationJpeg(await response.blob());
      const record = group.attendances.find((attendance) => attendanceRecordId(attendance) === recordId);
      attachments.push({
        ...image,
        label: `${displayDate(record?.occurredAt || '')} • ${record?.modalityName || document.fileName || `Comprovante ${index + 1}`}`,
      });
    } catch {
      omitted += 1;
    }
  }
  return { attachments, omitted };
}

function reconciliationFileName(group) {
  const workplace = group.workplace.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'local';
  return `conciliacao-medrecebe-${workplace}-${group.month}.pdf`;
}

function reconciliationPdfInput(group, attachments, omitted, pdfBody) {
  const modalityMap = new Map();
  group.attendances.forEach((attendance) => {
    const current = modalityMap.get(attendance.modalityName) || { modality: attendance.modalityName, quantity: 0, amountCents: 0 };
    current.quantity += attendanceQuantity(attendance);
    current.amountCents += attendance.amountCents;
    modalityMap.set(attendance.modalityName, current);
  });
  return {
    workplaceName: group.workplace.name,
    payerLegalName: group.workplace.payerLegalName,
    payerCnpj: group.workplace.payerCnpj ? formatCnpj(group.workplace.payerCnpj) : '',
    period: monthLabel(group.month),
    doctorName: appState.profile.name,
    generatedAt: new Date().toLocaleString('pt-BR'),
    total: currency(group.totalCents),
    quantity: group.quantity,
    attachmentCount: attachments.length,
    message: pdfBody,
    modalitySummaries: [...modalityMap.values()].map((item) => ({
      modality: item.modality,
      quantity: item.quantity,
      amount: currency(item.amountCents),
    })),
    detailRows: group.attendances.map((attendance) => ({
      date: displayDate(attendance.occurredAt),
      modality: attendance.modalityName,
      quantity: attendanceQuantity(attendance),
      dueDate: displayDate(attendance.dueAt),
      amount: currency(attendance.amountCents),
    })),
    attachments,
    omittedAttachments: omitted,
  };
}

async function buildReconciliationFile(group) {
  if (!window.MedRecebePdf?.build) throw new Error('O gerador do PDF não foi carregado. Atualize a página e tente novamente.');
  const { pdfBody, subject, shareText } = reconciliationContent(group);
  const { attachments, omitted } = await reconciliationAttachments(group);
  const pdfBytes = window.MedRecebePdf.build(reconciliationPdfInput(group, attachments, omitted, pdfBody));
  return {
    file: new File([pdfBytes], reconciliationFileName(group), { type: 'application/pdf' }),
    omitted,
    subject,
    shareText,
  };
}

function downloadReconciliationFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function shareReconciliation(button) {
  const group = reconciliationGroups().find((item) => item.id === selectedReconciliationGroup);
  if (!group) return;
  const originalLabel = button?.textContent || '';
  if (button) {
    button.disabled = true;
    button.textContent = 'Gerando PDF…';
  }
  try {
    const { file, subject, shareText } = await buildReconciliationFile(group);
    if (!navigator.share || !navigator.canShare?.({ files: [file] })) {
      throw new Error('O compartilhamento de arquivos não está disponível neste navegador. Use “Exportar PDF”.');
    }
    await navigator.share({ title: subject, text: shareText, files: [file] });
    if (confirm('Você concluiu o envio da conciliação?')) {
      markReconciliationRequested(group);
      renderReconciliation();
      showToast('Conciliação marcada como solicitada.');
    }
  } catch (error) {
    if (error?.name !== 'AbortError') showToast(error instanceof Error ? error.message : 'Não foi possível preparar o PDF.');
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}

async function exportReconciliationPdf(button) {
  const group = reconciliationGroups().find((item) => item.id === selectedReconciliationGroup);
  if (!group) return;
  const originalLabel = button?.textContent || '';
  if (button) {
    button.disabled = true;
    button.textContent = 'Gerando PDF…';
  }
  try {
    const { file } = await buildReconciliationFile(group);
    downloadReconciliationFile(file);
    showToast('PDF exportado.');
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Não foi possível exportar o PDF.');
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}

function authSubmitLabel(mode = authMode) {
  return {
    register: 'Criar acesso',
    forgot: 'Enviar instruções',
    reset: 'Salvar nova senha',
  }[mode] || 'Entrar';
}

function showAuthMessage(message = '', success = false) {
  const status = $('#auth-error');
  status.textContent = message;
  status.classList.toggle('success', Boolean(message) && success);
}

function consumeRecoveryLink() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const recoveryRequested = new URLSearchParams(window.location.search).get('reset-password') === '1';
  if (hash.get('type') === 'recovery' && hash.get('access_token')) {
    recoveryAccessToken = hash.get('access_token');
  } else if (hash.get('error') || recoveryRequested) {
    recoveryLinkError = 'O link de recuperação é inválido ou expirou. Solicite um novo link.';
  }
  if (window.location.hash) {
    window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}`);
  }
  return Boolean(recoveryAccessToken);
}

function clearRecoveryMarker() {
  const url = new URL(window.location.href);
  url.searchParams.delete('reset-password');
  url.hash = '';
  window.history.replaceState({}, '', `${url.pathname}${url.search}`);
}

function setAuthMode(mode) {
  authMode = ['login', 'register', 'forgot', 'reset'].includes(mode) ? mode : 'login';
  const register = authMode === 'register';
  const forgot = authMode === 'forgot';
  const reset = authMode === 'reset';
  const cpfField = $('#auth-cpf-field');
  const passwordField = $('#auth-password-field');
  const cpfInput = $('#auth-cpf');
  const passwordInput = $('#auth-password');
  const newPassword = $('#auth-new-password');
  const confirmPassword = $('#auth-confirm-password');

  $('#register-fields').hidden = !register;
  $('#reset-password-fields').hidden = !reset;
  cpfField.hidden = reset;
  passwordField.hidden = forgot || reset;
  cpfInput.required = !reset;
  passwordInput.required = !forgot && !reset;
  newPassword.required = reset;
  confirmPassword.required = reset;

  const titles = {
    login: 'Boas-vindas',
    register: 'Criar meu acesso',
    forgot: 'Recuperar senha',
    reset: 'Criar nova senha',
  };
  const descriptions = {
    login: isCloudMode() ? 'Entre com o CPF e a senha da sua conta MedRecebe.' : 'Entre com o CPF e a senha cadastrados neste aparelho.',
    register: isCloudMode() ? 'Crie sua conta para contratar o plano único com 7 dias de garantia.' : 'Cadastre seus dados reais. A conta permanecerá salva neste aparelho.',
    forgot: 'Informe seu CPF para receber as instruções no e-mail cadastrado.',
    reset: 'Defina uma nova senha com pelo menos oito caracteres.',
  };
  $('#auth-title').textContent = titles[authMode];
  $('#auth-description').textContent = descriptions[authMode];
  $('#auth-submit').textContent = authSubmitLabel();
  $('#auth-toggle').hidden = reset;
  $('#auth-toggle').textContent = register ? 'Já tenho acesso' : forgot ? 'Voltar para entrar' : 'Primeiro uso? Criar meu acesso';
  $('#forgot-password').hidden = authMode !== 'login';
  $('#demo-entry').hidden = authMode !== 'login' || isCloudMode();
  passwordInput.autocomplete = register ? 'new-password' : 'current-password';
  showAuthMessage();
}

function bindEvents() {
  $('#auth-cpf').addEventListener('input', (event) => (event.target.value = formatCpf(event.target.value)));
  $('#auth-toggle').addEventListener('click', () => setAuthMode(authMode === 'login' ? 'register' : 'login'));
  $('#forgot-password').addEventListener('click', () => setAuthMode('forgot'));

  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    void requestPersistentStorage();
    const cpf = onlyDigits($('#auth-cpf').value);
    const password = $('#auth-password').value;
    const error = $('#auth-error');
    const submit = $('#auth-submit');
    showAuthMessage();
    if (isCloudMode()) {
      submit.disabled = true;
      submit.textContent = 'Aguarde…';
      try {
        if (authMode === 'forgot') {
          if (!isValidCpf(cpf)) throw new Error('Informe um CPF válido.');
          const result = await cloud.requestPasswordReset(cpf);
          setAuthMode('login');
          showAuthMessage(result.message || 'Se houver uma conta para este CPF, enviaremos as instruções ao e-mail cadastrado.', true);
          return;
        }
        if (authMode === 'reset') {
          const newPassword = $('#auth-new-password').value;
          const confirmation = $('#auth-confirm-password').value;
          if (newPassword.length < 8) throw new Error('A senha deve ter pelo menos oito caracteres.');
          if (newPassword !== confirmation) throw new Error('As senhas informadas não coincidem.');
          await cloud.updatePassword(recoveryAccessToken, newPassword);
          recoveryAccessToken = '';
          clearRecoveryMarker();
          $('#auth-new-password').value = '';
          $('#auth-confirm-password').value = '';
          setAuthMode('login');
          showAuthMessage('Senha alterada. Entre com seu CPF e a nova senha.', true);
          return;
        }
        if (authMode === 'register') {
          const name = $('#auth-name').value.trim();
          const email = $('#auth-email').value.trim().toLowerCase();
          if (name.length < 3) throw new Error('Informe seu nome completo.');
          if (!isValidCpf(cpf)) throw new Error('Informe um CPF válido.');
          if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Informe um e-mail válido.');
          if (password.length < 8) throw new Error('A senha deve ter pelo menos oito caracteres.');
          const result = await cloud.register({ name, email, cpf, password, planCode: selectedPlanCode });
          if (result.requiresLogin) {
            setAuthMode('login');
            $('#auth-title').textContent = 'Cadastro recebido';
            $('#auth-description').textContent = 'Confirme seu e-mail, se solicitado, e entre com CPF e senha.';
            showAuthMessage(result.message || 'Cadastro recebido. Agora entre com CPF e senha.', true);
            return;
          }
          applyCloudAccount(result, cpf);
        } else {
          applyCloudAccount(await cloud.login(cpf, password), cpf);
        }
      } catch (caught) {
        showAuthMessage(caught instanceof Error ? caught.message : 'Não foi possível concluir o acesso.');
      } finally {
        submit.disabled = false;
        submit.textContent = authSubmitLabel();
      }
      return;
    }
    if (authMode === 'forgot' || authMode === 'reset') {
      return showAuthMessage('A recuperação por e-mail requer conexão com o serviço MedRecebe. Tente novamente quando estiver online.');
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
    button.textContent = 'Abrindo pagamento…';
    try {
      const result = await cloud.createSubscription(selectedPlanCode);
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
      button.textContent = 'Continuar';
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

  $('#header-action').addEventListener('click', () => (currentRoute === 'attendance' ? navigate('home') : currentRoute === 'cancellation' ? navigate('account') : openDrawer()));
  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#drawer-backdrop').addEventListener('click', closeDrawer);
  $('#logout-button').addEventListener('click', logout);

  document.addEventListener('click', handleClick);
  document.addEventListener('submit', handleSubmit);
  document.addEventListener('change', handleChange);
  document.addEventListener('input', handleInput);
  window.addEventListener('resize', () => {
    if (!$('#app-view').hidden) document.body.classList.toggle('web-plan', isDesktopComputer());
  });
  window.addEventListener('online', () => void syncPendingEvidence());
}

async function handleClick(event) {
  const nav = event.target.closest('[data-nav]');
  if (nav) return navigate(nav.dataset.nav);
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action, id: targetId, ids, index, value } = target.dataset;
  if (action === 'confirm-cancel-subscription') void performCancellation(target);
  if (action === 'cancel-cancellation') navigate('account');
  if (action === 'install') openInstallModal();
  if (action === 'close-modal') {
    modalRoot.innerHTML = '';
    pendingInvoiceWorkplaceId = '';
  }
  if (action === 'new-workplace') newWorkplace();
  if (action === 'edit-workplace') editWorkplace(targetId);
  if (action === 'create-workplace-from-invoice') newWorkplaceFromInvoice(targetId);
  if (action === 'delete-invoice') {
    const invoice = (appState.invoices || []).find((item) => item.id === targetId);
    if (invoice && confirm('Apagar esta Nota Fiscal anexada? O documento será removido da conciliação e dos seus dispositivos.')) {
      appState.invoices = appState.invoices.filter((item) => item.id !== targetId);
      if (selectedInvoiceId === targetId) selectedInvoiceId = appState.invoices[0]?.id || '';
      if (pendingInvoiceWorkplaceId === targetId) pendingInvoiceWorkplaceId = '';
      saveState();
      renderReconciliation();
      if (isCloudMode()) {
        try {
          await cloud.deleteDocumentsForRecord(targetId);
          showToast('Nota Fiscal e anexo removidos.');
        } catch {
          showToast('Anexo removido da conciliação. A exclusão na nuvem será retomada.');
        }
      } else showToast('Nota Fiscal removida.');
    }
  }
  if (action === 'select-directory-institution') selectDirectoryInstitution(targetId);
  if (action === 'toggle-workplace') {
    const workplace = appState.workplaces.find((item) => item.id === targetId);
    if (workplace) workplace.active = !workplace.active;
    saveState();
    renderWorkplaces();
  }
  if (action === 'open-attendance') {
    selectedWorkplaceId = targetId;
    attendanceDraft = null;
    editingAttendanceId = '';
    attendanceHistoryExpanded = false;
    navigate('attendance');
  }
  if (action === 'cancel-attendance') {
    attendanceDraft = null;
    editingAttendanceId = '';
    navigate('home');
  }
  if (action === 'edit-attendance') {
    const lines = attendanceRecordLines(targetId);
    const editableLines = lines.filter((line) => !line.isAssociatedConsultation);
    const attendance = editableLines[0];
    if (attendance) {
      const document = attendanceRecordDocument(lines);
      editingAttendanceId = targetId;
      attendanceDraft = {
        occurredAt: attendance.occurredAt,
        notes: attendance.notes || '',
        evidence: document.source,
        evidenceDocumentId: document.id,
        evidenceRemoteUrl: document.remoteUrl,
        evidenceSyncStatus: document.syncStatus,
        evidenceFileName: document.fileName,
        evidenceMimeType: document.mimeType,
        evidenceChanged: false,
        items: Object.fromEntries(editableLines.map((line) => [line.modalityId, {
          quantity: attendanceQuantity(line),
          patientReference: line.patientReference || '',
          medication: line.medication || '',
          includeConsultation: Boolean(line.includeConsultation),
          consultationModalityId: line.consultationModalityId || '',
        }])),
      };
      renderAttendance();
      window.scrollTo(0, 0);
    }
  }
  if (action === 'delete-attendance' && confirm('Excluir este registro e todas as modalidades contabilizadas nele? Esta ação remove os valores do Dashboard e não pode ser desfeita.')) {
    appState.attendances = appState.attendances.filter((item) => attendanceRecordId(item) !== targetId);
    if (editingAttendanceId === targetId) {
      editingAttendanceId = '';
      attendanceDraft = null;
    }
    saveState();
    renderAttendance();
    if (isCloudMode()) {
      try {
        await cloud.deleteDocumentsForRecord(targetId);
        showToast('Registro e comprovante excluídos.');
      } catch {
        showToast('Registro excluído. A remoção do comprovante será retomada pelo suporte.');
      }
    } else showToast('Registro de atendimentos excluído.');
  }
  if ((action === 'increase-attendance-quantity' || action === 'decrease-attendance-quantity') && attendanceDraft) {
    const item = attendanceDraft.items[targetId] || { quantity: 1 };
    const delta = action === 'increase-attendance-quantity' ? 1 : -1;
    item.quantity = Math.min(999, Math.max(1, (Number(item.quantity) || 1) + delta));
    attendanceDraft.items[targetId] = item;
    renderAttendance();
  }
  if (action === 'remove-photo') {
    attendanceDraft.evidence = '';
    attendanceDraft.evidenceChanged = true;
    attendanceDraft.evidenceSyncStatus = '';
    renderAttendance();
  }
  if (action === 'toggle-attendance-history') {
    attendanceHistoryExpanded = !attendanceHistoryExpanded;
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
    const group = reconciliationGroups().find((item) => item.id === targetId);
    if (group) selectedChannelWorkplace = group.workplace.id;
    renderReconciliation();
  }
  if (action === 'share-reconciliation') await shareReconciliation(target);
  if (action === 'export-reconciliation-pdf') await exportReconciliationPdf(target);
  if (action === 'rate-feedback') {
    feedbackRating = Number(value);
    $$('.rating button').forEach((button) => button.classList.toggle('selected', Number(button.dataset.value) === feedbackRating));
  }
  if (action === 'logout') logout();
  if (action === 'delete-beta-data' && confirm(isCloudMode() ? 'Excluir deste aparelho os cadastros, atendimentos, fotos e feedbacks?' : 'Excluir conta, cadastros, atendimentos, fotos e feedbacks locais?')) {
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
    autosaveExistingWorkplace();
    renderWorkplaceModal();
  }
  if (action === 'save-modality') saveModality();
  if (action === 'save-workplace') saveWorkplace();
}

function handleChange(event) {
  if (event.target.id === 'mod-rule') $('#rule-fields').innerHTML = ruleFields({ kind: event.target.value });
  if (event.target.id === 'mod-type') {
    const custom = $('#mod-custom-type-wrap');
    if (custom) custom.hidden = event.target.value !== 'custom';
  }
  if (currentRoute === 'attendance' && attendanceDraft && event.target.id === 'attendance-date') {
    attendanceDraft.occurredAt = event.target.value;
    renderAttendance();
  }
  if (currentRoute === 'attendance' && attendanceDraft && event.target.name === 'modality') {
    if (event.target.checked) attendanceDraft.items[event.target.value] = attendanceDraft.items[event.target.value] || { quantity: 1 };
    else delete attendanceDraft.items[event.target.value];
    renderAttendance();
  }
  if (currentRoute === 'attendance' && attendanceDraft && event.target.classList.contains('attendance-quantity-input')) {
    const item = attendanceDraft.items[event.target.dataset.modalityId];
    if (item) item.quantity = Math.min(999, Math.max(1, Number(event.target.value) || 1));
    renderAttendance();
  }
  if (currentRoute === 'attendance' && attendanceDraft && event.target.classList.contains('recurring-consultation')) {
    const item = attendanceDraft.items[event.target.dataset.modalityId];
    if (item) item.includeConsultation = event.target.checked;
    renderAttendance();
  }
  if (currentRoute === 'attendance' && attendanceDraft && event.target.classList.contains('recurring-consultation-modality')) {
    const item = attendanceDraft.items[event.target.dataset.modalityId];
    if (item) item.consultationModalityId = event.target.value;
    renderAttendance();
  }
  if (event.target.id === 'channel-workplace') {
    selectedChannelWorkplace = event.target.value;
    renderReconciliation();
  }
  if (event.target.id === 'invoice-file' && event.target.files[0]) {
    const file = event.target.files[0];
    const button = event.target.closest('label');
    if (button) button.textContent = 'Lendo Nota Fiscal…';
    analyzeInvoiceFile(file)
      .then((invoice) => {
        renderReconciliation();
        showToast(invoice.status === 'matched'
          ? 'Nota Fiscal conciliada com os atendimentos.'
          : invoice.status === 'payer_not_matched'
            ? 'Pagador não cadastrado. Use a sugestão para criar o local.'
            : 'Nota Fiscal lida. Revise o resultado da conferência.');
      })
      .catch((error) => {
        renderReconciliation();
        showToast(error instanceof Error ? error.message : 'Não foi possível ler a Nota Fiscal.');
      });
  }
  if (event.target.classList.contains('evidence-input') && event.target.files[0]) {
    const file = event.target.files[0];
    if (!file.type.startsWith('image/')) return showToast('Escolha uma imagem válida.');
    if (file.size > 15 * 1024 * 1024) return showToast('A foto é muito grande. Escolha uma imagem de até 15 MB.');
    compressImage(file)
      .then((dataUrl) => {
        attendanceDraft.evidence = dataUrl;
        attendanceDraft.evidenceFileName = `${String(file.name || 'comprovante').replace(/\.[^.]+$/, '').slice(0, 120) || 'comprovante'}.jpg`;
        attendanceDraft.evidenceMimeType = 'image/jpeg';
        attendanceDraft.evidenceSyncStatus = 'pending';
        attendanceDraft.evidenceChanged = true;
        renderAttendance();
      })
      .catch(() => showToast('Não foi possível preparar esta foto.'));
  }
}

function handleInput(event) {
  if (event.target.id === 'institution-search') {
    if (institutionDirectory.length) renderInstitutionSearchResults(event.target.value);
    else void loadInstitutionDirectory().then(() => renderInstitutionSearchResults(event.target.value)).catch(() => {});
    return;
  }
  if (event.target.id === 'work-cnpj') {
    event.target.value = formatCnpj(event.target.value);
    return;
  }
  if (currentRoute !== 'attendance' || !attendanceDraft) return;
  if (event.target.id === 'attendance-date') attendanceDraft.occurredAt = event.target.value;
  if (event.target.id === 'attendance-notes') attendanceDraft.notes = event.target.value;
  if (event.target.dataset.recurringPatient) attendanceDraft.items[event.target.dataset.recurringPatient].patientReference = event.target.value;
  if (event.target.dataset.recurringMedication) attendanceDraft.items[event.target.dataset.recurringMedication].medication = event.target.value;
  if (event.target.classList.contains('attendance-quantity-input')) {
    const modalityId = event.target.dataset.modalityId;
    const item = attendanceDraft.items[modalityId];
    if (!item) return;
    item.quantity = Math.min(999, Math.max(1, Number(event.target.value) || 1));
    window.clearTimeout(attendanceRenderTimer);
    attendanceRenderTimer = window.setTimeout(() => {
      if (currentRoute !== 'attendance' || !attendanceDraft?.items?.[modalityId]) return;
      renderAttendance();
      const quantityInput = $(`.attendance-quantity-input[data-modality-id="${CSS.escape(modalityId)}"]`);
      quantityInput?.focus();
    }, 350);
  }
}

async function handleSubmit(event) {
  if (event.target.id === 'attendance-form') {
    event.preventDefault();
    const workplace = appState.workplaces.find((item) => item.id === selectedWorkplaceId);
    const selectedItems = workplace ? selectedAttendanceItems(workplace) : [];
    if (!attendanceDraft.evidence) return showToast('Adicione a foto do comprovante.');
    if (!selectedItems.length) return showToast('Selecione pelo menos uma modalidade de repasse.');
    for (const { modality, draft } of selectedItems) {
      if (modality.type === 'recurring' && !String(draft.patientReference || '').trim()) return showToast(`Informe a identificação do paciente em ${modality.name}.`);
      if (modality.type === 'recurring' && !String(draft.medication || '').trim()) return showToast(`Informe o medicamento ou tratamento em ${modality.name}.`);
      const consultation = draft.includeConsultation ? workplace.modalities.find((item) => item.id === draft.consultationModalityId) : null;
      if (draft.includeConsultation && !consultation) return showToast(`Selecione a modalidade da consulta em ${modality.name}.`);
    }
    const previousLines = editingAttendanceId ? attendanceRecordLines(editingAttendanceId) : [];
    const previousEditableLines = previousLines.filter((item) => !item.isAssociatedConsultation);
    const recordId = editingAttendanceId || id('record');
    const createdAt = previousLines[0]?.createdAt || new Date().toISOString();
    const updatedAt = new Date().toISOString();
    const localEvidence = String(attendanceDraft.evidence || '').startsWith('data:') ? attendanceDraft.evidence : '';
    const previousDocument = attendanceRecordDocument(previousLines);
    const evidenceDocumentId = attendanceDraft.evidenceDocumentId || previousDocument.id || `evidence-${recordId}`;
    const evidenceRemoteUrl = attendanceDraft.evidenceRemoteUrl || previousDocument.remoteUrl || (!localEvidence ? attendanceDraft.evidence : '');
    const attendances = selectedItems.flatMap(({ modality, draft }, selectedIndex) => {
      const previous = previousEditableLines.find((item) => item.modalityId === modality.id);
      const quantity = attendanceQuantity(draft);
      const consultation = draft.includeConsultation ? workplace.modalities.find((item) => item.id === draft.consultationModalityId) : null;
      const main = { id: previous?.id || id('att'), recordId, workplaceId: selectedWorkplaceId, modalityId: modality.id, modalityName: modality.name, modalityType: modality.type, quantity, occurredAt: attendanceDraft.occurredAt, dueAt: calculateDueDate(attendanceDraft.occurredAt, modality.rule), amountCents: modality.amountCents * quantity, unitAmountCents: modality.amountCents, baseAmountCents: modality.amountCents, evidence: selectedIndex === 0 ? localEvidence : '', evidenceDocumentId: selectedIndex === 0 ? evidenceDocumentId : '', evidenceRemoteUrl: selectedIndex === 0 ? evidenceRemoteUrl : '', evidenceFileName: selectedIndex === 0 ? attendanceDraft.evidenceFileName || previousDocument.fileName : '', evidenceMimeType: selectedIndex === 0 ? attendanceDraft.evidenceMimeType || previousDocument.mimeType : '', evidenceSyncStatus: selectedIndex === 0 ? (localEvidence && attendanceDraft.evidenceChanged ? 'pending' : attendanceDraft.evidenceSyncStatus || previousDocument.syncStatus) : '', evidenceAvailable: selectedIndex === 0, notes: attendanceDraft.notes.trim(), patientReference: modality.type === 'recurring' ? String(draft.patientReference || '').trim() : '', medication: modality.type === 'recurring' ? String(draft.medication || '').trim() : '', includeConsultation: Boolean(consultation), consultationSeparated: Boolean(consultation), consultationModalityId: consultation?.id || '', consultationModalityName: consultation?.name || '', consultationAmountCents: consultation?.amountCents || 0, status: previous?.status || 'pending', createdAt, updatedAt };
      if (!consultation) return [main];
      const previousConsultation = previousLines.find((item) => item.isAssociatedConsultation && item.sourceAttendanceId === main.id);
      return [main, {
        id: previousConsultation?.id || `consultation-${main.id}`,
        recordId,
        workplaceId: selectedWorkplaceId,
        modalityId: consultation.id,
        modalityName: consultation.name,
        modalityType: consultation.type,
        quantity,
        occurredAt: attendanceDraft.occurredAt,
        dueAt: calculateDueDate(attendanceDraft.occurredAt, consultation.rule),
        amountCents: consultation.amountCents * quantity,
        unitAmountCents: consultation.amountCents,
        baseAmountCents: consultation.amountCents,
        evidence: '',
        notes: '',
        status: previousConsultation?.status || previous?.status || 'pending',
        createdAt,
        updatedAt,
        isAssociatedConsultation: true,
        sourceAttendanceId: main.id,
        sourceModalityId: modality.id,
      }];
    });
    appState.attendances = [...attendances, ...appState.attendances.filter((item) => attendanceRecordId(item) !== recordId)];
    if (!saveState()) {
      return;
    }
    attendanceDraft = null;
    const corrected = Boolean(editingAttendanceId);
    editingAttendanceId = '';
    renderAttendance();
    const quantity = attendanceCount(attendances);
    const successMessage = corrected ? 'Correção salva no registro.' : `${quantity} ${quantity === 1 ? 'atendimento salvo' : 'atendimentos salvos'} e adicionados ao Dashboard.`;
    showToast(localEvidence && isCloudMode() ? `${successMessage} Sincronizando comprovante…` : successMessage);
    if (localEvidence && isCloudMode()) {
      void syncEvidenceForRecord(recordId)
        .then(() => {
          if (currentRoute === 'attendance') renderAttendance();
          showToast('Comprovante sincronizado e disponível em outros dispositivos.');
        })
        .catch(() => {
          if (currentRoute === 'attendance') renderAttendance();
          showToast('Atendimento salvo. O comprovante será enviado quando a conexão voltar.');
        });
    }
  }
  if (event.target.id === 'channel-form') {
    event.preventDefault();
    const workplace = appState.workplaces.find((item) => item.id === selectedChannelWorkplace);
    if (!workplace) return;
    workplace.reconciliationEmail = $('#channel-email').value.trim().toLowerCase();
    workplace.reconciliationCc = $('#channel-cc').value.trim().toLowerCase();
    appState.reconciliationMessage = $('#channel-message').value.trim();
    saveState();
    showToast(isCloudMode() ? 'Canal e mensagem sincronizados.' : 'Canal e mensagem salvos neste aparelho.');
  }
  if (event.target.id === 'feedback-form') {
    event.preventDefault();
    const feedback = { rating: feedbackRating, area: $('#feedback-area').value, message: $('#feedback-message').value.trim(), contact: $('#feedback-contact').value.trim(), createdAt: new Date().toISOString() };
    if (!feedback.message) return;
    appState.feedbacks.push(feedback);
    saveState();
    const context = `\n\n--- Contexto automático ---\nNota: ${feedback.rating}/5\nÁrea: ${feedback.area}\nTela: ${currentRoute}\nLocais: ${appState.workplaces.length}\nAtendimentos: ${attendanceCount(appState.attendances)}\nModo instalado: ${isStandalone() ? 'sim' : 'não'}\nDispositivo: ${navigator.userAgent}\nContato: ${feedback.contact || 'não informado'}`;
    window.location.href = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(`Feedback MedRecebe — ${feedback.area} — ${feedback.rating}/5`)}&body=${encodeURIComponent(feedback.message + context)}`;
    renderFeedback();
  }
}

function saveModality() {
  preserveWorkplaceFields();
  const name = $('#mod-name').value.trim();
  const amountCents = parseMoney($('#mod-value').value);
  const rule = readRuleForm();
  if (!name || amountCents <= 0) return showToast('Informe nome e valor da modalidade.');
  const type = $('#mod-type').value;
  const customType = type === 'custom' ? $('#mod-custom-type').value.trim() : '';
  if (type === 'custom' && !customType) return showToast('Informe o nome do tipo personalizado.');
  const existing = editingModalityIndex === null ? null : draftWorkplace.modalities[editingModalityIndex];
  const modality = { id: existing?.id || id('mod'), name, type, customType, amountCents, rule, active: true };
  if (editingModalityIndex === null) draftWorkplace.modalities.push(modality);
  else draftWorkplace.modalities[editingModalityIndex] = modality;
  editingModalityIndex = null;
  autosaveExistingWorkplace();
  renderWorkplaceModal();
  showToast('Modalidade salva. Você pode cadastrar a próxima.');
}

function autosaveExistingWorkplace() {
  if (!draftWorkplace || !appState.workplaces.some((item) => item.id === draftWorkplace.id)) return;
  appState.workplaces = appState.workplaces.map((item) => (item.id === draftWorkplace.id ? structuredClone(draftWorkplace) : item));
  saveState();
}

function saveWorkplace() {
  preserveWorkplaceFields();
  if (!draftWorkplace.name.trim()) return showToast('Informe o nome do local.');
  if (draftWorkplace.payerLegalName.trim().length < 3) return showToast('Informe a Razão Social do pagador.');
  if (!isValidCnpj(draftWorkplace.payerCnpj)) return showToast('Informe um CNPJ válido do pagador.');
  if (!draftWorkplace.modalities.length) return showToast('Cadastre pelo menos uma modalidade.');
  const exists = appState.workplaces.some((item) => item.id === draftWorkplace.id);
  const savedWorkplace = structuredClone(draftWorkplace);
  if (exists) appState.workplaces = appState.workplaces.map((item) => (item.id === draftWorkplace.id ? savedWorkplace : item));
  else appState.workplaces.push(savedWorkplace);
  const sourceInvoice = (appState.invoices || []).find((item) => item.id === pendingInvoiceWorkplaceId);
  if (sourceInvoice) reconcileStoredInvoice(sourceInvoice, savedWorkplace);
  saveState();
  modalRoot.innerHTML = '';
  pendingInvoiceWorkplaceId = '';
  if (sourceInvoice) {
    renderReconciliation();
    showToast(sourceInvoice.status === 'group_not_found'
      ? 'Local cadastrado. Ainda não há grupo vencido deste pagador para comparar.'
      : 'Local cadastrado e Nota Fiscal vinculada à conciliação.');
  } else {
    renderWorkplaces();
    showToast('Local e modalidades salvos.');
  }
}

async function logout() {
  if (isCloudMode()) await cloud.logout();
  cloudAccount = null;
  localStorage.removeItem(SESSION_KEY);
  activeStateKey = APP_KEY;
  appState = loadState(APP_KEY);
  currentRoute = 'dashboard';
  showLogin();
}

async function boot() {
  const hasRecoveryToken = consumeRecoveryLink();
  bindEvents();
  if (new URLSearchParams(window.location.search).get('signup') === '1') setAuthMode('register');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  void loadInstitutionDirectory().catch(() => {});
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
  });
  if (isCloudMode()) {
    $('#demo-entry').hidden = true;
    $('#auth-description').textContent = 'Entre com o CPF e a senha da sua conta MedRecebe.';
    if (hasRecoveryToken) {
      await cloud.logout().catch(() => {});
      showLogin();
      setAuthMode('reset');
      return;
    }
    if (recoveryLinkError) {
      showLogin();
      setAuthMode('login');
      showAuthMessage(recoveryLinkError);
      return;
    }
    try {
      const restored = await cloud.restore();
      if (restored && returnedFromCheckout()) await reconcileBillingReturn(restored);
      else if (restored) applyCloudAccount(restored);
      else {
        showLogin();
        if (new URLSearchParams(window.location.search).get('signup') === '1') setAuthMode('register');
      }
    } catch {
      showLogin();
      if (new URLSearchParams(window.location.search).get('signup') === '1') setAuthMode('register');
    }
    return;
  }
  if (localStorage.getItem(SESSION_KEY) === 'active' && appState.profile && appState.account) showApp();
  else showLogin();
}

void boot();
