# Assinaturas e painel administrativo

O MedRecebe oferece teste gratuito de 7 dias sem cartão, Plano Mobile de **R$ 29,90/mês** e Plano Web de **R$ 59,90/mês**. Checkout, recorrência, cancelamento e reembolso são processados pelo Mercado Pago. Identidade, acesso, sincronização e painel administrativo usam Supabase.

## Arquitetura

- GitHub Pages: PWA e painel `admin.html`; contém somente URL e chave pública do Supabase.
- Supabase Auth: sessão, confirmação de e-mail e recuperação futura.
- Postgres + RLS: perfis, assinaturas, eventos, estado sincronizado e auditoria administrativa.
- Edge Functions: cadastro, login, status, checkout, webhook, sincronização, cancelamento e administração.
- Mercado Pago: token e assinatura secreta ficam apenas nas Edge Functions.

O CPF completo não é gravado na tabela de perfis. O servidor persiste um SHA-256 com `CPF_PEPPER` e apenas os quatro últimos dígitos para suporte operacional.

## 1. Criar o projeto Supabase

Crie um projeto de produção, instale a CLI e execute na raiz do repositório:

```bash
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase db push
```

Ative proteção contra senhas vazadas, CAPTCHA no cadastro/login e configure SMTP próprio antes de abrir o cadastro público.

## 2. Criar a integração Mercado Pago

Na conta vendedora **Lucas Catarin**, acesse **Suas integrações**, crie uma aplicação chamada `MedRecebe` e obtenha primeiro as credenciais de teste. Não coloque Access Token em arquivos, GitHub Pages ou mensagens.

Configure os segredos diretamente no Supabase:

```bash
supabase secrets set APP_ORIGINS=https://medrecebe.com.br,https://www.medrecebe.com.br,https://calmart-brasil.github.io
supabase secrets set APP_URL=https://medrecebe.com.br/app.html
supabase secrets set CPF_PEPPER=UMA_CHAVE_ALEATORIA_LONGA
supabase secrets set MERCADO_PAGO_ACCESS_TOKEN=SEU_TOKEN
supabase secrets set MERCADO_PAGO_WEBHOOK_SECRET=SEU_SEGREDO_DE_WEBHOOK
```

Implante as funções:

```bash
supabase functions deploy register
supabase functions deploy login-cpf
supabase functions deploy account-status
supabase functions deploy create-subscription
supabase functions deploy mercado-pago-webhook
supabase functions deploy admin-users
supabase functions deploy admin-update-user
supabase functions deploy sync-state
supabase functions deploy cancel-subscription
```

O endpoint de webhook será:

```text
https://SEU_PROJECT_REF.supabase.co/functions/v1/mercado-pago-webhook
```

Ative os eventos `subscription_preapproval`, `subscription_authorized_payment` e `payment`. O status autenticado também reconcilia diretamente com a API do Mercado Pago, evitando dependência exclusiva do webhook.

## 3. Conectar o GitHub Pages

Em **GitHub → Settings → Secrets and variables → Actions → Variables**, crie:

- `SUPABASE_URL`: URL pública do projeto.
- `SUPABASE_PUBLISHABLE_KEY`: chave pública `sb_publishable_...`.

O workflow gera `runtime-config.js` durante a publicação. A chave secreta/service role nunca deve ser configurada no GitHub Pages.

## 4. Criar o primeiro administrador

Faça um cadastro normal com seu CPF e, no SQL Editor do Supabase, promova somente sua conta:

```sql
update public.profiles
set role = 'admin', access_status = 'active'
where email = 'SEU_EMAIL_ADMINISTRATIVO';
```

Depois acesse `/admin.html`. O painel permite pesquisar usuários, liberar ou suspender acesso. Cada mudança gera uma linha em `admin_audit_log`.

## 5. Regras de acesso

- `pending_payment`: cadastrado, ainda sem assinatura aprovada.
- `active`: teste vigente, assinatura autorizada ou liberação temporária por administrador.
- `past_due`: cobrança recusada/pausada.
- `suspended`: bloqueio manual administrativo.
- `canceled`: assinatura cancelada.

O webhook é idempotente: eventos são guardados antes do processamento e tentativas repetidas não duplicam a atualização.

## Cancelamento e reembolso

`cancel-subscription` cancela a recorrência no Mercado Pago. Se o último pagamento tiver até 7 dias, localiza a transação pelo usuário, valor e data e solicita reembolso integral com chave de idempotência. Falhas de reembolso são devolvidas como pendência de conferência, sem reativar a recorrência.

## Plano Web

`sync-state` aceita somente contas do Plano Web ativas. Credenciais, campos internos e fotografias são removidos antes do `upsert` em `user_app_states`. Fotos permanecem no aparelho de origem.

## App Store e TestFlight

O Mercado Pago pode operar o checkout web. Para oferecer esse pagamento alternativo dentro do app distribuído no Brasil, será necessário solicitar o **StoreKit External Purchases or Offers Entitlement**, implementar as APIs/tela informativa exigidas pela Apple e limitar o recurso a iOS 26.5 ou posterior. Em TestFlight, transações de teste do pagamento alternativo devem ocorrer sem custo.

Antes da App Store final, escolha uma das estratégias:

1. StoreKit auto-renovável como compra principal e Mercado Pago apenas na web; ou
2. Mercado Pago no iOS brasileiro com entitlement, relatórios e comissões de compra externa.

Não habilite cobrança produtiva no TestFlight sem concluir essa decisão e revisar requisitos fiscais, cancelamento, reembolso e LGPD.
