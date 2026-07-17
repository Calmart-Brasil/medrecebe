# Diretório institucional — São Paulo e Região Metropolitana

## Escopo do primeiro lote

O diretório cobre os 39 municípios da Região Metropolitana de São Paulo e contém somente registros ativos encontrados na competência consultada do Cadastro Nacional de Estabelecimentos de Saúde (CNES).

Base gerada em 17/07/2026 com dados CNES atualizados em 16/07/2026:

- 506 hospitais ou estabelecimentos com atendimento hospitalar;
- 14 cooperativas ou empresas de cessão de trabalhadores na saúde;
- 426 unidades móveis ou prestadores pré-hospitalares de urgência;
- 110 centrais de gestão em saúde;
- 1.056 estabelecimentos e 583 CNPJs pagadores distintos.

Cada unidade física permanece separada pelo código CNES. Isso permite que dois hospitais da mesma rede apareçam como locais de trabalho diferentes, ainda que compartilhem a mesma mantenedora.

## Fontes oficiais

- CNES / Ministério da Saúde: https://dadosabertos.saude.gov.br/dataset/cnes-cadastro-nacional-de-estabelecimentos-de-saude
- API de tipos de unidade do CNES: https://apidadosabertos.saude.gov.br/cnes/tipounidades
- Municípios da RMSP: https://admin.sggd.sp.gov.br/habitacao/institucional/subsecretaria%20de%20desenvolvimento%20urbano/PDUI/rmsp
- Consulta do comprovante oficial do CNPJ: https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/cnpj.aspx

## Regra para o CNPJ sugerido

O MedRecebe utiliza primeiro o CNPJ do próprio estabelecimento informado pelo CNES. Quando a unidade não possui CNPJ próprio, utiliza o CNPJ da mantenedora e identifica essa origem na tela.

O CNPJ sugerido é um auxílio de preenchimento. O médico deve confirmar no contrato, na Nota Fiscal ou no demonstrativo de repasse qual pessoa jurídica efetivamente realiza o pagamento. Os campos permanecem editáveis depois da seleção.

## Comprovante de inscrição (“cartão CNPJ”)

O comprovante oficial é emitido sob demanda pela Receita Federal e pode exigir validação humana. Por isso, o MedRecebe não armazena um PDF antigo como se fosse uma certidão atual. A tela oferece acesso direto ao serviço oficial para que o usuário consulte o comprovante vigente do CNPJ selecionado.

## Atualização da base

1. Baixar o recurso CSV mais recente do CNES.
2. Extrair `cnes_estabelecimentos.csv` em `.tmp-cnes/csv/`.
3. Executar:

```powershell
node scripts/build-institution-directory.mjs --input=.tmp-cnes/csv/cnes_estabelecimentos.csv --output=data/institution-directory-rmsp.json --source-date=AAAA-MM-DD
```

4. Executar `node validate-beta.mjs` e os testes do projeto mobile.

O gerador valida os dígitos do CNPJ, remove estabelecimentos desativados, limita o território aos 39 municípios e preserva a rastreabilidade pelo CNES.
