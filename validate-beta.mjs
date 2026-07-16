import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const read = (file) => readFile(join(root, file), 'utf8');

const [manifestText, landing, appHtml, app, cloud, adminHtml, adminApp, worker, workflow, migration, launchMigration, upfrontMigration, manualAccessMigration, singlePlanMigration, invoiceFunction, adminCreateFunction, adminUpdateFunction, mobileConfig, mobileInvoice, terms, privacy, cancellation] = await Promise.all([
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
  read('supabase/migrations/202607160003_upfront_billing.sql'),
  read('supabase/migrations/202607160004_manual_access.sql'),
  read('supabase/migrations/202607160005_single_plan_freemium.sql'),
  read('supabase/functions/analyze-invoice/index.ts'),
  read('supabase/functions/admin-create-user/index.ts'),
  read('supabase/functions/admin-update-user/index.ts'),
  read('mobile/app.json'),
  read('mobile/src/services/invoice.ts'),
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

for (const marker of ['7 dias de garantia', 'R$ 39,90', 'Casos de uso', 'Nota Fiscal', 'Cancelamento e reembolso']) {
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
  'analyzeInvoiceFile',
  'payerCnpj',
]) assert.ok(app.includes(marker), `app.js sem: ${marker}`);

assert.ok(
  app.indexOf('const DEFAULT_MESSAGE') < app.indexOf('let appState = loadState(activeStateKey);'),
  'appState só pode ser carregado depois da mensagem padrão usada pelo estado vazio',
);
assert.ok(!appHtml.includes('Beta local:'), 'o aviso antigo de beta local não deve aparecer na entrada');
assert.ok(appHtml.includes('styles.css?v=5') && appHtml.includes('app.js?v=9'), 'os arquivos corrigidos precisam de cache busting');
for (const marker of ['billing-view', 'R$ 39,90', 'PLANO ÚNICO', 'runtime-config.js', 'cloud.js']) {
  assert.ok(appHtml.includes(marker), `fluxo de assinatura sem: ${marker}`);
}
for (const marker of ['register', 'login-cpf', 'create-subscription', 'cancel-subscription', 'sync-state', 'account-status', 'analyze-invoice', 'adminUsers', 'adminCreateUser', 'adminMfaSatisfied']) {
  assert.ok(cloud.includes(marker), `cliente cloud sem: ${marker}`);
}
for (const marker of ['MedRecebe Admin', 'admin-users']) {
  assert.ok(adminHtml.includes(marker) || adminApp.includes(marker), `painel administrativo sem: ${marker}`);
}
for (const marker of ['admin.css?v=3', 'users-toolbar', 'Base de clientes', 'SEGUNDA ETAPA']) {
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
for (const marker of ['pending_payment', 'trial_ends_at = null', 'authorized']) {
  assert.ok(upfrontMigration.toLowerCase().includes(marker), `cobrança inicial sem: ${marker}`);
}
assert.ok(manualAccessMigration.includes('manual_access_until'), 'liberação administrativa precisa de prazo próprio');
for (const marker of ['3990', 'manual_access_lifetime', 'suspension_scheduled_at', 'admin_mfa_sessions']) assert.ok(singlePlanMigration.includes(marker), `plano único e Freemium sem: ${marker}`);
for (const marker of ['freemium_user_created', 'durationUnit', 'lifetime']) assert.ok(adminCreateFunction.includes(marker), `criação Freemium sem: ${marker}`);
for (const marker of ['update_profile', 'schedule_suspension', 'force_suspension', 'delete_user']) assert.ok(adminUpdateFunction.includes(marker), `CRUD administrativo sem: ${marker}`);
for (const marker of ['unpdf@1.6.2', 'matchedPayerIds', 'amountCents', '5 * 1024 * 1024']) {
  assert.ok(invoiceFunction.includes(marker), `leitura de Nota Fiscal sem: ${marker}`);
}
for (const marker of ['expo-sharing', 'supportsFileWithMaxCount']) assert.ok(mobileConfig.includes(marker), `extensão iOS sem: ${marker}`);
for (const marker of ['getDocumentProxy', 'reconcileInvoice', 'payerMatches']) assert.ok(mobileInvoice.includes(marker), `leitura nativa sem: ${marker}`);
for (const [name, document, markers] of [
  ['Termos', terms, ['garantia de 7 dias', 'R$ 39,90', 'plano único']],
  ['Privacidade', privacy, ['Controlador', 'Direitos do titular', 'Notas Fiscais']],
  ['Cancelamento', cancellation, ['7 dias', 'reembolso integral', 'Continuar para o cancelamento']],
]) for (const marker of markers) assert.ok(document.includes(marker), `${name} sem: ${marker}`);

for (const [name, document] of [['Landing', landing], ['Aplicativo', `${appHtml}\n${app}`], ['Termos', terms], ['Privacidade', privacy], ['Cancelamento', cancellation]]) {
  for (const forbidden of ['Mercado Pago', 'Lucas Catarin', 'lucas.catarin', 'sem cartão']) {
    assert.ok(!document.includes(forbidden), `${name} não pode mencionar: ${forbidden}`);
  }
}

for (const marker of ['install', 'activate', 'fetch', 'caches.open', 'medrecebe-app-v10', './app.html']) {
  assert.ok(worker.includes(marker), `sw.js sem: ${marker}`);
}

for (const marker of ['actions/checkout@v6', 'actions/configure-pages@v5', 'actions/upload-pages-artifact@v4', 'actions/deploy-pages@v4']) {
  assert.ok(workflow.includes(marker), `workflow do GitHub Pages sem: ${marker}`);
}

console.log('MedRecebe validado: plano único, Freemium, CRUD com 2FA, Nota Fiscal, backup, cancelamento, sincronização e publicação presentes.');
