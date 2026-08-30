begin;

create or replace function public.increment_legal_reading_history(
    p_workspace_id uuid,
    p_subject_id uuid,
    p_provision_id uuid
)
returns table (
    provision_id uuid,
    visit_count integer,
    first_read_at timestamptz,
    last_read_at timestamptz
)
language sql
volatile
security invoker
set search_path = ''
as $$
    insert into public.user_legal_reading_history as history (
        workspace_id,
        subject_id,
        user_id,
        provision_id,
        visit_count,
        last_read_at
    )
    values (
        p_workspace_id,
        p_subject_id,
        (select auth.uid()),
        p_provision_id,
        1,
        now()
    )
    on conflict (user_id, subject_id, provision_id)
    do update set
        visit_count = least(1000000, history.visit_count + 1),
        last_read_at = now()
    returning
        history.provision_id,
        history.visit_count,
        history.first_read_at,
        history.last_read_at;
$$;

revoke all on function public.increment_legal_reading_history(uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function public.increment_legal_reading_history(uuid, uuid, uuid)
to authenticated;

comment on function public.increment_legal_reading_history(uuid, uuid, uuid) is
    'Registra uma visita jurídica de forma atômica, sob as políticas RLS do usuário autenticado.';

commit;
