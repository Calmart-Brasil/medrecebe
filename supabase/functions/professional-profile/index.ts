import { json, options, publicError } from '../_shared/http.ts';
import { normalizeSpecialties } from '../_shared/medical-specialties.ts';
import { clientAddress, consumeRateLimit } from '../_shared/rate-limit.ts';
import { adminClient, authenticatedUser, authenticationStatus } from '../_shared/supabase.ts';

const UFS = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);

function normalizeCrmNumber(value: unknown): string {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 13);
}

function validCrmNumber(value: string): boolean {
  return /^(EME)?[0-9]{1,10}P?$/.test(value);
}

async function readProfile(userId: string) {
  const admin = adminClient();
  const [profileResult, registrationResult, specialtiesResult] = await Promise.all([
    admin.from('professional_profiles').select('opportunity_city, opportunity_city_code, opportunity_uf, opportunity_radius_km, updated_at').eq('user_id', userId).maybeSingle(),
    admin.from('professional_registrations').select('id, crm_uf, crm_number, is_primary, registration_status, verification_source, verified_at, source_updated_at').eq('user_id', userId).order('is_primary', { ascending: false }).order('created_at'),
    admin.from('professional_specialties').select('id, specialty_code, specialty_name, rqe_number, verification_status, verification_source, confirmed_by_user, verified_at, source_updated_at').eq('user_id', userId).order('specialty_name'),
  ]);
  if (profileResult.error) throw profileResult.error;
  if (registrationResult.error) throw registrationResult.error;
  if (specialtiesResult.error) throw specialtiesResult.error;
  return {
    opportunityCity: profileResult.data?.opportunity_city || '',
    opportunityCityCode: profileResult.data?.opportunity_city_code || '',
    opportunityUf: profileResult.data?.opportunity_uf || registrationResult.data?.find((item) => item.is_primary)?.crm_uf || '',
    opportunityRadiusKm: profileResult.data?.opportunity_radius_km || 100,
    registrations: (registrationResult.data || []).map((item) => ({
      id: item.id,
      crmUf: item.crm_uf,
      crmNumber: item.crm_number,
      primary: item.is_primary,
      status: item.registration_status,
      source: item.verification_source,
      verifiedAt: item.verified_at,
      sourceUpdatedAt: item.source_updated_at,
    })),
    specialties: (specialtiesResult.data || []).map((item) => ({
      id: item.id,
      code: item.specialty_code,
      name: item.specialty_name,
      rqeNumber: item.rqe_number || '',
      status: item.verification_status,
      source: item.verification_source,
      confirmedByUser: item.confirmed_by_user,
      verifiedAt: item.verified_at,
      sourceUpdatedAt: item.source_updated_at,
    })),
    verification: {
      cfmConnectorAvailable: Boolean(Deno.env.get('CFM_WEBSERVICE_URL') && Deno.env.get('CFM_WEBSERVICE_KEY')),
      source: 'CFM Webservice — Resolução CFM nº 2.309/2022',
    },
  };
}

