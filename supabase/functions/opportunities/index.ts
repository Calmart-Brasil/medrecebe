import { json, options, publicError } from '../_shared/http.ts';
import { clientAddress, consumeRateLimit } from '../_shared/rate-limit.ts';
import { adminClient, authenticatedUser, authenticationStatus } from '../_shared/supabase.ts';

const AREAS = new Set(['medical','nursing','physiotherapy','psychology','nutrition','pharmacy','administration','technician','other']);
const CONTRACTS = new Set(['pj','clt','shift','credentialing','temporary','internship','other']);

function clean(value: unknown, max = 240): string {
  return String(value || '').trim().replace(/[\u0000-\u001f]+/g, ' ').slice(0, max);
}
function validEmail(value: unknown): string {
  const result = clean(value, 180).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(result)) throw new Error('Informe um e-mail válido.');
  return result;
}
function validCnpj(value: unknown): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) throw new Error('Informe um CNPJ válido.');
  const digit = (base: string, weights: number[]) => {
    const sum = [...base].reduce((total, item, index) => total + Number(item) * weights[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const first = digit(digits.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]);
  const second = digit(digits.slice(0, 12) + first, [6,5,4,3,2,9,8,7,6,5,4,3,2]);
  if (digits.slice(-2) !== `${first}${second}`) throw new Error('Informe um CNPJ válido.');
  return digits;
}
async function digest(value: string): Promise<string> {
  const pepper = Deno.env.get('MARKETPLACE_HASH_PEPPER') || 'medrecebe-marketplace';
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${pepper}:${value}`));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function presentOpportunity(row: any, organization = '') {
  return { id: row.id, source: 'MedRecebe', title: row.title, organization, professionalArea: row.professional_area,
    contractType: row.contract_type, specialty: row.specialty, uf: row.uf, city: row.city, description: row.description,
    compensationMinCents: Number(row.compensation_min_cents || 0), compensationMaxCents: Number(row.compensation_max_cents || 0),
    status: row.status, publishedAt: row.published_at, closesAt: row.closes_at };
}
async function ownerOrganization(admin: ReturnType<typeof adminClient>, userId: string) {
  const { data, error } = await admin.from('marketplace_organizations').select('*').eq('owner_user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

Deno.serve(async (request) => {
  const preflight = options(request);
  if (preflight) return preflight;
  if (request.method !== 'POST') return publicError(request, 'Método não permitido.', 405);
  try {
    const user = await authenticatedUser(request);
    const admin = adminClient();
    const body = await request.json().catch(() => ({}));
    const action = clean(body.action || 'list', 40);

    if (action !== 'list') {
      const [ipLimit, accountLimit] = await Promise.all([
        consumeRateLimit('opportunities_write_ip', clientAddress(request), 120, 60 * 60, 60 * 60),
        consumeRateLimit('opportunities_write_account', user.id, 60, 60 * 60, 60 * 60),
      ]);
      if (!ipLimit.allowed || !accountLimit.allowed) {
        const retryAfter = Math.max(ipLimit.retryAfterSeconds, accountLimit.retryAfterSeconds, 1);
        return publicError(request, 'Muitas alterações. Aguarde e tente novamente.', 429, { 'Retry-After': String(retryAfter) });
      }
    }

    if (action === 'list') {
      const uf = clean(body.uf, 2).toUpperCase();
      const area = clean(body.professionalArea || 'all', 40);
      const contract = clean(body.contractType || 'all', 40);
      const codes = Array.isArray(body.municipalityCodes) ? body.municipalityCodes.map((item: unknown) => clean(item, 7)).filter((item: string) => /^\d{7}$/.test(item)).slice(0, 1500) : [];
      let query = admin.from('marketplace_opportunities').select('*, marketplace_organizations!inner(trade_name)').eq('status', 'published').order('published_at', { ascending: false }).limit(100);
      if (/^[A-Z]{2}$/.test(uf)) query = query.eq('uf', uf);
      if (AREAS.has(area)) query = query.eq('professional_area', area);
      if (CONTRACTS.has(contract)) query = query.eq('contract_type', contract);
      if (codes.length) query = query.in('municipality_ibge_code', codes);
      const [{ data, error }, { data: applications, error: applicationError }] = await Promise.all([
        query,
        admin.from('marketplace_applications').select('id, opportunity_id, status, created_at').eq('professional_user_id', user.id),
      ]);
      if (error || applicationError) throw error || applicationError;
      const organization = await ownerOrganization(admin, user.id);
      let ownPostings: any[] = [];
      let workers: any[] = [];
      if (organization) {
        const [postsResult, workersResult] = await Promise.all([
          admin.from('marketplace_opportunities').select('*').eq('organization_id', organization.id).order('created_at', { ascending: false }),
          admin.from('marketplace_workers').select('*').eq('organization_id', organization.id).order('created_at', { ascending: false }),
        ]);
        if (postsResult.error || workersResult.error) throw postsResult.error || workersResult.error;
        ownPostings = postsResult.data || [];
        workers = workersResult.data || [];
      }
      return json(request, {
        opportunities: (data || []).map((row: any) => presentOpportunity(row, row.marketplace_organizations?.trade_name || '')),
        organizations: organization ? [{ id: organization.id, organizationType: organization.organization_type, legalName: organization.legal_name, tradeName: organization.trade_name, cnpjLast4: organization.cnpj_last4, uf: organization.uf, city: organization.city, contactEmail: organization.contact_email, verificationStatus: organization.verification_status }] : [],
        postings: ownPostings.map((row) => presentOpportunity(row, organization?.trade_name || '')),
        workers: workers.map((row) => ({ id: row.id, name: row.name, email: row.email, professionalArea: row.professional_area, professionalRegistration: row.professional_registration, status: row.status, createdAt: row.created_at })),
        applications: (applications || []).map((row: any) => ({ id: row.id, opportunityId: row.opportunity_id, status: row.status, createdAt: row.created_at })),
      });
    }

    if (action === 'save-organization') {
      const type = clean(body.organizationType, 20);
      const legalName = clean(body.legalName, 180);
      const tradeName = clean(body.tradeName, 140);
      const document = validCnpj(body.cnpj);
      const uf = clean(body.uf, 2).toUpperCase();
      const city = clean(body.city, 120);
      if (!['company','government'].includes(type) || legalName.length < 3 || tradeName.length < 2 || !/^[A-Z]{2}$/.test(uf) || city.length < 2) throw new Error('Revise os dados da organização.');
      const { data, error } = await admin.from('marketplace_organizations').upsert({ owner_user_id: user.id, organization_type: type, legal_name: legalName, trade_name: tradeName, cnpj_hash: await digest(document), cnpj_last4: document.slice(-4), uf, city, contact_email: validEmail(body.contactEmail) }, { onConflict: 'owner_user_id' }).select('*').single();
      if (error) throw error;
      return json(request, { organization: { id: data.id, organizationType: data.organization_type, legalName: data.legal_name, tradeName: data.trade_name, cnpjLast4: data.cnpj_last4, uf: data.uf, city: data.city, contactEmail: data.contact_email, verificationStatus: data.verification_status } });
    }

    const organization = await ownerOrganization(admin, user.id);
    if (['create-opportunity','add-worker'].includes(action) && !organization) return publicError(request, 'Cadastre a organização primeiro.', 409);

    if (action === 'create-opportunity') {
      const area = clean(body.professionalArea, 40), contract = clean(body.contractType, 40);
      const title = clean(body.title, 140), description = clean(body.description, 2500);
      const uf = clean(body.uf, 2).toUpperCase(), city = clean(body.city, 120);
      const min = Math.max(0, Math.round(Number(body.compensationMinCents) || 0));
      const max = Math.max(0, Math.round(Number(body.compensationMaxCents) || 0));
      if (!AREAS.has(area) || !CONTRACTS.has(contract) || title.length < 5 || description.length < 20 || !/^[A-Z]{2}$/.test(uf) || city.length < 2 || (max && max < min)) throw new Error('Revise os dados da oportunidade.');
      const code = clean(body.municipalityIbgeCode, 7);
      const { data, error } = await admin.from('marketplace_opportunities').insert({ organization_id: organization.id, created_by: user.id, title, professional_area: area, contract_type: contract, specialty: clean(body.specialty, 140) || null, uf, city, municipality_ibge_code: /^\d{7}$/.test(code) ? code : null, description, compensation_min_cents: min || null, compensation_max_cents: max || null, status: 'published', published_at: new Date().toISOString() }).select('*').single();
      if (error) throw error;
      return json(request, { opportunity: presentOpportunity(data, organization.trade_name) }, 201);
    }

    if (action === 'add-worker') {
      const area = clean(body.professionalArea, 40), name = clean(body.name, 160), workerEmail = validEmail(body.email);
      if (!AREAS.has(area) || name.length < 3) throw new Error('Revise os dados do profissional.');
      const { data, error } = await admin.from('marketplace_workers').upsert({ organization_id: organization.id, linked_user_id: null, name, email: workerEmail, professional_area: area, professional_registration: clean(body.professionalRegistration, 80) || null, status: 'invited' }, { onConflict: 'organization_id,email' }).select('*').single();
      if (error) throw error;
      return json(request, { worker: { id: data.id, name: data.name, email: data.email, professionalArea: data.professional_area, professionalRegistration: data.professional_registration, status: data.status, createdAt: data.created_at } }, 201);
    }

    if (action === 'apply') {
      const opportunityId = clean(body.opportunityId, 80);
      if (!/^[0-9a-f-]{36}$/i.test(opportunityId)) throw new Error('Oportunidade inválida.');
      const { data: available } = await admin.from('marketplace_opportunities').select('id').eq('id', opportunityId).eq('status', 'published').maybeSingle();
      if (!available) return publicError(request, 'Esta oportunidade não está mais disponível.', 409);
      const { data, error } = await admin.from('marketplace_applications').upsert({ opportunity_id: opportunityId, professional_user_id: user.id, status: 'interested' }, { onConflict: 'opportunity_id,professional_user_id' }).select('*').single();
      if (error) throw error;
      return json(request, { application: { id: data.id, opportunityId: data.opportunity_id, status: data.status, createdAt: data.created_at } }, 201);
    }
    return publicError(request, 'Ação inválida.', 400);
  } catch (error) {
    console.error('opportunities', error);
    const message = error instanceof Error ? error.message : '';
    const safe = /^(Informe|Revise|Cadastre|Esta oportunidade|Oportunidade)/.test(message) ? message : 'Não foi possível processar as oportunidades.';
    return publicError(request, safe, authenticationStatus(error, 500));
  }
});
