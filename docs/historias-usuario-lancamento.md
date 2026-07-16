# Histórias do usuário — lançamento oficial MedRecebe

Versão: 16/07/2026

## Jornada 1 — Descoberta e teste

### US-01 — Entender a proposta antes de criar conta

Como médico, quero entender quais problemas o MedRecebe resolve e quais são seus limites, para decidir se faz sentido testá-lo.

Critérios de aceite:

- A página explica atrasos, valores divergentes, atendimentos não localizados e regras de repasse.
- A página não promete recuperar dinheiro nem garantir pagamento.
- Planos, valores, teste, cancelamento, privacidade e suporte aparecem antes do cadastro.

### US-02 — Começar o teste sem cartão

Como novo usuário, quero testar por 7 dias sem cadastrar cartão, para avaliar o produto sem risco de cobrança inesperada.

Critérios de aceite:

- O cadastro inicia o período de 7 dias e libera o plano escolhido.
- Nenhuma cobrança é criada durante o teste sem ação expressa do usuário.
- A conta mostra a data ou os dias restantes.
- Encerrar o teste bloqueia o acesso e não solicita reembolso, pois não houve cobrança.

## Jornada 2 — Conta e acesso

### US-03 — Criar acesso com CPF real

Como médico, quero criar conta com nome, e-mail, CPF e senha, para acessar meu ambiente com segurança.

Critérios de aceite:

- CPF inválido, senha curta e e-mail inválido são recusados com mensagem clara.
- CPF completo não fica disponível no painel administrativo.
- CPF ou e-mail já cadastrados não criam conta duplicada.
- A sessão persiste entre fechamentos normais do navegador.

### US-04 — Recuperar o acesso após login

Como usuário existente, quero entrar com CPF e senha e ver o status correto do teste ou assinatura.

Critérios de aceite:

- Teste válido libera o aplicativo.
- Teste expirado apresenta os planos sem apagar os dados locais.
- Pagamento aprovado libera acesso mesmo que o webhook esteja atrasado.
- Conta suspensa não revela se o CPF existe.

## Jornada 3 — Cadastro e atendimento

### US-05 — Configurar local e modalidade

Como médico, quero cadastrar cada local, modalidade, valor e regra, para calcular o repasse previsto corretamente.

Critérios de aceite:

- Um local precisa de pelo menos uma modalidade.
- Valores precisam ser positivos.
- Regra personalizada exige texto contratual e parâmetros calculáveis.
- O usuário pode editar, desativar e reativar sem perder o histórico.

### US-06 — Registrar atendimento

Como médico, quero fotografar a prova, classificar a modalidade e salvar uma observação, para manter uma memória do serviço prestado.

Critérios de aceite:

- O registro exige local, modalidade, data e comprovante.
- A data de crédito e o valor são exibidos antes de salvar.
- A foto é comprimida e permanece no aparelho.
- Falha de armazenamento não cria registro parcial.

## Jornada 4 — Dashboard e conciliação

### US-07 — Ver recebíveis por local e vencimento

Como médico, quero visualizar valores em aberto e datas previstas, para priorizar conferências.

Critérios de aceite:

- Totais excluem itens marcados como recebidos.
- Grupos mostram quantidade, local, data e valor.
- Marcar como recebido exige confirmação.
- Cálculos informam a limitação referente a feriados e regras excepcionais.

### US-08 — Preparar uma conciliação

Como médico, quero selecionar atendimentos vencidos e abrir uma mensagem padronizada, para cobrar o canal oficial com contexto suficiente.

Critérios de aceite:

- Somente itens vencidos e não recebidos entram no grupo.
- Destinatário, assunto, período, quantidade e valor são revisáveis.
- O envio só ocorre após confirmação no aplicativo de e-mail.
- A versão web informa que anexos devem ser adicionados manualmente.

## Jornada 5 — Planos e dispositivos

### US-09 — Usar o Plano Mobile

Como usuário do Plano Mobile, quero instalar o MedRecebe no iPhone e manter meus registros no aparelho.

