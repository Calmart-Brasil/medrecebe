# MedRecebe — MVP iOS

Aplicativo React Native/Expo voltado primeiro ao iPhone para registrar atendimentos, calcular repasses e preparar conciliações por e-mail.

## O que está implementado

- Login por CPF e senha, primeiro acesso local e desbloqueio opcional por Face ID/Touch ID.
- Dashboard com quantidade, valor a receber, vencidos, conciliações, próxima data de crédito por local e baixa de grupos recebidos.
- CRUD de locais e modalidades, com CNPJ e Razão Social do pagador, valor por atendimento e regra de pagamento.
- Novas regras à vista, antecipada, em dias corridos e primeiro/último dia útil do mês seguinte. Regras semanais ou personalizadas já existentes continuam compatíveis como legado.
- Registro de atendimento com câmera ou galeria, modalidade, observação, valor e vencimento calculados.
- Persistência local no SQLite; credenciais no Keychain; comprovantes na pasta privada do aplicativo.
- Conciliação de grupos vencidos por local/mês, com mensagem parametrizada e anexos no compositor nativo do Mail.
- Leitura de Nota Fiscal em PDF/XML pelo seletor de arquivos ou por Compartilhar/Abrir com, com comparação de CNPJ, Razão Social e valor contabilizado.
- Exclusão de conta, dados e comprovantes pelo próprio aplicativo.

## Executar

Pré-requisitos: Node.js 22.13 ou superior e uma conta Expo.

```bash
cd mobile
npm install
npx expo start
```

O Face ID precisa de um development build ou de uma compilação distribuída; não funciona plenamente no Expo Go.

### Acesso de demonstração

- CPF: `529.982.247-25`
- Senha: `Teste@123`

O botão **Usar demo** faz esse acesso automaticamente. Os endereços de conciliação da demonstração usam o domínio reservado `.exemplo` e não devem ser enviados.

## Testes locais

```bash
npm run test:rules
npm run check:project
npm run doctor
```

O teste de regras não depende de pacotes externos e cobre os principais vencimentos. O `expo-doctor` deve ser executado depois de instalar as dependências.

## TestFlight

Antes da primeira compilação, confirme o identificador `com.calmart.medrecebe` em `app.json`. Ele precisa ser único e pertencer à sua conta Apple Developer.

```bash
cd mobile
npm install
npx eas-cli@latest login
npx eas-cli@latest init
npx testflight
```

O `eas init` adiciona o `projectId` real do projeto. O comando `npx testflight` conduz a criação, assinatura e submissão ao TestFlight. Como alternativa:

```bash
npm run build:ios
npm run submit:ios
```

As credenciais Apple/Expo não ficam no repositório. Veja [docs/APP_STORE.md](docs/APP_STORE.md) para o checklist de publicação e [docs/API_PRODUCAO.md](docs/API_PRODUCAO.md) para a evolução do MVP.

## Limite deliberado do MVP

Esta versão é **local-first e de um único aparelho**. Ela é adequada para validação no TestFlight, mas não deve ser promovida à versão pública final sem autenticação no servidor, backup/sincronização, política de retenção, auditoria, calendário de feriados e revisão jurídica/LGPD. A biometria libera uma sessão local; ela não substitui a autenticação de identidade no backend.
