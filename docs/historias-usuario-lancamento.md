# Histórias de usuário — contratação e conciliação por Nota Fiscal

## Jornada 1 — Descoberta e contratação

### US-01 — Entender o benefício

Como médico, quero compreender como o MedRecebe identifica atrasos e divergências, para decidir se a plataforma serve à minha rotina.

Critérios de aceite:

- A página apresenta problemas reais de repasse, os dois planos, valores, garantia, cancelamento, privacidade e limitações.
- A conciliação por Nota Fiscal explica CNPJ, Razão Social e comparação de valores sem prometer que o pagador quitará a dívida.
- O nome do operador e a marca do provedor de pagamentos não aparecem na comunicação pública.

### US-02 — Contratar antes de acessar

Como novo usuário, quero criar minha conta e concluir a contratação, para acessar o plano escolhido imediatamente após a confirmação.

Critérios de aceite:

- O cadastro cria a conta com acesso `pending_payment`.
- Nenhuma função paga é liberada antes de assinatura autorizada ou liberação administrativa.
- O retorno do checkout consulta o servidor e libera o acesso sem depender exclusivamente do webhook.
- Falha ou demora na confirmação apresenta “Já paguei — verificar acesso” sem apagar a conta.

### US-03 — Usar a garantia de 7 dias

Como consumidor, quero cancelar dentro dos 7 primeiros dias, para receber o estorno integral sem falar com vendedor.

Critérios de aceite:

- O prazo conta do último pagamento aprovado.
- O cancelamento encerra a recorrência antes de solicitar o reembolso.
- O pedido de reembolso usa chave de idempotência.
- Falha do provedor retorna `refundPending`; a interface não afirma que o estorno concluiu.
- Depois de 7 dias, o cancelamento impede cobranças futuras, observadas as exceções legais.

## Jornada 2 — Cadastro financeiro

### US-04 — Cadastrar o pagador corretamente

Como médico, quero informar o local de trabalho, o CNPJ e a Razão Social do pagador, para que a Nota Fiscal seja associada com segurança.

Critérios de aceite:

- Nome do local, CNPJ válido, Razão Social e pelo menos uma modalidade são obrigatórios.
- O CNPJ é salvo somente com 14 dígitos e exibido formatado.
- CNPJ e Razão Social aparecem no resumo do cadastro.
- Cadastros antigos recebem campos vazios e exigem complementação antes da próxima edição.

### US-05 — Registrar modalidades e regras

Como médico, quero registrar plano/particular, valor e regra de vencimento, para calcular automaticamente o recebível.

Critérios de aceite:

- Cada modalidade contém tipo, valor positivo, regra e status.
- Regras personalizadas guardam data-base, deslocamento, unidade, ajuste de dia útil e texto contratual.
- O usuário confere o exemplo de vencimento antes de salvar uma regra personalizada.

### US-06 — Registrar atendimento

Como médico, quero anexar a prova, selecionar a modalidade e salvar, para incluir valor e vencimento no Dashboard.

Critérios de aceite:

- O local precisa estar ativo e ter modalidade ativa.
- A foto é opcional, comprimida e preservada no aparelho.
- O registro salva data, modalidade, valor, vencimento, observação e situação.

## Jornada 3 — Nota Fiscal e conciliação

### US-07 — Selecionar Nota Fiscal no aplicativo

Como médico, quero escolher um PDF ou XML na tela de Conciliação, para conferir o documento recebido.

Critérios de aceite:

- O seletor aceita PDF/XML de até 5 MB.
- O arquivo é processado para extração e não é incorporado à sincronização dos dados de gestão.
- PDF sem texto legível orienta o usuário a usar o XML ou PDF digital original.

### US-08 — Abrir Nota Fiscal pelo e-mail no iPhone

Como médico, quero usar Compartilhar/Abrir com no arquivo recebido, para enviar a Nota Fiscal diretamente ao MedRecebe.

Critérios de aceite:

- O binário iOS inclui uma Share Extension para um arquivo.
- O aplicativo aceita PDF/XML e mantém o compartilhamento pendente até o usuário entrar.
- Depois da leitura, a tela de Conciliação é aberta com o resultado.
- A extensão é validada em uma nova compilação TestFlight; o atalho PWA não substitui essa capacidade nativa.

### US-09 — Identificar o pagador

Como médico, quero que o sistema confirme CNPJ e Razão Social, para evitar associação da nota ao local errado.

Critérios de aceite:

- A associação automática exige o CNPJ válido presente no documento e a Razão Social normalizada presente no texto.
- Apenas CNPJ ou apenas nome não basta para conciliar automaticamente.
- Sem correspondência, o resultado informa “Pagador não identificado” e orienta revisar o cadastro.

### US-10 — Comparar o valor da Nota Fiscal

Como médico, quero comparar o valor da nota ao grupo de atendimentos vencidos, para identificar divergências rapidamente.

Critérios de aceite:

- O sistema escolhe o grupo do pagador com valor mais próximo.
- Igualdade em centavos produz `matched`.
- Diferença produz `divergent` e mostra o valor absoluto da divergência.
- Nota Fiscal não marca o grupo como pago; a baixa continua exigindo confirmação do crédito.

### US-11 — Solicitar conferência

Como médico, quero abrir o e-mail oficial com valores e comprovantes, para pedir regularização do repasse.

Critérios de aceite:

- A mensagem usa local, período, quantidade, valor, detalhes e médico.
- O usuário revisa destinatários, mensagem e anexos antes de enviar.
- O status muda para “em conciliação” somente após confirmação de envio no aplicativo nativo.

## Jornada 4 — Administração e continuidade

### US-12 — Gerenciar acesso pelo PC

Como administrador, quero ver plano, assinatura, garantia e acesso, para resolver pendências sem expor CPF completo nem cartão.

Critérios de aceite:

- Métricas mostram usuários, ativos, dentro da garantia, inadimplentes e suspensos.
- O painel exibe somente os quatro últimos dígitos do CPF.
- Mudanças administrativas geram auditoria.

### US-13 — Alternar provedor de cobrança

Como operador, quero trocar o provedor de pagamentos sem reescrever textos públicos, para preservar a jornada e a marca MedRecebe.

Critérios de aceite:

- Interface e políticas usam “provedor de pagamentos” ou “meio de pagamento”.
- A integração fica isolada nas funções de checkout, webhook, reconciliação, cancelamento e reembolso.
- A troca preserva os estados internos `pending`, `authorized`, `past_due`, `canceled` e `refunded`.

## Matriz de inconsistências evitadas

| Situação | Comportamento esperado |
|---|---|
| Cadastro concluído, pagamento não confirmado | Conta existe, acesso permanece pendente e dados não são apagados. |
| Pagamento aprovado, webhook atrasado | Consulta autenticada reconcilia diretamente com o provedor. |
| Cancelamento repetido | Operação idempotente, sem reembolso duplicado. |
| Nota contém CNPJ de várias empresas | Associação exige também a Razão Social cadastrada. |
| Nota e contabilizado divergem | Mostra diferença; não marca como pago. |
| PDF é apenas imagem | Solicita XML/PDF digital; não inventa dados. |
| Arquivo compartilhado antes do login | Mantém pendente e processa após autenticação. |
| Cadastro antigo sem CNPJ/Razão Social | Exibe ausência e exige complementação ao editar. |
| Plano Mobile aberto em PC | Oferece Plano Web sem apagar dados. |
| Provedor de cobrança muda | Comunicação pública e estados internos permanecem estáveis. |
