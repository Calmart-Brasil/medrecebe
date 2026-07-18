const DIRECTORY_URL = 'https://medrecebe.com.br/data/institution-directory-rmsp.json?v=20260717';

export const CNPJ_CARD_URL = 'https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/cnpj.aspx';

export interface DirectoryInstitution {
  id: string;
  cnes: string;
  category: string;
  categoryLabel: string;
  typeName: string;
  name: string;
  tradeName: string;
  legalName: string;
  payerCnpj: string;
  payerCnpjSource: 'establishment' | 'maintainer';
  establishmentCnpj: string;
  maintainerCnpj: string;
  city: string;
  address: string;
}

export interface InstitutionDirectory {
  meta: {
    total: number;
    municipalities: number;
    sourceUpdatedAt: string;
  };
  institutions: DirectoryInstitution[];
}

let cachedDirectory: InstitutionDirectory | null = null;

function normalize(value = ''): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export async function loadInstitutionDirectory(): Promise<InstitutionDirectory> {
  if (cachedDirectory) return cachedDirectory;
  const response = await fetch(DIRECTORY_URL);
  if (!response.ok) throw new Error('Diretório institucional indisponível.');
  cachedDirectory = await response.json() as InstitutionDirectory;
  return cachedDirectory;
}

export function searchInstitutionDirectory(directory: InstitutionDirectory | null, query: string): DirectoryInstitution[] {
  if (!directory) return [];
  const normalized = normalize(query);
  const digits = query.replace(/\D/g, '').slice(0, 14);
  if (normalized.length < 2 && digits.length < 3) return [];
  const tokens = normalized.split(' ').filter(Boolean);
  return directory.institutions.filter((institution) => {
    if (digits.length >= 3 && institution.payerCnpj.includes(digits)) return true;
    const key = normalize(`${institution.tradeName} ${institution.name} ${institution.legalName} ${institution.city} ${institution.payerCnpj} ${institution.cnes}`);
    return tokens.every((token) => key.includes(token));
  }).slice(0, 10);
}
