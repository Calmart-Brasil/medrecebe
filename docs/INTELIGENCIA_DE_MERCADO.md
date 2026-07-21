# Inteligência de mercado do MedRecebe

## Operacional no MVP

- **Mapa da concentração de renda:** usa somente atendimentos registrados pelo médico e mostra participação por pagador e município.
- **Radar de contratações públicas:** consulta propostas abertas na API oficial do PNCP, filtra objetos médicos e preserva o link do edital.
- **Oportunidades regionais:** classifica por UF, município e especialidades confirmadas no perfil. Sem especialidade, considera oportunidades compatíveis com CRM generalista.
- **Diretório nacional:** 22.782 estabelecimentos e empresas elegíveis, particionados por UF, derivados de 627.864 registros do CNES de 18/07/2026. Os municípios são nomeados pela API do IBGE.

## Perfil profissional e CFM

O CRM principal e até doze especialidades podem ser informados pelo médico. Cada dado preserva origem e estado de verificação. Informação autodeclarada nunca recebe selo de verificada.

O CFM disponibiliza um webservice oficial, normatizado pela Resolução CFM nº 2.309/2022, com atualização diária de nome, CRM, UF, situação e especialidade registrada. Empresas privadas precisam contratar o serviço diretamente com o CFM. Até a contratação e configuração da chave, o MedRecebe não raspa a página pública nem replica uma base nacional não autorizada.

## Pipeline planejado

As tabelas `market_data_snapshots` e `market_indicators` registram fonte, versão, data de referência, território e especialidade. Cada indicador deve apontar para um snapshot auditável.

1. Receita Federal + CNES: identidade e situação do pagador e do estabelecimento.
2. IBGE + RAIS + CAGED: população, renda, emprego formal e tendência ocupacional.
3. SIH/SUS + SIA/SUS + SIGTAP: volume assistencial, procedimentos, compatibilidades e valores de referência.
4. ANS: cobertura e desempenho da saúde suplementar por região e operadora.
5. CMED: pressão de custo para terapias e medicamentos recorrentes.
6. PNCP: credenciamentos e contratações abertas.
7. CFM: CRM e especialidades, somente pelo canal oficial contratado.

Indicadores agregados não podem identificar pacientes. Dados públicos de profissionais mantêm finalidade, minimização, proveniência, prazo de atualização e canal de correção, conforme LGPD.
