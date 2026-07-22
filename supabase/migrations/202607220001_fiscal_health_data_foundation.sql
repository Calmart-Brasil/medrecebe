create table if not exists public.market_source_registry (
  source_code text primary key check (source_code ~ '^[A-Z0-9_]{2,40}$'),
  official_owner text not null,
  dataset_name text not null,
  official_url text not null,
  access_method text not null,
  quality_grade char(1) not null check (quality_grade in ('A', 'B', 'C', 'D')),
  decision text not null check (decision in ('approved', 'pilot', 'blocked', 'contract_required')),
  data_grain text not null,
  update_frequency text,
  coverage_notes text not null,
  quality_caveats text not null,
  supports_cid boolean not null default false,
  supports_professional boolean not null default false,
  supports_establishment boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.market_source_registry (
  source_code, official_owner, dataset_name, official_url, access_method, quality_grade,
  decision, data_grain, update_frequency, coverage_notes, quality_caveats,
  supports_cid, supports_professional, supports_establishment
) values
  ('RECEITA_CNPJ', 'Receita Federal do Brasil', 'Cadastro Nacional da Pessoa Jurídica', 'https://dados.gov.br/dados/conjuntos-dados/cadastro-nacional-da-pessoa-juridica-cnpj', 'dados_abertos', 'A', 'approved', 'estabelecimento/CNPJ', 'mensal', 'Pessoas jurídicas e estabelecimentos registrados no CNPJ.', 'Situação cadastral não comprova contratação nem vaga ativa.', false, false, true),
  ('CNES', 'Ministério da Saúde / DATASUS', 'CNES - consultas e TabNet', 'https://cnes.datasus.gov.br/', 'tabnet_consulta', 'B', 'approved', 'profissional-indivíduo ou vínculo por competência', 'mensal', 'Estabelecimentos e profissionais cadastrados no CNES em todo o Brasil.', 'Cadastro administrativo; vínculo não comprova presença diária, atendimento produzido ou RQE ativo.', false, true, true),
  ('CNES_RAW', 'Ministério da Saúde / DATASUS', 'Extração de profissionais do CNES', 'https://cnes.datasus.gov.br/pages/profissionais/extracao.jsp', 'arquivo_zip_csv_por_uf', 'B', 'approved', 'vínculo profissional-estabelecimento-CBO por competência', 'mensal', 'Extração nacional possível pela soma dos 27 arquivos estaduais.', 'Uma pessoa pode gerar vários registros; nomes e CNS devem ser descartados das camadas analíticas.', false, true, true),
  ('SIH_SUS', 'Ministério da Saúde / DATASUS', 'Sistema de Informações Hospitalares do SUS', 'https://datasus.saude.gov.br/acesso-a-informacao/morbidade-hospitalar-do-sus-sih-sus/', 'tabnet_e_arquivos_reduzidos', 'B', 'approved', 'AIH/internação aprovada', 'mensal', 'Internações financiadas pelo SUS, com CID principal e campos assistenciais.', 'Mede utilização hospitalar aprovada, não prevalência, fila ou toda a necessidade de saúde.', true, true, true),
  ('SIA_SUS', 'Ministério da Saúde / DATASUS', 'Sistema de Informações Ambulatoriais do SUS', 'https://datasus.saude.gov.br/acesso-a-informacao/producao-ambulatorial-sia-sus/', 'tabnet_e_arquivos_reduzidos', 'B', 'approved', 'produção ambulatorial aprovada', 'mensal', 'BPA, APAC e RAAS do SUS.', 'CID e identificação profissional não estão presentes com a mesma completude em todos os instrumentos.', true, true, true),
  ('SIGTAP', 'Ministério da Saúde / DATASUS', 'Tabela de Procedimentos, Medicamentos e OPM do SUS', 'https://sigtap.datasus.gov.br/', 'tabelas_mensais', 'A', 'approved', 'procedimento e regra de compatibilidade por competência', 'mensal', 'Vocabulário oficial de procedimentos, CBO, CID e compatibilidades do SUS.', 'Compatibilidade normativa não equivale a causalidade entre CID e especialidade.', true, true, false),
  ('ANS', 'Agência Nacional de Saúde Suplementar', 'Dados e indicadores da saúde suplementar', 'https://www.gov.br/ans/pt-br/acesso-a-informacao/perfil-do-setor/dados-e-indicadores-do-setor', 'dados_abertos_e_paineis', 'B', 'approved', 'operadora, beneficiário, rede e evento agregado', 'periódica', 'Dados oficiais do setor de saúde suplementar.', 'Cobertura e granularidade variam entre os produtos publicados.', false, false, true),
  ('TISS_ANS', 'Agência Nacional de Saúde Suplementar', 'D-TISS', 'https://www.gov.br/ans/pt-br/acesso-a-informacao/perfil-do-setor/dados-e-indicadores-do-setor/d-tiss-painel-dos-dados-do-tiss', 'dados_abertos_agregados', 'C', 'pilot', 'procedimento/TUSS, UF, competência e valor agregado', 'anual', 'Eventos informados por operadoras à ANS; útil para volume privado por procedimento.', 'Não oferece um censo nacional completo por CID; há ausência de operadoras, inconsistências e outliers que exigem tratamento.', false, false, false),
  ('OCI_SUS', 'Ministério da Saúde / DATASUS', 'Produção das Ofertas de Cuidados Integrados', 'https://sus360.saude.gov.br/#painel/componente-ambulatorial', 'sia_apac_e_sigtap', 'B', 'pilot', 'APAC OCI, procedimento principal/secundário, CNES, CBO e competência', 'mensal', 'Produção aprovada de OCI registrada no SIA e regras do SIGTAP.', 'Produção mede oferta executada. Listas de espera nacionais individualizadas não são dados públicos para inferir demanda reprimida real.', false, true, true),
  ('AEAT_INSS', 'Ministério da Previdência Social / INSS', 'Acidentes do trabalho e benefícios por incapacidade por CID-10', 'https://www.gov.br/previdencia/pt-br/assuntos/previdencia-social/saude-e-seguranca-do-trabalhador/acidente_trabalho_incapacidade', 'tabelas_oficiais', 'B', 'blocked', 'benefício ou acidente agregado por CID, região e período', 'anual', 'Recorte oficial de incapacidade e saúde do trabalhador.', 'Não representa a procura geral por atendimento médico nem o mercado assistencial completo.', true, false, false),
  ('NFSE_ADN', 'Sistema Nacional NFS-e / Receita Federal', 'Ambiente de Dados Nacional da NFS-e', 'https://www.gov.br/nfse/pt-br/municipios/produtos-disponiveis/ambiente-de-dados-nacional-adn', 'api_mtls_nsu', 'B', 'pilot', 'documento fiscal de serviço e evento por NSU', 'contínua', 'NFS-e compartilhadas com o ADN em que o contribuinte figure como emitente, tomador ou intermediário.', 'Automação requer certificado digital e a cobertura depende do compartilhamento municipal; o manual atual de contribuintes documenta consulta por CNPJ.', false, false, true),
  ('RECEITA_SAUDE', 'Receita Federal do Brasil', 'Receita Saúde', 'https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/manuais/orientacao-tributaria/receita-saude-2.1.pdf', 'aplicativo_oficial', 'B', 'blocked', 'recibo de saúde de profissional pessoa física', 'contínua', 'Recibos eletrônicos emitidos por profissionais de saúde pessoa física.', 'Não foi localizada API oficial pública para ingestão automática por um SaaS terceiro.', false, true, false),
  ('PNCP', 'Governo Federal', 'Portal Nacional de Contratações Públicas', 'https://pncp.gov.br/api/consulta/swagger-ui/index.html', 'api_publica', 'B', 'approved', 'contratação pública', 'contínua', 'Contratações públicas publicadas no PNCP.', 'Texto livre exige classificação e não garante vaga ainda disponível.', false, false, true),
  ('RAIS', 'Ministério do Trabalho e Emprego', 'Relação Anual de Informações Sociais', 'https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/estatisticas-trabalho/rais', 'dados_abertos', 'B', 'approved', 'vínculo formal anual', 'anual', 'Estoque formal de empregos.', 'Defasagem anual e ausência de trabalho informal/autônomo.', false, true, true),
  ('CAGED', 'Ministério do Trabalho e Emprego', 'Novo Caged', 'https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/estatisticas-trabalho/novo-caged', 'dados_abertos', 'B', 'approved', 'movimentação de emprego formal', 'mensal', 'Admissões e desligamentos formais.', 'Não mede contratação PJ ou plantão autônomo.', false, true, true),
  ('CMED', 'Anvisa', 'Listas de preços de medicamentos', 'https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/cmed/precos', 'planilhas_oficiais', 'A', 'approved', 'apresentação de medicamento', 'periódica', 'Preços máximos regulados de medicamentos.', 'Preço regulado não representa consumo ou demanda clínica.', false, false, false),
  ('IBGE', 'Instituto Brasileiro de Geografia e Estatística', 'População, território e indicadores municipais', 'https://www.ibge.gov.br/estatisticas/sociais/populacao.html', 'apis_e_sidra', 'A', 'approved', 'município/UF/país e período', 'anual', 'Denominadores populacionais e malhas oficiais.', 'Estimativas populacionais possuem data de referência e revisão próprias.', false, false, false),
  ('CFM', 'Conselho Federal de Medicina', 'Webservice de médicos e especialidades', 'https://sistemas.cfm.org.br/', 'webservice_contratado', 'A', 'contract_required', 'CRM, UF, situação e especialidade/RQE', 'diária', 'Fonte oficial para validar CRM e especialidades.', 'Empresas privadas precisam contratar o webservice; CNES/CBO não substitui RQE.', false, true, false)
on conflict (source_code) do update set
  official_owner = excluded.official_owner,
  dataset_name = excluded.dataset_name,
  official_url = excluded.official_url,
  access_method = excluded.access_method,
  quality_grade = excluded.quality_grade,
  decision = excluded.decision,
  data_grain = excluded.data_grain,
  update_frequency = excluded.update_frequency,
  coverage_notes = excluded.coverage_notes,
  quality_caveats = excluded.quality_caveats,
  supports_cid = excluded.supports_cid,
  supports_professional = excluded.supports_professional,
  supports_establishment = excluded.supports_establishment,
  updated_at = now();

alter table public.market_data_snapshots
  drop constraint if exists market_data_snapshots_source_code_check;

alter table public.market_data_snapshots
  drop constraint if exists market_data_snapshots_source_registry_fk;

alter table public.market_data_snapshots
  add constraint market_data_snapshots_source_registry_fk
  foreign key (source_code) references public.market_source_registry(source_code);

create table if not exists public.market_indicator_definitions (
  indicator_code text primary key check (indicator_code ~ '^[a-z0-9_]{3,80}$'),
  public_label text not null,
  analytical_class text not null check (analytical_class in ('observed_utilization', 'installed_supply', 'work_incapacity', 'pressure_signal', 'waiting_list')),
  source_codes text[] not null,
  publication_status text not null check (publication_status in ('approved', 'pilot', 'blocked')),
  methodology text not null,
  mandatory_disclaimer text not null,
  mapping_version text,
  updated_at timestamptz not null default now()
);

insert into public.market_indicator_definitions (
  indicator_code, public_label, analytical_class, source_codes, publication_status,
  methodology, mandatory_disclaimer, mapping_version
) values
  ('sih_principal_cid_hospitalizations', 'Internações SUS observadas por CID principal', 'observed_utilization', array['SIH_SUS', 'IBGE'], 'approved', 'Conta AIHs aprovadas por CID principal, competência e território; taxas usam população IBGE do mesmo período de referência.', 'Internação aprovada não equivale a prevalência, fila ou demanda total por especialista.', null),
  ('sia_oci_approved_production', 'Produção aprovada de OCI', 'observed_utilization', array['SIA_SUS', 'SIGTAP', 'OCI_SUS', 'CNES'], 'pilot', 'Identifica procedimentos principais do grupo 09 na APAC, seus procedimentos secundários, CNES, município, CBO e competência.', 'O indicador mede OCI executada e aprovada; não mede sozinho demanda reprimida.', 'sigtap-por-competencia'),
  ('ans_private_procedure_volume', 'Volume observado na saúde suplementar por procedimento', 'observed_utilization', array['TISS_ANS', 'IBGE'], 'pilot', 'Agrega eventos TISS públicos por procedimento/TUSS, território e período após filtros de consistência e outliers.', 'A cobertura das operadoras não é completa e o indicador não deve ser apresentado como volume privado total por CID.', null),
  ('cnes_specialty_supply', 'Oferta cadastrada de profissionais por CBO', 'installed_supply', array['CNES_RAW', 'CNES', 'IBGE'], 'approved', 'Deduplica profissionais dentro de cada território e competência, preservando separadamente o número de vínculos e a carga horária cadastrada.', 'CBO no CNES não equivale a especialidade/RQE ativa no CFM nem comprova disponibilidade de agenda.', 'cbo2002'),
  ('aeat_cid_work_incapacity', 'Incapacidade relacionada ao trabalho por CID', 'work_incapacity', array['AEAT_INSS'], 'blocked', 'Usaria benefícios e acidentes agregados por CID e região apenas em uma vertical de saúde ocupacional.', 'Este recorte não representa demanda assistencial geral; por isso não integra o mapa médico principal.', null),
  ('specialty_pressure_signal', 'Sinal de pressão assistencial por especialidade', 'pressure_signal', array['SIH_SUS', 'SIA_SUS', 'SIGTAP', 'CNES_RAW', 'IBGE'], 'pilot', 'Índice composto e versionado que compara utilização observada ajustada por população com oferta profissional deduplicada e capacidade instalada.', 'É um sinal analítico, não uma fila real nem recomendação clínica. A associação CID-procedimento-especialidade exige validação médica.', 'pending-clinical-review'),
  ('national_suppressed_demand', 'Demanda reprimida nacional', 'waiting_list', array['OCI_SUS'], 'blocked', 'Somente seria calculada com listas de espera oficiais, agregadas, comparáveis e atualizadas por território e OCI.', 'Não há hoje base pública nacional com qualidade suficiente para publicar este indicador.', null)
on conflict (indicator_code) do update set
  public_label = excluded.public_label,
  analytical_class = excluded.analytical_class,
  source_codes = excluded.source_codes,
  publication_status = excluded.publication_status,
  methodology = excluded.methodology,
  mandatory_disclaimer = excluded.mandatory_disclaimer,
  mapping_version = excluded.mapping_version,
  updated_at = now();

create table if not exists public.fiscal_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  subject_type text not null check (subject_type in ('cnpj', 'cpf')),
  subject_hmac char(64) not null,
  subject_last4 char(4) not null check (subject_last4 ~ '^[0-9]{4}$'),
  provider_code text not null check (provider_code in ('nfse_adn', 'fiscal_provider')),
  status text not null default 'pending_credential'
    check (status in ('pending_credential', 'active', 'syncing', 'error', 'disconnected', 'unsupported')),
  coverage_scope text not null default 'issued_received_intermediated'
    check (coverage_scope in ('issued', 'received', 'issued_received_intermediated')),
  consent_version text not null,
  consented_at timestamptz not null,
  last_successful_sync_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, subject_type, subject_hmac, provider_code)
);

