create table if not exists public.security_rate_limits (
  scope text not null check (char_length(scope) between 3 and 40),
  key_hash char(64) not null,
  attempts integer not null default 0 check (attempts >= 0),
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash)
);

alter table public.security_rate_limits enable row level security;
revoke all on table public.security_rate_limits from anon, authenticated;

create or replace function public.consume_security_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer,
  p_block_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  current_row public.security_rate_limits%rowtype;
begin
  if p_scope !~ '^[a-z0-9_]{3,40}$'
    or p_key_hash !~ '^[a-f0-9]{64}$'
    or p_limit < 1
    or p_window_seconds < 1
    or p_block_seconds < 1 then
    raise exception 'Invalid rate limit parameters';
  end if;

  insert into public.security_rate_limits as limiter (
    scope,
    key_hash,
    attempts,
    window_started_at,
    blocked_until,
    updated_at
  )
  values (p_scope, p_key_hash, 1, v_now, null, v_now)
  on conflict (scope, key_hash) do update
  set attempts = case
        when limiter.blocked_until is not null and limiter.blocked_until > v_now then limiter.attempts
        when limiter.window_started_at <= v_now - make_interval(secs => p_window_seconds) then 1
        else limiter.attempts + 1
      end,
      window_started_at = case
        when limiter.blocked_until is null or limiter.blocked_until <= v_now then
          case
            when limiter.window_started_at <= v_now - make_interval(secs => p_window_seconds) then v_now
            else limiter.window_started_at
          end
        else limiter.window_started_at
      end,
      blocked_until = case
        when limiter.blocked_until is not null and limiter.blocked_until > v_now then limiter.blocked_until
        when (
          case
            when limiter.window_started_at <= v_now - make_interval(secs => p_window_seconds) then 1
            else limiter.attempts + 1
          end
        ) > p_limit then v_now + make_interval(secs => p_block_seconds)
        else null
      end,
      updated_at = v_now
  returning limiter.* into current_row;

  allowed := current_row.blocked_until is null or current_row.blocked_until <= v_now;
  retry_after_seconds := case
    when allowed then 0
    else greatest(1, ceil(extract(epoch from current_row.blocked_until - v_now))::integer)
  end;
  return next;
end;
$$;

create or replace function public.clear_security_rate_limit(p_scope text, p_key_hash text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.security_rate_limits
  where scope = p_scope and key_hash = p_key_hash;
$$;

create or replace function public.is_auth_session_active(p_session_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.sessions
    where id = p_session_id
      and user_id = p_user_id
  );
$$;

revoke all on function public.consume_security_rate_limit(text, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.clear_security_rate_limit(text, text) from public, anon, authenticated;
revoke all on function public.is_auth_session_active(uuid, uuid) from public, anon, authenticated;
grant execute on function public.consume_security_rate_limit(text, text, integer, integer, integer) to service_role;
grant execute on function public.clear_security_rate_limit(text, text) to service_role;
grant execute on function public.is_auth_session_active(uuid, uuid) to service_role;

update public.user_app_states
set state = state - 'account' - 'cloudUserId' - 'profile',
    version = version + 1,
    updated_at = now()
where state ?| array['account', 'cloudUserId', 'profile'];

delete from public.security_rate_limits
where updated_at < now() - interval '2 days';

comment on table public.security_rate_limits is
  'Contadores temporarios e pseudonimizados para limitar abuso em autenticacao e cadastro.';

comment on function public.is_auth_session_active(uuid, uuid) is
  'Permite que Edge Functions rejeitem imediatamente JWTs cuja sessao foi revogada.';
