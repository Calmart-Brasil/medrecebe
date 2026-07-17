import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const RMSP_MUNICIPALITIES = new Map([
  ['350390', 'Arujá'],
  ['350570', 'Barueri'],
  ['350660', 'Biritiba-Mirim'],
  ['350900', 'Caieiras'],
  ['350920', 'Cajamar'],
  ['351060', 'Carapicuíba'],
  ['351300', 'Cotia'],
  ['351380', 'Diadema'],
  ['351500', 'Embu das Artes'],
  ['351510', 'Embu-Guaçu'],
  ['351570', 'Ferraz de Vasconcelos'],
  ['351630', 'Francisco Morato'],
  ['351640', 'Franco da Rocha'],
  ['351830', 'Guararema'],
  ['351880', 'Guarulhos'],
  ['352220', 'Itapecerica da Serra'],
  ['352250', 'Itapevi'],
  ['352310', 'Itaquaquecetuba'],
  ['352500', 'Jandira'],
  ['352620', 'Juquitiba'],
  ['352850', 'Mairiporã'],
  ['352940', 'Mauá'],
  ['353060', 'Mogi das Cruzes'],
  ['353440', 'Osasco'],
  ['353910', 'Pirapora do Bom Jesus'],
  ['353980', 'Poá'],
  ['354330', 'Ribeirão Pires'],
  ['354410', 'Rio Grande da Serra'],
  ['354500', 'Salesópolis'],
  ['354680', 'Santa Isabel'],
  ['354730', 'Santana de Parnaíba'],
  ['354780', 'Santo André'],
  ['354870', 'São Bernardo do Campo'],
  ['354880', 'São Caetano do Sul'],
  ['354995', 'São Lourenço da Serra'],
  ['355030', 'São Paulo'],
  ['355250', 'Suzano'],
  ['355280', 'Taboão da Serra'],
  ['355645', 'Vargem Grande Paulista'],
]);

const TYPE_NAMES = new Map([
  ['2', 'Centro de saúde / Unidade básica'],
  ['4', 'Policlínica'],
  ['5', 'Hospital geral'],
  ['7', 'Hospital especializado'],
  ['15', 'Unidade mista'],
  ['20', 'Pronto-socorro geral'],
  ['21', 'Pronto-socorro especializado'],
  ['22', 'Consultório isolado'],
  ['36', 'Clínica / Centro de especialidade'],
  ['39', 'Unidade de apoio diagnóstico e terapia'],
  ['42', 'Unidade móvel pré-hospitalar de urgência'],
  ['60', 'Cooperativa ou empresa de cessão de trabalhadores na saúde'],
  ['61', 'Centro de parto normal isolado'],
  ['62', 'Hospital-dia isolado'],
  ['68', 'Central de gestão em saúde'],
  ['69', 'Centro de atenção em hemoterapia ou hematologia'],
  ['70', 'Centro de atenção psicossocial'],
  ['73', 'Pronto atendimento'],
]);

const HOSPITAL_TYPES = new Set(['5', '7', '62']);
const COMPANY_TYPES = new Set(['42', '60', '68']);
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
const output = resolve(args.get('output') || 'data/institution-directory-rmsp.json');
const sourceUpdatedAt = args.get('source-date') || new Date().toISOString().slice(0, 10);

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
      } else {
        quoted = !quoted;
      }
    } else if (char === ';' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += char;
    }
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
    const weights = length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
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
  return [
    [clean(row.NO_LOGRADOURO), clean(row.NU_ENDERECO)].filter(Boolean).join(', '),
    clean(row.NO_BAIRRO),
    city,
  ].filter(Boolean).join(' · ');
}

const reader = createInterface({
  input: createReadStream(input, { encoding: 'utf8' }),
  crlfDelay: Infinity,
});
let headers = null;
const institutions = [];
let inspected = 0;

