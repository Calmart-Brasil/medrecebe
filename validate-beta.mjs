import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const read = (file) => readFile(join(root, file), 'utf8');

const [manifestText, landing, landingCss, appHtml, app, appCss, reconciliationPdf, cloud, adminHtml, adminApp, worker, workflow, migration, launchMigration, upfrontMigration, manualAccessMigration, singlePlanMigration, simpleAdminMigration, documentMigration, documentFunction, syncStateFunction, invoiceFunction, adminCreateFunction, adminUpdateFunction, createSubscriptionFunction, cancelSubscriptionFunction, mercadoPagoShared, mobileConfig, mobileInvoice, mobileReconciliationPdf, mobileReconciliationScreen, terms, privacy, cancellation] = await Promise.all([
  read('manifest.webmanifest'),
  read('index.html'),
  read('landing.css'),
  read('app.html'),
  read('app.js'),
  read('styles.css'),
  read('reconciliation-pdf.js'),
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
  read('supabase/migrations/202607160006_remove_admin_mfa.sql'),
  read('supabase/migrations/202607190001_document_sync.sql'),
  read('supabase/functions/documents/index.ts'),
  read('supabase/functions/sync-state/index.ts'),
  read('supabase/functions/analyze-invoice/index.ts'),
  read('supabase/functions/admin-create-user/index.ts'),
  read('supabase/functions/admin-update-user/index.ts'),
  read('supabase/functions/create-subscription/index.ts'),
  read('supabase/functions/cancel-subscription/index.ts'),
  read('supabase/functions/_shared/mercado-pago.ts'),
  read('mobile/app.json'),
  read('mobile/src/services/invoice.ts'),
  read('mobile/src/services/reconciliationPdf.ts'),
  read('mobile/src/screens/ReconciliationScreen.tsx'),
  read('termos.html'),
  read('privacidade.html'),
  read('cancelamento.html'),
]);
const manifest = JSON.parse(manifestText);
const [institutionDirectoryText, institutionBuilder, mobileInstitutionDirectory] = await Promise.all([
  read('data/institution-directory-rmsp.json'),
  read('scripts/build-institution-directory.mjs'),
  read('mobile/src/services/institutionDirectory.ts'),
]);
const institutionDirectory = JSON.parse(institutionDirectoryText);

assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, './app.html?source=homescreen');
assert.equal(manifest.scope, './');
assert.equal(manifest.orientation, 'portrait');
assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));

for (const asset of ['landing.css', 'legal.css', 'styles.css', 'app.html', 'app.js', 'reconciliation-pdf.js', 'cloud.js', 'admin.html', 'admin.js', 'admin.css', 'manifest.webmanifest', 'termos.html', 'privacidade.html', 'cancelamento.html', 'data/institution-directory-rmsp.json', 'scripts/build-institution-directory.mjs', 'assets/apple-touch-icon.png', 'assets/icon-192.png', 'assets/icon-512.png', 'branding/medrecebe-liquid-glass-master.png']) {
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
  'Mais',
]) assert.ok(appHtml.includes(marker), `app.html sem: ${marker}`);

for (const marker of ['7 dias de garantia', 'R$ 39,90', 'Benefícios', 'Nota Fiscal', 'Cancelamento e reembolso']) {
  assert.ok(landing.includes(marker), `landing page sem: ${marker}`);
}
for (const marker of ['#004DB6', '#0A1F44', '#56A0E8', '#2BB673', '#D9E7F8', '#EFF4FB', '#111A2B', '#5A6472']) assert.ok(landingCss.includes(marker), `branding sem a cor: ${marker}`);

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
  'loadInstitutionDirectory',
  'selectDirectoryInstitution',
]) assert.ok(app.includes(marker), `app.js sem: ${marker}`);

