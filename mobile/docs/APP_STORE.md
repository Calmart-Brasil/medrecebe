# Checklist de TestFlight e App Store

## 1. Identidade do aplicativo

- Nome: **MedRecebe**
- Bundle ID sugerido: `com.calmart.medrecebe`
- SKU sugerido: `MEDRECEBE-IOS-001`
- Categoria primária sugerida: Finanças
- Categoria secundária sugerida: Produtividade
- Classificação etária provável: 4+
- URL de suporte: `https://calmart-brasil.github.io/medrecebe/suporte.html`
- URL de privacidade: `https://calmart-brasil.github.io/medrecebe/privacidade.html`

Confirme a disponibilidade do nome e do Bundle ID no App Store Connect antes do primeiro build.

## 2. Texto sugerido para o TestFlight

### O que testar

> Cadastre um local com CNPJ e Razão Social do pagador e suas modalidades de repasse; registre um atendimento com comprovante; confira valor e vencimento no Dashboard; importe uma Nota Fiscal em PDF/XML pela Conciliação; teste também “Compartilhar → MedRecebe” a partir do Mail ou Arquivos, a mensagem de conciliação e a ativação do Face ID.

### Conta para revisão

- CPF: `529.982.247-25`
- Senha: `Teste@123`

### Notas ao revisor

> O MedRecebe organiza recebíveis do próprio profissional. No MVP, os dados ficam no aparelho e o envio de conciliação sempre exige revisão e confirmação no compositor do Mail. A Nota Fiscal recebida pelo menu Compartilhar é lida para conferir CNPJ, Razão Social e valor, sem marcar o repasse como pago. A câmera é solicitada apenas ao adicionar o comprovante. O Face ID é opcional e pode ser ativado em Conta e segurança. A conta e todos os dados podem ser excluídos no mesmo menu.

## 3. Metadados sugeridos

### Subtítulo

`Atendimentos e repasses em dia`

### Texto promocional

`Registre atendimentos, acompanhe cada crédito previsto e prepare conciliações com os comprovantes certos.`

### Descrição

> O MedRecebe ajuda profissionais de saúde a organizar os repasses dos locais onde trabalham.
>
> Cadastre clínicas e hospitais, configure modalidades como planos e atendimentos particulares e registre o valor e a regra de pagamento de cada uma. Ao finalizar um atendimento, fotografe o comprovante, escolha a modalidade e salve. O aplicativo calcula o valor a receber e a data prevista para o crédito.
>
> No Dashboard, acompanhe os totais por local, os atendimentos vencidos e os pagamentos em conciliação. Quando necessário, selecione um grupo vencido e abra uma solicitação pronta no Mail, com resumo e comprovantes anexados.
>
> Face ID ou Touch ID opcionais tornam a entrada mais rápida. Seus dados podem ser excluídos diretamente no aplicativo.

### Palavras-chave

`médico,repasses,atendimentos,recebíveis,conciliação,clínica,financeiro`

## 4. App Privacy — declaração inicial do MVP

Revise no App Store Connect com assessoria de privacidade. Para a versão local atual:

- Identificadores: CPF e nome, vinculados ao usuário, usados para funcionalidade/autenticação.
- Informações de contato: e-mail, vinculado ao usuário, usado para conta e composição da mensagem.
- Conteúdo do usuário: fotografias e observações, vinculadas ao usuário, usadas para funcionalidade.
- Informações financeiras: valores e previsões de repasse, vinculadas ao usuário, usadas para funcionalidade.
- Rastreamento: não realizado.
- Publicidade: não utilizada.
- Analytics/crash SDKs: não instalados no MVP.

Quando o backend entrar, atualize tanto a política quanto o formulário App Privacy antes de submeter a versão.

## 5. Arte e capturas

O ícone 1024×1024 está em `assets/icon.png`. Gerar capturas reais no build para os tamanhos de iPhone exigidos no App Store Connect, cobrindo:

1. Início com locais de trabalho.
2. Registro com comprovante e modalidade.
3. Dashboard por local.
4. Cadastro das regras de pagamento.
5. Grupo de conciliação pronto para envio.

Não use dados de pacientes ou endereços reais nas capturas.

## 6. Portões antes da versão pública

- Backend de autenticação, sincronização e backup em produção.
- Hash de senha forte no servidor (Argon2id ou equivalente) e tokens curtos/renováveis.
- Criptografia em trânsito, gestão de segredos e trilha de auditoria.
- Calendário brasileiro de feriados bancários e regras contratuais validadas.
- Termos de Uso e Política de Privacidade revisados juridicamente para LGPD e contexto de saúde.
- Processo de suporte, recuperação de acesso, exportação e exclusão no servidor.
- Testes em aparelhos reais, acessibilidade, falhas de rede e migração do banco.
- Conta de revisão ativa ou modo demo funcional durante toda a análise da Apple.
