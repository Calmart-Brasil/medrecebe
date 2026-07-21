# Inteligência de mercado do MedRecebe

## Operacional no MVP

- **Mapa da concentração de renda:** usa somente atendimentos registrados pelo médico e mostra participação por pagador e município.
- **Radar de contratações públicas:** consulta propostas abertas na API oficial do PNCP, amostra páginas distribuídas por todo o resultado, filtra prestação de serviços médicos e preserva o link do edital.
- **Oportunidades regionais:** o município-base vem da lista oficial do IBGE e o raio limita de fato os resultados do PNCP pela distância entre centroides municipais. O GPS do aparelho não é usado.
- **Mapa de concentração médica:** abre em Brasil e permite descer para qualquer UF. Usa as malhas oficiais do IBGE para desenhar estados e municípios, apresenta profissionais-indivíduos do CNES, total médico ou uma das 63 ocupações CBO. Alterna entre quantidade absoluta e profissionais por 100 mil habitantes, mostra maiores e menores concentrações, bolsões de ausência e ranking de especialidades. A população é a estimativa IBGE 2025 e a camada CNES usa junho/2026.
- **Potenciais contratantes privados:** lista hospitais, cooperativas, empresas de gestão de saúde e de remoção ativos no CNES dentro do raio escolhido. É uma base para prospecção direta, não um feed de vagas anunciadas.
- **Diretório nacional:** 22.782 estabelecimentos e empresas elegíveis, particionados por UF, derivados de 627.864 registros do CNES de 18/07/2026. Os municípios são nomeados pela API do IBGE.

## Perfil profissional e CFM

O CRM principal e até doze especialidades podem ser informados pelo médico. Cada dado preserva origem e estado de verificação. Informação autodeclarada nunca recebe selo de verificada.

O CFM disponibiliza um webservice oficial, normatizado pela Resolução CFM nº 2.309/2022, com atualização diária de nome, CRM, UF, situação e especialidade registrada. Empresas privadas precisam contratar o serviço diretamente com o CFM. Até a contratação e configuração da chave, o MedRecebe não raspa a página pública nem replica uma base nacional não autorizada.

## Pipeline planejado

As tabelas `market_data_snapshots` e `market_indicators` registram fonte, versão, data de referência, território e especialidade. Cada indicador deve apontar para um snapshot auditável.

1. Receita Federal + CNES: identidade e situação do pagador e do estabelecimento.
2. IBGE + CNES: 5.571 unidades municipais atuais, centro territorial, população estimada de 2025 e concentração agregada de médicos por CBO.
3. IBGE + RAIS + CAGED: população, renda, emprego formal e tendência ocupacional.
4. SIH/SUS + SIA/SUS + SIGTAP: volume assistencial, procedimentos, compatibilidades e valores de referência.
5. ANS: cobertura e desempenho da saúde suplementar por região e operadora.
6. CMED: pressão de custo para terapias e medicamentos recorrentes.
7. PNCP: credenciamentos e contratações abertas.
8. CNES: identifica potenciais contratantes privados ativos para prospecção regional, sem tratá-los como vagas anunciadas.
9. CFM: CRM e especialidades, somente pelo canal oficial contratado.

O total do mapa considera profissionais-indivíduos selecionados nas ocupações médicas do CNES. A visualização por especialidade usa CBO e não deve ser interpretada como quantidade de RQEs ativos no CFM. Um mesmo médico pode aparecer em mais de um município; por isso o total estadual de indivíduos é exibido separadamente da presença municipal.

Indicadores agregados não podem identificar pacientes. Dados públicos de profissionais mantêm finalidade, minimização, proveniência, prazo de atualização e canal de correção, conforme LGPD.
