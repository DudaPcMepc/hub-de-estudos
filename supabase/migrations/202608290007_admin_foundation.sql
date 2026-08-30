begin;

create table private.platform_admins (
    user_id uuid primary key references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    created_by uuid references auth.users(id) on delete set null
);

revoke all on table private.platform_admins from public, anon, authenticated;

create or replace function public.is_platform_admin(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
    select target_user_id is not null
       and exists (
            select 1
            from private.platform_admins administrator
            where administrator.user_id = target_user_id
       );
$$;

revoke all on function public.is_platform_admin(uuid) from public, anon, authenticated;
grant execute on function public.is_platform_admin(uuid) to service_role;

comment on table private.platform_admins is
    'Accounts allowed to use protected platform administration Edge Functions.';

comment on function public.is_platform_admin(uuid) is
    'Service-role-only check used by protected administration Edge Functions.';

commit;
