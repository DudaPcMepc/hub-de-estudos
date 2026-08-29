begin;

create table if not exists public.ai_daily_usage (
    user_id uuid not null references auth.users(id) on delete cascade,
    usage_date date not null,
    questions_generated integer not null default 0 check (questions_generated >= 0),
    request_count integer not null default 0 check (request_count >= 0),
    updated_at timestamptz not null default now(),
    primary key (user_id, usage_date)
);

alter table public.ai_daily_usage enable row level security;

revoke all on table public.ai_daily_usage from anon, authenticated;
grant select on table public.ai_daily_usage to authenticated;

drop policy if exists "Users read own AI usage" on public.ai_daily_usage;
create policy "Users read own AI usage"
on public.ai_daily_usage
for select
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.reserve_ai_daily_quota(
    target_user_id uuid,
    target_questions integer,
    daily_limit integer default 50
)
returns table (allowed boolean, used integer, remaining integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
    quota_date date := timezone('America/Fortaleza', now())::date;
    new_total integer;
    current_total integer;
begin
    if target_user_id is null
       or target_questions < 1
       or target_questions > 10
       or daily_limit < 10
       or daily_limit > 500 then
        raise exception 'Invalid AI quota request';
    end if;

    insert into public.ai_daily_usage (
        user_id,
        usage_date,
        questions_generated,
        request_count,
        updated_at
    ) values (
        target_user_id,
        quota_date,
        target_questions,
        1,
        now()
    )
    on conflict (user_id, usage_date) do update
    set questions_generated = public.ai_daily_usage.questions_generated + excluded.questions_generated,
        request_count = public.ai_daily_usage.request_count + 1,
        updated_at = now()
    where public.ai_daily_usage.questions_generated + excluded.questions_generated <= daily_limit
    returning questions_generated into new_total;

    if new_total is not null then
        return query select true, new_total, greatest(0, daily_limit - new_total);
        return;
    end if;

    select questions_generated
      into current_total
      from public.ai_daily_usage
     where user_id = target_user_id
       and usage_date = quota_date;

    return query select false, coalesce(current_total, 0), greatest(0, daily_limit - coalesce(current_total, 0));
end;
$$;

create or replace function public.refund_ai_daily_quota(
    target_user_id uuid,
    target_questions integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    quota_date date := timezone('America/Fortaleza', now())::date;
begin
    if target_user_id is null or target_questions < 1 or target_questions > 10 then
        raise exception 'Invalid AI quota refund';
    end if;

    update public.ai_daily_usage
       set questions_generated = greatest(0, questions_generated - target_questions),
           request_count = greatest(0, request_count - 1),
           updated_at = now()
     where user_id = target_user_id
       and usage_date = quota_date;
end;
$$;

revoke all on function public.reserve_ai_daily_quota(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.refund_ai_daily_quota(uuid, integer) from public, anon, authenticated;
grant execute on function public.reserve_ai_daily_quota(uuid, integer, integer) to service_role;
grant execute on function public.refund_ai_daily_quota(uuid, integer) to service_role;

commit;
