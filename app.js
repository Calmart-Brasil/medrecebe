const APP_KEY = 'medrecebe.beta.app.v1';
const SESSION_KEY = 'medrecebe.beta.session.v1';
const DEMO_CPF = '52998224725';
const DEMO_PASSWORD = 'Teste@123';
const FEEDBACK_EMAIL = 'ti@calmart.com.br';
const INSTITUTION_DIRECTORY_BASE_URL = './data/institutions';
const INSTITUTION_DIRECTORY_VERSION = '20260718';
const MEDICAL_SPECIALTIES_URL = './data/medical-specialties.json?v=20260721';
const MUNICIPALITY_DIRECTORY_BASE_URL = './data/municipalities';
const MEDICAL_DENSITY_BASE_URL = './data/medical-density';
const MEDICAL_SHAPES_BASE_URL = './data/medical-map-shapes';
const MARKET_MAP_VERSION = '202606-pop2025-v3';
const CNPJ_CARD_URL = 'https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/cnpj.aspx';
const FISCAL_AGREEMENT_VERSION = '2026.07.1';
const GOVBR_SIGNATURE_URL = 'https://assinador.iti.br/assinatura/index.xhtml';
const RFB_AUTHORIZATION_URL = 'https://www.gov.br/pt-br/servicos/cadastrar-ou-cancelar-procuracao-para-acesso-ao-e-cac';
const MARKET_CACHE_KEY = 'medrecebe.market-intelligence.v2';

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
let institutionDirectoryIndex = null;
let institutionDirectoryIndexPromise = null;
let institutionDirectoryState = 'SP';
const institutionDirectoryCache = new Map();
let pendingInvoiceWorkplaceId = '';
let medicalSpecialties = [];
let medicalSpecialtiesPromise = null;
let registrationSpecialtiesDraft = [];
let professionalProfile = null;
let professionalProfileLoading = false;
let professionalProfileError = '';
let professionalDraft = null;
let marketIntelligenceCache = null;
let marketIntelligenceLoading = false;
let marketIntelligenceError = '';
let privateProspectsError = '';
const municipalityDirectoryCache = new Map();
const municipalityDirectoryPromises = new Map();
const medicalDensityCache = new Map();
const medicalDensityPromises = new Map();
const medicalShapesCache = new Map();
const medicalShapesPromises = new Map();
let medicalDensityError = '';
let selectedMedicalMapUf = 'BR';
let selectedMedicalMapSpecialty = 'all';
let selectedMedicalMapMetric = 'per_100k';
let selectedMedicalMapLayer = 'concentration';
let selectedSpecialtyRankingOrder = 'asc';
let marketplaceMode = 'professional';
let marketplaceCache = null;
let marketplaceLoading = false;
let marketplaceError = '';
let marketplaceMunicipalitiesLoading = false;

