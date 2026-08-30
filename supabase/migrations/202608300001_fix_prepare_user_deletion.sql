begin;

-- Evita que o PostgreSQL confunda o parâmetro target_user_id com a coluna
-- homônima da tabela de aprovações durante o UPSERT.
create or replace function public.prepare_user_deletion(
    target_user_id uuid,
    confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
    deletion_preview jsonb;
    new_approval_id uuid;
    approval_expires_at timestamptz := now() + interval '15 minutes';
begin
    if prepare_user_deletion.confirmation is distinct from
       'EXCLUIR ' || prepare_user_deletion.target_user_id::text then
        raise exception using errcode = 'P0001', message = 'INVALID_DELETION_CONFIRMATION';
    end if;

    deletion_preview := public.preview_user_deletion(
        prepare_user_deletion.target_user_id
    );

    if (deletion_preview ->> 'shared_workspaces_owned')::bigint > 0 then
        raise exception using errcode = 'P0001', message = 'TRANSFER_SHARED_WORKSPACE_OWNERSHIP_FIRST';
    end if;

    delete from private.user_deletion_approvals approval
    where approval.expires_at <= now();

    insert into private.user_deletion_approvals (
        target_user_id,
        snapshot,
        expires_at
    )
    values (
        prepare_user_deletion.target_user_id,
        deletion_preview,
        approval_expires_at
    )
    on conflict on constraint user_deletion_approvals_pkey do update
    set approval_id = gen_random_uuid(),
        snapshot = excluded.snapshot,
        prepared_at = now(),
        expires_at = excluded.expires_at
    returning approval_id into new_approval_id;

    return jsonb_build_object(
        'approval_id', new_approval_id,
        'expires_at', approval_expires_at,
        'preview', deletion_preview
    );
end;
$$;

revoke all on function public.prepare_user_deletion(uuid, text)
from public, anon, authenticated;
grant execute on function public.prepare_user_deletion(uuid, text) to service_role;

comment on function public.prepare_user_deletion(uuid, text) is
    'Prepara a exclusão administrativa com confirmação e snapshot recente, sem ambiguidade entre parâmetro e coluna.';

commit;
