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
    scope, key_hash, attempts, window_started_at, blocked_until, updated_at
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

revoke all on function public.consume_security_rate_limit(text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_security_rate_limit(text, text, integer, integer, integer) to service_role;
