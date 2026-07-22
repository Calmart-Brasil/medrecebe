# Integração fiscal e inteligência de dados assistenciais

Atualizado em 22/07/2026.

## Decisões executivas

| Tema | Decisão | Qualidade para uso no produto |
|---|---|---|
| NFS-e de CNPJ | Preparar integração pela API de distribuição do Ambiente de Dados Nacional (ADN), por NSU e certificado digital. Não automatizar o e-CAC. | Piloto controlado |
| Documento de prestador CPF | Manter upload de PDF/XML. Não anunciar sincronização automática até existir contrato de API oficial atual e homologado para CPF/Receita Saúde. | Bloqueado para automação |
| Internações por CID | Publicar como utilização hospitalar SUS observada por CID principal, com taxa populacional e competência. | Aprovado |
| Produção ambulatorial por CID | Usar somente os instrumentos individualizados em que o diagnóstico está disponível e medir completude por competência. | Piloto |
| Saúde suplementar | Usar D-TISS para volume e valor por procedimento. Não apresentar um mapa privado nacional por CID. | Piloto |
| Saúde do trabalhador | Reservar AEAT/INSS para uma análise específica de incapacidade ocupacional. | Fora do mapa principal |
| OCI | Cruzar APAC/SIA, SIGTAP e CNES para produção, procedimentos, estabelecimento, município e CBO. | Piloto |
| Demanda reprimida | Não publicar como fato nacional. As filas são geridas localmente e não há base pública nacional comparável com a qualidade necessária. | Bloqueado |
| CNES nacional | Baixar a extração oficial por UF; deduplicar pessoas e separar indivíduos de vínculos. | Aprovado |

## 1. Consulta automática de NFS-e

### Canal recomendado

O canal oficial é o **Ambiente de Dados Nacional da NFS-e (ADN)**. O manual de contribuintes publicado em 2026 descreve a consulta dos documentos em que o contribuinte é emitente, tomador ou intermediário e a distribuição pelo método `GET /DFe/{NSU}`. A conexão é autenticada por certificado digital e a consulta documentada atualmente valida o CNPJ raiz.

O e-CAC não deve ser usado como integração. Automatizar a interface, guardar senha Gov.br ou contornar autenticação criaria dependência frágil, risco de segurança e risco regulatório. A consulta pública por chave também não resolve o caso: ela valida um documento já conhecido, mas não descobre automaticamente o histórico do contribuinte.

Fontes oficiais:

