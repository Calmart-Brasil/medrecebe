import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

const UF_BY_CODE = new Map([
  ['11', 'RO'], ['12', 'AC'], ['13', 'AM'], ['14', 'RR'], ['15', 'PA'], ['16', 'AP'], ['17', 'TO'],
  ['21', 'MA'], ['22', 'PI'], ['23', 'CE'], ['24', 'RN'], ['25', 'PB'], ['26', 'PE'], ['27', 'AL'],
  ['28', 'SE'], ['29', 'BA'], ['31', 'MG'], ['32', 'ES'], ['33', 'RJ'], ['35', 'SP'], ['41', 'PR'],
  ['42', 'SC'], ['43', 'RS'], ['50', 'MS'], ['51', 'MT'], ['52', 'GO'], ['53', 'DF'],
]);

const TYPE_NAMES = new Map([
  ['2', 'Centro de saúde / Unidade básica'], ['4', 'Policlínica'], ['5', 'Hospital geral'],
  ['7', 'Hospital especializado'], ['15', 'Unidade mista'], ['20', 'Pronto-socorro geral'],
  ['21', 'Pronto-socorro especializado'], ['22', 'Consultório isolado'], ['36', 'Clínica / Centro de especialidade'],
  ['39', 'Unidade de apoio diagnóstico e terapia'], ['42', 'Unidade móvel pré-hospitalar de urgência'],
  ['60', 'Cooperativa ou empresa de cessão de trabalhadores na saúde'], ['61', 'Centro de parto normal isolado'],
  ['62', 'Hospital-dia isolado'], ['68', 'Central de gestão em saúde'],
  ['69', 'Centro de atenção em hemoterapia ou hematologia'], ['70', 'Centro de atenção psicossocial'],
  ['73', 'Pronto atendimento'],
]);

const HOSPITAL_TYPES = new Set(['5', '7', '62']);
const CATEGORY_LABELS = {
  hospital: 'Hospital ou estabelecimento assistencial',
  medical_staffing: 'Cooperativa ou empresa de cessão de profissionais',
  ambulance: 'Ambulância ou atendimento pré-hospitalar',
  health_management: 'Gestão em saúde',
};

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...parts] = arg.replace(/^--/, '').split('=');
  return [key, parts.join('=')];
}));
const input = resolve(args.get('input') || '.tmp-cnes/csv/cnes_estabelecimentos.csv');
const outputDir = resolve(args.get('output-dir') || 'data/institutions');
const sourceUpdatedAt = args.get('source-date') || new Date().toISOString().slice(0, 10);
const ibgeUrl = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado';

function parseCsvRow(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === ';' && !quoted) {
      values.push(value);
      value = '';
    } else value += char;
  }
  values.push(value);
  return values;
}

function onlyDigits(value = '') {
  return String(value).replace(/\D/g, '');
}

function isValidCnpj(value = '') {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const digit = (length) => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + Number(cnpj[index]) * weight, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return digit(12) === Number(cnpj[12]) && digit(13) === Number(cnpj[13]);
}

function clean(value = '') {
  return String(value).trim().replace(/\s+/g, ' ');
}

function categoryFor(row) {
  if (row.TP_UNIDADE === '60') return 'medical_staffing';
  if (row.TP_UNIDADE === '42') return 'ambulance';
  if (row.TP_UNIDADE === '68') return 'health_management';
  if (HOSPITAL_TYPES.has(row.TP_UNIDADE) || row.ST_ATEND_HOSPITALAR === '1.0') return 'hospital';
  return '';
}

function addressLine(row, city) {
  return [[clean(row.NO_LOGRADOURO), clean(row.NU_ENDERECO)].filter(Boolean).join(', '), clean(row.NO_BAIRRO), city].filter(Boolean).join(' · ');
}

async function municipalityMap() {
  const response = await fetch(ibgeUrl, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`IBGE indisponível (${response.status})`);
  const rows = await response.json();
  return new Map(rows.map((row) => [String(row['municipio-id']).slice(0, 6), {
    name: row['municipio-nome'],
    state: row['UF-sigla'],
    fullCode: String(row['municipio-id']),
  }]));
}

const municipalities = await municipalityMap();
const byUf = new Map([...UF_BY_CODE.values()].map((uf) => [uf, []]));
const reader = createInterface({ input: createReadStream(input, { encoding: 'utf8' }), crlfDelay: Infinity });
let headers = null;
let inspected = 0;

