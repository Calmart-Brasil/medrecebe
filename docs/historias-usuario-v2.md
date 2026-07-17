# Histórias de usuário — MedRecebe 2.1

## Plano único e acesso

- Como médico, quero contratar um único plano de R$ 39,90 para usar todos os recursos no celular e no computador.
- Critérios: não existe bloqueio por tipo de dispositivo; a interface adapta-se à tela; os dados de gestão são sincronizados; o acesso pago só é liberado após confirmação.

## Locais, modalidades e regras

- Como médico, quero cadastrar plano, particular, receita recorrente ou um tipo personalizado.
- Critérios: o tipo personalizado exige somente o nome do tipo; novas regras oferecem à vista, antecipado, dias corridos e primeiro/último dia útil do mês seguinte; regras semanais e personalizadas antigas continuam legíveis, mas não aparecem em novos cadastros.
- Como médico, quero adicionar várias modalidades sem perder o preenchimento do local.
- Critérios: adicionar/editar/excluir atualiza a lista abaixo do formulário; locais existentes recebem autosave da modalidade; o rodapé exibe Salvar e depois Cancelar; não há Salvar no cabeçalho.

## Atendimento e receita recorrente

- Como médico, quero consultar e corrigir atendimentos registrados.
- Critérios: a tela lista o histórico do local; permite editar e excluir; a correção preserva o status e recalcula valor e vencimento.
- Como médico, quero registrar um medicamento de uso contínuo e a consulta associada.
- Critérios: receita recorrente registra referência mínima do paciente, medicamento/tratamento e pode somar uma modalidade de consulta ao valor contabilizado.

## Cancelamento e portabilidade

- Como assinante, quero encontrar o cancelamento dentro da política correspondente.
- Critérios: a conta não expõe um botão direto; a política apresenta o comando ao final; pedidos elegíveis em até 7 dias solicitam reembolso integral.
- Como médico, quero guardar meus registros antes de cancelar.
- Critérios: o fluxo oferece arquivo JSON com locais, modalidades, atendimentos e conciliações; no iPhone usa o compartilhamento do Safari; no fallback baixa o arquivo e prepara uma mensagem ao próprio e-mail.

## Administração e Freemium

- Como administrador, quero criar, consultar, corrigir e excluir clientes.
- Critérios: nome e e-mail podem ser corrigidos; o CPF só é substituído quando o número completo é informado; exclusões exigem confirmação textual e geram auditoria.
- Como administrador, quero conceder acesso Freemium por dias, semanas, meses, anos ou vitalício.
- Critérios: a validade é calculada no servidor; concessão e revogação são auditadas; a métrica Freemium não se confunde com assinatura paga.
- Como administrador, quero programar uma suspensão para o fim do ciclo ou forçá-la por infração.
- Critérios: a suspensão comum pausa novas cobranças e preserva o período pago; a forçada é imediata, exige reconfirmação e registra a ausência de restituição proporcional quando legalmente aplicável.

## Acesso administrativo

- Como administrador, quero acessar o painel com CPF e senha, sem uma etapa adicional.
- Critérios: a senha cria uma sessão autenticada; o servidor confirma que a conta possui papel `admin`; contas comuns nunca acessam o painel nem as funções de CRUD.

## Comunicação e identidade

- Como equipe, quero centralizar comunicações operacionais em `ti@calmart.com.br`.
- Critérios: feedback, suporte, privacidade e comunicações administrativas não apontam para endereço pessoal.
- Como usuário, quero reconhecer facilmente o ícone.
- Critérios: a fonte vetorial é única; o azul está mais luminoso; o ponto verde do estetoscópio possui maior brilho; PNGs de PWA e iOS são derivados da mesma arte.
