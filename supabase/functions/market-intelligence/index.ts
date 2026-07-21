import { json, options, publicError } from '../_shared/http.ts';
import { clientAddress, consumeRateLimit } from '../_shared/rate-limit.ts';
import { adminClient, authenticatedUser, authenticationStatus } from '../_shared/supabase.ts';

type PncpRecord = Record<string, any>;

const MEDICAL_SERVICE_TERMS = [
  'credenciamento medico', 'credenciamento de medicos', 'credenciamento de profissionais medicos',
  'prestacao de servicos medicos', 'prestadores de servicos medicos', 'servicos medicos',
  'servicos de profissionais medicos',
  'profissional medico', 'profissionais medicos', 'plantao medico', 'plantoes medicos',
  'equipe medica', 'consulta medica', 'consultas medicas', 'atendimento medico',
  'assistencia medica', 'especialidade medica', 'especialidades medicas', 'corpo clinico',
  'procedimento medico', 'procedimentos medicos',
];

const SUPPLY_ONLY_TERMS = [
  'aquisicao de medicamentos', 'fornecimento de medicamentos', 'material medico hospitalar',
  'materiais medico hospitalares', 'equipamento medico', 'equipamentos medicos',
  'insumos hospitalares', 'reagentes', 'material de consumo', 'locacao de equipamento',
  'manutencao de equipamento',
];

const EXCLUDED_SERVICE_TERMS = ['veterinario', 'veterinaria', 'medicina veterinaria', 'caes e gatos', 'odontologico', 'odontologica'];

const SPECIALTY_ALIASES: Record<string, string[]> = {
  'clinica-medica': ['clinica medica', 'medico clinico', 'generalista'],
  'medicina-emergencia': ['emergencia', 'urgencia', 'pronto atendimento', 'pronto socorro'],
  'medicina-familia-comunidade': ['medicina de familia', 'estrategia saude da familia', 'atencao basica', 'generalista'],
  'medicina-intensiva': ['intensivista', 'terapia intensiva', 'uti'],
  'ginecologia-obstetricia': ['ginecologia', 'obstetricia', 'ginecologista', 'obstetra'],
  'ortopedia-traumatologia': ['ortopedia', 'traumatologia', 'ortopedista'],
  'radiologia-diagnostico-imagem': ['radiologia', 'diagnostico por imagem', 'radiologista'],
  'patologia-clinica-medicina-laboratorial': ['patologia clinica', 'medicina laboratorial', 'laboratorio clinico'],
  'medicina-legal-pericia': ['pericia medica', 'medico perito', 'junta medica'],
  'medicina-trabalho': ['medicina do trabalho', 'medico do trabalho', 'saude ocupacional'],
  'otorrinolaringologia': ['otorrino'],
  'oncologia-clinica': ['oncologia', 'oncologista', 'cancerologia'],
};

function normalized(value: unknown): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function specialtyTerms(code: string, name: string): string[] {
  const ignored = new Set(['medicina', 'medica', 'medico', 'cirurgia', 'clinica', 'geral', 'diagnostico', 'imagem']);
  const base = normalized(name);
  const tokens = base.split(' ').filter((token) => token.length >= 5 && !ignored.has(token));
  return [...new Set([base, ...tokens, ...(SPECIALTY_ALIASES[code] || []).map(normalized)])].filter((term) => term.length >= 4);
}

function formatPncpDate(value: Date): string {
  return value.toISOString().slice(0, 10).replace(/-/g, '');
}

function detailUrl(item: PncpRecord): string {
  const cnpj = String(item.orgaoEntidade?.cnpj || '').replace(/\D/g, '');
  const year = Number(item.anoCompra || 0);
  const sequence = Number(item.sequencialCompra || 0);
  return cnpj && year && sequence ? `https://pncp.gov.br/app/editais/${cnpj}/${year}/${sequence}` : 'https://pncp.gov.br/app/editais';
}

function compact(item: PncpRecord, score: number, matches: string[]) {
  return {
    id: String(item.numeroControlePNCP || `${item.anoCompra}-${item.sequencialCompra}`),
    title: String(item.objetoCompra || 'Contratação pública na área da saúde').slice(0, 1200),
    organization: String(item.orgaoEntidade?.razaoSocial || item.unidadeOrgao?.nomeUnidade || ''),
    cnpj: String(item.orgaoEntidade?.cnpj || ''),
    city: String(item.unidadeOrgao?.municipioNome || ''),
    uf: String(item.unidadeOrgao?.ufSigla || ''),
    ibgeCode: String(item.unidadeOrgao?.codigoIbge || ''),
    modality: String(item.modalidadeNome || ''),
    estimatedValue: Number(item.valorTotalEstimado) || null,
    publishedAt: item.dataPublicacaoPncp || null,
    closesAt: item.dataEncerramentoProposta || null,
    pncpNumber: String(item.numeroControlePNCP || ''),
    url: detailUrl(item),
    score,
    matches,
    source: 'PNCP',
  };
}

