create table if not exists public.user_documents (
  id text not null check (char_length(id) between 3 and 180),
  user_id uuid not null references public.profiles(id) on delete cascade,
  record_id text not null check (char_length(record_id) between 1 and 180),
  document_type text not null check (document_type in ('attendance_evidence', 'invoice')),
  file_name text not null check (char_length(file_name) between 1 and 180),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  checksum_sha256 char(64) not null,
  storage_path text not null unique,
  status text not null default 'ready' check (status in ('ready', 'deleting')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists user_documents_owner_record
  on public.user_documents(user_id, record_id, created_at desc);

alter table public.user_documents enable row level security;

drop policy if exists "documents_select_own" on public.user_documents;
create policy "documents_select_own"
on public.user_documents for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "documents_insert_own" on public.user_documents;
create policy "documents_insert_own"
on public.user_documents for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "documents_update_own" on public.user_documents;
create policy "documents_update_own"
on public.user_documents for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "documents_delete_own" on public.user_documents;
create policy "documents_delete_own"
on public.user_documents for delete
to authenticated
using (user_id = (select auth.uid()));

drop trigger if exists user_documents_touch_updated_at on public.user_documents;
create trigger user_documents_touch_updated_at
before update on public.user_documents
for each row execute function public.touch_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'medrecebe-documents',
  'medrecebe-documents',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/xml', 'text/xml']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "documents_storage_select_own" on storage.objects;
create policy "documents_storage_select_own"
on storage.objects for select
to authenticated
using (
  bucket_id = 'medrecebe-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "documents_storage_insert_own" on storage.objects;
create policy "documents_storage_insert_own"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'medrecebe-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "documents_storage_update_own" on storage.objects;
create policy "documents_storage_update_own"
on storage.objects for update
to authenticated
using (
  bucket_id = 'medrecebe-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'medrecebe-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "documents_storage_delete_own" on storage.objects;
create policy "documents_storage_delete_own"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'medrecebe-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

comment on table public.user_documents is
  'Metadados dos comprovantes e Notas Fiscais armazenados de forma privada e sincronizados entre dispositivos.';

comment on table public.user_app_states is
  'Estado operacional sincronizado. Arquivos ficam no bucket privado e apenas suas referências permanecem no JSON.';
