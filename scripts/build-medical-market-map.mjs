import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const LOCALITIES_URL = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado';
const POPULATION_URL = 'https://apisidra.ibge.gov.br/values/t/6579/n6/all/v/9324/p/2025?formato=json';
const BRAZIL_MESH_URL = 'https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application%2Fvnd.geo%2Bjson&qualidade=minima&intrarregiao=UF';
const TABNET_FORM_URL = 'http://tabnet.datasus.gov.br/cgi/deftohtm.exe?cnes/cnv/prid02br.def';
const TABNET_QUERY_URL = 'http://tabnet.datasus.gov.br/cgi/tabcgi.exe?cnes/cnv/prid02br.def';

const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...parts] = argument.replace(/^--/, '').split('=');
  return [key, parts.join('=')];
}));
const municipalityOutput = resolve(args.get('municipality-output') || 'data/municipalities');
const densityOutput = resolve(args.get('density-output') || 'data/medical-density');
const shapesOutput = resolve(args.get('shapes-output') || 'data/medical-map-shapes');

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

function geometryPolygons(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function featureBounds(features) {
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const feature of features || []) {
    for (const polygon of geometryPolygons(feature.geometry)) {
      for (const ring of polygon) {
        for (const [longitude, latitude] of ring) {
          bounds.minX = Math.min(bounds.minX, longitude);
          bounds.maxX = Math.max(bounds.maxX, longitude);
          bounds.minY = Math.min(bounds.minY, latitude);
          bounds.maxY = Math.max(bounds.maxY, latitude);
        }
      }
    }
  }
  return bounds;
}

function geometrySvgPath(geometry, bounds, width = 640, height = 440, padding = 12) {
  const longitudeRange = Math.max(0.001, bounds.maxX - bounds.minX);
  const latitudeRange = Math.max(0.001, bounds.maxY - bounds.minY);
  const scale = Math.min((width - padding * 2) / longitudeRange, (height - padding * 2) / latitudeRange);
  const projectedWidth = longitudeRange * scale;
  const projectedHeight = latitudeRange * scale;
  const offsetX = (width - projectedWidth) / 2;
  const offsetY = (height - projectedHeight) / 2;
  const project = ([longitude, latitude]) => [
    offsetX + (longitude - bounds.minX) * scale,
    height - offsetY - (latitude - bounds.minY) * scale,
  ];
  const simplify = (points, tolerance = 0.32) => {
    if (points.length <= 4) return points;
    const output = [points[0]];
    for (let index = 1; index < points.length - 1; index += 1) {
      const previous = output[output.length - 1];
      const point = points[index];
      if (Math.hypot(point[0] - previous[0], point[1] - previous[1]) >= tolerance) output.push(point);
    }
    output.push(points[points.length - 1]);
    return output;
  };
  return geometryPolygons(geometry).flatMap((polygon) => polygon.map((ring) => {
    const points = simplify(ring.map(project));
    if (points.length < 3) return '';
    return `M${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z`;
  })).join('');
}

async function municipalityDirectory(localities) {
  const byUf = new Map(UFS.map((uf) => [uf, []]));
  const shapesByUf = new Map();
  const localitiesByCode = new Map(localities.map((row) => [String(row['municipio-id']), row]));
  for (const uf of UFS) {
    const url = `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${uf}?formato=application%2Fvnd.geo%2Bjson&qualidade=minima&intrarregiao=municipio`;
    const mesh = await fetchJsonWithRetry(url, { headers: { Accept: 'application/vnd.geo+json' }, timeout: 120_000 });
    const bounds = featureBounds(mesh.features || []);
    const shapes = [];
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
      shapes.push({ ibgeCode, path: geometrySvgPath(feature.geometry, bounds) });
    }
    byUf.get(uf).sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
    shapesByUf.set(uf, { meta: { uf, viewBox: '0 0 640 440', source: 'IBGE — Malha Municipal Digital' }, shapes });
    console.log(`${uf}: ${byUf.get(uf).length} municípios georreferenciados`);
  }
  return { byUf, shapesByUf };
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
const stateSpecialtyRows = await tabnetQuery([
  ['Linha', 'Unidade_da_Federação'], ['Coluna', 'Médicos'], ...basePairs,
]);

