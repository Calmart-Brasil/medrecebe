import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(root, '..');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const packageJson = readJson(join(root, 'package.json'));
const appJson = readJson(join(root, 'app.json'));
readJson(join(root, 'eas.json'));
readJson(join(root, 'tsconfig.json'));

assert.match(packageJson.dependencies.expo, /^~57\./, 'O projeto deve permanecer no Expo SDK 57.');
assert.equal(appJson.expo.ios.bundleIdentifier, 'com.calmart.medrecebe');
assert.equal(appJson.expo.ios.supportsTablet, false);
assert.ok(appJson.expo.plugins.some((entry) => entry[0] === 'expo-local-authentication'));
assert.ok(appJson.expo.plugins.some((entry) => entry[0] === 'expo-image-picker'));
const sharingPlugin = appJson.expo.plugins.find((entry) => Array.isArray(entry) && entry[0] === 'expo-sharing');
assert.ok(sharingPlugin?.[1]?.ios?.enabled, 'A Share Extension do iOS precisa estar habilitada.');
assert.equal(sharingPlugin?.[1]?.ios?.activationRule?.supportsFileWithMaxCount, 1, 'A extensão deve receber uma Nota Fiscal por vez.');
assert.ok(packageJson.dependencies['expo-document-picker'], 'O seletor de documentos precisa estar instalado.');
assert.ok(packageJson.dependencies.unpdf, 'A leitura local de PDF precisa estar instalada.');

const icon = readFileSync(join(root, 'assets', 'icon.png'));
assert.equal(icon.readUInt32BE(16), 1024, 'O ícone deve ter 1024 px de largura.');
assert.equal(icon.readUInt32BE(20), 1024, 'O ícone deve ter 1024 px de altura.');
assert.equal(icon[25], 2, 'O ícone deve ser RGB sem canal alfa para a App Store.');

for (const page of ['privacidade.html', 'suporte.html']) {
  assert.ok(existsSync(join(repositoryRoot, page)), `${page} não encontrado.`);
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return ['.ts', '.tsx'].includes(extname(entry.name)) ? [path] : [];
  });
}

function resolvesImport(sourcePath, importPath) {
  const absolute = resolve(dirname(sourcePath), importPath);
  return [absolute, `${absolute}.ts`, `${absolute}.tsx`, `${absolute}.json`, `${absolute}.png`, join(absolute, 'index.ts'), join(absolute, 'index.tsx')].some(existsSync);
}

const importPattern = /(?:from\s+|require\()\s*['"](\.[^'"]+)['"]/g;
for (const sourcePath of [join(root, 'App.tsx'), join(root, 'index.ts'), ...sourceFiles(join(root, 'src'))]) {
  const content = readFileSync(sourcePath, 'utf8');
  for (const match of content.matchAll(importPattern)) {
    assert.ok(resolvesImport(sourcePath, match[1]), `Import relativo ausente em ${sourcePath}: ${match[1]}`);
  }
}

const defaultMessage = readFileSync(join(root, 'src', 'data', 'store.ts'), 'utf8');
for (const token of ['{{local}}', '{{periodo}}', '{{quantidade}}', '{{valor}}', '{{detalhes}}', '{{medico}}']) {
  assert.ok(defaultMessage.includes(token), `Token ausente na mensagem padrão: ${token}`);
}

console.log('OK: configuração, ícone, páginas públicas, imports e tokens validados.');
