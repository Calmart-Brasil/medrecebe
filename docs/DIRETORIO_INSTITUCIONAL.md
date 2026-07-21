# Diretório institucional — Brasil

## Escopo nacional

O diretório cobre as 27 UFs do Brasil e contém somente registros ativos, com CNPJ válido, encontrados na competência consultada do Cadastro Nacional de Estabelecimentos de Saúde (CNES). A aplicação baixa apenas o arquivo da UF escolhida para preservar desempenho no celular.

Base gerada em 21/07/2026 com dados CNES atualizados em 18/07/2026:

- 22.782 estabelecimentos e empresas elegíveis;
- 14.422 CNPJs pagadores distintos;
- 26 estados e Distrito Federal;
- 627.864 registros CNES inspecionados.

Cada unidade física permanece separada pelo código CNES. Isso permite que dois hospitais da mesma rede apareçam como locais de trabalho diferentes, ainda que compartilhem a mesma mantenedora.

O campo `tradeName` preserva o nome fantasia informado pelo estabelecimento ao CNES, enquanto `legalName` guarda a razão social. A busca considera ambos e a interface os apresenta separadamente. Quando o CNES não informa nome fantasia, o campo permanece vazio e a razão social é usada apenas como nome de exibição de contingência.

## Fontes oficiais

- CNES / Ministério da Saúde: https://dadosabertos.saude.gov.br/dataset/cnes-cadastro-nacional-de-estabelecimentos-de-saude
- API de tipos de unidade do CNES: https://apidadosabertos.saude.gov.br/cnes/tipounidades
- API de Localidades do IBGE: https://servicodados.ibge.gov.br/api/docs/localidades
- Consulta do comprovante oficial do CNPJ: https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/cnpj.aspx

## Regra para o CNPJ sugerido

O MedRecebe utiliza primeiro o CNPJ do próprio estabelecimento informado pelo CNES. Quando a unidade não possui CNPJ próprio, utiliza o CNPJ da mantenedora e identifica essa origem na tela.

O CNPJ sugerido é um auxílio de preenchimento. O médico deve confirmar no contrato, na Nota Fiscal ou no demonstrativo de repasse qual pessoa jurídica efetivamente realiza o pagamento. Os campos permanecem editáveis depois da seleção.

## Comprovante de inscrição (“cartão CNPJ”)

O comprovante oficial é emitido sob demanda pela Receita Federal e pode exigir validação humana. Por isso, o MedRecebe não armazena um PDF antigo como se fosse uma certidão atual. A tela oferece acesso direto ao serviço oficial para que o usuário consulte o comprovante vigente do CNPJ selecionado.

## Atualização da base

1. Baixar o recurso CSV mais recente do CNES.
2. Extrair `cnes_estabelecimentos.csv` em uma pasta temporária.
3. Executar o gerador nacional, que consulta a API oficial do IBGE para nomear os municípios:

```powershell
node scripts/build-national-institution-directory.mjs --input=.tmp-cnes/csv/cnes_estabelecimentos.csv --output-dir=data/institutions --source-date=AAAA-MM-DD
```

4. Executar `node validate-beta.mjs` e os testes do projeto mobile.

O gerador valida os dígitos do CNPJ, remove estabelecimentos desativados, particiona o resultado por UF e preserva a rastreabilidade pelos códigos CNES e IBGE.