assert.ok(
  app.indexOf('const DEFAULT_MESSAGE') < app.indexOf('let appState = loadState(activeStateKey);'),
  'appState só pode ser carregado depois da mensagem padrão usada pelo estado vazio',
);
assert.ok(!appHtml.includes('Beta local:'), 'o aviso antigo de beta local não deve aparecer na entrada');
assert.ok(appHtml.includes('styles.css?v=16') && appHtml.includes('cloud.js?v=6') && appHtml.includes('reconciliation-pdf.js?v=1') && appHtml.includes('app.js?v=22'), 'os arquivos corrigidos precisam de cache busting');
for (const marker of ['aria-label="Home"', 'aria-label="Registro dos locais e modalidades"', 'aria-label="Registro de atendimentos"', 'aria-label="Conciliação"']) assert.ok(appHtml.includes(marker), `barra inferior sem: ${marker}`);
const bottomNavigation = appHtml.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)?.[0] || '';
assert.equal((bottomNavigation.match(/<button data-nav=/g) || []).length, 4, 'a barra inferior deve manter exatamente quatro destinos');
assert.ok(bottomNavigation.indexOf('aria-label="Home"') < bottomNavigation.indexOf('aria-label="Registro dos locais e modalidades"'), 'Home deve ser o primeiro destino');
assert.ok(bottomNavigation.indexOf('aria-label="Registro dos locais e modalidades"') < bottomNavigation.indexOf('aria-label="Registro de atendimentos"'), 'Locais e modalidades deve vir antes de atendimentos');
assert.ok(bottomNavigation.indexOf('aria-label="Registro de atendimentos"') < bottomNavigation.indexOf('aria-label="Conciliação"'), 'Conciliação deve ser o último destino');
for (const marker of ['Tirar foto', 'Galeria', 'attendance-quantity-input', 'recordId', 'attendanceQuantity']) assert.ok(app.includes(marker), `registro em lote sem: ${marker}`);
for (const marker of ['dashboardAttendanceDetails', 'dashboard-expandable', 'dashboard-status-row', 'Marcar grupo como recebido', 'Registrar neste local']) assert.ok(app.includes(marker) || appCss.includes(marker), `Dashboard expansível sem: ${marker}`);
for (const marker of ['pendingInvoiceWorkplaceId', 'create-workplace-from-invoice', 'delete-invoice', 'reconcileStoredInvoice', 'Cadastrar local pela Nota Fiscal']) assert.ok(app.includes(marker), `fluxo de Nota Fiscal sem: ${marker}`);
for (const marker of ['invoice-delete', 'body[data-route="attendance"]', 'quantity-row > strong']) assert.ok(appCss.includes(marker), `interface responsiva ou remoção de anexo sem: ${marker}`);
for (const marker of ['prepareReconciliationWhatsApp', 'share-reconciliation-whatsapp', 'reconciliationAttachments', 'Compartilhar PDF no WhatsApp']) assert.ok(app.includes(marker), `conciliação por WhatsApp sem: ${marker}`);
for (const marker of ['MedRecebePdf', 'Solicitação de conciliação de repasses', '/Subtype /Image', 'jpegDimensions']) assert.ok(reconciliationPdf.includes(marker), `PDF consolidado sem: ${marker}`);
assert.ok(appCss.includes('.button.whatsapp') && appCss.includes('.reconciliation-send-actions'), 'interface sem ações de compartilhamento da conciliação');
assert.equal(institutionDirectory.meta.municipalities, 39, 'o diretório deve cobrir os 39 municípios da RMSP');
assert.ok(institutionDirectory.meta.total >= 1000, 'o diretório institucional está incompleto');
assert.ok(institutionDirectory.meta.countsByCategory.hospital >= 500, 'o diretório hospitalar está incompleto');
assert.ok(institutionDirectory.meta.countsByCategory.medical_staffing >= 10, 'faltam empresas de cessão de profissionais');
assert.ok(institutionDirectory.meta.countsByCategory.ambulance >= 400, 'faltam prestadores móveis e pré-hospitalares');
assert.ok(institutionDirectory.meta.countsByCategory.health_management >= 100, 'faltam centrais de gestão em saúde');
assert.equal(new Set(institutionDirectory.institutions.map((item) => item.city)).size, 39, 'há município da RMSP sem cobertura');
assert.ok(institutionDirectory.institutions.every((item) => /^\d{14}$/.test(item.payerCnpj) && /^\d{7}$/.test(item.cnes)), 'diretório com CNPJ ou CNES inválido');
assert.ok(institutionDirectory.institutions.filter((item) => item.tradeName).length >= 950, 'o diretório precisa preservar os nomes fantasia informados pelo CNES');
assert.ok(institutionDirectory.institutions.every((item) => item.tradeName !== undefined), 'todo registro precisa declarar o campo tradeName, ainda que vazio');
for (const marker of ['RMSP_MUNICIPALITIES', 'isValidCnpj', 'medical_staffing', 'sourceUpdatedAt', 'tradeName']) assert.ok(institutionBuilder.includes(marker), `gerador do diretório sem: ${marker}`);
for (const marker of ['loadInstitutionDirectory', 'searchInstitutionDirectory', 'CNPJ_CARD_URL']) assert.ok(mobileInstitutionDirectory.includes(marker), `diretório nativo sem: ${marker}`);
for (const marker of ['billing-view', 'R$ 39,90', 'PLANO ÚNICO', 'runtime-config.js', 'cloud.js']) {
  assert.ok(appHtml.includes(marker), `fluxo de assinatura sem: ${marker}`);
}
for (const marker of ['register', 'login-cpf', 'create-subscription', 'cancel-subscription', 'sync-state', 'account-status', 'analyze-invoice', 'adminUsers', 'adminCreateUser']) {
  assert.ok(cloud.includes(marker), `cliente cloud sem: ${marker}`);
}
for (const marker of ['medrecebe-documents', 'user_documents', 'primary key (user_id, id)', 'storage.objects']) assert.ok(documentMigration.includes(marker), `sincronização de documentos sem: ${marker}`);
for (const marker of ['attendance_evidence', 'delete-record', "onConflict: 'user_id,id'", 'createSignedUrl', 'checksum']) assert.ok(documentFunction.includes(marker), `API de documentos sem: ${marker}`);
for (const marker of ['attendance.evidence =', 'evidenceDocumentId', 'invoice.documentUrl']) assert.ok(syncStateFunction.includes(marker), `estado cloud ainda persiste binários ou não preserva referências: ${marker}`);
for (const marker of ['listDocuments', 'uploadDocument', 'deleteDocumentsForRecord']) assert.ok(cloud.includes(marker), `cliente sem sincronização documental: ${marker}`);
for (const marker of ['showCloudLoading', 'syncPendingEvidence', 'mergeUnsyncedLocalState', 'evidenceRemoteUrl']) assert.ok(app.includes(marker), `aplicativo sem jornada documental: ${marker}`);
for (const marker of ['MedRecebe Admin', 'admin-users']) {
  assert.ok(adminHtml.includes(marker) || adminApp.includes(marker), `painel administrativo sem: ${marker}`);
}
for (const marker of ['admin.css?v=4', 'admin.js?v=6', 'users-toolbar', 'Base de clientes', 'Entrar no painel']) {
  assert.ok(adminHtml.includes(marker), `layout administrativo desktop sem: ${marker}`);
}
for (const forbidden of ['SEGUNDA ETAPA', 'segundo fator', 'Authenticator', 'admin-mfa', 'adminMfaSatisfied', 'prompt(']) assert.ok(!`${adminHtml}\n${adminApp}\n${cloud}`.includes(forbidden), `painel administrativo ainda contém: ${forbidden}`);
for (const marker of ['width: calc(100% - 272px)', 'grid-template-columns: repeat(3,minmax(0,1fr))', 'background: var(--navy)', 'dashboard-columns']) assert.ok(appCss.includes(marker) || app.includes(marker), `experiência desktop sem: ${marker}`);
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
for (const marker of ['drop table if exists public.admin_mfa_sessions', 'drop table if exists public.admin_mfa_email_challenges']) assert.ok(simpleAdminMigration.includes(marker), `remoção do 2FA sem: ${marker}`);
for (const marker of ['freemium_user_created', 'durationUnit', 'lifetime']) assert.ok(adminCreateFunction.includes(marker), `criação Freemium sem: ${marker}`);
for (const marker of ['update_profile', 'schedule_suspension', 'force_suspension', 'delete_user']) assert.ok(adminUpdateFunction.includes(marker), `CRUD administrativo sem: ${marker}`);
for (const marker of ['cancelPreapproval', "['cancelled', 'canceled']", 'MercadoPagoError', 'status === 404']) assert.ok(mercadoPagoShared.includes(marker), `cancelamento recorrente sem: ${marker}`);
assert.ok(adminUpdateFunction.includes('cancelPreapproval'), 'exclusão administrativa não cancela a assinatura de forma compatível');
assert.ok(createSubscriptionFunction.includes('cancelPreapproval'), 'substituição de assinatura pendente não cancela a anterior de forma compatível');
assert.ok(cancelSubscriptionFunction.includes('cancelPreapproval'), 'cancelamento do cliente não usa a rotina compatível');
for (const marker of ['unpdf@1.6.2', 'matchedPayerIds', 'amountCents', '5 * 1024 * 1024', 'isRecognizedInvoice', 'hasPdfSignature', 'suggestedPayerCnpj', 'isInvoice: true']) {
  assert.ok(invoiceFunction.includes(marker), `leitura de Nota Fiscal sem: ${marker}`);
}
for (const marker of ['expo-sharing', 'supportsFileWithMaxCount']) assert.ok(mobileConfig.includes(marker), `extensão iOS sem: ${marker}`);
for (const marker of ['getDocumentProxy', 'reconcileInvoice', 'payerMatches', 'isRecognizedInvoice', 'isInvoice: true']) assert.ok(mobileInvoice.includes(marker), `leitura nativa sem: ${marker}`);
for (const marker of ['PDFDocument', 'manipulateAsync', 'createReconciliationPdf', 'embedJpg']) assert.ok(mobileReconciliationPdf.includes(marker), `PDF nativo sem: ${marker}`);
for (const marker of ['Sharing.shareAsync', 'shareOnWhatsApp', 'Compartilhar PDF no WhatsApp', 'Sim, marcar como enviada']) assert.ok(mobileReconciliationScreen.includes(marker), `compartilhamento nativo sem: ${marker}`);
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

for (const marker of ['install', 'activate', 'fetch', 'caches.open', 'medrecebe-app-v21', './app.html', 'reconciliation-pdf.js?v=1', 'institution-directory-rmsp.json']) {
  assert.ok(worker.includes(marker), `sw.js sem: ${marker}`);
}

for (const marker of ['actions/checkout@v6', 'actions/configure-pages@v5', 'actions/upload-pages-artifact@v4', 'actions/deploy-pages@v4']) {
  assert.ok(workflow.includes(marker), `workflow do GitHub Pages sem: ${marker}`);
}
assert.ok(workflow.includes('reconciliation-pdf.js'), 'workflow do GitHub Pages sem o gerador do PDF consolidado');

console.log('MedRecebe validado: branding Calmart, SaaS desktop, login administrativo simples, plano único, CRUD, Nota Fiscal, backup, cancelamento e sincronização presentes.');