const localities = await fetchJsonWithRetry(LOCALITIES_URL, { headers: { Accept: 'application/json' }, timeout: 120_000 });
const populationRows = await fetchJsonWithRetry(POPULATION_URL, { headers: { Accept: 'application/json' }, timeout: 120_000 });
const nationalMesh = await fetchJsonWithRetry(BRAZIL_MESH_URL, { headers: { Accept: 'application/vnd.geo+json' }, timeout: 120_000 });
const municipalityMap = await municipalityDirectory(localities);
const municipalitiesByUf = municipalityMap.byUf;
const shapesByUf = municipalityMap.shapesByUf;
const localityBySixDigits = new Map(localities.map((row) => [String(row['municipio-id']).slice(0, 6), row]));
const ufByStateCode = new Map(localities.map((row) => [String(row['UF-id']), row['UF-sigla']]));
const uniqueByCode = new Map(uniqueRows.slice(1).map((row) => [String(row[0]).match(/^\d{6}/)?.[0] || '', Number(row[1]) || 0]).filter(([code]) => code));
const uniqueByStateCode = new Map(stateRows.slice(1).map((row) => [String(row[0]).match(/^\d{2}/)?.[0] || '', Number(row[1]) || 0]).filter(([code]) => code));
const nationalUniquePhysicians = Number(stateRows.find((row) => row[0] === 'Total')?.[1]) || 0;
const specialtyHeaders = specialtyRows[0].slice(1, -1);
const nationalSpecialties = (stateSpecialtyRows.find((row) => row[0] === 'Total')?.slice(1, -1) || specialtyHeaders.map(() => 0))
  .map((value) => value === '-' ? 0 : Number(value) || 0);
const specialtyByCode = new Map(specialtyRows.slice(1).map((row) => {
  const code = String(row[0]).match(/^\d{6}/)?.[0] || '';
  return [code, row.slice(1, -1).map((value) => value === '-' ? 0 : Number(value) || 0)];
}).filter(([code]) => code));
const stateSpecialtyByCode = new Map(stateSpecialtyRows.slice(1).map((row) => {
  const code = String(row[0]).match(/^\d{2}/)?.[0] || '';
  return [code, row.slice(1, -1).map((value) => value === '-' ? 0 : Number(value) || 0)];
}).filter(([code]) => code));
const populationByCode = new Map(populationRows.slice(1).map((row) => [
  String(row.D1C || ''),
  Number(String(row.V || '').replace(/\D/g, '')) || 0,
]).filter(([code]) => /^\d{7}$/.test(code)));

await Promise.all([mkdir(municipalityOutput, { recursive: true }), mkdir(densityOutput, { recursive: true }), mkdir(shapesOutput, { recursive: true })]);
const stateSummaries = [];
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
      population: populationByCode.get(municipality.ibgeCode) || 0,
      physicians: uniqueByCode.get(shortCode) || 0,
      specialties: specialtyByCode.get(shortCode) || specialtyHeaders.map(() => 0),
    };
  });
  const municipalPresence = densityMunicipalities.reduce((sum, municipality) => sum + municipality.physicians, 0);
  const stateCode = localities.find((row) => row['UF-sigla'] === uf)?.['UF-id'];
  const uniquePhysicians = uniqueByStateCode.get(String(stateCode || '')) || 0;
  const statePopulation = [...populationByCode.entries()]
    .filter(([code]) => code.startsWith(String(stateCode || '')))
    .reduce((sum, [, population]) => sum + population, 0);
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
      statePopulation,
      populationPeriod: '2025',
      populationReferenceDate: '1º de julho de 2025',
      populationSource: 'IBGE/SIDRA — Estimativas da População, tabela 6579, variável 9324',
      populationSourceUrl: POPULATION_URL,
      municipalPresence,
      municipalities: densityMunicipalities.filter((municipality) => municipality.physicians > 0).length,
      methodology: 'O total considera indivíduos selecionados em todas as ocupações médicas. A visão por especialidade utiliza a ocupação CBO e não equivale ao RQE do CFM.',
    },
    specialtyNames: specialtyHeaders,
    stateSpecialties: stateSpecialtyByCode.get(String(stateCode || '')) || specialtyHeaders.map(() => 0),
    municipalities: densityMunicipalities,
  };
  stateSummaries.push({
    uf,
    population: statePopulation,
    physicians: uniquePhysicians,
    specialties: stateSpecialtyByCode.get(String(stateCode || '')) || specialtyHeaders.map(() => 0),
  });
  await writeFile(resolve(densityOutput, `${uf}.json`), `${JSON.stringify(densityPayload)}\n`, 'utf8');
  await writeFile(resolve(shapesOutput, `${uf}.json`), `${JSON.stringify(shapesByUf.get(uf))}\n`, 'utf8');
}

