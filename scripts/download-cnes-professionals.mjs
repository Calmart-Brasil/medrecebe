import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const PORTAL = 'https://cnes.datasus.gov.br';
const EXTRACTION_PAGE = `${PORTAL}/pages/profissionais/extracao.jsp`;
const DOWNLOAD_HOST = 'http://cnesdownload.datasus.gov.br/download/ProfissionaisServlet?path=';
const UF_BY_IBGE = Object.freeze({
  12: 'AC', 27: 'AL', 16: 'AP', 13: 'AM', 29: 'BA', 23: 'CE', 53: 'DF',
  32: 'ES', 52: 'GO', 21: 'MA', 51: 'MT', 50: 'MS', 31: 'MG', 15: 'PA',
  25: 'PB', 41: 'PR', 26: 'PE', 22: 'PI', 33: 'RJ', 24: 'RN', 43: 'RS',
  11: 'RO', 14: 'RR', 42: 'SC', 35: 'SP', 28: 'SE', 17: 'TO',
});

const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...value] = argument.replace(/^--/, '').split('=');
  return [key, value.length ? value.join('=') : 'true'];
}));
const outputDirectory = resolve(args.get('output-dir') || 'data/raw/cnes-professionals');
const manifestPath = resolve(args.get('manifest') || `${outputDirectory}/manifest.json`);
const requestedStates = String(args.get('states') || 'all').toUpperCase();
const competence = String(args.get('competence') || '').replace(/\D/g, '');
const shouldDownload = args.get('download') === 'true';
const force = args.get('force') === 'true';

if (competence && !/^20\d{4}$/.test(competence)) {
  throw new Error('Use --competence=AAAAMM ou omita o argumento para a competência atual.');
}

const headers = {
  Accept: 'application/json, application/zip;q=0.9, */*;q=0.8',
  Referer: EXTRACTION_PAGE,
  'User-Agent': 'MedRecebe-CNES-Pipeline/1.0 (+https://medrecebe.com.br)',
};

async function fetchWithRetry(url, options = {}, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { ...headers, ...(options.headers || {}) },
        signal: AbortSignal.timeout(options.timeout || 120_000),
      });
      if (!response.ok) throw new Error(`${url} respondeu ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 1500));
    }
  }
  throw lastError;
}

async function fetchJson(url) {
  const response = await fetchWithRetry(url, { headers: { Accept: 'application/json' } });
  return response.json();
}

function selectedStates(catalog) {
  const available = Object.entries(catalog)
    .map(([ibgeCode, name]) => ({ ibgeCode, uf: UF_BY_IBGE[ibgeCode], name }))
    .filter((item) => item.uf)
    .sort((left, right) => left.uf.localeCompare(right.uf));
  if (requestedStates === 'ALL') return available;
  const requested = new Set(requestedStates.split(',').map((value) => value.trim()).filter(Boolean));
  const invalid = [...requested].filter((uf) => !Object.values(UF_BY_IBGE).includes(uf));
  if (invalid.length) throw new Error(`UF inválida: ${invalid.join(', ')}.`);
  return available.filter((item) => requested.has(item.uf));
}

function downloadFileName(response, fallback) {
  const disposition = response.headers.get('content-disposition') || '';
  const match = /filename\*?=(?:UTF-8''|["'])?([^"';]+)/i.exec(disposition);
  return basename(decodeURIComponent(match?.[1] || fallback));
}

async function resolveArchive(item) {
  const query = new URLSearchParams({ estado: item.ibgeCode, gestao: 'todos', comp: competence });
  const locator = await fetchJson(`${PORTAL}/services/profissionais-url-download?${query}`);
  if (!locator?.url) throw new Error(`O CNES não retornou o arquivo de ${item.uf}.`);
  const downloadUrl = `${DOWNLOAD_HOST}${encodeURIComponent(locator.url)}`;
  const head = await fetchWithRetry(downloadUrl, { method: 'HEAD', headers: { Accept: 'application/zip' } });
  const contentType = head.headers.get('content-type') || '';
  if (!contentType.includes('zip')) throw new Error(`O arquivo de ${item.uf} não foi identificado como ZIP.`);
  return {
    ...item,
    downloadUrl,
    fileName: downloadFileName(head, `profissionais-${item.ibgeCode}.zip`),
    sizeBytes: Number(head.headers.get('content-length')) || null,
    contentType,
  };
}

async function downloadArchive(archive) {
  const destination = resolve(outputDirectory, archive.fileName);
  if (!force) {
    try {
      const existing = await stat(destination);
      if (!archive.sizeBytes || existing.size === archive.sizeBytes) {
        return { ...archive, localFile: archive.fileName, downloaded: false, sha256: null };
      }
    } catch {
      // O arquivo ainda não existe.
    }
  }

  const response = await fetchWithRetry(archive.downloadUrl, {
    headers: { Accept: 'application/zip' },
    timeout: 15 * 60_000,
  });
  if (!response.body) throw new Error(`O download de ${archive.uf} não retornou conteúdo.`);
  const partial = `${destination}.partial`;
  const hash = createHash('sha256');
  const digest = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await rm(partial, { force: true });
  await pipeline(Readable.fromWeb(response.body), digest, createWriteStream(partial, { flags: 'wx' }));
  const downloaded = await stat(partial);
  if (archive.sizeBytes && downloaded.size !== archive.sizeBytes) {
    await rm(partial, { force: true });
    throw new Error(`Download incompleto de ${archive.uf}: ${downloaded.size}/${archive.sizeBytes} bytes.`);
  }
  await rename(partial, destination);
  return { ...archive, localFile: archive.fileName, downloaded: true, sha256: hash.digest('hex') };
}

const catalog = await fetchJson(`${PORTAL}/services/estados`);
const states = selectedStates(catalog);
if (!states.length) throw new Error('Nenhuma UF foi selecionada.');
await mkdir(outputDirectory, { recursive: true });

const archives = [];
for (const [index, state] of states.entries()) {
  process.stdout.write(`[${index + 1}/${states.length}] ${state.uf}: localizando arquivo oficial... `);
  const archive = await resolveArchive(state);
  const result = shouldDownload ? await downloadArchive(archive) : archive;
  archives.push(result);
  console.log(shouldDownload ? `${result.downloaded ? 'baixado' : 'já existente'} (${result.sizeBytes || '?'} bytes)` : `${result.fileName} (${result.sizeBytes || '?'} bytes)`);
}

const manifest = {
  meta: {
    source: 'CNES / DATASUS — Extração de dados de profissional',
    sourceUrl: EXTRACTION_PAGE,
    generatedAt: new Date().toISOString(),
    competence: competence || 'current',
    states: archives.length,
    downloaded: shouldDownload,
    grain: 'Um registro representa um vínculo profissional-estabelecimento-CBO, não uma pessoa única.',
    privacy: 'A camada analítica deve pseudonimizar o CNS e excluir nome e CNS dos produtos publicados.',
  },
  archives,
};
await mkdir(dirname(manifestPath), { recursive: true });
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Manifesto salvo em ${manifestPath}`);