async function fetchPage(uf: string, dataFinal: string, page: number): Promise<{ data: PncpRecord[]; totalPages: number; totalRecords: number }> {
  const url = new URL('https://pncp.gov.br/api/consulta/v1/contratacoes/proposta');
  url.searchParams.set('dataFinal', dataFinal);
  url.searchParams.set('uf', uf);
  url.searchParams.set('pagina', String(page));
  url.searchParams.set('tamanhoPagina', '50');
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'MedRecebe/1.0 (inteligencia de mercado)' }, signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error(`PNCP ${response.status}`);
      const body = await response.json();
      return { data: Array.isArray(body.data) ? body.data : [], totalPages: Number(body.totalPaginas) || 1, totalRecords: Number(body.totalRegistros) || 0 };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 350));
    }
  }
  throw lastError;
}

function sampledPages(totalPages: number, maximum = 14): number[] {
  const total = Math.max(1, totalPages);
  const size = Math.min(total, maximum);
  if (size === 1) return [1];
  return [...new Set(Array.from({ length: size }, (_, index) => Math.round(1 + index * (total - 1) / (size - 1))))];
}

Deno.serve(async (request) => {
  const preflight = options(request);
  if (preflight) return preflight;
  if (request.method !== 'POST') return publicError(request, 'Método não permitido.', 405);

  try {
    const user = await authenticatedUser(request);
    const body = await request.json().catch(() => ({}));
    const [ipLimit, accountLimit] = await Promise.all([
      consumeRateLimit('market_intelligence_ip', clientAddress(request), 30, 60 * 60, 60 * 60),
      consumeRateLimit('market_intelligence_account', user.id, 8, 60 * 60, 60 * 60),
    ]);
    if (!ipLimit.allowed || !accountLimit.allowed) {
      const retryAfter = Math.max(ipLimit.retryAfterSeconds, accountLimit.retryAfterSeconds, 1);
      return publicError(request, 'O radar foi atualizado recentemente. Aguarde antes de consultar novamente.', 429, { 'Retry-After': String(retryAfter) });
    }

    const admin = adminClient();
    const [accountResult, profileResult, registrationResult, specialtiesResult] = await Promise.all([
      admin.from('profiles').select('role, access_status').eq('id', user.id).single(),
      admin.from('professional_profiles').select('opportunity_city, opportunity_city_code, opportunity_uf, opportunity_radius_km').eq('user_id', user.id).maybeSingle(),
      admin.from('professional_registrations').select('crm_uf, crm_number, registration_status').eq('user_id', user.id).eq('is_primary', true).maybeSingle(),
      admin.from('professional_specialties').select('specialty_code, specialty_name, rqe_number, verification_status').eq('user_id', user.id),
    ]);
    if (accountResult.error || !accountResult.data) return publicError(request, 'Conta não encontrada.', 404);
    if (accountResult.data.role !== 'admin' && accountResult.data.access_status !== 'active') return publicError(request, 'Acesso inativo.', 403);
    if (profileResult.error) throw profileResult.error;
    if (registrationResult.error) throw registrationResult.error;
    if (specialtiesResult.error) throw specialtiesResult.error;
    if (!registrationResult.data) return publicError(request, 'Cadastre seu CRM para ativar o radar.', 409);

    const uf = String(profileResult.data?.opportunity_uf || registrationResult.data.crm_uf).toUpperCase();
    const city = normalized(profileResult.data?.opportunity_city || '');
    const cityCode = String(profileResult.data?.opportunity_city_code || '');
    const radiusKm = Math.min(1000, Math.max(10, Number(profileResult.data?.opportunity_radius_km) || 100));
    const originCityCode = String(body.originCityCode || '').replace(/\D/g, '').slice(0, 7);
    const requestedMunicipalityCodes = Array.isArray(body.municipalityCodes)
      ? [...new Set(body.municipalityCodes.map((value: unknown) => String(value || '').replace(/\D/g, '')).filter((value: string) => /^\d{7}$/.test(value)))].slice(0, 1200)
      : [];
    const effectiveCityCode = cityCode || originCityCode;
    const territorialFilterActive = radiusKm < 1000 && Boolean(effectiveCityCode);
    if (cityCode && territorialFilterActive && originCityCode !== cityCode) return publicError(request, 'Atualize o município-base antes de consultar o raio.', 409);
    if (territorialFilterActive && !requestedMunicipalityCodes.length) return publicError(request, 'Não foi possível determinar os municípios dentro do raio.', 422);
    const allowedMunicipalities = new Set(requestedMunicipalityCodes);
    const specialties = specialtiesResult.data || [];
    const termsBySpecialty = specialties.map((item) => ({
      code: item.specialty_code,
      name: item.specialty_name,
      terms: specialtyTerms(item.specialty_code, item.specialty_name),
    }));
    const limitDate = new Date();
    limitDate.setUTCDate(limitDate.getUTCDate() + 120);
    const dataFinal = formatPncpDate(limitDate);
    const first = await fetchPage(uf, dataFinal, 1);
    const inspectedPages = sampledPages(first.totalPages);
    const remainingPages = inspectedPages.filter((page) => page !== 1);
    const settlements = await Promise.allSettled(remainingPages.map((page) => fetchPage(uf, dataFinal, page)));
    const successfulPages = [1, ...remainingPages.filter((_, index) => settlements[index].status === 'fulfilled')];
    const failedPages = remainingPages.filter((_, index) => settlements[index].status === 'rejected');
    const remaining = settlements.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    const records = [first, ...remaining].flatMap((page) => page.data);

    const ranked = records.map((item) => {
      const text = normalized(`${item.objetoCompra || ''} ${item.informacaoComplementar || ''} ${item.modalidadeNome || ''}`);
      const generalMatches = MEDICAL_SERVICE_TERMS.filter((term) => text.includes(term));
      const supplyMatches = SUPPLY_ONLY_TERMS.filter((term) => text.includes(term));
      const excludedMatches = EXCLUDED_SERVICE_TERMS.filter((term) => text.includes(term));
      const specialtyMatches = termsBySpecialty.filter((specialty) => specialty.terms.some((term) => text.includes(term)));
      const itemCity = normalized(item.unidadeOrgao?.municipioNome || '');
      let score = Math.min(5, generalMatches.length);
      if (specialtyMatches.length) score += 7 + Math.min(4, specialtyMatches.length - 1);
      if (city && itemCity === city) score += 4;
      if (normalized(item.modalidadeNome).includes('credenciamento')) score += 2;
      const matches = [
        ...specialtyMatches.map((specialty) => specialty.name),
        ...(city && itemCity === city ? [`Mesmo município: ${item.unidadeOrgao?.municipioNome}`] : []),
        ...(!specialtyMatches.length && generalMatches.length ? ['Compatível com CRM sem especialidade exigida'] : []),
      ];
      const excluded = excludedMatches.length > 0 || (supplyMatches.length > 0 && generalMatches.length === 0);
      return { item, text, generalMatches, specialtyMatches, excluded, score, matches };
    });

    const health = ranked.filter((entry) => (entry.generalMatches.length > 0 || entry.specialtyMatches.length > 0) && !entry.excluded);
    const radar = health
      .sort((a, b) => Date.parse(a.item.dataEncerramentoProposta || '') - Date.parse(b.item.dataEncerramentoProposta || '') || b.score - a.score)
      .slice(0, 30)
      .map((entry) => compact(entry.item, entry.score, entry.matches));
    const regional = [...health]
      .filter((entry) => (entry.specialtyMatches.length || !specialties.length)
        && (!territorialFilterActive || allowedMunicipalities.has(String(entry.item.unidadeOrgao?.codigoIbge || ''))))
      .sort((a, b) => b.score - a.score || Date.parse(a.item.dataEncerramentoProposta || '') - Date.parse(b.item.dataEncerramentoProposta || ''))
      .slice(0, 20)
      .map((entry) => compact(entry.item, entry.score, entry.matches));

    return json(request, {
      radar,
      regional,
      profile: {
        crmUf: registrationResult.data.crm_uf,
        crmNumber: registrationResult.data.crm_number,
        registrationStatus: registrationResult.data.registration_status,
        opportunityUf: uf,
        opportunityCity: profileResult.data?.opportunity_city || '',
        opportunityCityCode: effectiveCityCode,
        opportunityRadiusKm: radiusKm,
        specialties: specialties.map((item) => ({ code: item.specialty_code, name: item.specialty_name, rqeNumber: item.rqe_number || '', status: item.verification_status })),
      },
      meta: {
        source: 'Portal Nacional de Contratações Públicas (PNCP)',
        sourceUrl: 'https://pncp.gov.br/app/editais',
        fetchedAt: new Date().toISOString(),
        recordsInspected: records.length,
        totalRecordsReported: first.totalRecords,
        pagesInspected: successfulPages.length,
        sampledPages: successfulPages,
        failedPages,
        truncated: first.totalPages > successfulPages.length,
        scope: `${uf} · propostas abertas com encerramento em até 120 dias`,
        regionalScope: territorialFilterActive
          ? `${profileResult.data?.opportunity_city || cityCode} · raio territorial de ${radiusKm} km`
          : `${uf} · todo o estado`,
        regionalMunicipalities: territorialFilterActive ? allowedMunicipalities.size : null,
      },
    });
  } catch (error) {
    console.error('market-intelligence', error);
    return publicError(request, 'Não foi possível atualizar o radar agora.', authenticationStatus(error, 502));
  }
});