const nationalBounds = featureBounds(nationalMesh.features || []);
const nationalShapes = (nationalMesh.features || []).map((feature) => ({
  uf: ufByStateCode.get(String(feature.properties?.codarea || '')) || '',
  path: geometrySvgPath(feature.geometry, nationalBounds),
})).filter((item) => item.uf);
const nationalPopulation = stateSummaries.reduce((sum, state) => sum + state.population, 0);
await writeFile(resolve(shapesOutput, 'BR.json'), `${JSON.stringify({
  meta: { uf: 'BR', viewBox: '0 0 640 440', source: 'IBGE — Malha das Unidades da Federação' },
  shapes: nationalShapes,
})}\n`, 'utf8');
await writeFile(resolve(densityOutput, 'BR.json'), `${JSON.stringify({
  meta: {
    source: 'CNES / DATASUS — Recursos Humanos — Profissionais (indivíduos) segundo CBO 2002',
    sourceUrl: 'https://tabnet.datasus.gov.br/cgi/deftohtm.exe?cnes/cnv/prid02br.def',
    technicalNotesUrl: 'https://tabnet.datasus.gov.br/cgi/cnes/NT_RecursosHumanos.htm',
    period: periodLabel,
    periodFile,
    generatedAt: new Date().toISOString(),
    uf: 'BR',
    uniquePhysicians: nationalUniquePhysicians,
    statePopulation: nationalPopulation,
    populationPeriod: '2025',
    populationReferenceDate: '1º de julho de 2025',
    populationSource: 'IBGE/SIDRA — Estimativas da População, tabela 6579, variável 9324',
    populationSourceUrl: POPULATION_URL,
    methodology: 'A visão Brasil agrega as 27 Unidades da Federação. Especialidades usam ocupações CBO e não equivalem ao RQE do CFM.',
  },
  specialtyNames: specialtyHeaders,
  stateSpecialties: nationalSpecialties,
  states: stateSummaries,
})}\n`, 'utf8');

await writeFile(resolve(municipalityOutput, 'index.json'), `${JSON.stringify({
  meta: { source: 'IBGE', generatedAt: new Date().toISOString(), total: localities.length, states: UFS.length },
  states: UFS.map((uf) => ({ uf, total: municipalitiesByUf.get(uf)?.length || 0, file: `${uf}.json` })),
})}\n`, 'utf8');
await writeFile(resolve(densityOutput, 'index.json'), `${JSON.stringify({
  meta: { source: 'CNES / DATASUS', period: periodLabel, periodFile, generatedAt: new Date().toISOString(), uniquePhysicians: nationalUniquePhysicians, states: UFS.length },
  specialtyNames: specialtyHeaders,
  states: stateSummaries.map((state) => ({ ...state, file: `${state.uf}.json` })),
})}\n`, 'utf8');

console.log(`Mapa concluído: ${localities.length} municípios, ${nationalUniquePhysicians} médicos únicos no CNES, competência ${periodLabel}.`);
