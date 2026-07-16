import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const read = (file) => readFile(join(root, file), 'utf8');

const [manifestText, landing, appHtml, app, cloud, adminHtml, adminApp, worker, workflow, migration, launchMigration, terms, privacy, cancellation] = await Promise.all([
  read('manifest.webmanifest'),
  read('index.html'),
  read('app.html'),
  read('app.js'),
  read('cloud.js'),
  read('admin.html'),
  read('admin.js'),
  read('sw.js'),
  read('.github/workflows/pages.yml'),
  read('supabase/migrations/202607160001_billing_admin.sql'),
  read('supabase/migrations/202607160002_official_launch.sql'),
  read('termos.html'),
  read('privacidade.html'),
  read('cancelamento.html'),
]);
const manifest = JSON.parse(manifestText);

assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, './app.html?source=homescreen');
assert.equal(manifest.scope, './');
assert.equal(manifest.orientation, 'portrait');
assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));

for (const asset of ['landing.css', 'legal.css', 'styles.css', 'app.html', 'app.js', 'cloud.js', 'admin.html', 'admin.js', 'admin.css', 'manifest.webmanifest', 'termos.html', 'privacidade.html', 'cancelamento.html', 'assets/apple-touch-icon.png', 'assets/icon-192.png', 'assets/icon-512.png', 'branding/medrecebe-liquid-glass-master.png']) {
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
]) assert.ok(appHtml.includes(marker), `app.html sem: ${marker}`);

for (const marker of ['7 dias grátis', 'R$ 29,90', 'R$ 59,90', 'Casos de uso', 'Termos de Uso', 'Cancelamento e reembolso']) {
  assert.ok(landing.includes(marker), `landing page sem: ${marker}`);
}

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
  app.indexOf('const DEFAULT_MESSAGE') < app.indexOf('let appState = loadState(activeStateKey);'),
  'appState só pode ser carregado depois da mensagem padrão usada pelo estado vazio',
);
assert.ok(!appHtml.includes('Beta local:'), 'o aviso antigo de beta local não deve aparecer na entrada');
assert.ok(appHtml.includes('styles.css?v=4') && appHtml.includes('app.js?v=7'), 'os arquivos corrigidos precisam de cache busting');
for (const marker of ['billing-view', 'R$ 29,90', 'R$ 59,90', 'runtime-config.js', 'cloud.js']) {
  assert.ok(appHtml.includes(marker), `fluxo de assinatura sem: ${marker}`);
}
for (const marker of ['register', 'login-cpf', 'create-subscription', 'cancel-subscription', 'sync-state', 'account-status', 'adminUsers']) {
  assert.ok(cloud.includes(marker), `cliente cloud sem: ${marker}`);
}
for (const marker of ['MedRecebe Admin', 'admin-users']) {
  assert.ok(adminHtml.includes(marker) || adminApp.includes(marker), `painel administrativo sem: ${marker}`);
}
for (const marker of ['admin.css?v=2', 'users-toolbar', 'Base de usuários']) {
  assert.ok(adminHtml.includes(marker), `layout administrativo desktop sem: ${marker}`);
}
assert.ok(!app.includes('Abrir painel administrativo'), 'o painel administrativo não deve aparecer no app móvel');
assert.ok(cloud.includes('admin-update-user'), 'cliente cloud sem comando administrativo');
for (const marker of ['profiles', 'subscriptions', 'billing_events', 'admin_audit_log', 'row level security']) {
  assert.ok(migration.toLowerCase().includes(marker), `banco de produção sem: ${marker}`);
}
for (const marker of ['selected_plan', 'trial_ends_at', '5990', 'user_app_states', 'refunded_at']) {
  assert.ok(launchMigration.toLowerCase().includes(marker), `lançamento SaaS sem: ${marker}`);
}
for (const [name, document, markers] of [
  ['Termos', terms, ['Teste gratuito', 'Plano Mobile', 'Plano Web']],
  ['Privacidade', privacy, ['Controlador', 'Direitos do titular', 'Mercado Pago']],
  ['Cancelamento', cancellation, ['7 dias', 'reembolso integral', 'Mercado Pago']],
]) for (const marker of markers) assert.ok(document.includes(marker), `${name} sem: ${marker}`);

for (const marker of ['install', 'activate', 'fetch', 'caches.open', 'medrecebe-app-v7', './app.html']) {
  assert.ok(worker.includes(marker), `sw.js sem: ${marker}`);
}

for (const marker of ['actions/checkout@v6', 'actions/configure-pages@v5', 'actions/upload-pages-artifact@v4', 'actions/deploy-pages@v4']) {
  assert.ok(workflow.includes(marker), `workflow do GitHub Pages sem: ${marker}`);
}

console.log('MedRecebe validado: landing, PWA, dois planos, teste, políticas, cancelamento, sincronização e publicação presentes.');