for await (const line of reader) {
  if (!headers) {
    headers = parseCsvRow(line).map((header) => header.replace(/^\uFEFF/, ''));
    continue;
  }
  inspected += 1;
  const values = parseCsvRow(line);
  const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
  if (row.CO_UF !== '35' || !RMSP_MUNICIPALITIES.has(row.CO_IBGE) || clean(row.CO_MOTIVO_DESAB)) continue;
  const category = categoryFor(row);
  if (!category) continue;

  const establishmentCnpj = isValidCnpj(row.NU_CNPJ) ? onlyDigits(row.NU_CNPJ) : '';
  const maintainerCnpj = isValidCnpj(row.NU_CNPJ_MANTENEDORA) ? onlyDigits(row.NU_CNPJ_MANTENEDORA) : '';
  const payerCnpj = establishmentCnpj || maintainerCnpj;
  if (!payerCnpj) continue;

  const city = RMSP_MUNICIPALITIES.get(row.CO_IBGE);
  const cnes = onlyDigits(row.CO_CNES).padStart(7, '0');
  const legalName = clean(row.NO_RAZAO_SOCIAL);
  const name = clean(row.NO_FANTASIA) || legalName;
  institutions.push({
    id: `cnes-${cnes}`,
    cnes,
    category,
    categoryLabel: CATEGORY_LABELS[category],
    typeCode: Number(row.TP_UNIDADE),
    typeName: TYPE_NAMES.get(row.TP_UNIDADE) || `Tipo CNES ${row.TP_UNIDADE}`,
    name,
    legalName,
    payerCnpj,
    payerCnpjSource: establishmentCnpj ? 'establishment' : 'maintainer',
    establishmentCnpj,
    maintainerCnpj,
    cityCode: row.CO_IBGE,
    city,
    state: 'SP',
    address: addressLine(row, city),
    street: clean(row.NO_LOGRADOURO),
    number: clean(row.NU_ENDERECO),
    district: clean(row.NO_BAIRRO),
    postalCode: onlyDigits(row.CO_CEP),
    phone: clean(row.NU_TELEFONE),
    email: clean(row.NO_EMAIL).toLowerCase(),
    source: 'CNES / Ministério da Saúde',
  });
}

institutions.sort((left, right) => left.name.localeCompare(right.name, 'pt-BR') || left.city.localeCompare(right.city, 'pt-BR'));
const countsByCategory = Object.fromEntries(Object.keys(CATEGORY_LABELS).map((category) => [category, institutions.filter((item) => item.category === category).length]));
const uniqueCnpjs = new Set(institutions.map((item) => item.payerCnpj)).size;
const payload = {
  meta: {
    title: 'Diretório institucional MedRecebe — São Paulo e Região Metropolitana',
    scope: '39 municípios da Região Metropolitana de São Paulo',
    source: 'Cadastro Nacional de Estabelecimentos de Saúde (CNES), Ministério da Saúde',
    sourceUrl: 'https://dadosabertos.saude.gov.br/dataset/cnes-cadastro-nacional-de-estabelecimentos-de-saude',
    sourceUpdatedAt,
    generatedAt: new Date().toISOString(),
    inspectedRecords: inspected,
    total: institutions.length,
    uniqueCnpjs,
    municipalities: RMSP_MUNICIPALITIES.size,
    countsByCategory,
    cnpjCardUrl: 'https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/cnpj.aspx',
    notice: 'Os dados facilitam o preenchimento. O médico deve confirmar no contrato ou na Nota Fiscal qual CNPJ efetivamente realiza o repasse.',
  },
  institutions,
};

await mkdir(dirname(output), { recursive: true });
await new Promise((resolvePromise, rejectPromise) => {
  const stream = createWriteStream(output, { encoding: 'utf8' });
  stream.on('error', rejectPromise);
  stream.on('finish', resolvePromise);
  stream.end(`${JSON.stringify(payload)}\n`);
});

console.log(`${basename(output)}: ${institutions.length} instituições, ${uniqueCnpjs} CNPJs únicos, ${RMSP_MUNICIPALITIES.size} municípios.`);