create table if not exists public.fiscal_connection_vault_refs (
  connection_id uuid primary key references public.fiscal_connections(id) on delete cascade,
  vault_provider text not null,
  credential_reference text not null,
  certificate_fingerprint_sha256 char(64),
  certificate_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fiscal_connection_checkpoints (
  connection_id uuid primary key references public.fiscal_connections(id) on delete cascade,
  last_nsu bigint not null default 0 check (last_nsu >= 0),
  next_sync_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.fiscal_sync_runs (
  id bigint generated always as identity primary key,
  connection_id uuid not null references public.fiscal_connections(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')),
  start_nsu bigint check (start_nsu is null or start_nsu >= 0),
  end_nsu bigint check (end_nsu is null or end_nsu >= 0),
  documents_seen integer not null default 0 check (documents_seen >= 0),
  documents_imported integer not null default 0 check (documents_imported >= 0),
  duplicates_ignored integer not null default 0 check (duplicates_ignored >= 0),
  public_error_code text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists fiscal_sync_runs_connection_requested
  on public.fiscal_sync_runs(connection_id, requested_at desc);

create table if not exists public.fiscal_document_index (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  connection_id uuid references public.fiscal_connections(id) on delete set null,
  document_id text,
  provider_code text not null,
  external_document_hash char(64) not null,
  access_key_last8 char(8),
  document_kind text not null default 'nfse' check (document_kind in ('nfse', 'nfse_event')),
  subject_role text not null check (subject_role in ('issuer', 'recipient', 'intermediary')),
  issuer_tax_id_last4 char(4),
  recipient_tax_id_last4 char(4),
  invoice_number text,
  issued_at timestamptz,
  service_amount_cents bigint check (service_amount_cents is null or service_amount_cents >= 0),
  municipality_ibge_code char(7),
  payer_match_status text not null default 'pending'
    check (payer_match_status in ('pending', 'matched', 'unmatched', 'ambiguous')),
  data_quality jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider_code, external_document_hash)
);

create index if not exists fiscal_document_index_user_issued
  on public.fiscal_document_index(user_id, issued_at desc);

drop trigger if exists market_source_registry_touch_updated_at on public.market_source_registry;
create trigger market_source_registry_touch_updated_at
before update on public.market_source_registry
for each row execute function public.touch_updated_at();

drop trigger if exists market_indicator_definitions_touch_updated_at on public.market_indicator_definitions;
create trigger market_indicator_definitions_touch_updated_at
before update on public.market_indicator_definitions
for each row execute function public.touch_updated_at();

drop trigger if exists fiscal_connections_touch_updated_at on public.fiscal_connections;
create trigger fiscal_connections_touch_updated_at
before update on public.fiscal_connections
for each row execute function public.touch_updated_at();

drop trigger if exists fiscal_connection_vault_refs_touch_updated_at on public.fiscal_connection_vault_refs;
create trigger fiscal_connection_vault_refs_touch_updated_at
before update on public.fiscal_connection_vault_refs
for each row execute function public.touch_updated_at();

drop trigger if exists fiscal_connection_checkpoints_touch_updated_at on public.fiscal_connection_checkpoints;
create trigger fiscal_connection_checkpoints_touch_updated_at
before update on public.fiscal_connection_checkpoints
for each row execute function public.touch_updated_at();

drop trigger if exists fiscal_document_index_touch_updated_at on public.fiscal_document_index;
create trigger fiscal_document_index_touch_updated_at
before update on public.fiscal_document_index
for each row execute function public.touch_updated_at();

alter table public.market_source_registry enable row level security;
alter table public.market_indicator_definitions enable row level security;
alter table public.fiscal_connections enable row level security;
alter table public.fiscal_connection_vault_refs enable row level security;
alter table public.fiscal_connection_checkpoints enable row level security;
alter table public.fiscal_sync_runs enable row level security;
alter table public.fiscal_document_index enable row level security;

drop policy if exists "market_source_registry_read_authenticated" on public.market_source_registry;
create policy "market_source_registry_read_authenticated"
on public.market_source_registry for select to authenticated
using (true);

drop policy if exists "market_indicator_definitions_read_authenticated" on public.market_indicator_definitions;
create policy "market_indicator_definitions_read_authenticated"
on public.market_indicator_definitions for select to authenticated
using (publication_status in ('approved', 'pilot'));

drop policy if exists "fiscal_connections_select_own" on public.fiscal_connections;
create policy "fiscal_connections_select_own"
on public.fiscal_connections for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "fiscal_sync_runs_select_own" on public.fiscal_sync_runs;
create policy "fiscal_sync_runs_select_own"
on public.fiscal_sync_runs for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "fiscal_document_index_select_own" on public.fiscal_document_index;
create policy "fiscal_document_index_select_own"
on public.fiscal_document_index for select to authenticated
using (user_id = (select auth.uid()));

comment on table public.market_source_registry is
  'Catálogo oficial de fontes, qualidade e decisão de uso. Fontes bloqueadas não podem alimentar funcionalidades públicas.';

comment on table public.market_indicator_definitions is
  'Contratos semânticos dos indicadores. Diferencia utilização observada, oferta instalada, pressão analítica e fila real.';

comment on table public.fiscal_connections is
  'Conexões fiscais consentidas. Guarda apenas HMAC e últimos quatro dígitos; nunca CPF/CNPJ completo, senha Gov.br ou certificado.';

comment on table public.fiscal_connection_vault_refs is
  'Tabela exclusiva do backend para referências opacas de cofre. A chave privada do certificado não deve ser armazenada no PostgreSQL.';

comment on table public.fiscal_connection_checkpoints is
  'Checkpoint servidor-a-servidor da distribuição de NFS-e por NSU e controle de concorrência do worker.';

comment on table public.fiscal_document_index is
  'Índice mínimo das NFS-e sincronizadas. O XML original deve permanecer no bucket privado medrecebe-documents.';
