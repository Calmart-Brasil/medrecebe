# MedRecebe

SaaS para médicos registrarem atendimentos, acompanharem repasses e prepararem conciliações de pagamento.

## Produção

- Site: `https://medrecebe.com.br/`
- Aplicativo web/PWA: `https://medrecebe.com.br/app.html`
- Painel administrativo: `https://medrecebe.com.br/admin.html`
- Repositório: `https://github.com/Calmart-Brasil/medrecebe`

## Produto

- Cobrança no início do ciclo, com garantia de cancelamento e estorno integral em 7 dias.
- Plano único: R$ 39,90/mês, uso no celular e no PC com sincronização dos dados de gestão.
- Fotos de comprovantes permanecem no aparelho e não entram na sincronização Web.
- Cobrança recorrente, cancelamento e reembolso processados pelo provedor de pagamentos vigente.
- Conciliação de Nota Fiscal em PDF/XML por CNPJ, Razão Social e valor contabilizado.

## Estrutura

- `index.html` e `landing.css`: página comercial.
- `app.html`, `app.js`, `styles.css` e `cloud.js`: aplicação PWA.
- `admin.html`, `admin.js` e `admin.css`: painel administrativo para PC.
- `termos.html`, `privacidade.html`, `cancelamento.html` e `suporte.html`: documentos e suporte.
- `supabase/`: banco, RLS e Edge Functions.
- `docs/historias-usuario-lancamento.md`: jornadas e critérios de aceite.
- `mobile/`: base do aplicativo iOS para TestFlight.

## Instalação no iPhone

1. Abra `https://medrecebe.com.br/app.html` no Safari.
2. Toque em Compartilhar.
3. Escolha **Adicionar à Tela de Início**.
4. Ative **Abrir como App da Web** e confirme.

## Segurança e privacidade

O CPF completo é transformado em hash no servidor. O painel exibe somente os quatro últimos dígitos. Dados completos do cartão não passam pelo MedRecebe. O servidor remove credenciais e fotografias antes de persistir o estado sincronizado. O painel administrativo aceita somente contas com papel `admin`, autenticadas por CPF e senha.

## Validação

```bash
node --check app.js
node --check cloud.js
node --check admin.js
node validate-beta.mjs
```

O workflow `.github/workflows/pages.yml` publica o conteúdo estático no GitHub Pages. As Edge Functions são implantadas pela Supabase CLI.