const TITLES = {
  home: 'Início',
  attendance: 'Novo atendimento',
  dashboard: 'Dashboard',
  workplaces: 'Locais e modalidades',
  reconciliation: 'Conciliação',
  fiscal: 'Integração fiscal',
  opportunities: 'Oportunidades',
  intelligence: 'Inteligência',
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
    fiscalIntegration: {
      status: 'not_started',
      agreementVersion: FISCAL_AGREEMENT_VERSION,
      agreementAcceptedAt: '',
      agreementSigner: '',
      subjectType: 'cnpj',
      subjectLast4: '',
      signedDocumentName: '',
      signedDocumentId: '',
      selectedWorkplaceId: '',
      connections: [],
    },
    marketplace: {
      mode: 'professional',
      search: { uf: '', city: '', cityCode: '', radiusKm: 1000, professionalArea: 'medical', contractType: 'all', publicCategory: 'all' },
      demoPostings: [],
      demoOrganization: null,
      demoWorkers: [],
      demoApplications: [],
    },
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
  state.fiscalIntegration = { ...emptyState().fiscalIntegration, ...(state.fiscalIntegration || {}) };
  state.fiscalIntegration.connections = Array.isArray(state.fiscalIntegration.connections) ? state.fiscalIntegration.connections : [];
  state.marketplace = { ...emptyState().marketplace, ...(state.marketplace || {}) };
  state.marketplace.search = { ...emptyState().marketplace.search, ...(state.marketplace.search || {}) };
  state.marketplace.demoPostings = Array.isArray(state.marketplace.demoPostings) ? state.marketplace.demoPostings : [];
  state.marketplace.demoWorkers = Array.isArray(state.marketplace.demoWorkers) ? state.marketplace.demoWorkers : [];
  state.marketplace.demoApplications = Array.isArray(state.marketplace.demoApplications) ? state.marketplace.demoApplications : [];
  state.schemaVersion = 4;
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

async function loadInstitutionDirectoryIndex() {
  if (institutionDirectoryIndex) return institutionDirectoryIndex;
  if (institutionDirectoryIndexPromise) return institutionDirectoryIndexPromise;
  institutionDirectoryIndexPromise = fetch(`${INSTITUTION_DIRECTORY_BASE_URL}/index.json?v=${INSTITUTION_DIRECTORY_VERSION}`)
    .then((response) => {
      if (!response.ok) throw new Error('Índice institucional indisponível.');
      return response.json();
    })
    .then((payload) => {
      institutionDirectoryIndex = payload;
      return payload;
    })
    .catch((error) => {
      institutionDirectoryIndexPromise = null;
      throw error;
    });
  return institutionDirectoryIndexPromise;
}

async function loadInstitutionDirectory(uf = institutionDirectoryState || 'SP') {
  const state = BRAZIL_UFS?.includes?.(String(uf).toUpperCase()) ? String(uf).toUpperCase() : 'SP';
  institutionDirectoryState = state;
  if (institutionDirectoryCache.has(state)) {
    const cached = institutionDirectoryCache.get(state);
    institutionDirectory = cached.institutions;
    institutionDirectoryMeta = cached.meta;
    return institutionDirectory;
  }
  if (institutionDirectoryPromise?.state === state) return institutionDirectoryPromise.promise;
  const promise = Promise.all([
    loadInstitutionDirectoryIndex().catch(() => null),
    fetch(`${INSTITUTION_DIRECTORY_BASE_URL}/${state}.json?v=${INSTITUTION_DIRECTORY_VERSION}`).then((response) => {
      if (!response.ok) throw new Error(`Diretório de ${state} indisponível.`);
      return response.json();
    }),
  ])
    .then(([, payload]) => {
      const normalized = (payload.institutions || []).map((institution) => ({
        ...institution,
        tradeName: institution.tradeName || institution.name || '',
        searchKey: normalizeDirectoryText(`${institution.tradeName || ''} ${institution.name} ${institution.legalName} ${institution.city} ${institution.payerCnpj} ${institution.cnes}`),
      }));
      const cached = { institutions: normalized, meta: payload.meta || null };
      institutionDirectoryCache.set(state, cached);
      if (institutionDirectoryState === state) {
        institutionDirectory = normalized;
        institutionDirectoryMeta = cached.meta;
      }
      return institutionDirectory;
    })
    .catch((error) => {
      institutionDirectoryPromise = null;
      throw error;
    });
  institutionDirectoryPromise = { state, promise };
  return promise;
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
      ? `${institutionDirectoryMeta.total} locais e empresas em ${institutionDirectoryMeta.municipalities} municípios de ${institutionDirectoryState}. Fonte: CNES.`
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
    city: institution.city,
    state: institution.state,
    cityCode: institution.cityCode,
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

async function loadMedicalSpecialties() {
  if (medicalSpecialties.length) return medicalSpecialties;
  if (medicalSpecialtiesPromise) return medicalSpecialtiesPromise;
  medicalSpecialtiesPromise = fetch(MEDICAL_SPECIALTIES_URL)
    .then((response) => {
      if (!response.ok) throw new Error('Lista de especialidades indisponível.');
      return response.json();
    })
    .then((payload) => {
      medicalSpecialties = Array.isArray(payload.specialties) ? payload.specialties : [];
      populateSpecialtySelect($('#auth-specialty'));
      return medicalSpecialties;
    })
    .catch((error) => {
      medicalSpecialtiesPromise = null;
      throw error;
    });
  return medicalSpecialtiesPromise;
}

function populateSpecialtySelect(select, selected = '') {
  if (!select) return;
  const current = selected || select.value;
  select.innerHTML = `<option value="">Selecione</option>${medicalSpecialties.map((item) => `<option value="${escapeHtml(item.code)}" ${item.code === current ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}`;
}

function specialtyByCode(code) {
  return medicalSpecialties.find((item) => item.code === code);
}

function normalizeCrmNumber(value = '') {
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 13);
}

function renderSpecialtyChips(root, specialties, removeAction) {
  if (!root) return;
  root.innerHTML = specialties.map((item, index) => `<span class="specialty-chip"><span><strong>${escapeHtml(item.name)}</strong>${item.rqeNumber ? `<small>RQE ${escapeHtml(item.rqeNumber)}</small>` : '<small>RQE não informado</small>'}</span><button data-action="${removeAction}" data-index="${index}" aria-label="Remover ${escapeHtml(item.name)}" type="button">×</button></span>`).join('');
}

function renderRegistrationSpecialties() {
  renderSpecialtyChips($('#auth-specialty-list'), registrationSpecialtiesDraft, 'remove-registration-specialty');
}

function addSpecialtyToDraft(target) {
  const source = target === 'registration' ? registrationSpecialtiesDraft : professionalDraft?.specialties;
  const select = target === 'registration' ? $('#auth-specialty') : $('#professional-specialty');
  const rqe = target === 'registration' ? $('#auth-rqe') : $('#professional-rqe');
  const specialty = specialtyByCode(select?.value);
  if (!source || !specialty) return showToast('Selecione uma especialidade.');
  if (source.some((item) => item.code === specialty.code)) return showToast('Esta especialidade já foi adicionada.');
  source.push({ code: specialty.code, name: specialty.name, rqeNumber: onlyDigits(rqe?.value || '').slice(0, 12), status: 'self_reported' });
  if (select) select.value = '';
  if (rqe) rqe.value = '';
  if (target === 'registration') renderRegistrationSpecialties();
  else renderProfessionalProfileModal();
}

function phoneDigits(value = '', maxLength = 15) {
  return String(value).replace(/\D/g, '').slice(0, maxLength);
}

function formatPhoneCountryCode(value = '') {
  const digits = phoneDigits(value, 3);
  return digits ? `+${digits}` : '';
}

function formatMobilePhone(value = '', countryCode = '+55') {
  const digits = phoneDigits(value, countryCode === '+55' ? 11 : 15);
  if (countryCode !== '+55') return digits;
  if (digits.length <= 2) return digits ? `(${digits}` : '';
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function isValidPhone(countryCode, phoneNumber) {
  const country = formatPhoneCountryCode(countryCode);
  const number = phoneDigits(phoneNumber);
  if (!/^\+[1-9]\d{0,2}$/.test(country)) return false;
  return country === '+55' ? number.length === 11 : number.length >= 8 && number.length <= 15;
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

function isFreemiumAccount() {
  if (!isCloudMode() || cloudAccount?.profile?.role === 'admin') return false;
  return cloudAccount?.subscription?.status !== 'authorized' && cloudAccount?.profile?.planCode === 'freemium';
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

async function loadProfessionalProfile(force = false) {
  if (!isCloudMode() || !cloudAccount) return professionalProfile;
  if (professionalProfileLoading) return professionalProfile;
  if (professionalProfile && !force) return professionalProfile;
  professionalProfileLoading = true;
  professionalProfileError = '';
  try {
    const result = await cloud.professionalProfile({ action: 'get' });
    professionalProfile = result.professional || { registrations: [], specialties: [] };
    return professionalProfile;
  } catch (error) {
    professionalProfileError = error instanceof Error ? error.message : 'Não foi possível carregar o perfil profissional.';
    return null;
  } finally {
    professionalProfileLoading = false;
  }
}

function applyCloudAccount(result, cpf = '') {
  cloudAccount = result;
  professionalProfile = result.professional || null;
  professionalProfileError = '';
  marketIntelligenceCache = null;
  marketIntelligenceError = '';
  selectedPlanCode = cloudPlanCode();
  document.body.classList.toggle('web-plan', isDesktopComputer());
  activeStateKey = `${APP_KEY}.user.${result.profile.id}`;
  appState = loadState(activeStateKey);
  cloudStateDirty = localStorage.getItem(`${activeStateKey}.dirty`) === '1';
  appState.profile = {
    name: result.profile.fullName,
    email: result.profile.email,
    cpf: `•••.•••.•••-${String(result.profile.cpfLast4 || cpf.slice(-4)).padStart(4, '•')}`,
    phoneCountryCode: result.profile.phoneCountryCode || '',
    phoneNumber: result.profile.phoneNumber || '',
  };
  appState.cloudUserId = result.profile.id;
  localStorage.setItem(activeStateKey, JSON.stringify(appState));
  activateSession();
  if (!cloudAccessAllowed()) return showBilling();
  const hydrationSequence = ++cloudHydrationSequence;
  showCloudLoading();
  void Promise.all([hydrateCloudState(), loadProfessionalProfile()]).finally(() => {
    if (hydrationSequence === cloudHydrationSequence && cloudAccessAllowed()) showApp();
  });
}

function showBilling() {
  $('#login-view').hidden = true;
  $('#app-view').hidden = true;
  $('#billing-view').hidden = false;
  closeDrawer();
  const status = cloudAccount?.profile?.accessStatus || 'pending_payment';
  const upgrading = isFreemiumAccount();
  const messages = {
    pending_payment: ['Ative seu acesso para registrar atendimentos e acompanhar seus repasses.', 'Conclua a contratação mensal do plano único.'],
    past_due: ['Não conseguimos confirmar a última mensalidade.', 'Atualize o pagamento para restabelecer o acesso.'],
    canceled: ['Sua assinatura não está ativa.', 'Faça uma nova assinatura para voltar a usar o MedRecebe.'],
    suspended: ['Este acesso foi suspenso pelo administrador.', 'Entre em contato com o suporte antes de tentar um novo pagamento.'],
  };
  const [lead, detail] = upgrading
    ? ['Desbloqueie locais ilimitados e mantenha toda a gestão em uma única conta.', 'Seu plano gratuito continua ativo enquanto você conclui a assinatura.']
    : messages[status] || messages.pending_payment;
  $('#billing-title').textContent = upgrading ? 'Evolua para o plano completo' : 'Ative seu acesso';
  $('#billing-lead').textContent = lead;
  $('#billing-status').textContent = detail;
  $('#billing-price-value').textContent = 'R$ 39,90';
  $('#billing-plan-name').textContent = 'PLANO COMPLETO';
  $('#billing-subscribe').textContent = upgrading ? 'Assinar plano completo' : 'Continuar';
  $('#billing-back').hidden = !upgrading;
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
  if (typeof screen.scrollTo === 'function') screen.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  else {
    screen.scrollTop = 0;
    screen.scrollLeft = 0;
  }
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
    case 'fiscal':
      renderFiscalIntegration();
      break;
    case 'opportunities':
      renderOpportunities();
      break;
    case 'intelligence':
      renderIntelligence();
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
    <button class="card intelligence-shortcut" data-nav="intelligence" type="button"><span class="intelligence-shortcut-icon">↗</span><span><small>INTELIGÊNCIA DE MERCADO</small><strong>Veja concentração de renda e oportunidades</strong><em>${professionalProfile?.specialties?.length ? `${professionalProfile.specialties.length} ${professionalProfile.specialties.length === 1 ? 'especialidade cadastrada' : 'especialidades cadastradas'}` : 'Complete seu CRM para personalizar o radar'}</em></span><b>Explorar ›</b></button>
  </div>`;
}

function workplaceRegion(workplace) {
  if (workplace?.city) return `${workplace.city}${workplace.state ? `/${workplace.state}` : ''}`;
  const address = String(workplace?.address || '');
  const cityState = address.match(/([^·,—]+)\s*[/–-]\s*([A-Z]{2})\s*$/i);
  if (cityState) return `${cityState[1].trim()}/${cityState[2].toUpperCase()}`;
  const directoryCity = address.split('·').map((item) => item.trim()).filter(Boolean).at(-1);
  return directoryCity && !/\d/.test(directoryCity) ? directoryCity : 'Município não informado';
}

function incomeConcentration() {
  const total = appState.attendances.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
  const byWorkplace = appState.workplaces.map((workplace) => {
    const attendances = appState.attendances.filter((item) => item.workplaceId === workplace.id);
    const amountCents = attendances.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
    return { id: workplace.id, name: workplace.name, region: workplaceRegion(workplace), amountCents, quantity: attendanceCount(attendances), share: total ? amountCents / total : 0 };
  }).filter((item) => item.amountCents > 0).sort((a, b) => b.amountCents - a.amountCents);
  const byRegionMap = new Map();
  byWorkplace.forEach((item) => {
    const current = byRegionMap.get(item.region) || { name: item.region, amountCents: 0, quantity: 0 };
    current.amountCents += item.amountCents;
    current.quantity += item.quantity;
    byRegionMap.set(item.region, current);
  });
  const byRegion = [...byRegionMap.values()].map((item) => ({ ...item, share: total ? item.amountCents / total : 0 })).sort((a, b) => b.amountCents - a.amountCents);
  const hhi = byWorkplace.reduce((sum, item) => sum + (item.share * 100) ** 2, 0);
  return { total, byWorkplace, byRegion, topShare: byWorkplace[0]?.share || 0, hhi };
}

function concentrationBars(items, emptyMessage) {
  if (!items.length) return `<div class="intelligence-empty">${escapeHtml(emptyMessage)}</div>`;
  return `<div class="concentration-bars">${items.slice(0, 8).map((item) => `<div class="concentration-row"><div><span><strong>${escapeHtml(item.name)}</strong><small>${item.quantity} atend.</small></span><b>${Math.round(item.share * 100)}%</b></div><div class="concentration-track"><span style="width:${Math.max(3, item.share * 100).toFixed(1)}%"></span></div><small>${currency(item.amountCents)}</small></div>`).join('')}</div>`;
}

async function loadMunicipalityDirectory(uf) {
  const state = BRAZIL_UFS.includes(String(uf || '').toUpperCase()) ? String(uf).toUpperCase() : 'SP';
  if (municipalityDirectoryCache.has(state)) return municipalityDirectoryCache.get(state);
  if (municipalityDirectoryPromises.has(state)) return municipalityDirectoryPromises.get(state);
  const promise = fetch(`${MUNICIPALITY_DIRECTORY_BASE_URL}/${state}.json?v=${MARKET_MAP_VERSION}`)
    .then((response) => {
      if (!response.ok) throw new Error('Lista oficial de municípios indisponível.');
      return response.json();
    })
    .then((payload) => {
      municipalityDirectoryCache.set(state, payload);
      municipalityDirectoryPromises.delete(state);
      return payload;
    })
    .catch((error) => {
      municipalityDirectoryPromises.delete(state);
      throw error;
    });
  municipalityDirectoryPromises.set(state, promise);
  return promise;
}

async function loadMedicalDensity(uf) {
  const requested = String(uf || '').toUpperCase();
  const state = requested === 'BR' || BRAZIL_UFS.includes(requested) ? requested : 'BR';
  if (medicalDensityCache.has(state)) return medicalDensityCache.get(state);
  if (medicalDensityPromises.has(state)) return medicalDensityPromises.get(state);
  const promise = fetch(`${MEDICAL_DENSITY_BASE_URL}/${state}.json?v=${MARKET_MAP_VERSION}`)
    .then((response) => {
      if (!response.ok) throw new Error('Mapa médico indisponível.');
      return response.json();
    })
    .then((payload) => {
      medicalDensityCache.set(state, payload);
      medicalDensityPromises.delete(state);
      medicalDensityError = '';
      return payload;
    })
    .catch((error) => {
      medicalDensityPromises.delete(state);
      medicalDensityError = error instanceof Error ? error.message : 'Mapa médico indisponível.';
      throw error;
    });
  medicalDensityPromises.set(state, promise);
  return promise;
}

async function loadMedicalShapes(uf) {
  const requested = String(uf || '').toUpperCase();
  const state = requested === 'BR' || BRAZIL_UFS.includes(requested) ? requested : 'BR';
  if (medicalShapesCache.has(state)) return medicalShapesCache.get(state);
  if (medicalShapesPromises.has(state)) return medicalShapesPromises.get(state);
  const promise = fetch(`${MEDICAL_SHAPES_BASE_URL}/${state}.json?v=${MARKET_MAP_VERSION}`)
    .then((response) => {
      if (!response.ok) throw new Error('Fronteiras do mapa indisponíveis.');
      return response.json();
    })
    .then((payload) => {
      medicalShapesCache.set(state, payload);
      medicalShapesPromises.delete(state);
      medicalDensityError = '';
      return payload;
    })
    .catch((error) => {
      medicalShapesPromises.delete(state);
      medicalDensityError = error instanceof Error ? error.message : 'Fronteiras do mapa indisponíveis.';
      throw error;
    });
  medicalShapesPromises.set(state, promise);
  return promise;
}

function haversineKm(origin, destination) {
  if (!origin || !destination) return Number.POSITIVE_INFINITY;
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(destination.latitude - origin.latitude);
  const longitudeDelta = radians(destination.longitude - origin.longitude);
  const latitude1 = radians(origin.latitude);
  const latitude2 = radians(destination.latitude);
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function selectedOpportunityMunicipality(directory, profile = professionalProfile) {
  const municipalities = directory?.municipalities || [];
  const byCode = municipalities.find((item) => item.ibgeCode === profile?.opportunityCityCode);
  if (byCode) return byCode;
  const city = normalizeDirectoryText(profile?.opportunityCity || '');
  return city ? municipalities.find((item) => normalizeDirectoryText(item.name) === city) : null;
}

async function opportunityTerritory() {
  const search = ensureMarketplaceSearch();
  const uf = search.uf || professionalProfile?.opportunityUf || professionalProfile?.registrations?.find((item) => item.primary)?.crmUf || 'SP';
  const directory = await loadMunicipalityDirectory(uf);
  const origin = selectedOpportunityMunicipality(directory, { opportunityCityCode: search.cityCode, opportunityCity: search.city });
  const radiusKm = Number(search.radiusKm) || 1000;
  const municipalities = radiusKm >= 1000 || !origin
    ? directory.municipalities
    : directory.municipalities.filter((item) => haversineKm(origin, item) <= radiusKm);
  return { uf, directory, origin, radiusKm, municipalityCodes: municipalities.map((item) => item.ibgeCode) };
}

function publicContractCategory(item) {
  const value = normalizeDirectoryText(`${item?.title || ''} ${(item?.matches || []).join(' ')}`);
  if (/credenciamento|credenciar/.test(value)) return 'credentialing';
  if (/plantao|urgencia|emergencia|pronto atendimento|pronto socorro/.test(value)) return 'shifts';
  if (/diagnost|imagem|radiolog|laborator|exame/.test(value)) return 'diagnostics';
  if (/ocupacional|trabalho|pcmso/.test(value)) return 'occupational';
  if (/telemedicina|telessaude|teleconsulta/.test(value)) return 'telemedicine';
  if (/especializ|cardio|oncolo|neurolog|ortoped|pediatr|ginecolog|psiquiatr/.test(value)) return 'specialized';
  return 'general';
}

function filteredPublicContracts(items = []) {
  const category = appState.marketplace.search.publicCategory || 'all';
  return category === 'all' ? items : items.filter((item) => publicContractCategory(item) === category);
}

function publicContractFiltersMarkup() {
  const search = ensureMarketplaceSearch();
  return `<div class="card market-public-filters"><div class="form-grid"><div class="inline-grid"><label>Estado<select id="marketplace-uf">${ufOptions(search.uf)}</select></label><label>Município-base<select id="marketplace-city"><option value="">${search.city ? escapeHtml(search.city) : 'Todo o estado'}</option></select></label></div><div class="inline-grid"><label>Raio<select id="marketplace-radius"><option value="50" ${search.radiusKm === 50 ? 'selected' : ''}>50 km</option><option value="100" ${search.radiusKm === 100 ? 'selected' : ''}>100 km</option><option value="250" ${search.radiusKm === 250 ? 'selected' : ''}>250 km</option><option value="500" ${search.radiusKm === 500 ? 'selected' : ''}>500 km</option><option value="1000" ${search.radiusKm >= 1000 ? 'selected' : ''}>Todo o estado</option></select></label><label>Tipo de contratação<select id="public-contract-category">${Object.entries(PUBLIC_CONTRACT_CATEGORIES).map(([value, label]) => `<option value="${value}" ${search.publicCategory === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div></div><button class="button primary small" data-action="search-marketplace" type="button">Aplicar filtros</button><p class="field-hint">Busca manual independente. Sua região do perfil permanece reservada aos alertas automáticos.</p></div>`;
}

function persistedMarketCache(search = appState.marketplace.search) {
  try {
    const stored = JSON.parse(localStorage.getItem(MARKET_CACHE_KEY) || '{}');
    return stored.key === `${search.uf}:${search.cityCode}:${search.radiusKm}` ? stored.payload : null;
  } catch { return null; }
}

function savePersistedMarketCache(payload, search = appState.marketplace.search) {
  if (!payload || !(payload.radar?.length || payload.regional?.length)) return;
  try { localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify({ key: `${search.uf}:${search.cityCode}:${search.radiusKm}`, payload })); } catch { /* armazenamento indisponível */ }
}

function addOpportunityDistances(payload, territory) {
  if (!payload || !territory?.origin) return payload;
  const byCode = new Map(territory.directory.municipalities.map((item) => [item.ibgeCode, item]));
  const allowedCodes = new Set(territory.municipalityCodes || []);
  const withDistances = (items = []) => items.map((item) => {
    const destination = byCode.get(String(item.ibgeCode || ''));
    return { ...item, distanceKm: destination ? Math.round(haversineKm(territory.origin, destination)) : null };
  });
  const regional = withDistances(payload.regional).filter((item) => territory.radiusKm >= 1000 || allowedCodes.has(String(item.ibgeCode || '')));
  return {
    ...payload,
    radar: withDistances(payload.radar),
    regional,
    meta: {
      ...(payload.meta || {}),
      regionalScope: territory.radiusKm >= 1000
        ? `${territory.uf} · todo o estado`
        : `${territory.origin.name} · raio territorial de ${territory.radiusKm} km`,
      regionalMunicipalities: territory.radiusKm >= 1000 ? territory.directory.municipalities.length : allowedCodes.size,
    },
  };
}

function medicalMapMarkup(uf) {
  const density = medicalDensityCache.get(uf);
  const nationalDensity = medicalDensityCache.get('BR');
  const shapes = medicalShapesCache.get(uf);
  if (medicalDensityError) return `<div class="notice warning">${escapeHtml(medicalDensityError)}</div>`;
  if (!density || !nationalDensity || !shapes) return '<div class="card intelligence-loading"><span class="sync-spinner" aria-hidden="true"></span><strong>Preparando mapa territorial</strong><p>Carregando fronteiras do IBGE e dados agregados do CNES.</p></div>';
  const specialtyIndex = selectedMedicalMapSpecialty === 'all' ? -1 : Number(selectedMedicalMapSpecialty);
  if (specialtyIndex >= (density.specialtyNames || []).length || specialtyIndex < -1) selectedMedicalMapSpecialty = 'all';
  const effectiveSpecialtyIndex = selectedMedicalMapSpecialty === 'all' ? -1 : Number(selectedMedicalMapSpecialty);
  const title = effectiveSpecialtyIndex >= 0 ? density.specialtyNames[effectiveSpecialtyIndex] : 'Todos os médicos';
  const isBrazil = uf === 'BR';
  const sourceAreas = isBrazil ? density.states || [] : density.municipalities || [];
  const shapeByCode = new Map((shapes.shapes || []).map((item) => [String(item.ibgeCode || item.uf || ''), item.path]));
  const nationalPopulation = Number(nationalDensity.meta?.statePopulation || 0);
  const nationalCount = effectiveSpecialtyIndex >= 0
    ? Number(nationalDensity.stateSpecialties?.[effectiveSpecialtyIndex] || 0)
    : Number(nationalDensity.meta?.uniquePhysicians || 0);
  const benchmarkRate = nationalPopulation > 0 ? nationalCount * 100000 / nationalPopulation : 0;
  const areas = sourceAreas.map((source) => {
    const code = String(source.ibgeCode || source.uf || '');
    const count = effectiveSpecialtyIndex >= 0 ? Number(source.specialties?.[effectiveSpecialtyIndex] || 0) : Number(source.physicians || 0);
    const population = Number(source.population || 0);
    const rate = population > 0 ? count * 100000 / population : 0;
    const concentrationValue = selectedMedicalMapMetric === 'per_100k' ? rate : count;
    const gapRate = Math.max(0, benchmarkRate - rate);
    const estimatedGap = population > 0 ? Math.ceil(gapRate * population / 100000) : 0;
    const scarcity = benchmarkRate > 0 ? Math.min(1, gapRate / benchmarkRate) : 0;
    return { code, name: source.name || source.uf || code, count, population, rate, concentrationValue, estimatedGap, scarcity, path: shapeByCode.get(code) || '' };
  });
  const positive = areas.filter((item) => item.concentrationValue > 0);
  const sortedValues = positive.map((item) => item.concentrationValue).sort((left, right) => left - right);
  const scaleMax = sortedValues[Math.min(sortedValues.length - 1, Math.floor(sortedValues.length * 0.95))] || 1;
  const paths = areas.map((item) => {
    const intensity = selectedMedicalMapLayer === 'scarcity'
      ? item.scarcity
      : item.concentrationValue > 0 ? Math.max(0.08, Math.min(1, Math.log1p(item.concentrationValue) / Math.log1p(scaleMax))) : 0;
    const fill = selectedMedicalMapLayer === 'scarcity'
      ? `rgba(205,38,52,${(0.08 + intensity * 0.84).toFixed(2)})`
      : item.concentrationValue > 0 ? `rgba(0,77,182,${(0.10 + intensity * 0.82).toFixed(2)})` : 'rgba(90,100,114,.08)';
    const measure = `${item.rate.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} por 100 mil hab.`;
    return `<path d="${item.path}" fill="${fill}" fill-rule="evenodd"><title>${escapeHtml(item.name)}: ${measure} · ${item.count.toLocaleString('pt-BR')} profissionais · população ${item.population.toLocaleString('pt-BR')}${item.estimatedGap ? ` · déficit indicativo ${item.estimatedGap.toLocaleString('pt-BR')}` : ''}</title></path>`;
  }).join('');
  const compareValue = (item) => selectedMedicalMapMetric === 'per_100k' ? item.rate : item.count;
  const top = [...areas].filter((item) => item.count > 0).sort((left, right) => compareValue(right) - compareValue(left) || right.population - left.population).slice(0, 8);
  const bottom = [...areas].filter((item) => item.population > 0).sort((left, right) => compareValue(left) - compareValue(right) || right.population - left.population).slice(0, 8);
  const gaps = [...areas].filter((item) => item.estimatedGap > 0).sort((left, right) => right.estimatedGap - left.estimatedGap || left.rate - right.rate).slice(0, 8);
  const specialtyOptions = (density.specialtyNames || []).map((name, index) => ({ name, index })).sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
  const options = `<option value="all">Todos os médicos</option>${specialtyOptions.map((item) => `<option value="${item.index}" ${String(item.index) === selectedMedicalMapSpecialty ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}`;
  const statePopulation = Number(density.meta?.statePopulation || 0);
  const stateCount = effectiveSpecialtyIndex >= 0 ? Number(density.stateSpecialties?.[effectiveSpecialtyIndex] || 0) : Number(density.meta?.uniquePhysicians || 0);
  const stateRate = statePopulation > 0 ? stateCount * 100000 / statePopulation : 0;
  const formatValue = (item) => selectedMedicalMapMetric === 'per_100k'
    ? item.rate.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
    : item.count.toLocaleString('pt-BR');
  const rankingUnit = selectedMedicalMapMetric === 'per_100k' ? 'por 100 mil' : 'profissionais';
  const territoryLabel = isBrazil ? 'estados' : 'municípios';
  const rankingRows = (items, mode = 'value') => items.map((item, index) => `<div><span><b>${index + 1}</b><span><strong>${escapeHtml(item.name)}</strong><small>${item.count.toLocaleString('pt-BR')} profissionais · ${item.population.toLocaleString('pt-BR')} habitantes</small></span></span><em>${mode === 'gap' ? item.estimatedGap.toLocaleString('pt-BR') : formatValue(item)}<small>${mode === 'gap' ? 'déficit indicativo' : rankingUnit}</small></em></div>`).join('') || '<p class="muted">Sem dados suficientes.</p>';
  const specialtyRanking = (density.specialtyNames || []).map((name, index) => {
    const count = Number(density.stateSpecialties?.[index] || 0);
    return { name, count, rate: statePopulation > 0 ? count * 100000 / statePopulation : 0 };
  }).sort((left, right) => selectedSpecialtyRankingOrder === 'asc' ? left.rate - right.rate || right.count - left.count : right.rate - left.rate || right.count - left.count).slice(0, 15);
  const stateOptions = `<option value="BR" ${uf === 'BR' ? 'selected' : ''}>Brasil</option>${BRAZIL_UFS.map((state) => `<option value="${state}" ${state === uf ? 'selected' : ''}>${state}</option>`).join('')}`;
  return `<div class="medical-map-filters"><label>Território<select id="medical-map-uf">${stateOptions}</select></label><label>Especialidade<select id="medical-map-specialty">${options}</select></label><label>Indicador<select id="medical-map-metric"><option value="per_100k" ${selectedMedicalMapMetric === 'per_100k' ? 'selected' : ''}>Profissionais por 100 mil habitantes</option><option value="absolute" ${selectedMedicalMapMetric === 'absolute' ? 'selected' : ''}>Quantidade de profissionais</option></select></label><label>Camada<select id="medical-map-layer"><option value="concentration" ${selectedMedicalMapLayer === 'concentration' ? 'selected' : ''}>Concentração — azul</option><option value="scarcity" ${selectedMedicalMapLayer === 'scarcity' ? 'selected' : ''}>Ausência / déficit — vermelho</option></select></label></div><div class="medical-map-state-summary"><span><small>PROFISSIONAIS ${isBrazil ? 'NO BRASIL' : 'NA UF'}</small><strong>${stateCount.toLocaleString('pt-BR')}</strong></span><span><small>POPULAÇÃO ESTIMADA</small><strong>${statePopulation.toLocaleString('pt-BR')}</strong></span><span><small>PROFISSIONAIS / 100 MIL HAB.</small><strong>${stateRate.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</strong></span></div><div class="card medical-map-card"><svg class="medical-heatmap" viewBox="${escapeHtml(shapes.meta?.viewBox || '0 0 640 440')}" role="img" aria-label="Mapa da ${selectedMedicalMapLayer === 'scarcity' ? 'ausência' : 'concentração'} de ${escapeHtml(title)} em ${escapeHtml(uf)}">${paths}</svg><div class="map-legend ${selectedMedicalMapLayer === 'scarcity' ? 'scarcity' : ''}"><span>${selectedMedicalMapLayer === 'scarcity' ? 'Menor déficit' : 'Menor concentração'}</span><i></i><span>${selectedMedicalMapLayer === 'scarcity' ? 'Maior déficit' : 'Maior concentração'}</span></div></div><div class="medical-map-rankings"><div class="card medical-map-ranking"><h3>Maiores concentrações — ${territoryLabel}</h3>${rankingRows(top)}</div><div class="card medical-map-ranking"><h3>Menores concentrações — ${territoryLabel}</h3>${rankingRows(bottom)}</div><div class="card medical-map-ranking scarcity-ranking"><h3>Maiores bolsões de ausência</h3>${rankingRows(gaps, 'gap')}</div></div><div class="card specialty-rate-ranking"><div class="section-heading"><div><p class="eyebrow">OFERTA RELATIVA</p><h3>Ranking de especialidades por 100 mil habitantes</h3></div><label>Ordenar<select id="medical-specialty-ranking-order"><option value="asc" ${selectedSpecialtyRankingOrder === 'asc' ? 'selected' : ''}>Menor oferta primeiro</option><option value="desc" ${selectedSpecialtyRankingOrder === 'desc' ? 'selected' : ''}>Maior oferta primeiro</option></select></label></div><div class="specialty-rate-list">${specialtyRanking.map((item, index) => `<div><b>${index + 1}</b><span><strong>${escapeHtml(item.name)}</strong><small>${item.count.toLocaleString('pt-BR')} profissionais</small></span><em>${item.rate.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}<small>por 100 mil</small></em></div>`).join('')}</div></div><p class="data-footnote">Fontes: CNES/DATASUS, ${escapeHtml(density.meta?.period || '')}, e estimativa populacional IBGE ${escapeHtml(density.meta?.populationPeriod || '2025')}. O déficit é uma estimativa indicativa: quantidade adicional necessária para alcançar a taxa média nacional da ocupação selecionada. Não representa vaga aberta. Especialidades são ocupações CBO e não equivalem a RQE ativo no CFM.</p>`;
}

async function ensureMarketMapData() {
  const uf = selectedMedicalMapUf || 'BR';
  if (!uf || medicalDensityError || (medicalDensityCache.has(uf) && medicalDensityCache.has('BR') && medicalShapesCache.has(uf))) return;
  try {
    await Promise.all([loadMedicalDensity(uf), loadMedicalDensity('BR'), loadMedicalShapes(uf)]);
  } catch {
    // O erro é renderizado na própria seção do mapa.
  }
  if (currentRoute === 'intelligence') renderIntelligence();
}

function opportunityCard(item) {
  const deadline = item.closesAt ? new Date(item.closesAt).toLocaleDateString('pt-BR') : 'Consulte o edital';
  const matches = Array.isArray(item.matches) && item.matches.length ? `<div class="opportunity-matches">${item.matches.slice(0, 3).map((match) => `<span>${escapeHtml(match)}</span>`).join('')}</div>` : '';
  const distance = Number.isFinite(item.distanceKm) ? ` · ${item.distanceKm.toLocaleString('pt-BR')} km do município-base` : '';
  return `<article class="card opportunity-card"><div class="opportunity-card-head"><span class="source-pill">PNCP</span><small>Encerra em ${escapeHtml(deadline)}</small></div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.organization)}${item.city ? ` · ${escapeHtml(item.city)}/${escapeHtml(item.uf || '')}` : ''}${escapeHtml(distance)}</p>${matches}<div class="opportunity-footer"><span>${item.estimatedValue ? `<small>VALOR ESTIMADO</small><strong>${currency(Math.round(item.estimatedValue * 100))}</strong>` : '<small>VALOR NO EDITAL</small><strong>Consultar</strong>'}</span><a class="button secondary small" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Abrir no PNCP</a></div></article>`;
}

function opportunityList(items, emptyTitle, emptyDescription) {
  if (!items?.length) return emptyCard(emptyTitle, emptyDescription);
  return `<div class="opportunity-list">${items.slice(0, 12).map(opportunityCard).join('')}</div>`;
}

function marketIntelligenceFreshnessMarkup() {
  const meta = marketIntelligenceCache?.meta;
  if (!meta?.fetchedAt) return '';
  const fetchedAt = new Date(meta.fetchedAt);
  const updated = Number.isNaN(fetchedAt.getTime()) ? '' : fetchedAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const inspected = Number(meta.recordsInspected || 0).toLocaleString('pt-BR');
  const total = Number(meta.totalRecordsReported || 0).toLocaleString('pt-BR');
  return `<p class="radar-freshness"><span>Atualizado em ${escapeHtml(updated)}</span><span>${Number(meta.pagesInspected || 0)} amostras distribuídas · ${inspected} de ${total} registros abertos analisados</span></p>`;
}

function isPrivateHealthInstitution(institution) {
  const publicTerms = ['municipio', 'prefeitura', 'secretaria', 'governo', 'estado de', 'fundo municipal', 'ministerio', 'ebserh', 'universidade federal'];
  const identity = normalizeDirectoryText(`${institution.legalName || ''} ${institution.name || ''}`);
  return Boolean(institution.payerCnpj) && !publicTerms.some((term) => identity.includes(term));
}

function privateProspectsMarkup() {
  const search = ensureMarketplaceSearch();
  const uf = search.uf || professionalProfile?.opportunityUf || professionalProfile?.registrations?.find((item) => item.primary)?.crmUf || 'SP';
  const cached = institutionDirectoryCache.get(uf);
  const directory = municipalityDirectoryCache.get(uf);
  if (privateProspectsError) return `<section class="intelligence-section"><div class="section-heading"><div><p class="eyebrow">REDE PRIVADA</p><h2>Potenciais contratantes</h2></div></div><div class="notice warning">${escapeHtml(privateProspectsError)}</div></section>`;
  if (!cached || !directory) return '<section class="intelligence-section"><div class="section-heading"><div><p class="eyebrow">REDE PRIVADA</p><h2>Potenciais contratantes</h2></div></div><div class="card intelligence-loading"><span class="sync-spinner" aria-hidden="true"></span><strong>Mapeando instituições privadas</strong><p>Consultando hospitais, cooperativas e empresas do CNES na sua região.</p></div></section>';
  const origin = selectedOpportunityMunicipality(directory, { opportunityCityCode: search.cityCode, opportunityCity: search.city });
  const radiusKm = Number(search.radiusKm) || 1000;
  const municipalityByCode = new Map(directory.municipalities.map((item) => [item.ibgeCode, item]));
  const categoryPriority = { medical_staffing: 4, health_management: 3, hospital: 2, ambulance: 1 };
  const prospects = cached.institutions.filter(isPrivateHealthInstitution).map((institution) => {
    const destination = municipalityByCode.get(String(institution.ibgeCode || ''));
    const distanceKm = origin && destination ? Math.round(haversineKm(origin, destination)) : null;
    return { ...institution, distanceKm, priority: categoryPriority[institution.category] || 0 };
  }).filter((institution) => radiusKm >= 1000 || !origin || (Number.isFinite(institution.distanceKm) && institution.distanceKm <= radiusKm))
    .sort((left, right) => right.priority - left.priority || Number(left.distanceKm || 0) - Number(right.distanceKm || 0) || left.tradeName.localeCompare(right.tradeName, 'pt-BR'))
    .slice(0, 8);
  const cards = prospects.map((institution) => `<article class="card private-prospect-card"><div><span class="source-pill verified">CNES ${escapeHtml(institution.cnes)}</span><small>${escapeHtml(institution.categoryLabel || institution.typeName)}</small></div><h3>${escapeHtml(institution.tradeName || institution.name)}</h3><p>${escapeHtml(institution.legalName)} · ${escapeHtml(institution.city)}/${escapeHtml(institution.state)}${Number.isFinite(institution.distanceKm) ? ` · ${institution.distanceKm.toLocaleString('pt-BR')} km` : ''}</p><div class="private-prospect-footer"><span><small>CNPJ</small><strong>${formatCnpj(institution.payerCnpj)}</strong></span><button class="button secondary small" data-action="create-workplace-from-prospect" data-id="${escapeHtml(institution.id)}" type="button">Cadastrar local</button></div></article>`).join('');
  return `<section class="intelligence-section"><div class="section-heading"><div><p class="eyebrow">CNES · REDE PRIVADA</p><h2>Potenciais contratantes na sua região</h2><p class="section-subtitle">Hospitais, cooperativas e empresas de saúde para prospecção direta. São instituições ativas no cadastro oficial, não vagas anunciadas.</p></div></div>${cards ? `<div class="private-prospect-list">${cards}</div>` : emptyCard('Nenhuma instituição privada no raio', 'Amplie o raio ou escolha outro município-base no perfil profissional.')}</section>`;
}

async function ensurePrivateProspects() {
  const search = ensureMarketplaceSearch();
  const uf = search.uf || professionalProfile?.opportunityUf || professionalProfile?.registrations?.find((item) => item.primary)?.crmUf || 'SP';
  if (institutionDirectoryCache.has(uf) && municipalityDirectoryCache.has(uf)) return;
  try {
    await Promise.all([loadInstitutionDirectory(uf), loadMunicipalityDirectory(uf)]);
    privateProspectsError = '';
  } catch (error) {
    privateProspectsError = error instanceof Error ? error.message : 'Instituições privadas indisponíveis.';
  }
  if (currentRoute === 'intelligence') renderIntelligence();
}

function newWorkplaceFromProspect(institutionId) {
  const cached = [...institutionDirectoryCache.values()].find((entry) => entry.institutions.some((item) => item.id === institutionId));
  const institution = cached?.institutions.find((item) => item.id === institutionId);
  if (!institution || !canCreateWorkplace()) return;
  pendingInvoiceWorkplaceId = '';
  draftWorkplace = { id: id('work'), name: '', address: '', payerCnpj: '', payerLegalName: '', reconciliationEmail: '', reconciliationCc: '', active: true, modalities: [] };
  editingModalityIndex = null;
  institutionDirectoryState = institution.state;
  institutionDirectory = cached.institutions;
  institutionDirectoryMeta = cached.meta;
  renderWorkplaceModal();
  selectDirectoryInstitution(institutionId);
}

const PNCP_SERVICE_TERMS = [
  'credenciamento medico', 'credenciamento de medicos', 'credenciamento de profissionais medicos',
  'prestacao de servicos medicos', 'prestadores de servicos medicos', 'servicos medicos',
  'servicos de profissionais medicos', 'profissional medico',
  'profissionais medicos', 'plantao medico', 'plantoes medicos', 'equipe medica', 'consulta medica',
  'consultas medicas', 'atendimento medico', 'assistencia medica', 'especialidade medica',
  'especialidades medicas', 'corpo clinico', 'procedimento medico', 'procedimentos medicos',
];

const PNCP_SUPPLY_TERMS = [
  'aquisicao de medicamentos', 'fornecimento de medicamentos', 'material medico hospitalar',
  'materiais medico hospitalares', 'equipamento medico', 'equipamentos medicos',
  'insumos hospitalares', 'reagentes', 'material de consumo', 'locacao de equipamento',
  'manutencao de equipamento',
];

const PNCP_EXCLUDED_SERVICE_TERMS = ['veterinario', 'veterinaria', 'medicina veterinaria', 'caes e gatos', 'odontologico', 'odontologica'];

function pncpSampledPages(totalPages, maximum = 12) {
  const total = Math.max(1, Number(totalPages) || 1);
  const size = Math.min(total, maximum);
  if (size === 1) return [1];
  return [...new Set(Array.from({ length: size }, (_, index) => Math.round(1 + index * (total - 1) / (size - 1))))];
}

async function fetchPncpPublicPage(uf, dataFinal, page) {
  const url = new URL('https://pncp.gov.br/api/consulta/v1/contratacoes/proposta');
  url.searchParams.set('dataFinal', dataFinal);
  url.searchParams.set('uf', uf);
  url.searchParams.set('pagina', String(page));
  url.searchParams.set('tamanhoPagina', '50');
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`PNCP ${response.status}`);
      const body = await response.json();
      return { data: Array.isArray(body.data) ? body.data : [], totalPages: Number(body.totalPaginas) || 1, totalRecords: Number(body.totalRegistros) || 0 };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 350));
    }
  }
  throw lastError || new Error('O PNCP não respondeu à atualização distribuída.');
}

function compactPncpPublicRecord(item, score, matches) {
  const cnpj = String(item.orgaoEntidade?.cnpj || '').replace(/\D/g, '');
  const year = Number(item.anoCompra || 0);
  const sequence = Number(item.sequencialCompra || 0);
  return {
    id: String(item.numeroControlePNCP || `${year}-${sequence}`),
    title: String(item.objetoCompra || 'Contratação pública na área da saúde').slice(0, 1200),
    organization: String(item.orgaoEntidade?.razaoSocial || item.unidadeOrgao?.nomeUnidade || ''),
    cnpj,
    city: String(item.unidadeOrgao?.municipioNome || ''),
    uf: String(item.unidadeOrgao?.ufSigla || ''),
    ibgeCode: String(item.unidadeOrgao?.codigoIbge || ''),
    modality: String(item.modalidadeNome || ''),
    estimatedValue: Number(item.valorTotalEstimado) || null,
    publishedAt: item.dataPublicacaoPncp || null,
    closesAt: item.dataEncerramentoProposta || null,
    pncpNumber: String(item.numeroControlePNCP || ''),
    url: cnpj && year && sequence ? `https://pncp.gov.br/app/editais/${cnpj}/${year}/${sequence}` : 'https://pncp.gov.br/app/editais',
    score,
    matches,
    source: 'PNCP',
  };
}

async function loadPncpPublicCompatibility(territory, authenticatedResponse) {
  const limitDate = new Date();
  limitDate.setUTCDate(limitDate.getUTCDate() + 120);
  const dataFinal = limitDate.toISOString().slice(0, 10).replace(/-/g, '');
  const first = await fetchPncpPublicPage(territory.uf, dataFinal, 1);
  const pages = pncpSampledPages(first.totalPages);
  const remainingPages = pages.filter((page) => page !== 1);
  const settlements = await Promise.allSettled(remainingPages.map((page) => fetchPncpPublicPage(territory.uf, dataFinal, page)));
  const successfulPages = [1, ...remainingPages.filter((_, index) => settlements[index].status === 'fulfilled')];
  const failedPages = remainingPages.filter((_, index) => settlements[index].status === 'rejected');
  const remaining = settlements.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  const records = [first, ...remaining].flatMap((page) => page.data);
  const specialtyTerms = (professionalProfile?.specialties || []).map((specialty) => {
    const normalizedName = normalizeDirectoryText(specialty.name);
    const tokens = normalizedName.split(' ').filter((token) => token.length >= 5 && !['medicina', 'medica', 'medico', 'cirurgia', 'clinica', 'geral'].includes(token));
    return { name: specialty.name, terms: [...new Set([normalizedName, ...tokens])] };
  });
  const ranked = records.map((item) => {
    const text = normalizeDirectoryText(`${item.objetoCompra || ''} ${item.informacaoComplementar || ''} ${item.modalidadeNome || ''}`);
    const serviceMatches = PNCP_SERVICE_TERMS.filter((term) => text.includes(term));
    const supplyMatches = PNCP_SUPPLY_TERMS.filter((term) => text.includes(term));
    const excludedMatches = PNCP_EXCLUDED_SERVICE_TERMS.filter((term) => text.includes(term));
    const specialtyMatches = specialtyTerms.filter((specialty) => specialty.terms.some((term) => text.includes(term)));
    const sameCity = normalizeDirectoryText(item.unidadeOrgao?.municipioNome || '') === normalizeDirectoryText(professionalProfile?.opportunityCity || '');
    const score = Math.min(5, serviceMatches.length) + (specialtyMatches.length ? 7 + Math.min(4, specialtyMatches.length - 1) : 0) + (sameCity ? 4 : 0);
    const matches = [...specialtyMatches.map((specialty) => specialty.name), ...(sameCity ? [`Mesmo município: ${item.unidadeOrgao?.municipioNome}`] : []), ...(!specialtyMatches.length && serviceMatches.length ? ['Compatível com CRM sem especialidade exigida'] : [])];
    const excluded = excludedMatches.length > 0 || (supplyMatches.length > 0 && serviceMatches.length === 0);
    return { item, serviceMatches, specialtyMatches, excluded, score, matches };
  });
  const health = ranked.filter((entry) => (entry.serviceMatches.length || entry.specialtyMatches.length) && !entry.excluded);
  const allowedMunicipalities = new Set(territory.municipalityCodes || []);
  const byDeadline = (left, right) => Date.parse(left.item.dataEncerramentoProposta || '') - Date.parse(right.item.dataEncerramentoProposta || '') || right.score - left.score;
  const radar = [...health].sort(byDeadline).slice(0, 30).map((entry) => compactPncpPublicRecord(entry.item, entry.score, entry.matches));
  const regional = [...health]
    .filter((entry) => (!specialtyTerms.length || entry.specialtyMatches.length) && (territory.radiusKm >= 1000 || allowedMunicipalities.has(String(entry.item.unidadeOrgao?.codigoIbge || ''))))
    .sort((left, right) => right.score - left.score || byDeadline(left, right))
    .slice(0, 20)
    .map((entry) => compactPncpPublicRecord(entry.item, entry.score, entry.matches));
  return {
    ...authenticatedResponse,
    radar,
    regional,
    meta: {
      ...(authenticatedResponse.meta || {}),
      fetchedAt: new Date().toISOString(),
      recordsInspected: records.length,
      totalRecordsReported: first.totalRecords,
      pagesInspected: successfulPages.length,
      sampledPages: successfulPages,
      failedPages,
      truncated: first.totalPages > successfulPages.length,
      compatibilityMode: true,
    },
  };
}

async function loadMarketIntelligence(force = false) {
  if (!isCloudMode() || !professionalProfile?.registrations?.length || marketIntelligenceLoading) return;
  if (!marketIntelligenceCache) marketIntelligenceCache = persistedMarketCache();
  if (marketIntelligenceCache && !force) return;
  marketIntelligenceLoading = true;
  marketIntelligenceError = '';
  if (currentRoute === 'intelligence') renderIntelligence();
  let territory = null;
  try {
    territory = await opportunityTerritory();
    let response = await cloud.marketIntelligence({
      originCityCode: territory.origin?.ibgeCode || '',
      municipalityCodes: territory.municipalityCodes,
    });
    if (!Array.isArray(response?.meta?.sampledPages)) {
      try {
        response = await loadPncpPublicCompatibility(territory, response);
      } catch {
        // Preserva a resposta autenticada existente se a API pública estiver temporariamente indisponível.
      }
    }
    const fresh = addOpportunityDistances(response, territory);
    if (fresh?.radar?.length || fresh?.regional?.length || !marketIntelligenceCache) marketIntelligenceCache = fresh;
    savePersistedMarketCache(marketIntelligenceCache);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Não foi possível consultar o radar.';
    const activeAccount = cloudAccount?.profile?.role === 'admin' || cloudAccount?.profile?.accessStatus === 'active';
    let recovered = false;
    if (territory && activeAccount) {
      try {
        const response = await loadPncpPublicCompatibility(territory, { radar: [], regional: [], meta: { source: 'Portal Nacional de Contratações Públicas (PNCP)' } });
        marketIntelligenceCache = addOpportunityDistances(response, territory);
        marketIntelligenceError = '';
        recovered = true;
      } catch {
        // A indisponibilidade simultânea da função e do PNCP é tratada abaixo.
      }
    }
    if (!recovered && marketIntelligenceCache) {
      marketIntelligenceError = '';
      showToast(`${message} Exibindo a última atualização disponível.`);
    } else if (!recovered) marketIntelligenceError = message;
  } finally {
    marketIntelligenceLoading = false;
    if (currentRoute === 'intelligence') renderIntelligence();
  }
}

function renderIntelligence() {
  const concentration = incomeConcentration();
  const primary = professionalProfile?.registrations?.find((item) => item.primary) || professionalProfile?.registrations?.[0];
  const specialties = professionalProfile?.specialties || [];
  const concentrationLabel = concentration.topShare >= 0.6 ? 'Alta dependência' : concentration.topShare >= 0.4 ? 'Atenção à concentração' : concentration.byWorkplace.length ? 'Receita diversificada' : 'Sem base suficiente';
  const concentrationClass = concentration.topShare >= 0.6 ? 'risk' : concentration.topShare >= 0.4 ? 'warning' : 'healthy';
  const profileMarkup = professionalProfileLoading
    ? '<div class="card intelligence-loading">Carregando perfil profissional…</div>'
    : `<div class="card professional-summary"><div><span class="source-pill ${primary?.status?.startsWith('verified') ? 'verified' : ''}">${primary?.status?.startsWith('verified') ? 'VERIFICADO' : 'INFORMADO PELO MÉDICO'}</span><h2>${primary ? `CRM ${escapeHtml(primary.crmNumber)}/${escapeHtml(primary.crmUf)}` : 'Cadastre seu CRM'}</h2><p>${specialties.length ? specialties.map((item) => escapeHtml(item.name)).join(' · ') : 'Sem especialidade registrada. O radar exibirá oportunidades que aceitam CRM sem RQE específico.'}</p></div><button class="button secondary small" data-action="edit-professional-profile" type="button">${primary ? 'Editar perfil' : 'Completar perfil'}</button></div>`;
  const radarMarkup = marketIntelligenceLoading
    ? '<div class="card intelligence-loading"><span class="sync-spinner" aria-hidden="true"></span><strong>Consultando o PNCP</strong><p>Buscando contratações públicas abertas na sua UF.</p></div>'
    : marketIntelligenceError
      ? `<div class="notice warning">${escapeHtml(marketIntelligenceError)} <button class="link-button" data-action="refresh-market-intelligence" type="button">Tentar novamente</button></div>`
      : primary
        ? opportunityList(filteredPublicContracts(marketIntelligenceCache?.radar), 'Nenhuma contratação compatível agora', 'Altere o tipo, município ou raio e tente novamente.')
        : emptyCard('CRM necessário', 'Cadastre o CRM principal para definir a UF da busca.');
  const regionalMarkup = primary
    ? opportunityList(filteredPublicContracts(marketIntelligenceCache?.regional), 'Nenhuma correspondência por especialidade', specialties.length ? 'Não encontramos editais compatíveis nesta atualização.' : 'Oportunidades sem exigência de especialidade aparecerão aqui.')
    : emptyCard('Perfil incompleto', 'Informe seu CRM e, se houver, suas especialidades.');
  const searchRegion = ensureMarketplaceSearch();
  const regionDescription = searchRegion.city
    ? `${searchRegion.city}/${searchRegion.uf} · ${Number(searchRegion.radiusKm) >= 1000 ? 'todo o estado' : `raio de ${searchRegion.radiusKm || 100} km`}`
    : `${searchRegion.uf || primary?.crmUf || ''} · todo o estado`;
  const uf = selectedMedicalMapUf || professionalProfile?.opportunityUf || primary?.crmUf || 'SP';
  if (!selectedMedicalMapUf) selectedMedicalMapUf = uf;
  screen.innerHTML = `<div class="screen-stack intelligence-page">${pageHeading('Dados para decidir melhor', 'Inteligência de mercado', 'Transforme seus registros e fontes públicas em sinais de concentração e novas oportunidades.')}${profileMarkup}<section class="intelligence-section"><div class="section-heading"><div><p class="eyebrow">SEUS DADOS</p><h2>Mapa da concentração de renda</h2></div><span class="concentration-status ${concentrationClass}">${concentrationLabel}</span></div><div class="intelligence-kpis"><div class="card"><small>HONORÁRIOS REGISTRADOS</small><strong>${currency(concentration.total)}</strong></div><div class="card"><small>MAIOR PAGADOR</small><strong>${Math.round(concentration.topShare * 100)}%</strong></div><div class="card"><small>FONTES DE RECEITA</small><strong>${concentration.byWorkplace.length}</strong></div></div><div class="intelligence-grid"><div class="card"><h3>Por pagador</h3>${concentrationBars(concentration.byWorkplace, 'Registre atendimentos para formar o mapa.')}</div><div class="card"><h3>Por município</h3>${concentrationBars(concentration.byRegion, 'O município aparecerá quando estiver informado no local de trabalho.')}</div></div><p class="data-footnote">Cálculo feito apenas com os honorários registrados na sua conta. Valores recebidos e a receber são mantidos separados no Dashboard.</p></section><section class="intelligence-section"><div class="section-heading"><div><p class="eyebrow">CNES + IBGE</p><h2>Concentração de médicos e especialidades</h2></div><span class="source-pill">${escapeHtml(uf)}</span></div>${medicalMapMarkup(uf)}</section><section class="intelligence-section"><div class="section-heading"><div><p class="eyebrow">FONTE PÚBLICA</p><h2>Radar de contratações públicas</h2></div><button class="link-button" data-action="refresh-market-intelligence" type="button">Atualizar</button></div>${radarMarkup}</section><section class="intelligence-section"><div class="section-heading"><div><p class="eyebrow">RAIO DE INTERESSE</p><h2>Oportunidades regionais</h2><p class="section-subtitle">${escapeHtml(regionDescription)}</p></div></div>${regionalMarkup}</section><section class="intelligence-section"><div class="section-heading"><div><p class="eyebrow">EMPRESAS PRIVADAS</p><h2>Vagas oficiais no SINE</h2></div></div><div class="card private-opportunities-card"><div><span class="source-pill verified">SERVIÇO OFICIAL</span><h3>Emprega Brasil e Carteira de Trabalho Digital</h3><p>Empresas privadas registram vagas no SINE. A consulta e a candidatura exigem acesso gov.br e permanecem no ambiente oficial.</p></div><a class="button secondary" href="https://www.gov.br/pt-br/servicos/buscar-emprego-no-sistema-nacional-de-emprego-sine" target="_blank" rel="noopener">Consultar vagas privadas</a></div></section><details class="card intelligence-method"><summary>Como os resultados são classificados</summary><p>O município é escolhido na lista oficial do IBGE. O raio usa a distância territorial entre os centroides municipais e limita de fato a lista regional; o GPS do aparelho não é consultado.</p><p>Contratações públicas vêm do PNCP. As vagas privadas são consultadas no SINE com acesso gov.br; a antiga API SINE Aberto foi descontinuada, então o MedRecebe direciona ao serviço oficial em vez de prometer um feed nacional inexistente.</p></details></div>`;
  const obsoletePrivateSection = screen.querySelector('a[href*="buscar-emprego-no-sistema-nacional-de-emprego-sine"]')?.closest('.intelligence-section');
  if (obsoletePrivateSection) obsoletePrivateSection.outerHTML = privateProspectsMarkup();
  const radarHeading = screen.querySelector('[data-action="refresh-market-intelligence"]')?.closest('.section-heading');
  if (radarHeading) radarHeading.insertAdjacentHTML('afterend', publicContractFiltersMarkup());
  const radarFreshness = marketIntelligenceFreshnessMarkup();
  if (radarHeading && radarFreshness) radarHeading.insertAdjacentHTML('afterend', radarFreshness);
  const method = screen.querySelector('.intelligence-method');
  if (method) method.innerHTML = '<summary>Como os resultados são classificados</summary><p>O município é escolhido na lista oficial do IBGE. O raio usa a distância territorial entre os centroides municipais e limita de fato a lista regional; o GPS do aparelho não é consultado.</p><p>As contratações abertas vêm do PNCP e passam por filtros de prestação de serviços médicos. A rede privada mostra potenciais contratantes ativos no CNES para prospecção direta; não é apresentada como vaga anunciada.</p>';
  if (!professionalProfile && isCloudMode() && !professionalProfileLoading) {
    professionalProfileLoading = true;
    cloud.professionalProfile({ action: 'get' }).then((result) => {
      professionalProfile = result.professional || { registrations: [], specialties: [] };
    }).catch((error) => {
      professionalProfileError = error instanceof Error ? error.message : 'Perfil profissional indisponível.';
    }).finally(() => {
      professionalProfileLoading = false;
      if (currentRoute === 'intelligence') renderIntelligence();
    });
  } else if (primary && !marketIntelligenceCache && !marketIntelligenceLoading && !marketIntelligenceError) void loadMarketIntelligence();
  void ensureMarketMapData();
  if (primary) void ensurePrivateProspects();
  void populateMarketplaceMunicipalities();
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
      return `<article class="card workplace-summary"><div class="card-head"><span class="round-icon">⌂</span><div><h3>${escapeHtml(workplace.name)}</h3><p>${escapeHtml(workplace.payerLegalName || 'Razão Social não informada')}<br/>${workplace.payerCnpj ? `CNPJ ${formatCnpj(workplace.payerCnpj)}` : 'CNPJ não informado'}<br/>${escapeHtml(workplace.address || 'Endereço não informado')}</p></div><span class="badge ${workplace.active ? '' : 'inactive'}">${workplace.active ? 'Ativo' : 'Inativo'}</span></div><div class="modality-lines">${modes || '<p class="muted">Nenhuma modalidade cadastrada.</p>'}${remaining ? `<p class="field-hint">+ ${remaining} ${remaining === 1 ? 'modalidade cadastrada' : 'modalidades cadastradas'}</p>` : ''}</div><div class="row-actions"><button class="button secondary small" data-action="edit-workplace" data-id="${workplace.id}" type="button">Editar</button><button class="button secondary small" data-action="toggle-workplace" data-id="${workplace.id}" type="button">${workplace.active ? 'Desativar' : 'Reativar'}</button><button class="danger-link" data-action="delete-workplace" data-id="${workplace.id}" type="button">Excluir</button></div></article>`;
    })
    .join('');
  const freemiumLimitReached = isFreemiumAccount() && appState.workplaces.length >= 1;
  const planNotice = isFreemiumAccount()
    ? `<div class="notice"><strong>Plano Freemium: ${Math.min(appState.workplaces.length, 1)} de 1 local utilizado</strong><br/>Você pode editar este local livremente ou migrar para o plano completo para cadastrar locais ilimitados.</div>`
    : '';
  const primaryAction = freemiumLimitReached
    ? '<button class="button primary" data-action="upgrade-plan" type="button">Cadastrar mais locais</button>'
    : '<button class="button primary" data-action="new-workplace" type="button">Adicionar local</button>';
  screen.innerHTML = `<div class="screen-stack">${pageHeading('', 'Locais e modalidades', 'Cadastre, consulte, edite ou exclua pagadores e suas regras de atendimento.')}${planNotice}${primaryAction}<div class="list">${cards || emptyCard('Comece pelo primeiro local', 'Cadastre o pagador e suas modalidades.')}</div></div>`;
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
  const attendancePageHeading = screen.querySelector('#attendance-form .page-heading');
  if (attendancePageHeading) attendancePageHeading.insertAdjacentHTML('beforeend', `<p class="page-subtitle">${editingAttendanceId ? 'Editando registro de atendimento' : 'Novo registro de atendimento'}</p>`);
  const attendanceHistoryHeading = screen.querySelector('.attendance-history-section .section-title');
  if (attendanceHistoryHeading) {
    attendanceHistoryHeading.textContent = 'Registros de atendimentos';
    attendanceHistoryHeading.insertAdjacentHTML('afterend', '<p class="field-hint">Consulte os detalhes e use Editar ou Excluir para corrigir qualquer lançamento.</p>');
  }
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

const BRAZIL_UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

function ufOptions(selected = '') {
  return `<option value="">UF</option>${BRAZIL_UFS.map((uf) => `<option value="${uf}" ${uf === selected ? 'selected' : ''}>${uf}</option>`).join('')}`;
}

function openProfessionalProfileModal() {
  const primary = professionalProfile?.registrations?.find((item) => item.primary) || professionalProfile?.registrations?.[0] || {};
  professionalDraft = {
    crmUf: primary.crmUf || 'SP',
    crmNumber: primary.crmNumber || '',
    opportunityUf: professionalProfile?.opportunityUf || primary.crmUf || 'SP',
    opportunityCity: professionalProfile?.opportunityCity || '',
    opportunityCityCode: professionalProfile?.opportunityCityCode || '',
    opportunityRadiusKm: professionalProfile?.opportunityRadiusKm || 100,
    opportunityAlertsEnabled: professionalProfile?.opportunityAlertsEnabled ?? true,
    companyAlertsEnabled: professionalProfile?.companyAlertsEnabled ?? true,
    publicContractAlertsEnabled: professionalProfile?.publicContractAlertsEnabled ?? true,
    specialties: structuredClone(professionalProfile?.specialties || []),
  };
  renderProfessionalProfileModal();
  void loadMedicalSpecialties()
    .then(() => {
      if (professionalDraft && $('#professional-specialty')) populateSpecialtySelect($('#professional-specialty'));
    })
    .catch(() => {});
}

function preserveProfessionalDraft() {
  if (!professionalDraft || !$('#professional-crm-number')) return;
  professionalDraft.crmUf = $('#professional-crm-uf').value;
  professionalDraft.crmNumber = normalizeCrmNumber($('#professional-crm-number').value);
  professionalDraft.opportunityUf = $('#professional-opportunity-uf').value;
  const municipalitySelect = $('#professional-opportunity-city');
  professionalDraft.opportunityCityCode = municipalitySelect?.value || '';
  professionalDraft.opportunityCity = municipalitySelect?.selectedOptions?.[0]?.dataset?.name || '';
  professionalDraft.opportunityRadiusKm = Number($('#professional-radius').value) || 100;
  professionalDraft.opportunityAlertsEnabled = Boolean($('#professional-alerts-enabled')?.checked);
  professionalDraft.companyAlertsEnabled = Boolean($('#professional-company-alerts')?.checked);
  professionalDraft.publicContractAlertsEnabled = Boolean($('#professional-public-alerts')?.checked);
}

async function populateOpportunityMunicipalities() {
  const select = $('#professional-opportunity-city');
  if (!select || !professionalDraft?.opportunityUf) return;
  select.disabled = true;
  select.innerHTML = '<option value="">Carregando municípios…</option>';
  try {
    const directory = await loadMunicipalityDirectory(professionalDraft.opportunityUf);
    if (!$('#professional-opportunity-city') || !professionalDraft) return;
    const selectedCode = professionalDraft.opportunityCityCode || selectedOpportunityMunicipality(directory, professionalDraft)?.ibgeCode || '';
    select.innerHTML = `<option value="">Selecione o município-base</option>${directory.municipalities.map((item) => `<option value="${item.ibgeCode}" data-name="${escapeHtml(item.name)}" ${item.ibgeCode === selectedCode ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}`;
    select.disabled = false;
    const selected = directory.municipalities.find((item) => item.ibgeCode === selectedCode);
    if (selected) {
      professionalDraft.opportunityCityCode = selected.ibgeCode;
      professionalDraft.opportunityCity = selected.name;
    }
  } catch {
    select.innerHTML = '<option value="">Não foi possível carregar os municípios</option>';
    select.disabled = false;
  }
}

function renderProfessionalProfileModal() {
  if (!professionalDraft) return;
  const specialties = professionalDraft.specialties.map((item, index) => `<div class="editor-row specialty-editor-row"><span><strong>${escapeHtml(item.name)}</strong><small>${item.rqeNumber ? `RQE ${escapeHtml(item.rqeNumber)}` : 'RQE não informado'} · ${item.status === 'verified' ? 'Verificado no CFM' : 'Informado pelo médico'}</small></span><button class="danger-link" data-action="remove-professional-specialty" data-index="${index}" type="button">Excluir</button></div>`).join('');
  modalRoot.innerHTML = `<div class="modal-wrap"><section class="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="professional-title"><header class="modal-header simple"><span></span><h2 id="professional-title">Perfil profissional</h2><button data-action="close-modal" aria-label="Fechar" type="button">×</button></header><div class="modal-body"><div class="form-grid"><div class="crm-fields"><label>UF do CRM<select id="professional-crm-uf">${ufOptions(professionalDraft.crmUf)}</select></label><label>CRM principal<input id="professional-crm-number" value="${escapeHtml(professionalDraft.crmNumber)}" inputmode="text" maxlength="13" placeholder="123456"/></label></div><div class="notice"><strong>Verificação com fonte oficial</strong><br/>O CRM e as especialidades informadas ficam identificados como autodeclarados até a conferência pelo webservice oficial do CFM. <a href="https://portal.cfm.org.br/busca-medicos/" target="_blank" rel="noopener">Consultar no CFM</a>.</div><h3>Especialidades</h3><div class="inline-grid"><label>Especialidade<select id="professional-specialty"><option value="">Selecione</option></select></label><label>RQE (opcional)<input id="professional-rqe" inputmode="numeric" maxlength="12" placeholder="Número do RQE"/></label></div><button class="button secondary small" data-action="add-professional-specialty" type="button">Adicionar especialidade</button><div class="modalities-editor professional-specialties-editor">${specialties || '<div class="notice warning">Sem especialidade cadastrada. O CRM continuará sendo usado para vagas generalistas.</div>'}</div><h3>Região de alertas automáticos</h3><div class="inline-grid"><label>UF<select id="professional-opportunity-uf">${ufOptions(professionalDraft.opportunityUf)}</select></label><label>Município-base<select id="professional-opportunity-city"><option value="">Carregando municípios…</option></select></label></div><label>Raio dos alertas<select id="professional-radius"><option value="50" ${professionalDraft.opportunityRadiusKm === 50 ? 'selected' : ''}>50 km</option><option value="100" ${professionalDraft.opportunityRadiusKm === 100 ? 'selected' : ''}>100 km</option><option value="250" ${professionalDraft.opportunityRadiusKm === 250 ? 'selected' : ''}>250 km</option><option value="500" ${professionalDraft.opportunityRadiusKm === 500 ? 'selected' : ''}>500 km</option><option value="1000" ${professionalDraft.opportunityRadiusKm === 1000 ? 'selected' : ''}>Todo o estado</option></select></label><div class="profile-alert-choices"><label class="toggle-choice"><input id="professional-alerts-enabled" type="checkbox" ${professionalDraft.opportunityAlertsEnabled ? 'checked' : ''}/><span><strong>Ativar alertas regionais</strong><small>Usar esta região para novidades relevantes.</small></span></label><label class="toggle-choice"><input id="professional-company-alerts" type="checkbox" ${professionalDraft.companyAlertsEnabled ? 'checked' : ''}/><span><strong>Novos potenciais contratantes</strong><small>Avisar quando uma instituição nova for identificada.</small></span></label><label class="toggle-choice"><input id="professional-public-alerts" type="checkbox" ${professionalDraft.publicContractAlertsEnabled ? 'checked' : ''}/><span><strong>Licitações e contratações públicas</strong><small>Avisar quando houver nova oportunidade compatível.</small></span></label></div><p class="field-hint">O GPS do aparelho não é utilizado. As buscas manuais possuem filtros independentes.</p></div><div class="modal-final-actions"><button class="button primary" data-action="save-professional-profile" type="button">Salvar perfil</button><button class="button secondary" data-action="close-modal" type="button">Cancelar</button></div></div></section></div>`;
  populateSpecialtySelect($('#professional-specialty'));
  void populateOpportunityMunicipalities();
}

async function saveProfessionalProfile(button) {
  preserveProfessionalDraft();
  if (!professionalDraft.crmUf) return showToast('Selecione a UF do CRM.');
  if (!/^(EME)?[0-9]{1,10}P?$/.test(professionalDraft.crmNumber)) return showToast('Informe um CRM válido.');
  if (!professionalDraft.opportunityUf) return showToast('Selecione a UF das oportunidades.');
  if (professionalDraft.opportunityRadiusKm < 1000 && !professionalDraft.opportunityCityCode) return showToast('Selecione o município-base do raio.');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Salvando…';
  try {
    if (isCloudMode()) {
      const result = await cloud.professionalProfile({ action: 'save', ...professionalDraft });
      professionalProfile = result.professional;
    } else {
      professionalProfile = { opportunityCity: professionalDraft.opportunityCity, opportunityCityCode: professionalDraft.opportunityCityCode, opportunityUf: professionalDraft.opportunityUf, opportunityRadiusKm: professionalDraft.opportunityRadiusKm, opportunityAlertsEnabled: professionalDraft.opportunityAlertsEnabled, companyAlertsEnabled: professionalDraft.companyAlertsEnabled, publicContractAlertsEnabled: professionalDraft.publicContractAlertsEnabled, registrations: [{ crmUf: professionalDraft.crmUf, crmNumber: professionalDraft.crmNumber, primary: true, status: 'self_reported' }], specialties: professionalDraft.specialties };
    }
    professionalDraft = null;
    marketIntelligenceCache = null;
    marketIntelligenceError = '';
    modalRoot.innerHTML = '';
    renderRoute();
    showToast('Perfil profissional atualizado.');
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Não foi possível salvar o perfil.');
    button.disabled = false;
    button.textContent = original;
  }
}

function fiscalStatusLabel(status) {
  return {
    not_started: ['Pendente', 'inactive'],
    agreement_generated: ['Aguardando assinatura', 'inactive'],
    agreement_signed: ['Contrato assinado', ''],
    authorization_pending: ['Autorização pendente', 'inactive'],
    ready_for_pilot: ['Pronto para homologação', ''],
  }[status] || ['Pendente', 'inactive'];
}

function renderFiscalIntegration() {
  const fiscalRoot = appState.fiscalIntegration || emptyState().fiscalIntegration;
  const fiscalWorkplaces = appState.workplaces.filter((item) => cnpjDigits(item.payerCnpj).length === 14);
  if (!fiscalRoot.selectedWorkplaceId || !fiscalWorkplaces.some((item) => item.id === fiscalRoot.selectedWorkplaceId)) fiscalRoot.selectedWorkplaceId = fiscalWorkplaces[0]?.id || '';
  const selectedFiscalWorkplace = fiscalWorkplaces.find((item) => item.id === fiscalRoot.selectedWorkplaceId) || null;
  const savedConnection = fiscalRoot.connections.find((item) => item.workplaceId === selectedFiscalWorkplace?.id);
  const fiscal = savedConnection ? { ...fiscalRoot, ...savedConnection } : fiscalRoot;
  const [statusLabel, statusClass] = fiscalStatusLabel(fiscal.status);
  const signed = fiscal.status === 'agreement_signed' || fiscal.status === 'authorization_pending' || fiscal.status === 'ready_for_pilot';
  const agreementSummary = fiscal.agreementAcceptedAt
    ? `<div class="card fiscal-agreement-summary"><span class="round-icon">✓</span><div><strong>Aceite registrado</strong><p>${escapeHtml(fiscal.agreementSigner)} · ${new Date(fiscal.agreementAcceptedAt).toLocaleString('pt-BR')} · documento final ${escapeHtml(fiscal.subjectLast4 || '----')}</p></div><span class="badge ${statusClass}">${escapeHtml(statusLabel)}</span></div>`
    : '';
  const uploadMarkup = fiscal.agreementAcceptedAt
    ? `<section class="card fiscal-step"><span class="fiscal-step-number">2</span><div><h2>Assine e devolva o PDF</h2><p>Abra o portal oficial, assine o arquivo baixado e anexe o PDF assinado. Não imprima o documento depois da assinatura, pois isso remove a assinatura digital.</p><div class="fiscal-actions"><a class="button secondary" href="${GOVBR_SIGNATURE_URL}" target="_blank" rel="noopener">Abrir Assinaturas GOV.BR</a><label class="button primary file-button">${signed ? 'Substituir PDF assinado' : 'Anexar PDF assinado'}<input id="fiscal-signed-file" type="file" accept="application/pdf,.pdf" /></label></div>${fiscal.signedDocumentName ? `<p class="field-hint">Documento protegido: ${escapeHtml(fiscal.signedDocumentName)}</p>` : ''}</div></section>`
    : '';
  const authorizationMarkup = signed
    ? `<section class="card fiscal-step"><span class="fiscal-step-number">3</span><div><h2>Conceda o escopo necessário na Receita Federal</h2><p>A autorização é feita no canal oficial, com conta GOV.BR prata ou ouro. Confira o representante, limite os serviços e defina um prazo. Não conceda poderes genéricos.</p><div class="notice warning"><strong>Conector ainda em homologação</strong><br/>A assinatura e a autorização não iniciam coleta automática. A sincronização será ativada somente após validação do representante, do provedor fiscal e do escopo técnico.</div><a class="button secondary" href="${RFB_AUTHORIZATION_URL}" target="_blank" rel="noopener">Abrir Autorizações de Acesso</a></div></section>`
    : '';
  screen.innerHTML = `<div class="screen-stack fiscal-page">${pageHeading('Conexão protegida', 'Integração fiscal e e-CAC', 'Prepare a autorização para importar e conferir documentos fiscais sem compartilhar sua senha.')}
    <div class="notice success"><strong>Suas credenciais permanecem fora do MedRecebe</strong><br/>Nunca solicitamos senha GOV.BR, senha do e-CAC, código de autenticação ou chave privada do certificado.</div>
    ${agreementSummary}
    <section class="card fiscal-step"><span class="fiscal-step-number">1</span><div><h2>Leia e gere o termo</h2><p>O aceite registra a versão do termo e gera um PDF para assinatura. O número completo é usado somente para montar o arquivo e não é salvo no estado da aplicação.</p><div class="form-grid fiscal-agreement-form"><label>Documento fiscal<select id="fiscal-subject-type"><option value="cnpj" ${fiscal.subjectType === 'cnpj' ? 'selected' : ''}>CNPJ prestador</option><option value="cpf" ${fiscal.subjectType === 'cpf' ? 'selected' : ''}>CPF prestador</option></select></label><label>Número do documento<input id="fiscal-subject" inputmode="numeric" autocomplete="off" placeholder="${fiscal.subjectType === 'cpf' ? '000.000.000-00' : '00.000.000/0000-00'}" /></label><label>Nome completo do signatário<input id="fiscal-signer" autocomplete="name" value="${escapeHtml(fiscal.agreementSigner || appState.profile?.name || '')}" /></label><label class="toggle-choice"><input id="fiscal-confidentiality-accept" type="checkbox"/><span><strong>Li e aceito o termo de confidencialidade</strong><small>Versão ${FISCAL_AGREEMENT_VERSION}</small></span></label><label class="toggle-choice"><input id="fiscal-minimum-scope" type="checkbox"/><span><strong>Usarei o menor escopo necessário</strong><small>Não concederei poderes ou serviços alheios à conciliação fiscal.</small></span></label></div><div class="fiscal-actions"><a class="button secondary" href="confidencialidade-fiscal.html" target="_blank" rel="noopener">Ler termo completo</a><button class="button primary" data-action="download-fiscal-agreement" type="button">Gerar contrato em PDF</button></div></div></section>
    ${uploadMarkup}${authorizationMarkup}
    <details class="card intelligence-method"><summary>Por que não existe um botão de login no e-CAC?</summary><p>O canal correto é uma Autorização de Acesso limitada ou um conector fiscal homologado. Automatizar a tela do e-CAC ou guardar senha GOV.BR seria frágil e incompatível com o nível de proteção exigido para dados fiscais.</p></details></div>`;
  const fiscalPjMarkup = fiscalWorkplaces.length
    ? `<section class="fiscal-pj-list"><div class="section-heading"><div><p class="eyebrow">CONEXÕES POR PJ</p><h2>Empresas prestadoras cadastradas</h2><p class="section-subtitle">Cada CNPJ possui aceite, assinatura, autorização e checkpoint de XML próprios.</p></div></div><div class="fiscal-pj-grid">${fiscalWorkplaces.map((workplace) => { const connection = fiscalRoot.connections.find((item) => item.workplaceId === workplace.id); const [label, style] = fiscalStatusLabel(connection?.status || 'not_started'); return `<button class="card fiscal-pj-card ${workplace.id === selectedFiscalWorkplace?.id ? 'selected' : ''}" data-action="select-fiscal-workplace" data-id="${workplace.id}" type="button"><span><strong>${escapeHtml(workplace.name)}</strong><small>${escapeHtml(workplace.payerLegalName || '')}<br/>CNPJ ${formatCnpj(workplace.payerCnpj)}</small></span><span class="badge ${style}">${escapeHtml(label)}</span></button>`; }).join('')}</div></section>`
    : emptyCard('Cadastre uma PJ prestadora', 'Informe o CNPJ em Locais e modalidades para preparar a importação automática de XML.', '<button class="button primary small" data-nav="workplaces" type="button">Abrir Locais e modalidades</button>');
  screen.querySelector('.notice.success')?.insertAdjacentHTML('afterend', fiscalPjMarkup);
  const subjectInput = $('#fiscal-subject');
  if (subjectInput && selectedFiscalWorkplace) subjectInput.value = formatCnpj(selectedFiscalWorkplace.payerCnpj);
  const firstStepTitle = screen.querySelector('.fiscal-step h2');
  if (firstStepTitle) firstStepTitle.textContent = 'Leia e gere o termo desta PJ';
  if (signed) screen.querySelector('.intelligence-method')?.insertAdjacentHTML('beforebegin', '<section class="card fiscal-step"><span class="fiscal-step-number">4</span><div><h2>Recebimento automático do XML</h2><p>Após homologação, o conector consulta a distribuição de documentos por NSU, valida assinatura e estrutura do XML, evita duplicidades e relaciona o CNPJ do pagador aos atendimentos desta PJ.</p><div class="fiscal-xml-flow"><span>ADN/NFS-e</span><b>→</b><span>Validação</span><b>→</b><span>Cofre privado</span><b>→</b><span>Conciliação</span></div><p class="field-hint">Aguardando credencial fiscal ou provedor homologado. Nenhuma coleta automática está ativa ainda.</p></div></section>');
}

function fiscalSubjectLabel(type, digits) {
  const last4 = digits.slice(-4);
  return `${type === 'cpf' ? 'CPF' : 'CNPJ'} final ${last4}`;
}

async function downloadFiscalAgreement() {
  const type = $('#fiscal-subject-type')?.value === 'cpf' ? 'cpf' : 'cnpj';
  const digits = type === 'cpf' ? onlyDigits($('#fiscal-subject')?.value || '') : cnpjDigits($('#fiscal-subject')?.value || '');
  const signerName = String($('#fiscal-signer')?.value || '').trim();
  const validLength = type === 'cpf' ? digits.length === 11 : digits.length === 14;
  if (!validLength) return showToast(`Informe um ${type.toUpperCase()} válido.`);
  if (signerName.length < 5) return showToast('Informe o nome completo do signatário.');
  if (!$('#fiscal-confidentiality-accept')?.checked || !$('#fiscal-minimum-scope')?.checked) return showToast('Confirme os dois aceites antes de gerar o contrato.');
  if (!window.MedRecebePdf?.buildFiscalAgreement) return showToast('Atualize a página para carregar o gerador do contrato.');
  const acceptedAt = new Date().toISOString();
  const agreementId = id('fiscal-agreement');
  const selectedWorkplaceId = appState.fiscalIntegration?.selectedWorkplaceId || '';
  if (type === 'cnpj' && selectedWorkplaceId) {
    const registered = appState.workplaces.find((item) => item.id === selectedWorkplaceId);
    if (registered && cnpjDigits(registered.payerCnpj) !== digits) return showToast('O CNPJ deve corresponder à PJ selecionada. Corrija o cadastro do local se necessário.');
  }
  const pdf = window.MedRecebePdf.buildFiscalAgreement({
    signerName,
    subjectLabel: fiscalSubjectLabel(type, digits),
    version: FISCAL_AGREEMENT_VERSION,
    acceptedAt: new Date(acceptedAt).toLocaleString('pt-BR'),
    generatedAt: new Date(acceptedAt).toLocaleString('pt-BR'),
    agreementId,
  });
  const file = new File([pdf], `termo-confidencialidade-medrecebe-${digits.slice(-4)}.pdf`, { type: 'application/pdf' });
  downloadReconciliationFile(file);
  const connection = {
    ...(appState.fiscalIntegration.connections || []).find((item) => item.workplaceId === selectedWorkplaceId),
    workplaceId: selectedWorkplaceId,
    status: 'agreement_generated',
    agreementVersion: FISCAL_AGREEMENT_VERSION,
    agreementAcceptedAt: acceptedAt,
    agreementSigner: signerName,
    agreementId,
    subjectType: type,
    subjectLast4: digits.slice(-4),
    providerCode: 'nfse_adn',
    xmlSyncStatus: 'pending_credential',
  };
  appState.fiscalIntegration = { ...appState.fiscalIntegration, connections: [...(appState.fiscalIntegration.connections || []).filter((item) => item.workplaceId !== selectedWorkplaceId), connection] };
  saveState();
  renderFiscalIntegration();
  showToast('Contrato gerado. Assine o PDF no portal oficial e anexe o arquivo assinado.');
}

async function uploadSignedFiscalAgreement(file) {
  if (!file || (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf'))) throw new Error('Selecione o PDF assinado.');
  if (file.size > 10 * 1024 * 1024) throw new Error('O contrato assinado deve ter no máximo 10 MB.');
  const selectedWorkplaceId = appState.fiscalIntegration?.selectedWorkplaceId || '';
  const currentConnection = (appState.fiscalIntegration.connections || []).find((item) => item.workplaceId === selectedWorkplaceId) || {};
  const recordId = currentConnection.agreementId || id('fiscal-agreement');
  const documentId = `document-${recordId}`;
  if (isCloudMode() && !appState.demo) {
    await cloud.uploadDocument({ documentId, recordId, documentType: 'fiscal_agreement', fileName: file.name, mimeType: 'application/pdf', dataBase64: await fileAsBase64(file) });
  }
  const connection = { ...currentConnection, workplaceId: selectedWorkplaceId, status: 'agreement_signed', agreementId: recordId, signedDocumentId: documentId, signedDocumentName: file.name, signedAt: new Date().toISOString() };
  appState.fiscalIntegration = { ...appState.fiscalIntegration, connections: [...(appState.fiscalIntegration.connections || []).filter((item) => item.workplaceId !== selectedWorkplaceId), connection] };
  saveState();
  renderFiscalIntegration();
  showToast('Contrato assinado armazenado com proteção e auditoria.');
}

const PROFESSIONAL_AREAS = {
  all: 'Todas as áreas', medical: 'Medicina', nursing: 'Enfermagem', physiotherapy: 'Fisioterapia', psychology: 'Psicologia', nutrition: 'Nutrição', pharmacy: 'Farmácia', administration: 'Administração em saúde', technician: 'Técnicos e auxiliares', other: 'Outra área',
};
const CONTRACT_TYPES = { all: 'Todos os vínculos', pj: 'Pessoa jurídica / prestação', clt: 'CLT', shift: 'Plantão', credentialing: 'Credenciamento', temporary: 'Temporário', internship: 'Estágio / residência', other: 'Outro' };
const PUBLIC_CONTRACT_CATEGORIES = { all: 'Todos os tipos', credentialing: 'Credenciamento médico', shifts: 'Plantões e urgência', specialized: 'Serviços especializados', diagnostics: 'Diagnóstico e exames', occupational: 'Saúde ocupacional', telemedicine: 'Telemedicina', general: 'Serviços médicos gerais' };

function ensureMarketplaceSearch() {
  const search = appState.marketplace.search;
  const primary = professionalProfile?.registrations?.find((item) => item.primary) || professionalProfile?.registrations?.[0];
  if (!search.uf) {
    search.uf = professionalProfile?.opportunityUf || primary?.crmUf || 'SP';
    search.city = professionalProfile?.opportunityCity || '';
    search.cityCode = professionalProfile?.opportunityCityCode || '';
    search.radiusKm = Number(professionalProfile?.opportunityRadiusKm) || 1000;
    saveState();
  }
  marketplaceMode = appState.marketplace.mode || marketplaceMode;
  return search;
}

function demoMarketplaceData() {
  if (!appState.marketplace.demoPostings.length) appState.marketplace.demoPostings = [
    { id: 'demo-op-1', source: 'MedRecebe', title: 'Médico plantonista - pronto atendimento', organization: 'Hospital Regional Modelo', city: 'Campinas', uf: 'SP', professionalArea: 'medical', contractType: 'shift', description: 'Escala de plantões para atendimento adulto. CRM ativo obrigatório.', compensationMinCents: 140000, compensationMaxCents: 180000, publishedAt: new Date().toISOString(), closesAt: new Date(Date.now() + 12 * 86400000).toISOString(), status: 'published' },
    { id: 'demo-op-2', source: 'MedRecebe', title: 'Fisioterapeuta respiratório', organization: 'Clínica Integra Saúde', city: 'São Paulo', uf: 'SP', professionalArea: 'physiotherapy', contractType: 'pj', description: 'Atuação ambulatorial e apoio a tratamentos contínuos.', compensationMinCents: 650000, compensationMaxCents: 850000, publishedAt: new Date().toISOString(), closesAt: new Date(Date.now() + 20 * 86400000).toISOString(), status: 'published' },
  ];
  return { opportunities: appState.marketplace.demoPostings, organizations: appState.marketplace.demoOrganization ? [appState.marketplace.demoOrganization] : [], postings: appState.marketplace.demoPostings.filter((item) => item.organizationId), workers: appState.marketplace.demoWorkers, applications: appState.marketplace.demoApplications };
}

function marketplaceOpportunityCard(item) {
  const area = PROFESSIONAL_AREAS[item.professionalArea] || item.professionalArea || 'Profissional de saúde';
  const contract = CONTRACT_TYPES[item.contractType] || item.contractType || 'A combinar';
  const compensation = item.compensationMinCents ? `${currency(item.compensationMinCents)}${item.compensationMaxCents && item.compensationMaxCents !== item.compensationMinCents ? ` a ${currency(item.compensationMaxCents)}` : ''}` : 'A combinar';
  const applied = (marketplaceCache?.applications || []).some((application) => application.opportunityId === item.id) || appState.marketplace.demoApplications.some((application) => application.opportunityId === item.id);
  return `<article class="card marketplace-opportunity-card"><div class="opportunity-card-head"><span class="source-pill ${item.source === 'MedRecebe' ? 'verified' : ''}">${escapeHtml(item.source || 'MedRecebe')}</span><small>${escapeHtml(area)}</small></div><h3>${escapeHtml(item.title)}</h3><p><strong>${escapeHtml(item.organization || '')}</strong> · ${escapeHtml(item.city || '')}/${escapeHtml(item.uf || '')}</p><p>${escapeHtml(item.description || 'Consulte os detalhes da oportunidade.')}</p><div class="opportunity-matches"><span>${escapeHtml(contract)}</span></div><div class="opportunity-footer"><span><small>REMUNERAÇÃO</small><strong>${escapeHtml(compensation)}</strong></span><button class="button ${applied ? 'secondary' : 'primary'} small" data-action="apply-opportunity" data-id="${escapeHtml(item.id)}" type="button" ${applied ? 'disabled' : ''}>${applied ? 'Interesse enviado' : 'Tenho interesse'}</button></div></article>`;
}

function marketplaceFiltersMarkup(search) {
  return `<div class="card marketplace-filters"><div class="form-grid"><div class="inline-grid"><label>Estado<select id="marketplace-uf">${ufOptions(search.uf)}</select></label><label>Cidade<select id="marketplace-city"><option value="">${search.city ? escapeHtml(search.city) : 'Todo o estado'}</option></select></label></div><div class="inline-grid"><label>Raio<select id="marketplace-radius"><option value="50" ${search.radiusKm === 50 ? 'selected' : ''}>50 km</option><option value="100" ${search.radiusKm === 100 ? 'selected' : ''}>100 km</option><option value="250" ${search.radiusKm === 250 ? 'selected' : ''}>250 km</option><option value="500" ${search.radiusKm === 500 ? 'selected' : ''}>500 km</option><option value="1000" ${search.radiusKm >= 1000 ? 'selected' : ''}>Todo o estado</option></select></label><label>Área profissional<select id="marketplace-area">${Object.entries(PROFESSIONAL_AREAS).map(([value, label]) => `<option value="${value}" ${search.professionalArea === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div><label>Tipo de vínculo<select id="marketplace-contract-type">${Object.entries(CONTRACT_TYPES).map(([value, label]) => `<option value="${value}" ${search.contractType === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div><button class="button primary" data-action="search-marketplace" type="button">Buscar oportunidades</button><p class="field-hint">Este filtro é independente da região de alertas do seu perfil.</p></div>`;
}

async function populateMarketplaceMunicipalities() {
  const select = $('#marketplace-city');
  const search = appState.marketplace.search;
  if (!select || !search.uf || marketplaceMunicipalitiesLoading) return;
  marketplaceMunicipalitiesLoading = true;
  select.disabled = true;
  try {
    const directory = await loadMunicipalityDirectory(search.uf);
    if (!$('#marketplace-city')) return;
    select.innerHTML = `<option value="">Todo o estado</option>${directory.municipalities.map((item) => `<option value="${item.ibgeCode}" data-name="${escapeHtml(item.name)}" ${item.ibgeCode === search.cityCode ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}`;
  } catch {
    select.innerHTML = '<option value="">Municípios indisponíveis</option>';
  } finally {
    select.disabled = false;
    marketplaceMunicipalitiesLoading = false;
  }
}

async function marketplaceTerritory() {
  const search = ensureMarketplaceSearch();
  const directory = await loadMunicipalityDirectory(search.uf);
  const origin = directory.municipalities.find((item) => item.ibgeCode === search.cityCode) || null;
  const radiusKm = Number(search.radiusKm) || 1000;
  const municipalities = radiusKm >= 1000 || !origin ? directory.municipalities : directory.municipalities.filter((item) => haversineKm(origin, item) <= radiusKm);
  return { uf: search.uf, origin, radiusKm, municipalityCodes: municipalities.map((item) => item.ibgeCode), directory };
}

async function loadMarketplace(force = false) {
  if (marketplaceLoading || (marketplaceCache && !force)) return;
  marketplaceLoading = true;
  marketplaceError = '';
  if (currentRoute === 'opportunities') renderOpportunities();
  try {
    if (appState.demo || !isCloudMode()) marketplaceCache = demoMarketplaceData();
    else {
      const search = ensureMarketplaceSearch();
      const territory = await marketplaceTerritory();
      const response = await cloud.opportunities({ action: 'list', uf: search.uf, professionalArea: search.professionalArea, contractType: search.contractType });
      if (territory.radiusKm < 1000 && territory.origin) {
        const allowedNames = new Set(territory.directory.municipalities.filter((item) => territory.municipalityCodes.includes(item.ibgeCode)).map((item) => normalizeDirectoryText(item.name)));
        response.opportunities = (response.opportunities || []).filter((item) => allowedNames.has(normalizeDirectoryText(item.city || '')));
      }
      marketplaceCache = response;
    }
  } catch (error) {
    marketplaceError = error instanceof Error ? error.message : 'Não foi possível carregar as oportunidades.';
  } finally {
    marketplaceLoading = false;
    if (currentRoute === 'opportunities') renderOpportunities();
  }
}

function professionalOpportunityMarkup(search) {
  const items = marketplaceCache?.opportunities || [];
  const list = marketplaceLoading
    ? '<div class="card intelligence-loading"><span class="sync-spinner" aria-hidden="true"></span><strong>Buscando oportunidades</strong><p>Consultando ofertas publicadas na região escolhida.</p></div>'
    : marketplaceError ? `<div class="notice warning">${escapeHtml(marketplaceError)}</div>`
      : items.length ? `<div class="opportunity-list">${items.map(marketplaceOpportunityCard).join('')}</div>` : emptyCard('Nenhuma oferta com estes filtros', 'Altere a cidade, o raio, a profissão ou o tipo de vínculo.');
  return `${marketplaceFiltersMarkup(search)}<section class="intelligence-section"><div class="section-heading"><div><p class="eyebrow">OFERTAS DIRETAS</p><h2>Oportunidades publicadas</h2><p class="section-subtitle">Empresas e órgãos contratantes são responsáveis pelas condições informadas e pela seleção.</p></div></div>${list}</section>`;
}

function companyOpportunityMarkup() {
  const organization = marketplaceCache?.organizations?.[0] || appState.marketplace.demoOrganization;
  if (!organization) return `<form class="card marketplace-company-form" id="marketplace-organization-form"><h2>Pré-cadastro do contratante</h2><p>Cadastre a organização para publicar ofertas e vincular profissionais que trabalharão e receberão pagamentos.</p><div class="form-grid"><label>Tipo<select id="marketplace-org-type"><option value="company">Empresa privada</option><option value="government">Órgão público</option></select></label><label>Razão Social<input id="marketplace-org-legal-name" required /></label><label>Nome fantasia<input id="marketplace-org-trade-name" required /></label><label>CNPJ<input id="marketplace-org-cnpj" inputmode="numeric" maxlength="18" required /></label><div class="inline-grid"><label>UF<select id="marketplace-org-uf">${ufOptions('SP')}</select></label><label>Município<input id="marketplace-org-city" required /></label></div><label>E-mail institucional<input id="marketplace-org-email" type="email" required /></label></div><button class="button primary" type="submit">Criar cadastro da organização</button></form>`;
  const postings = marketplaceCache?.postings || [];
  const workers = marketplaceCache?.workers || [];
  return `<div class="card marketplace-org-summary"><div><span class="source-pill verified">CONTRATANTE</span><h2>${escapeHtml(organization.tradeName || organization.legalName)}</h2><p>${escapeHtml(organization.city || '')}/${escapeHtml(organization.uf || '')}</p></div></div><div class="marketplace-company-grid"><form class="card" id="marketplace-opportunity-form"><h2>Publicar oportunidade</h2><div class="form-grid"><label>Título<input id="marketplace-post-title" required placeholder="Ex.: Médico plantonista" /></label><div class="inline-grid"><label>Área<select id="marketplace-post-area">${Object.entries(PROFESSIONAL_AREAS).filter(([value]) => value !== 'all').map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label><label>Vínculo<select id="marketplace-post-contract">${Object.entries(CONTRACT_TYPES).filter(([value]) => value !== 'all').map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label></div><label>Especialidade ou função<input id="marketplace-post-specialty" placeholder="Ex.: Cardiologia" /></label><div class="inline-grid"><label>UF<select id="marketplace-post-uf">${ufOptions(organization.uf || 'SP')}</select></label><label>Município<input id="marketplace-post-city" value="${escapeHtml(organization.city || '')}" required /></label></div><label>Descrição<textarea id="marketplace-post-description" required></textarea></label><div class="inline-grid"><label>Remuneração mínima<input id="marketplace-post-min" inputmode="decimal" placeholder="0,00" /></label><label>Remuneração máxima<input id="marketplace-post-max" inputmode="decimal" placeholder="0,00" /></label></div></div><button class="button primary" type="submit">Publicar oferta</button></form><form class="card" id="marketplace-worker-form"><h2>Adicionar profissional</h2><p>O profissional receberá o vínculo no ecossistema MedRecebe quando o e-mail corresponder a uma conta.</p><div class="form-grid"><label>Nome<input id="marketplace-worker-name" required /></label><label>E-mail<input id="marketplace-worker-email" type="email" required /></label><label>Área profissional<select id="marketplace-worker-area">${Object.entries(PROFESSIONAL_AREAS).filter(([value]) => value !== 'all').map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label><label>CRM/registro profissional (opcional)<input id="marketplace-worker-registration" /></label></div><button class="button secondary" type="submit">Adicionar profissional</button></form></div><section class="intelligence-section"><div class="section-heading"><div><p class="eyebrow">GESTÃO</p><h2>Publicações e profissionais</h2></div></div><div class="marketplace-management-grid"><div class="card"><h3>Ofertas publicadas</h3>${postings.length ? postings.map((item) => `<p><strong>${escapeHtml(item.title)}</strong><br/><small>${escapeHtml(item.city)}/${escapeHtml(item.uf)} · ${escapeHtml(CONTRACT_TYPES[item.contractType] || item.contractType)}</small></p>`).join('') : '<p class="muted">Nenhuma oferta publicada.</p>'}</div><div class="card"><h3>Profissionais vinculados</h3>${workers.length ? workers.map((item) => `<p><strong>${escapeHtml(item.name)}</strong><br/><small>${escapeHtml(item.email)} · ${escapeHtml(PROFESSIONAL_AREAS[item.professionalArea] || item.professionalArea)}</small></p>`).join('') : '<p class="muted">Nenhum profissional adicionado.</p>'}</div></div></section>`;
}

function renderOpportunities() {
  const search = ensureMarketplaceSearch();
  appState.marketplace.mode = marketplaceMode;
  const content = marketplaceMode === 'company' ? companyOpportunityMarkup() : professionalOpportunityMarkup(search);
  screen.innerHTML = `<div class="screen-stack opportunities-page">${pageHeading('Ecossistema de trabalho', 'Oportunidades', 'Encontre trabalho, publique necessidades e conecte contratantes aos profissionais que receberão os repasses.')}<div class="segmented-control marketplace-mode"><button class="${marketplaceMode === 'professional' ? 'active' : ''}" data-action="set-marketplace-mode" data-value="professional" type="button">Sou profissional</button><button class="${marketplaceMode === 'company' ? 'active' : ''}" data-action="set-marketplace-mode" data-value="company" type="button">Sou contratante</button></div>${content}</div>`;
  if (marketplaceMode === 'professional') void populateMarketplaceMunicipalities();
  if (!marketplaceCache && !marketplaceLoading && !marketplaceError) void loadMarketplace();
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
  const freemium = isFreemiumAccount();
  const cloudSection = isCloudMode()
    ? freemium
      ? `<h2 class="section-title">Plano e acesso</h2><div class="card workplace-summary"><div class="card-head"><span class="round-icon">1</span><div><h3>Plano Freemium</h3><p>1 local de trabalho gratuito</p></div><span class="badge">Ativo</span></div><p class="field-hint">Seus dados continuam sincronizados. Migre para o plano completo quando precisar cadastrar outros locais.</p><button class="button primary small" data-action="upgrade-plan" type="button">Conhecer o plano completo</button></div>`
      : `<h2 class="section-title">Plano e acesso</h2><div class="card workplace-summary"><div class="card-head"><span class="round-icon">✓</span><div><h3>Plano completo</h3><p>R$ 39,90 por mês</p></div><span class="badge ${accessStatus === 'active' ? '' : 'inactive'}">${escapeHtml(subscriptionLabels[accessStatus] || 'Em configuração')}</span></div><p class="field-hint">Locais ilimitados e dados sincronizados entre o celular e o computador.</p></div>`
    : '';
  const deleteLabel = isCloudMode() ? 'Excluir dados salvos neste aparelho' : 'Excluir conta e dados locais';
  const phone = appState.profile?.phoneNumber ? `<br/>${escapeHtml(appState.profile.phoneCountryCode || '+55')} ${escapeHtml(formatMobilePhone(appState.profile.phoneNumber, appState.profile.phoneCountryCode || '+55'))}` : '';
  const primary = professionalProfile?.registrations?.find((item) => item.primary) || professionalProfile?.registrations?.[0];
  const professionalSection = `<h2 class="section-title">Perfil profissional</h2><div class="card professional-account-card"><div><span class="source-pill ${primary?.status?.startsWith('verified') ? 'verified' : ''}">${primary?.status?.startsWith('verified') ? 'VERIFICADO' : primary ? 'AUTODECLARADO' : 'PENDENTE'}</span><h3>${primary ? `CRM ${escapeHtml(primary.crmNumber)}/${escapeHtml(primary.crmUf)}` : 'Informe seu CRM'}</h3><p>${professionalProfile?.specialties?.length ? professionalProfile.specialties.map((item) => escapeHtml(item.name)).join(' · ') : 'Sem especialidade cadastrada'}</p></div><button class="button secondary small" data-action="edit-professional-profile" type="button">${primary ? 'Editar' : 'Completar'}</button></div>`;
  screen.innerHTML = `<div class="screen-stack">${pageHeading('', 'Mais', '')}<div class="card card-head"><span class="avatar">${escapeHtml((appState.profile?.name || 'M').charAt(0))}</span><div><h3>${escapeHtml(appState.profile?.name || 'Médico')}</h3><p>${formatCpf(appState.profile?.cpf || '')}<br/>${escapeHtml(appState.profile?.email || '')}${phone}</p></div></div>${professionalSection}${cloudSection}<div class="notice success"><strong>Dados e documentos sincronizados</strong><br/>Comprovantes e Notas Fiscais ficam disponíveis nos seus dispositivos autenticados.</div><h2 class="section-title">Aplicativo</h2><div class="card install-card"><span class="install-icon">${isStandalone() ? '✓' : '⇧'}</span><div><strong>${isStandalone() ? 'MedRecebe instalado' : 'Adicionar à Tela de Início'}</strong><p>${isStandalone() ? 'Você está usando o modo aplicativo.' : 'Instale pelo Safari para abrir como aplicativo.'}</p></div>${isStandalone() ? '' : '<button class="link-button" data-action="install" type="button">Ver passos</button>'}</div><h2 class="section-title">Ajuda e preferências</h2><div class="card account-links"><button class="account-link" data-nav="feedback" type="button">Enviar feedback <span>›</span></button><a class="account-link" href="./privacidade.html" target="_blank" rel="noopener">Política de Privacidade <span>›</span></a><a class="account-link" href="./termos.html" target="_blank" rel="noopener">Termos de Uso <span>›</span></a><a class="account-link" href="./cancelamento.html" target="_blank" rel="noopener">Política de cancelamento e reembolso <span>›</span></a><a class="account-link" href="./suporte.html" target="_blank" rel="noopener">Ajuda e suporte <span>›</span></a></div><button class="button secondary" data-action="logout" type="button">Sair</button><button class="button danger" data-action="delete-beta-data" type="button">${deleteLabel}</button><p class="muted" style="text-align:center">MedRecebe • versão web 2.5</p></div>`;
  if (!professionalProfile && isCloudMode() && !professionalProfileLoading && !professionalProfileError) {
    void loadProfessionalProfile().then(() => { if (currentRoute === 'account') renderAccount(); });
  }
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

function showFreemiumLimit() {
  modalRoot.innerHTML = `<div class="modal-wrap"><section class="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="freemium-limit-title"><header class="modal-header simple"><span></span><h2 id="freemium-limit-title">Limite do plano gratuito</h2><button data-action="close-modal" aria-label="Fechar" type="button">×</button></header><div class="modal-body"><div class="notice"><strong>Seu local gratuito já está cadastrado.</strong><br/>Você pode continuar registrando atendimentos e editando este local. Para adicionar outros pagadores, migre para o plano completo.</div><button class="button primary" data-action="upgrade-plan" type="button">Cadastrar locais ilimitados</button><button class="button secondary" data-action="close-modal" type="button">Agora não</button></div></section></div>`;
}

function canCreateWorkplace() {
  if (!isFreemiumAccount() || appState.workplaces.length < 1) return true;
  showFreemiumLimit();
  return false;
}

function newWorkplace() {
  if (!canCreateWorkplace()) return;
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
  if (!canCreateWorkplace()) return;
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
  const primaryRegistration = professionalProfile?.registrations?.find((item) => item.primary) || professionalProfile?.registrations?.[0];
  institutionDirectoryState = draftWorkplace.state || professionalProfile?.opportunityUf || primaryRegistration?.crmUf || institutionDirectoryState || 'SP';
  workplaceFormGrid?.insertAdjacentHTML('beforebegin', `<section class="institution-directory"><div class="directory-heading"><span class="round-icon">⌕</span><div><h3>Buscar hospital ou empresa</h3><p>Consulte nome fantasia, razão social e dados oficiais do CNES em todo o Brasil.</p></div></div><div class="directory-search-fields"><label>Estado<select id="institution-directory-uf">${ufOptions(institutionDirectoryState)}</select></label><label>Nome fantasia, razão social, cidade, CNPJ ou CNES<input id="institution-search" autocomplete="off" placeholder="Ex.: hospital, empresa, cidade ou CNPJ"/></label></div><p class="field-hint" id="institution-directory-status">Carregando diretório de ${escapeHtml(institutionDirectoryState)}…</p><div class="directory-results" id="institution-results" role="listbox"></div>${directorySelectionMarkup()}</section>`);
  void loadInstitutionDirectory(institutionDirectoryState)
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
    register: 'Criar conta grátis',
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
  const phoneCountryInput = $('#auth-phone-country');
  const phoneInput = $('#auth-phone');
  const crmUfInput = $('#auth-crm-uf');
  const crmNumberInput = $('#auth-crm-number');

  $('#register-fields').hidden = !register;
  $('#reset-password-fields').hidden = !reset;
  cpfField.hidden = reset;
  passwordField.hidden = forgot || reset;
  cpfInput.required = !reset;
  passwordInput.required = !forgot && !reset;
  newPassword.required = reset;
  confirmPassword.required = reset;
  phoneCountryInput.required = register;
  phoneInput.required = register;
  crmUfInput.required = register;
  crmNumberInput.required = register;

  const titles = {
    login: 'Boas-vindas',
    register: 'Criar meu acesso',
    forgot: 'Recuperar senha',
    reset: 'Criar nova senha',
  };
  const descriptions = {
    login: isCloudMode() ? 'Entre com o CPF e a senha da sua conta MedRecebe.' : 'Entre com o CPF e a senha cadastrados neste aparelho.',
    register: isCloudMode() ? 'Cadastre-se gratuitamente e organize os atendimentos de um local de trabalho.' : 'Cadastre seus dados reais. A conta permanecerá salva neste aparelho.',
    forgot: 'Informe seu CPF para receber as instruções no e-mail cadastrado.',
    reset: 'Defina uma nova senha com pelo menos oito caracteres.',
  };
  $('#auth-title').textContent = titles[authMode];
  $('#auth-description').textContent = descriptions[authMode];
  $('#auth-submit').textContent = authSubmitLabel();
  $('#auth-toggle').hidden = reset;
  $('#auth-toggle').textContent = register ? 'Já tenho acesso' : forgot ? 'Voltar para entrar' : 'Cadastre-se grátis';
  $('#forgot-password').hidden = authMode !== 'login';
  $('#demo-entry').hidden = authMode !== 'login' || isCloudMode();
  passwordInput.autocomplete = register ? 'new-password' : 'current-password';
  showAuthMessage();
}

function bindEvents() {
  $('#auth-cpf').addEventListener('input', (event) => (event.target.value = formatCpf(event.target.value)));
  $('#auth-phone-country').addEventListener('input', (event) => {
    event.target.value = formatPhoneCountryCode(event.target.value);
    $('#auth-phone').value = formatMobilePhone($('#auth-phone').value, event.target.value);
  });
  $('#auth-phone').addEventListener('input', (event) => (event.target.value = formatMobilePhone(event.target.value, $('#auth-phone-country').value)));
  $('#auth-crm-number').addEventListener('input', (event) => (event.target.value = normalizeCrmNumber(event.target.value)));
  $('#auth-rqe').addEventListener('input', (event) => (event.target.value = onlyDigits(event.target.value).slice(0, 12)));
  $('#auth-add-specialty').addEventListener('click', () => addSpecialtyToDraft('registration'));
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
          const phoneCountryCode = formatPhoneCountryCode($('#auth-phone-country').value);
          const phoneNumber = phoneDigits($('#auth-phone').value);
          const crmUf = $('#auth-crm-uf').value;
          const crmNumber = normalizeCrmNumber($('#auth-crm-number').value);
          if (name.length < 3) throw new Error('Informe seu nome completo.');
          if (!isValidCpf(cpf)) throw new Error('Informe um CPF válido.');
          if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Informe um e-mail válido.');
          if (!isValidPhone(phoneCountryCode, phoneNumber)) throw new Error('Informe um celular válido com DDD.');
          if (!crmUf) throw new Error('Selecione a UF do CRM.');
          if (!/^(EME)?[0-9]{1,10}P?$/.test(crmNumber)) throw new Error('Informe um número de CRM válido.');
          if (password.length < 8) throw new Error('A senha deve ter pelo menos oito caracteres.');
          const result = await cloud.register({ name, email, cpf, password, phoneCountryCode, phoneNumber, crmUf, crmNumber, specialties: registrationSpecialtiesDraft });
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
      const phoneCountryCode = formatPhoneCountryCode($('#auth-phone-country').value);
      const phoneNumber = phoneDigits($('#auth-phone').value);
      const crmUf = $('#auth-crm-uf').value;
      const crmNumber = normalizeCrmNumber($('#auth-crm-number').value);
      if (name.length < 3) return (error.textContent = 'Informe seu nome completo.');
      if (!isValidCpf(cpf)) return (error.textContent = 'Informe um CPF válido.');
      if (!/^\S+@\S+\.\S+$/.test(email)) return (error.textContent = 'Informe um e-mail válido.');
      if (!isValidPhone(phoneCountryCode, phoneNumber)) return (error.textContent = 'Informe um celular válido com DDD.');
      if (!crmUf) return (error.textContent = 'Selecione a UF do CRM.');
      if (!/^(EME)?[0-9]{1,10}P?$/.test(crmNumber)) return (error.textContent = 'Informe um número de CRM válido.');
      if (password.length < 8) return (error.textContent = 'A senha deve ter pelo menos oito caracteres.');
      const salt = id('salt');
      appState = { ...emptyState(), account: { cpf, salt, passwordHash: await hashPassword(password, salt) }, profile: { name, cpf, email, phoneCountryCode, phoneNumber } };
      professionalProfile = { opportunityCity: '', opportunityUf: crmUf, opportunityRadiusKm: 100, registrations: [{ crmUf, crmNumber, primary: true, status: 'self_reported' }], specialties: structuredClone(registrationSpecialtiesDraft) };
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
    professionalProfile = { opportunityCity: 'São Paulo', opportunityCityCode: '3550308', opportunityUf: 'SP', opportunityRadiusKm: 100, registrations: [{ crmUf: 'SP', crmNumber: '123456', primary: true, status: 'self_reported' }], specialties: [{ code: 'clinica-medica', name: 'Clínica médica', rqeNumber: '12345', status: 'self_reported' }] };
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

  $('#billing-back').addEventListener('click', () => showApp());
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
    professionalDraft = null;
  }
  if (action === 'edit-professional-profile') openProfessionalProfileModal();
  if (action === 'add-professional-specialty') {
    preserveProfessionalDraft();
    addSpecialtyToDraft('professional');
  }
  if (action === 'remove-professional-specialty' && professionalDraft) {
    preserveProfessionalDraft();
    professionalDraft.specialties.splice(Number(index), 1);
    renderProfessionalProfileModal();
  }
  if (action === 'save-professional-profile') void saveProfessionalProfile(target);
  if (action === 'remove-registration-specialty') {
    registrationSpecialtiesDraft.splice(Number(index), 1);
    renderRegistrationSpecialties();
  }
  if (action === 'refresh-market-intelligence') {
    marketIntelligenceError = '';
    void loadMarketIntelligence(true);
  }
  if (action === 'download-fiscal-agreement') void downloadFiscalAgreement();
  if (action === 'select-fiscal-workplace') {
    appState.fiscalIntegration.selectedWorkplaceId = targetId;
    saveState();
    renderFiscalIntegration();
  }
  if (action === 'set-marketplace-mode') {
    marketplaceMode = value === 'company' ? 'company' : 'professional';
    appState.marketplace.mode = marketplaceMode;
    saveState();
    renderOpportunities();
  }
  if (action === 'search-marketplace') {
    if (currentRoute === 'intelligence') {
      marketIntelligenceCache = persistedMarketCache();
      marketIntelligenceError = '';
      privateProspectsError = '';
      void loadMarketIntelligence(true);
      void ensurePrivateProspects();
    } else {
      marketplaceCache = null;
      marketplaceError = '';
      void loadMarketplace(true);
    }
  }
  if (action === 'apply-opportunity') {
    const opportunity = (marketplaceCache?.opportunities || []).find((item) => item.id === targetId);
    if (!opportunity) return showToast('Esta oportunidade não está mais disponível.');
    target.disabled = true;
    target.textContent = 'Enviando…';
    try {
      let application;
      if (appState.demo || !isCloudMode()) {
        application = { id: id('application'), opportunityId: targetId, status: 'interested', createdAt: new Date().toISOString() };
        appState.marketplace.demoApplications = [...appState.marketplace.demoApplications.filter((item) => item.opportunityId !== targetId), application];
        saveState();
      } else {
        const result = await cloud.opportunities({ action: 'apply', opportunityId: targetId });
        application = result.application;
      }
      marketplaceCache = { ...(marketplaceCache || {}), applications: [...(marketplaceCache?.applications || []).filter((item) => item.opportunityId !== targetId), application] };
      renderOpportunities();
      showToast('Interesse enviado ao contratante.');
    } catch (error) {
      target.disabled = false;
      target.textContent = 'Tenho interesse';
      showToast(error instanceof Error ? error.message : 'Não foi possível enviar seu interesse.');
    }
  }
  if (action === 'upgrade-plan') {
    modalRoot.innerHTML = '';
    showBilling();
  }
  if (action === 'new-workplace') newWorkplace();
  if (action === 'create-workplace-from-prospect') newWorkplaceFromProspect(targetId);
  if (action === 'edit-workplace') editWorkplace(targetId);
  if (action === 'delete-workplace') {
    const workplace = appState.workplaces.find((item) => item.id === targetId);
    if (workplace) {
      const recordIds = [...new Set(appState.attendances.filter((item) => item.workplaceId === targetId).map(attendanceRecordId).filter(Boolean))];
      const detail = recordIds.length ? ` Também serão excluídos ${recordIds.length} registro(s) de atendimento e seus comprovantes.` : '';
      if (confirm(`Excluir definitivamente ${workplace.name}?${detail} Esta ação não pode ser desfeita.`)) {
        appState.workplaces = appState.workplaces.filter((item) => item.id !== targetId);
        appState.attendances = appState.attendances.filter((item) => item.workplaceId !== targetId);
        appState.fiscalIntegration.connections = (appState.fiscalIntegration.connections || []).filter((item) => item.workplaceId !== targetId);
        if (selectedWorkplaceId === targetId) selectedWorkplaceId = '';
        saveState();
        renderWorkplaces();
        if (isCloudMode() && recordIds.length) {
          Promise.allSettled(recordIds.map((recordId) => cloud.deleteDocumentsForRecord(recordId))).then(() => showToast('Local, atendimentos e comprovantes excluídos.'));
        } else showToast('Local excluído.');
      }
    }
  }
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
  if (event.target.id === 'fiscal-subject-type') {
    const input = $('#fiscal-subject');
    if (input) input.placeholder = event.target.value === 'cpf' ? '000.000.000-00' : '00.000.000/0000-00';
    return;
  }
  if (event.target.id === 'fiscal-signed-file' && event.target.files[0]) {
    const file = event.target.files[0];
    const label = event.target.closest('label');
    if (label) label.classList.add('busy');
    void uploadSignedFiscalAgreement(file)
      .catch((error) => showToast(error instanceof Error ? error.message : 'Não foi possível armazenar o contrato assinado.'))
      .finally(() => label?.classList.remove('busy'));
    return;
  }
  if (event.target.id === 'marketplace-uf') {
    appState.marketplace.search.uf = event.target.value || 'SP';
    appState.marketplace.search.city = '';
    appState.marketplace.search.cityCode = '';
    marketplaceCache = null;
    saveState();
    void populateMarketplaceMunicipalities();
    return;
  }
  if (event.target.id === 'marketplace-city') {
    const option = event.target.selectedOptions[0];
    appState.marketplace.search.cityCode = event.target.value;
    appState.marketplace.search.city = event.target.value ? option?.dataset.name || option?.textContent || '' : '';
    marketplaceCache = null;
    saveState();
    return;
  }
  if (event.target.id === 'marketplace-radius') {
    appState.marketplace.search.radiusKm = Number(event.target.value) || 1000;
    marketplaceCache = null;
    saveState();
    return;
  }
  if (event.target.id === 'marketplace-area') {
    appState.marketplace.search.professionalArea = event.target.value || 'all';
    marketplaceCache = null;
    saveState();
    return;
  }
  if (event.target.id === 'marketplace-contract-type') {
    appState.marketplace.search.contractType = event.target.value || 'all';
    marketplaceCache = null;
    saveState();
    return;
  }
  if (event.target.id === 'public-contract-category') {
    appState.marketplace.search.publicCategory = event.target.value || 'all';
    saveState();
    renderIntelligence();
    return;
  }
  if (event.target.id === 'professional-opportunity-uf' && professionalDraft) {
    professionalDraft.opportunityUf = event.target.value;
    professionalDraft.opportunityCity = '';
    professionalDraft.opportunityCityCode = '';
    void populateOpportunityMunicipalities();
    return;
  }
  if (event.target.id === 'medical-map-specialty') {
    selectedMedicalMapSpecialty = event.target.value || 'all';
    renderIntelligence();
    return;
  }
  if (event.target.id === 'medical-map-metric') {
    selectedMedicalMapMetric = event.target.value === 'absolute' ? 'absolute' : 'per_100k';
    renderIntelligence();
    return;
  }
  if (event.target.id === 'medical-map-layer') {
    selectedMedicalMapLayer = event.target.value === 'scarcity' ? 'scarcity' : 'concentration';
    renderIntelligence();
    return;
  }
  if (event.target.id === 'medical-specialty-ranking-order') {
    selectedSpecialtyRankingOrder = event.target.value === 'desc' ? 'desc' : 'asc';
    renderIntelligence();
    return;
  }
  if (event.target.id === 'medical-map-uf') {
    selectedMedicalMapUf = event.target.value || 'BR';
    medicalDensityError = '';
    renderIntelligence();
    void Promise.all([loadMedicalDensity(selectedMedicalMapUf), loadMedicalDensity('BR'), loadMedicalShapes(selectedMedicalMapUf)])
      .catch(() => {})
      .finally(() => {
        if (currentRoute === 'intelligence') renderIntelligence();
      });
    return;
  }
  if (event.target.id === 'institution-directory-uf') {
    institutionDirectoryState = event.target.value || 'SP';
    institutionDirectory = [];
    institutionDirectoryMeta = null;
    const status = $('#institution-directory-status');
    const results = $('#institution-results');
    if (status) status.textContent = `Carregando diretório de ${institutionDirectoryState}…`;
    if (results) results.innerHTML = '';
    void loadInstitutionDirectory(institutionDirectoryState)
      .then(() => renderInstitutionSearchResults($('#institution-search')?.value || ''))
      .catch(() => {
        if (status) status.textContent = 'A busca automática está indisponível agora. O preenchimento manual continua disponível.';
      });
    return;
  }
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
  if (event.target.id === 'marketplace-organization-form') {
    event.preventDefault();
    const organization = {
      organizationType: $('#marketplace-org-type').value,
      legalName: $('#marketplace-org-legal-name').value.trim(),
      tradeName: $('#marketplace-org-trade-name').value.trim(),
      cnpj: cnpjDigits($('#marketplace-org-cnpj').value),
      uf: $('#marketplace-org-uf').value,
      city: $('#marketplace-org-city').value.trim(),
      contactEmail: $('#marketplace-org-email').value.trim().toLowerCase(),
    };
    if (!isValidCnpj(organization.cnpj)) return showToast('Informe um CNPJ válido.');
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Criando…';
    try {
      if (appState.demo || !isCloudMode()) {
        appState.marketplace.demoOrganization = { id: id('organization'), ...organization };
        saveState();
        marketplaceCache = demoMarketplaceData();
      } else {
        const result = await cloud.opportunities({ action: 'save-organization', ...organization });
        marketplaceCache = { ...(marketplaceCache || {}), organizations: [result.organization], postings: [], workers: [], applications: marketplaceCache?.applications || [] };
      }
      renderOpportunities();
      showToast('Organização cadastrada. Agora você já pode publicar oportunidades.');
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Criar cadastro da organização';
      showToast(error instanceof Error ? error.message : 'Não foi possível criar a organização.');
    }
    return;
  }
  if (event.target.id === 'marketplace-opportunity-form') {
    event.preventDefault();
    const payload = {
      title: $('#marketplace-post-title').value.trim(),
      professionalArea: $('#marketplace-post-area').value,
      contractType: $('#marketplace-post-contract').value,
      specialty: $('#marketplace-post-specialty').value.trim(),
      uf: $('#marketplace-post-uf').value,
      city: $('#marketplace-post-city').value.trim(),
      description: $('#marketplace-post-description').value.trim(),
      compensationMinCents: parseMoney($('#marketplace-post-min').value),
      compensationMaxCents: parseMoney($('#marketplace-post-max').value),
    };
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Publicando…';
    try {
      let opportunity;
      if (appState.demo || !isCloudMode()) {
        opportunity = { id: id('opportunity'), source: 'MedRecebe', organizationId: appState.marketplace.demoOrganization.id, organization: appState.marketplace.demoOrganization.tradeName, status: 'published', publishedAt: new Date().toISOString(), ...payload };
        appState.marketplace.demoPostings.unshift(opportunity);
        saveState();
      } else {
        const result = await cloud.opportunities({ action: 'create-opportunity', ...payload });
        opportunity = result.opportunity;
      }
      marketplaceCache = { ...(marketplaceCache || {}), opportunities: [opportunity, ...(marketplaceCache?.opportunities || [])], postings: [opportunity, ...(marketplaceCache?.postings || [])] };
      renderOpportunities();
      showToast('Oportunidade publicada.');
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Publicar oferta';
      showToast(error instanceof Error ? error.message : 'Não foi possível publicar a oportunidade.');
    }
    return;
  }
  if (event.target.id === 'marketplace-worker-form') {
    event.preventDefault();
    const payload = {
      name: $('#marketplace-worker-name').value.trim(),
      email: $('#marketplace-worker-email').value.trim().toLowerCase(),
      professionalArea: $('#marketplace-worker-area').value,
      professionalRegistration: $('#marketplace-worker-registration').value.trim(),
    };
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Adicionando…';
    try {
      let worker;
      if (appState.demo || !isCloudMode()) {
        worker = { id: id('worker'), organizationId: appState.marketplace.demoOrganization.id, status: 'invited', ...payload };
        appState.marketplace.demoWorkers.unshift(worker);
        saveState();
      } else {
        const result = await cloud.opportunities({ action: 'add-worker', ...payload });
        worker = result.worker;
      }
      marketplaceCache = { ...(marketplaceCache || {}), workers: [worker, ...(marketplaceCache?.workers || [])] };
      renderOpportunities();
      showToast('Profissional adicionado ao cadastro do contratante.');
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Adicionar profissional';
      showToast(error instanceof Error ? error.message : 'Não foi possível adicionar o profissional.');
    }
    return;
  }
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
  if (!exists && isFreemiumAccount() && appState.workplaces.length >= 1) return showFreemiumLimit();
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
  try {
    if (isCloudMode()) await cloud.logout();
  } catch {
    // A limpeza local precisa ocorrer mesmo se a revogação remota estiver indisponível.
  } finally {
    if (cloudSyncTimer) window.clearTimeout(cloudSyncTimer);
    cloudSyncTimer = 0;
    cloudHydrationSequence += 1;
    cloudStateDirty = false;
    cloudAccount = null;
    professionalProfile = null;
    professionalProfileError = '';
    marketIntelligenceCache = null;
    marketIntelligenceError = '';
    localStorage.removeItem(SESSION_KEY);
    activeStateKey = APP_KEY;
    appState = loadState(APP_KEY);
    currentRoute = 'dashboard';
    document.body.classList.remove('web-plan');
    $('#drawer-name').textContent = 'Médico';
    $('#drawer-email').textContent = 'Conta MedRecebe';
    setAuthMode('login');
    showLogin();
  }
}

async function boot() {
  const hasRecoveryToken = consumeRecoveryLink();
  bindEvents();
  void loadMedicalSpecialties().catch(() => {});
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
