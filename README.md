# MedRecebe

Aplicativo para médicos registrarem atendimentos, preverem repasses e prepararem conciliações de pagamento.

## Estrutura

- A raiz contém o beta web instalável (PWA) publicado pelo GitHub Pages.
- [`admin.html`](admin.html) contém o painel administrativo protegido por função de servidor.
- [`supabase/`](supabase/) contém banco, RLS e Edge Functions para autenticação, assinatura e administração.
- [`branding/`](branding/) contém o master Liquid Glass e camadas para o Icon Composer.
- [`mobile/`](mobile/README.md) contém o MVP iOS em Expo, preparado para EAS Build e TestFlight.

## Acesso beta

`https://calmart-brasil.github.io/medrecebe/`

Sem configuração de backend, o beta continua no modo local. Com Supabase configurado, identidade e situação da assinatura passam a ser verificadas online; cadastros, fotos e atendimentos continuam separados por usuário no aparelho.

## Instalação no iPhone

1. Abra o link no Safari.
2. Toque em Compartilhar.
3. Escolha **Adicionar à Tela de Início**.
4. Ative **Abrir como App da Web** e toque em **Adicionar**.

## Acesso de demonstração

- CPF: `529.982.247-25`
- Senha: `Teste@123`

Também é possível fazer o primeiro acesso com nome, e-mail, CPF válido e uma senha de pelo menos oito caracteres. Conta, senha protegida por hash, cadastros, fotos e atendimentos permanecem no armazenamento local daquele aparelho.

## Feedback

O botão **Feedback** registra uma cópia local e abre o Mail com uma mensagem pronta para `feedback@medrecebe.com.br`. O tester revisa e confirma o envio.

Antes de iniciar a rodada de testes, configure esse endereço como caixa ou encaminhamento no domínio `medrecebe.com.br`.

## Limites deste beta

- Não há sincronização entre aparelhos nem recuperação de senha.
- Limpar os dados do Safari ou excluir os dados pelo app remove as informações do beta.
- O acesso biométrico e o envio de anexos já estão previstos no aplicativo iOS nativo, mas não fazem parte desta versão web local.
- Na conciliação, o beta prepara o e-mail; o tester anexa os comprovantes manualmente no Mail.

## Assinatura e administração

O fluxo comercial está preparado para R$ 29,90/mês pelo Mercado Pago, com checkout hospedado, webhook idempotente, liberação de acesso e painel administrativo. Consulte [`docs/BILLING_ADMIN.md`](docs/BILLING_ADMIN.md) antes de ativar credenciais de produção.

## Validação

```bash
node --check app.js
node --check sw.js
node validate-beta.mjs
```

Para validar o projeto iOS:

```bash
cd mobile
npm install
npm run check:project
npm run test:rules
```