- [Documentação técnica atual da NFS-e](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/documentacao-atual)
- [Manual de contribuintes das APIs do ADN](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-apis-adn-sistema-nacional-nfse.pdf)
- [Descrição oficial do ADN](https://www.gov.br/nfse/pt-br/municipios/produtos-disponiveis/ambiente-de-dados-nacional-adn)

### Arquitetura preparada

```text
Médico autoriza a conexão
        ↓
Provedor fiscal ou cofre recebe o certificado A1
        ↓
Worker privado faz mTLS com a API do ADN
        ↓
Distribuição sequencial por NSU + validação XSD/assinatura
        ↓
Deduplicação pela chave de acesso transformada em hash
        ↓
XML no bucket privado + índice fiscal mínimo no PostgreSQL
        ↓
Correspondência com o local/pagador pelo CNPJ
        ↓
Nota disponível em todos os dispositivos autenticados
```

A migration `202607220001_fiscal_health_data_foundation.sql` cria:

- `fiscal_connections`: consentimento, status, provedor, HMAC e últimos quatro dígitos do documento;
- `fiscal_connection_vault_refs`: referência opaca para o cofre, inacessível ao usuário;
- `fiscal_connection_checkpoints`: último NSU e controle de concorrência do worker;
- `fiscal_sync_runs`: auditoria de cada sincronização;
- `fiscal_document_index`: metadados mínimos e deduplicados da NFS-e.

O certificado e sua chave privada **não** entram no navegador, `localStorage`, banco público ou repositório. O XML original fica no bucket privado já usado pelo MedRecebe. Senhas do e-CAC/Gov.br não são solicitadas.

### CNPJ e CPF

- **CNPJ:** viável em piloto com certificado ICP-Brasil e API do ADN. Para boa experiência, a primeira implementação deve usar um provedor fiscal com custódia certificada ou cofre dedicado; depois, o MedRecebe pode operar um worker próprio.
- **CPF em NFS-e:** manuais integrados anteriores descrevem atores CPF/CNPJ, porém o manual específico e atual de contribuintes publicado em 2026 documenta a nova consulta por CNPJ raiz. É necessário homologar o CPF no ambiente restrito antes de oferecê-lo.
- **Receita Saúde:** há aplicativo e manual oficiais para recibos emitidos por profissionais pessoa física, mas não foi localizada API pública oficial para ingestão automática por SaaS terceiro. Até isso mudar, o fluxo correto é anexar o documento.
- **Pagamento de pessoa física por empresa:** pode ser RPA, informe de rendimentos ou outro documento, não necessariamente NFS-e. Não existe uma fonte oficial única comprovada para sincronizar todos esses recebimentos.

### Critérios para ativar o piloto fiscal

1. Contrato com provedor fiscal ou implantação de cofre e worker mTLS.
2. Termo de consentimento específico e política de retenção do certificado.
3. Homologação no ambiente de produção restrita do ADN.
4. Testes com NFS-e emitida, recebida, cancelada, substituída e duplicada.
5. Teste de cobertura por município e fallback explícito para upload manual.
6. Rotação/revogação de credencial e exclusão verificável no encerramento da conexão.

## 2. Volumetria por CID e especialidade

### O que tem qualidade suficiente

**SIH/SUS — internações.** O CID principal da AIH permite contar internações aprovadas por condição, estabelecimento, município, período e características disponíveis. É uma boa fonte de utilização hospitalar financiada pelo SUS. Não mede prevalência populacional, atendimentos particulares, fila ou demanda não atendida.

**SIA/SUS — ambulatório.** APAC e BPA-I podem identificar diagnóstico, profissional e paciente no sistema de origem; BPA-C é agregado. A disponibilidade e a completude do CID variam por instrumento e procedimento. Portanto, cada indicador deve publicar o percentual de registros utilizáveis, e não preencher ausências por inferência.

**ANS/D-TISS — saúde suplementar.** É adequada para volumes e valores agregados por procedimento/TUSS, UF e período. A própria ANS registra cobertura parcial de operadoras e necessidade de tratamento de inconsistências e outliers. A base pública não sustenta um censo nacional completo de atendimentos particulares por CID.

**AEAT/INSS — trabalho.** Permite recortes de acidentes e benefícios por incapacidade segundo CID, mas responde a uma pergunta diferente: impacto ocupacional/previdenciário. Não deve ser somado a SIH/SIA como procura geral por médicos.

Fontes oficiais:

- [Notas técnicas de recursos do SIH/SUS](https://wiki.saude.gov.br/sih/index.php/P%C3%A1gina_principal)
- [Morbidade hospitalar por CID-10 no TabNet](https://tabnet.datasus.gov.br/cgi/sih/mxcid10.htm)
- [Portal e documentação do SIA/SUS](https://wiki.saude.gov.br/sia/index.php/P%C3%A1gina_principal)
- [D-TISS da ANS](https://www.gov.br/ans/pt-br/acesso-a-informacao/perfil-do-setor/dados-e-indicadores-do-setor/d-tiss-painel-dos-dados-do-tiss)
- [Dados de acidentes e incapacidade do trabalho](https://www.gov.br/previdencia/pt-br/assuntos/previdencia-social/saude-e-seguranca-do-trabalhador/acidente_trabalho_incapacidade)

### Como relacionar CID e especialidade sem distorção

Não existe relação universal de um CID para uma única especialidade. Uma mesma condição pode envolver atenção primária, clínica médica, cirurgia, imagem, anestesia e várias especialidades. O MedRecebe deve usar uma matriz versionada:

1. CID principal observado;
2. procedimentos realizados e compatibilidades do SIGTAP;
3. CBO executante registrado na produção;
4. especialidades potencialmente relacionadas, com peso e justificativa;
5. revisão de médico especialista e data da versão.

O produto deve exibir três medidas separadas:

- **utilização observada:** eventos aprovados por 100 mil habitantes;
- **oferta instalada:** profissionais únicos, vínculos, carga horária e capacidade CNES;
- **sinal de pressão assistencial:** razão padronizada entre utilização e oferta, com intervalo e nota de qualidade.

O nome “demanda” só deve ser usado quando houver uma fonte de fila ou solicitação não atendida. Sem isso, “sinal de pressão” é mais honesto e tecnicamente defensável.

## 3. Ofertas de Cuidados Integrados (OCI)

As OCI são registradas em APAC no SIA. O procedimento principal pertence ao grupo 09 e os procedimentos secundários executados são lançados na mesma autorização. O manual orienta registrar CBO e CNS do médico responsável pela avaliação diagnóstica. O SIGTAP fornece procedimentos, compatibilidades e regras por competência.

É possível produzir, com fonte oficial:

- catálogo de OCI e composição de procedimentos principais/secundários;
- produção aprovada por OCI, competência, CNES, município, região e UF;
- volume e valor aprovado;
- tempo entre primeiro e último procedimento quando os campos permitirem;
- perfil do executante por **CBO** e oferta de profissionais no CNES;
- estabelecimentos que executam cada OCI e comparação com capacidade cadastrada.

O MedRecebe não deve publicar CNS ou nome do profissional extraído da APAC. Para inteligência de mercado, o nível necessário é CBO, estabelecimento e território. A identificação nominal pode introduzir risco LGPD e interpretações indevidas de produtividade individual.

Fontes oficiais:

- [Manual de registro da produção de OCI](https://www.gov.br/saude/pt-br/centrais-de-conteudo/publicacoes/guias-e-manuais/2024/manual-pmae-registro-da-producao-controle-e-avaliacao.pdf)
- [Painel oficial SUS 360](https://sus360.saude.gov.br/#painel/componente-ambulatorial)
- [Publicações de regulação e OCI](https://www.gov.br/saude/pt-br/composicao/saes/drac/regulacao/regulacao-do-acesso/publicacoes)

### Demanda reprimida de OCI

Os gestores enviam listas individualizadas por OCI ao Ministério da Saúde, mas essas listas contêm CPF/CNS e não formam hoje uma base pública nacional comparável para uso por um SaaS. O próprio Ministério informa que a organização e a transparência das filas eletivas são responsabilidade de estados e municípios.

Consequentemente:

- produção OCI pode entrar no piloto;
- oferta profissional/capacidade pode entrar no piloto;
- “demanda reprimida real” fica bloqueada;
- futuramente, podem ser integradas fontes locais de filas que publiquem agregados oficiais, com cobertura explícita;
- até lá, o sistema pode calcular um **sinal de possível insuficiência**, nunca chamar esse valor de pessoas na fila.

Referência: [transparência ativa da Atenção Especializada](https://www.gov.br/saude/pt-br/acesso-a-informacao/sic/dados-em-transparencia-ativa/saes).

## 4. Base nacional de profissionais e estabelecimentos do CNES

O painel SUS 360 incorpora um dashboard do ElastiCNES. O número próximo de 6 milhões mostrado como “documentos” representa documentos do índice — em geral vínculos profissional-estabelecimento-CBO e todos os grupos profissionais —, não 6 milhões de médicos únicos.

As notas técnicas do CNES distinguem explicitamente:

- **profissionais-indivíduos:** a pessoa é contada uma vez no recorte;
- **vínculos:** a mesma pessoa aparece uma vez para cada vínculo/ocupação/estabelecimento.

O MedRecebe já usa o TabNet em modo profissionais-indivíduos para o mapa médico. Na competência junho/2026, a geração local encontrou 613.376 médicos únicos no recorte nacional, número conceitualmente diferente dos documentos do ElastiCNES.

O download robusto é possível pelo portal oficial, que gera um ZIP/CSV para cada UF e competência. O script `scripts/download-cnes-professionals.mjs` resolve os 27 arquivos pelo mesmo serviço usado pelo botão oficial, consulta tamanho por `HEAD`, permite download com retentativa e gera manifesto auditável. A validação de 22/07/2026 encontrou todas as 27 UFs, somando 286.233.198 bytes (aproximadamente 273 MB) compactados na competência corrente; São Paulo respondia por aproximadamente 69,6 MB. O volume descompactado e normalizado será maior e deve ser medido na primeira carga.

Exemplos:

```bash
# Só cria o manifesto de AC e SP; não baixa os ZIPs
node scripts/download-cnes-professionals.mjs --states=AC,SP

# Baixa as 27 UFs da competência atual
node scripts/download-cnes-professionals.mjs --states=all --download

# Baixa uma competência específica
node scripts/download-cnes-professionals.mjs --states=all --competence=202606 --download
```

Fontes oficiais:

- [Extração de profissionais do CNES](https://cnes.datasus.gov.br/pages/profissionais/extracao.jsp)
- [Documentação do Portal CNES](https://wiki.saude.gov.br/cnes/index.php/Portal_CNES)
- [Notas técnicas de recursos humanos do CNES](https://tabnet.datasus.gov.br/cgi/cnes/NT_RecursosHumanos.htm)
- [Painel de profissionais no SUS 360](https://sus360.saude.gov.br/#painel/cnes-profissionais)

### Camadas do pipeline

1. **Raw restrita:** ZIP/CSV original, acesso operacional, retenção curta e checksum.
2. **Identidade pseudonimizada:** HMAC do CNS com chave rotacionável; nome e CNS original removidos.
3. **Vínculos normalizados:** profissional pseudônimo, CBO, CNES, município, carga horária, vínculo, SUS/não SUS e competência.
4. **Agregados publicáveis:** indivíduos únicos, vínculos e carga horária por território/CBO; supressão de células pequenas quando necessário.
5. **Snapshot auditável:** fonte, competência, data de coleta, contagem, checksum e regras de deduplicação.

## 5. Portões de qualidade

Um indicador só pode aparecer no aplicativo se cumprir todos os itens:

1. fonte oficial e URL registradas;
2. grão do registro conhecido;
3. competência e defasagem visíveis;
4. cobertura mensurada;
5. regras de deduplicação documentadas;
6. dados faltantes e outliers tratados sem inventar valores;
7. denominador populacional da referência correta;
8. relação CID-especialidade revisada e versionada;
9. nenhum dado identificável de paciente;
10. rótulo que diferencie observação, oferta, estimativa e fila real.

As decisões ficam no catálogo `market_source_registry` e os contratos semânticos em `market_indicator_definitions`. Indicadores marcados como `blocked` não são retornados aos usuários autenticados pelas políticas RLS.

## 6. Sequência recomendada de implantação

1. Aplicar a migration de fundação e validar RLS.
2. Rodar o manifesto CNES nacional, medir volume real e escolher armazenamento de objetos/warehouse.
3. Construir a camada CNES pseudonimizada e comparar indivíduos/vínculos com TabNet.
4. Ingerir SIH por CID principal e publicar um piloto de utilização hospitalar.
5. Ingerir SIGTAP + OCI/APAC e validar dez combinações manualmente contra SUS 360.
6. Criar matriz CID-procedimento-especialidade com revisão médica.
7. Contratar/homologar o conector NFS-e para dez CNPJs e medir cobertura por município.
8. Somente depois ativar sincronização fiscal e o sinal de pressão assistencial no produto.
