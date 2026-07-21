import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const LOCALITIES_URL = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado';
const TABNET_FORM_URL = 'http://tabnet.datasus.gov.br/cgi/deftohtm.exe?cnes/cnv/prid02br.def';
const TABNET_QUERY_URL = 'http://tabnet.datasus.gov.br/cgi/tabcgi.exe?cnes/cnv/prid02br.def';

const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...parts] = argument.replace(/^--/, '').split('=');
  return [key, parts.join('=')];
}));
const municipalityOutput = resolve(args.get('municipality-output') || 'data/municipalities');
const densityOutput = resolve(args.get('density-output') || 'data/medical-density');

function decodeEntities(value = '') {
  const named = {
    amp: '&', apos: "'", quot: '"', nbsp: ' ',
    aacute: 'á', Aacute: 'Á', acirc: 'â', Acirc: 'Â', agrave: 'à', atilde: 'ã', Atilde: 'Ã',
    eacute: 'é', Eacute: 'É', ecirc: 'ê', Ecirc: 'Ê', iacute: 'í', Iacute: 'Í',
    oacute: 'ó', Oacute: 'Ó', ocirc: 'ô', Ocirc: 'Ô', otilde: 'õ', Otilde: 'Õ',
    uacute: 'ú', Uacute: 'Ú', ccedil: 'ç', Ccedil: 'Ç', ordm: 'º', ndash: '–', mdash: '—',
  };
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => named[name] ?? match)
    .replace(/<[^>]+>/g, '')
    .trim();
}

