# MedRecebe

Aplicativo para médicos registrarem atendimentos, preverem repasses e prepararem conciliações de pagamento.

## Estrutura

- A raiz contém o beta web instalável (PWA) publicado pelo GitHub Pages.
- [`mobile/`](mobile/README.md) contém o MVP iOS em Expo, preparado para EAS Build e TestFlight.

## Link planejado

Depois da publicação no GitHub Pages, o endereço será:

`https://calmart-brasil.github.io/medrecebe/`

O beta é público, mas os dados inseridos ficam somente no navegador do tester.

## Instalação no iPhone

1. Abra o link no Safari.
2. Toque em Compartilhar.
3. Escolha **Adicionar à Tela de Início**.
4. Ative **Abrir como App da Web** e toque em **Adicionar**.

## Acesso de demonstração

- CPF: `529.982.247-25`
- Senha: `Teste@123`

Também é possível criar uma conta de teste. Conta, senha, cadastros, fotos e atendimentos ficam somente no armazenamento local daquele navegador/aparelho.

## Feedback

O botão **Feedback** registra uma cópia local e abre o Mail com uma mensagem pronta para `feedback@medrecebe.com.br`. O tester revisa e confirma o envio.

Antes de iniciar a rodada de testes, configure esse endereço como caixa ou encaminhamento no domínio `medrecebe.com.br`.

## Limites deste beta

- Não há sincronização entre aparelhos nem recuperação de senha.
- Limpar os dados do Safari ou excluir os dados pelo app remove as informações do beta.
- O acesso biométrico e o envio de anexos já estão previstos no aplicativo iOS nativo, mas não fazem parte desta versão web local.
- Na conciliação, o beta prepara o e-mail; o tester anexa os comprovantes manualmente no Mail.

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
