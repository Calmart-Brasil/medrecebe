import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const read = (file) => readFile(join(root, file), 'utf8');

const [manifestText, html, app, worker, workflow] = await Promise.all([
  read('manifest.webmanifest'),
  read('index.html'),
  read('app.js'),
  read('sw.js'),
  read('.github/workflows/pages.yml'),
]);
const manifest = JSON.parse(manifestText);

assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, './?source=homescreen');
assert.equal(manifest.scope, './');
assert.equal(manifest.orientation, 'portrait');
assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));

for (const asset of ['styles.css', 'app.js', 'manifest.webmanifest', 'assets/apple-touch-icon.png', 'assets/icon-192.png', 'assets/icon-512.png']) {
  const file = await stat(join(root, asset));
  assert.ok(file.size > 0, `${asset} precisa existir e não pode estar vazio`);
}

for (const marker of [
  'apple-mobile-web-app-capable',
  'manifest.webmanifest',
  'Registrar atendimento',
  'Dashboard',
  'Locais e repasses',
  'Conciliação',
  'Enviar feedback',
]) assert.ok(html.includes(marker), `index.html sem: ${marker}`);

for (const marker of [
  "navigator.serviceWorker.register('./sw.js')",
  'calculateDueDate',
  'compressImage',
  'prepareReconciliationEmail',
  'feedback-form',
  'localStorage',
  'isValidCpf',
  'requestPersistentStorage',
]) assert.ok(app.includes(marker), `app.js sem: ${marker}`);

assert.ok(
  app.indexOf('const DEFAULT_MESSAGE') < app.indexOf('let appState = loadState();'),
  'appState só pode ser carregado depois da mensagem padrão usada pelo estado vazio',
);
assert.ok(!html.includes('Beta local:'), 'o aviso antigo de beta local não deve aparecer na entrada');
assert.ok(html.includes('styles.css?v=2') && html.includes('app.js?v=2'), 'os arquivos corrigidos precisam de cache busting');

for (const marker of ['install', 'activate', 'fetch', 'caches.open']) {
  assert.ok(worker.includes(marker), `sw.js sem: ${marker}`);
}

for (const marker of ['actions/checkout@v6', 'actions/configure-pages@v5', 'actions/upload-pages-artifact@v4', 'actions/deploy-pages@v4']) {
  assert.ok(workflow.includes(marker), `workflow do GitHub Pages sem: ${marker}`);
}

console.log('Beta PWA validado: manifesto, app shell, instalação, modo offline, fluxos essenciais e GitHub Pages presentes.');