async function fetchWithRetry(url, options = {}, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(options.timeout || 240_000) });
      if (!response.ok) throw new Error(`${url} respondeu ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 1200));
    }
  }
  throw lastError;
}

async function fetchJsonWithRetry(url, options = {}, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchWithRetry(url, options, 1);
      return JSON.parse(Buffer.from(await response.arrayBuffer()).toString('utf8'));
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 1500));
    }
  }
  throw lastError;
}

function latin1Form(pairs) {
  const encode = (value) => [...Buffer.from(String(value), 'latin1')]
    .map((byte) => /[A-Za-z0-9_.~-]/.test(String.fromCharCode(byte)) ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
    .join('');
  return pairs.map(([key, value]) => `${encode(key)}=${encode(value)}`).join('&');
}

function parseDelimitedRow(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === ';' && !quoted) {
      values.push(decodeEntities(value));
      value = '';
    } else value += character;
  }
  values.push(decodeEntities(value));
  return values;
}

function parseTabnet(html) {
  const pre = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)?.[1] || '';
  const rows = pre.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('"'));
  if (rows.length < 2) throw new Error('O TabNet não retornou uma tabela utilizável.');
  return rows.map(parseDelimitedRow);
}

async function tabnetQuery(pairs) {
  const response = await fetchWithRetry(TABNET_QUERY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: latin1Form(pairs),
    timeout: 300_000,
  });
  return parseTabnet(Buffer.from(await response.arrayBuffer()).toString('latin1'));
}

function polygonCentroid(ring) {
  let twiceArea = 0;
  let longitude = 0;
  let latitude = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    longitude += (x1 + x2) * cross;
    latitude += (y1 + y2) * cross;
  }
  if (Math.abs(twiceArea) < 1e-10) {
    const points = ring.slice(0, -1);
    return { longitude: points.reduce((sum, point) => sum + point[0], 0) / points.length, latitude: points.reduce((sum, point) => sum + point[1], 0) / points.length, area: 0 };
  }
  return { longitude: longitude / (3 * twiceArea), latitude: latitude / (3 * twiceArea), area: Math.abs(twiceArea / 2) };
}

function geometryCentroid(geometry) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  const candidates = polygons.map((polygon) => polygonCentroid(polygon[0])).sort((left, right) => right.area - left.area);
  return candidates[0] || { longitude: 0, latitude: 0 };
}

async function municipalityDirectory(localities) {
  const byUf = new Map(UFS.map((uf) => [uf, []]));
  const localitiesByCode = new Map(localities.map((row) => [String(row['municipio-id']), row]));
  for (const uf of UFS) {
    const url = `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${uf}?formato=application%2Fvnd.geo%2Bjson&qualidade=minima&intrarregiao=municipio`;
    const mesh = await fetchJsonWithRetry(url, { headers: { Accept: 'application/vnd.geo+json' }, timeout: 120_000 });
    for (const feature of mesh.features || []) {
      const ibgeCode = String(feature.properties?.codarea || '');
      const locality = localitiesByCode.get(ibgeCode);
      if (!locality) continue;
      const center = geometryCentroid(feature.geometry);
      byUf.get(uf).push({
        ibgeCode,
        name: locality['municipio-nome'],
        latitude: Number(center.latitude.toFixed(5)),
        longitude: Number(center.longitude.toFixed(5)),
      });
    }
    byUf.get(uf).sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
    console.log(`${uf}: ${byUf.get(uf).length} municípios georreferenciados`);
  }
  return byUf;
}

const formResponse = await fetchWithRetry(TABNET_FORM_URL, { timeout: 120_000 });
const formHtml = Buffer.from(await formResponse.arrayBuffer()).toString('latin1');
const periodMatch = formHtml.match(/<option\s+value="(pfbr\d{4}\.dbf)"\s+selected[^>]*>([^<]+)/i);
const periodFile = args.get('period-file') || periodMatch?.[1];
const periodLabel = decodeEntities(periodMatch?.[2] || periodFile || 'Competência atual');
if (!periodFile) throw new Error('Não foi possível identificar a competência atual do CNES.');
const doctorsSelect = formHtml.match(/<select[^>]+name="SMédicos"[^>]*>([\s\S]*?)<\/select>/i)?.[1] || '';
const medicalOptions = [...doctorsSelect.matchAll(/<option\s+value="([^"]+)"[^>]*>([^<]+)/gi)]
  .map((match) => ({ value: match[1], name: decodeEntities(match[2]) }))
  .filter((option) => /^\d+$/.test(option.value));
if (!medicalOptions.length) throw new Error('A lista de ocupações médicas do CNES não foi encontrada.');

const basePairs = [['Incremento', 'Quantidade'], ['Arquivos', periodFile], ['formato', 'prn'], ['mostre', 'Mostra']];
const uniqueRows = await tabnetQuery([
  ['Linha', 'Município'], ['Coluna', '--Não-Ativa--'], ...basePairs,
  ...medicalOptions.map((option) => ['SMédicos', option.value]),
]);
const stateRows = await tabnetQuery([
  ['Linha', 'Unidade_da_Federação'], ['Coluna', '--Não-Ativa--'], ...basePairs,
  ...medicalOptions.map((option) => ['SMédicos', option.value]),
]);
const specialtyRows = await tabnetQuery([
  ['Linha', 'Município'], ['Coluna', 'Médicos'], ...basePairs,
]);

const localities = await fetchJsonWithRetry(LOCALITIES_URL, { headers: { Accept: 'application/json' }, timeout: 120_000 });
const municipalitiesByUf = await municipalityDirectory(localities);
const localityBySixDigits = new Map(localities.map((row) => [String(row['municipio-id']).slice(0, 6), row]));
const uniqueByCode = new Map(uniqueRows.slice(1).map((row) => [String(row[0]).match(/^\d{6}/)?.[0] || '', Number(row[1]) || 0]).filter(([code]) => code));
const uniqueByStateCode = new Map(stateRows.slice(1).map((row) => [String(row[0]).match(/^\d{2}/)?.[0] || '', Number(row[1]) || 0]).filter(([code]) => code));
const nationalUniquePhysicians = Number(stateRows.find((row) => row[0] === 'Total')?.[1]) || 0;
const specialtyHeaders = specialtyRows[0].slice(1, -1);
const specialtyByCode = new Map(specialtyRows.slice(1).map((row) => {
  const code = String(row[0]).match(/^\d{6}/)?.[0] || '';
  return [code, row.slice(1, -1).map((value) => value === '-' ? 0 : Number(value) || 0)];
}).filter(([code]) => code));

await Promise.all([mkdir(municipalityOutput, { recursive: true }), mkdir(densityOutput, { recursive: true })]);
for (const uf of UFS) {
  const municipalities = municipalitiesByUf.get(uf) || [];
  const municipalityPayload = {
    meta: {
      source: 'IBGE — API de Localidades e API de Malhas',
      sourceUrl: 'https://servicodados.ibge.gov.br/api/docs/',
      coordinateMethod: 'Centroide do maior polígono municipal na malha de qualidade mínima',
      generatedAt: new Date().toISOString(),
      uf,
      total: municipalities.length,
    },
    municipalities,
  };
  await writeFile(resolve(municipalityOutput, `${uf}.json`), `${JSON.stringify(municipalityPayload)}\n`, 'utf8');

  const densityMunicipalities = municipalities.map((municipality) => {
    const shortCode = municipality.ibgeCode.slice(0, 6);
    return {
      ibgeCode: municipality.ibgeCode,
      name: municipality.name,
      physicians: uniqueByCode.get(shortCode) || 0,
      specialties: specialtyByCode.get(shortCode) || specialtyHeaders.map(() => 0),
    };
  });
  const municipalPresence = densityMunicipalities.reduce((sum, municipality) => sum + municipality.physicians, 0);
  const stateCode = localities.find((row) => row['UF-sigla'] === uf)?.['UF-id'];
  const uniquePhysicians = uniqueByStateCode.get(String(stateCode || '')) || 0;
  const densityPayload = {
    meta: {
      source: 'CNES / DATASUS — Recursos Humanos — Profissionais (indivíduos) segundo CBO 2002',
      sourceUrl: 'https://tabnet.datasus.gov.br/cgi/deftohtm.exe?cnes/cnv/prid02br.def',
      technicalNotesUrl: 'https://tabnet.datasus.gov.br/cgi/cnes/NT_RecursosHumanos.htm',
      period: periodLabel,
      periodFile,
      generatedAt: new Date().toISOString(),
      uf,
      uniquePhysicians,
      municipalPresence,
      municipalities: densityMunicipalities.filter((municipality) => municipality.physicians > 0).length,
      methodology: 'O total considera indivíduos selecionados em todas as ocupações médicas. A visão por especialidade utiliza a ocupação CBO e não equivale ao RQE do CFM.',
    },
    specialtyNames: specialtyHeaders,
    municipalities: densityMunicipalities,
  };
  await writeFile(resolve(densityOutput, `${uf}.json`), `${JSON.stringify(densityPayload)}\n`, 'utf8');
}

await writeFile(resolve(municipalityOutput, 'index.json'), `${JSON.stringify({
  meta: { source: 'IBGE', generatedAt: new Date().toISOString(), total: localities.length, states: UFS.length },
  states: UFS.map((uf) => ({ uf, total: municipalitiesByUf.get(uf)?.length || 0, file: `${uf}.json` })),
})}\n`, 'utf8');
await writeFile(resolve(densityOutput, 'index.json'), `${JSON.stringify({
  meta: { source: 'CNES / DATASUS', period: periodLabel, periodFile, generatedAt: new Date().toISOString(), uniquePhysicians: nationalUniquePhysicians, states: UFS.length },
  specialtyNames: specialtyHeaders,
  states: UFS.map((uf) => ({ uf, file: `${uf}.json` })),
})}\n`, 'utf8');

console.log(`Mapa concluído: ${localities.length} municípios, ${nationalUniquePhysicians} médicos únicos no CNES, competência ${periodLabel}.`);