Critérios de aceite:

- O atalho abre diretamente em `app.html`.
- Fechar o aplicativo não apaga os registros.
- O acesso amplo pelo PC informa claramente a necessidade do Plano Web.

### US-10 — Usar o Plano Web

Como usuário do Plano Web, quero acessar cadastros e indicadores no iPhone e no PC, para administrar minha rotina em tela ampla.

Critérios de aceite:

- O layout se adapta ao computador com fontes e largura adequadas.
- Locais, regras, atendimentos e indicadores sincronizam após autenticação.
- Fotos e credenciais são removidas do estado enviado ao servidor.
- Falha de rede mantém o estado local e informa que a sincronização será retomada.

## Jornada 6 — Pagamento, cancelamento e reembolso

### US-11 — Assinar depois do teste

Como usuário que decidiu continuar, quero escolher Mobile ou Web e pagar pelo Mercado Pago, para liberar o plano sem espera.

Critérios de aceite:

- O checkout recebe o valor do plano escolhido.
- O retorno possui URL válida e inicia reconciliação automática.
- O servidor consulta o Mercado Pago e não depende apenas do webhook.
- Assinatura aprovada aparece como `authorized` e acesso `active` no painel.

### US-12 — Cancelar sem falar com vendedor

Como assinante, quero cancelar dentro da conta, para impedir novas cobranças sem burocracia.

Critérios de aceite:

- A ação exige confirmação explícita.
- A recorrência é cancelada no Mercado Pago antes da atualização local.
- O banco registra data e status do cancelamento.
- Uma falha apresenta mensagem clara e não afirma que o cancelamento foi concluído.

### US-13 — Receber estorno no prazo de arrependimento

Como consumidor que cancelou em até 7 dias da contratação, quero que o reembolso integral seja solicitado automaticamente.

Critérios de aceite:

- O pagamento é localizado pelo identificador da conta, status e valor do plano.
- A solicitação usa chave de idempotência para evitar reembolso duplicado.
- O resultado informa reembolso solicitado ou necessidade de conferência.
- O texto explica que o prazo de crédito depende do Mercado Pago e do emissor.

## Jornada 7 — Administração e privacidade

### US-14 — Administrar usuários

Como administrador, quero ver plano, teste, assinatura e acesso, para identificar pendências sem ver CPF completo nem cartão.

Critérios de aceite:

- Métricas separam usuários ativos, em teste, inadimplentes e suspensos.
- A tabela mostra Mobile/Web e status da assinatura.
- Mudanças manuais exigem confirmação e geram auditoria.
- Conta administrativa não pode ser suspensa nessa tela.

### US-15 — Exercer direitos de dados

Como titular, quero saber quais dados são tratados e como pedir acesso, correção ou exclusão.

Critérios de aceite:

- A Política de Privacidade identifica controlador, finalidades, operadores, retenção, direitos e canal.
- Cancelar assinatura e excluir dados são apresentados como ações distintas.
- O usuário é orientado a não inserir dados clínicos desnecessários.

## Matriz de prevenção de inconsistências

| Situação | Regra |
|---|---|
| Webhook falha | `account-status` reconcilia diretamente com Mercado Pago. |
| Retorno do checkout demora | App faz tentativas curtas e oferece verificação manual. |
| Pagamento de valor diferente | Servidor rejeita a liberação se não corresponder ao plano atual. |
| Reembolso repetido | Chave de idempotência usa o ID interno da assinatura. |
| Teste expira | Acesso muda para pagamento pendente sem apagar os dados. |
| Plano Mobile aberto no PC | Exibe upgrade; não perde registros. |
| Sincronização indisponível | Mantém dados locais e tenta novamente depois. |
| Foto no Plano Web | Nunca é incluída no estado sincronizado. |
| Cancelamento falha no provedor | Banco não confirma cancelamento e usuário recebe erro. |
| Usuário limpa dados do navegador | Políticas deixam claro o risco do armazenamento local. |