for await (const line of reader) {
  if (!headers) {
    headers = parseCsvRow(line).map((header) => header.replace(/^\uFEFF/, ''));
    continue;
  }
  inspected += 1;
  const values = parseCsvRow(line);
  const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
  if (clean(row.CO_MOTIVO_DESAB)) continue;
  const category = categoryFor(row);
  if (!category) continue;
  const state = UF_BY_CODE.get(row.CO_UF);
  const municipality = municipalities.get(row.CO_IBGE);
  if (!state || !municipality) continue;
  const establishmentCnpj = isValidCnpj(row.NU_CNPJ) ? onlyDigits(row.NU_CNPJ) : '';
  const maintainerCnpj = isValidCnpj(row.NU_CNPJ_MANTENEDORA) ? onlyDigits(row.NU_CNPJ_MANTENEDORA) : '';
  const payerCnpj = establishmentCnpj || maintainerCnpj;
  if (!payerCnpj) continue;
  const cnes = onlyDigits(row.CO_CNES).padStart(7, '0');
  const legalName = clean(row.NO_RAZAO_SOCIAL);
  const tradeName = clean(row.NO_FANTASIA);
  byUf.get(state).push({
    id: `cnes-${cnes}`, cnes, category, categoryLabel: CATEGORY_LABELS[category],
    typeCode: Number(row.TP_UNIDADE), typeName: TYPE_NAMES.get(row.TP_UNIDADE) || `Tipo CNES ${row.TP_UNIDADE}`,
    name: tradeName || legalName, tradeName, legalName, payerCnpj,
    payerCnpjSource: establishmentCnpj ? 'establishment' : 'maintainer', establishmentCnpj, maintainerCnpj,
    cityCode: row.CO_IBGE, ibgeCode: municipality.fullCode, city: municipality.name, state,
    address: addressLine(row, municipality.name), street: clean(row.NO_LOGRADOURO), number: clean(row.NU_ENDERECO),
    district: clean(row.NO_BAIRRO), postalCode: onlyDigits(row.CO_CEP),
    source: 'CNES / Ministério da Saúde',
  });
}

await mkdir(outputDir, { recursive: true });
const states = [];
let nationalTotal = 0;
let nationalUniqueCnpjs = 0;
const nationalCnpjs = new Set();
for (const [uf, institutions] of byUf) {
  institutions.sort((left, right) => left.name.localeCompare(right.name, 'pt-BR') || left.city.localeCompare(right.city, 'pt-BR'));
  const uniqueCnpjs = new Set(institutions.map((item) => item.payerCnpj)).size;
  const municipalityCount = new Set(institutions.map((item) => item.ibgeCode)).size;
  const countsByCategory = Object.fromEntries(Object.keys(CATEGORY_LABELS).map((category) => [category, institutions.filter((item) => item.category === category).length]));
  const meta = {
    title: `Diretório institucional MedRecebe — ${uf}`, scope: `Estado ${uf}`,
    source: 'Cadastro Nacional de Estabelecimentos de Saúde (CNES), Ministério da Saúde',
    sourceUrl: 'https://dadosabertos.saude.gov.br/dataset/cnes-cadastro-nacional-de-estabelecimentos-de-saude',
    municipalitySource: 'IBGE — API de Localidades', municipalitySourceUrl: ibgeUrl,
    sourceUpdatedAt, generatedAt: new Date().toISOString(), inspectedRecords: inspected,
    total: institutions.length, uniqueCnpjs, municipalities: municipalityCount, countsByCategory,
    cnpjCardUrl: 'https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/cnpj.aspx',
    notice: 'Os dados facilitam o preenchimento. O médico deve confirmar no contrato ou na Nota Fiscal qual CNPJ efetivamente realiza o repasse.',
  };
  await writeFile(resolve(outputDir, `${uf}.json`), `${JSON.stringify({ meta, institutions })}\n`, 'utf8');
  states.push({ uf, total: institutions.length, uniqueCnpjs, municipalities: municipalityCount, countsByCategory, file: `${uf}.json` });
  nationalTotal += institutions.length;
  nationalUniqueCnpjs += uniqueCnpjs;
  institutions.forEach((item) => nationalCnpjs.add(item.payerCnpj));
}

const index = {
  meta: {
    title: 'Diretório institucional MedRecebe — Brasil', scope: '26 estados e Distrito Federal',
    source: 'CNES / Ministério da Saúde', sourceUrl: 'https://dadosabertos.saude.gov.br/dataset/cnes-cadastro-nacional-de-estabelecimentos-de-saude',
    sourceUpdatedAt, generatedAt: new Date().toISOString(), inspectedRecords: inspected,
    total: nationalTotal, uniqueCnpjs: nationalCnpjs.size, uniqueCnpjsByUf: nationalUniqueCnpjs, states: states.length,
  },
  states,
};
await writeFile(resolve(outputDir, 'index.json'), `${JSON.stringify(index)}\n`, 'utf8');
console.log(`Brasil: ${nationalTotal} instituições em ${states.length} UFs; ${inspected} registros CNES analisados.`);