Deno.serve(async (request) => {
  const preflight = options(request);
  if (preflight) return preflight;
  if (request.method !== 'POST') return publicError(request, 'Método não permitido.', 405);

  try {
    const user = await authenticatedUser(request);
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || 'get');
    if (action === 'get') return json(request, { professional: await readProfile(user.id) });
    if (action !== 'save') return publicError(request, 'Ação inválida.');

    const [ipLimit, accountLimit] = await Promise.all([
      consumeRateLimit('professional_profile_ip', clientAddress(request), 30, 60 * 60, 60 * 60),
      consumeRateLimit('professional_profile_account', user.id, 20, 60 * 60, 60 * 60),
    ]);
    if (!ipLimit.allowed || !accountLimit.allowed) {
      const retryAfter = Math.max(ipLimit.retryAfterSeconds, accountLimit.retryAfterSeconds, 1);
      return publicError(request, 'Muitas alterações. Aguarde e tente novamente.', 429, { 'Retry-After': String(retryAfter) });
    }

    const crmUf = String(body.crmUf || '').trim().toUpperCase();
    const crmNumber = normalizeCrmNumber(body.crmNumber);
    const opportunityUf = String(body.opportunityUf || crmUf).trim().toUpperCase();
    const opportunityCity = String(body.opportunityCity || '').trim().slice(0, 120);
    const opportunityCityCode = String(body.opportunityCityCode || '').replace(/\D/g, '').slice(0, 7);
    const opportunityRadiusKm = Math.min(1000, Math.max(10, Number(body.opportunityRadiusKm) || 100));
    const specialties = normalizeSpecialties(body.specialties);
    if (!UFS.has(crmUf)) return publicError(request, 'Selecione a UF do CRM.');
    if (!validCrmNumber(crmNumber)) return publicError(request, 'Informe um número de CRM válido.');
    if (!UFS.has(opportunityUf)) return publicError(request, 'Selecione uma UF válida para as oportunidades.');
    if (opportunityCityCode && !/^\d{7}$/.test(opportunityCityCode)) return publicError(request, 'Selecione um município válido.');
    if (opportunityRadiusKm < 1000 && !opportunityCityCode) return publicError(request, 'Selecione o município-base do raio.');

    const admin = adminClient();
    const { data: existing } = await admin
      .from('professional_registrations')
      .select('id, registration_status, verification_source, verified_at, source_updated_at')
      .eq('user_id', user.id)
      .eq('crm_uf', crmUf)
      .eq('crm_number', crmNumber)
      .maybeSingle();

    const { error: profileError } = await admin.from('professional_profiles').upsert({
      user_id: user.id,
      opportunity_city: opportunityCity || null,
      opportunity_city_code: opportunityCityCode || null,
      opportunity_uf: opportunityUf,
      opportunity_radius_km: opportunityRadiusKm,
    }, { onConflict: 'user_id' });
    if (profileError) throw profileError;

    await admin.from('professional_registrations').update({ is_primary: false }).eq('user_id', user.id);
    const registrationPayload = {
      user_id: user.id,
      crm_uf: crmUf,
      crm_number: crmNumber,
      is_primary: true,
      registration_status: existing?.registration_status || 'self_reported',
      verification_source: existing?.verification_source || 'self_reported',
      verified_at: existing?.verified_at || null,
      source_updated_at: existing?.source_updated_at || null,
    };
    const registrationResult = existing
      ? await admin.from('professional_registrations').update(registrationPayload).eq('id', existing.id).select('id').single()
      : await admin.from('professional_registrations').insert(registrationPayload).select('id').single();
    if (registrationResult.error) throw registrationResult.error;

    const { data: verifiedSpecialties, error: verifiedError } = await admin
      .from('professional_specialties')
      .select('specialty_code, verification_status, verification_source, verified_at, source_updated_at')
      .eq('user_id', user.id);
    if (verifiedError) throw verifiedError;
    const verifiedByCode = new Map((verifiedSpecialties || []).map((item) => [item.specialty_code, item]));
    const { error: deleteError } = await admin.from('professional_specialties').delete().eq('user_id', user.id);
    if (deleteError) throw deleteError;
    if (specialties.length) {
      const { error: insertError } = await admin.from('professional_specialties').insert(specialties.map((item) => {
        const previous = verifiedByCode.get(item.code);
        const keepVerified = previous?.verification_status === 'verified';
        return {
          user_id: user.id,
          registration_id: registrationResult.data.id,
          specialty_code: item.code,
          specialty_name: item.name,
          rqe_number: item.rqeNumber || null,
          verification_status: keepVerified ? 'verified' : 'self_reported',
          verification_source: keepVerified ? previous.verification_source : 'self_reported',
          confirmed_by_user: true,
          verified_at: keepVerified ? previous.verified_at : null,
          source_updated_at: keepVerified ? previous.source_updated_at : null,
        };
      }));
      if (insertError) throw insertError;
    }

    return json(request, { saved: true, professional: await readProfile(user.id) });
  } catch (error) {
    console.error('professional-profile', error);
    return publicError(request, 'Não foi possível salvar o perfil profissional.', authenticationStatus(error, 500));
  }
});
