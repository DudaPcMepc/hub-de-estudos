begin;

create table private.user_deletion_approvals (
    target_user_id uuid primary key,
    approval_id uuid not null default gen_random_uuid() unique,
    snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
    prepared_at timestamptz not null default now(),
    expires_at timestamptz not null,
    check (expires_at > prepared_at)
);

create table private.user_deletion_audit (
    id uuid primary key default gen_random_uuid(),
    approval_id uuid not null unique,
    target_user_id uuid not null,
    snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
    deleted_at timestamptz not null default now()
);

revoke all on table private.user_deletion_approvals from public, anon, authenticated;
revoke all on table private.user_deletion_audit from public, anon, authenticated;

create or replace function private.build_user_deletion_preview(target_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
    with personal_workspaces as (
        select workspace.id
        from public.workspaces workspace
        where workspace.owner_id = target_user_id
          and workspace.kind = 'personal'
    )
    select jsonb_build_object(
        'target_user_id', target_user_id,
        'personal_workspaces', (select count(*) from personal_workspaces),
        'shared_workspaces_owned', (
            select count(*) from public.workspaces workspace
            where workspace.owner_id = target_user_id and workspace.kind = 'shared'
        ),
        'shared_workspace_memberships', (
            select count(*)
            from public.workspace_members membership
            join public.workspaces workspace on workspace.id = membership.workspace_id
            where membership.user_id = target_user_id and workspace.kind = 'shared'
        ),
        'all_workspace_memberships', (
            select count(*) from public.workspace_members membership
            where membership.user_id = target_user_id
        ),
        'subjects', (
            select count(*) from public.subjects item
            where item.workspace_id in (select id from personal_workspaces)
        ),
        'topics', (
            select count(*) from public.topics item
            where item.workspace_id in (select id from personal_workspaces)
        ),
        'notes', (
            select count(*) from public.notes item
            where item.workspace_id in (select id from personal_workspaces)
        ),
        'flashcards', (
            select count(*) from public.flashcards item
            where item.workspace_id in (select id from personal_workspaces)
        ),
        'study_links', (
            select count(*) from public.study_links item
            where item.workspace_id in (select id from personal_workspaces)
        ),
        'study_tasks', (
            select count(*) from public.study_tasks item
            where item.workspace_id in (select id from personal_workspaces)
        ),
        'exam_subjects', (
            select count(*) from public.exam_subjects item
            where item.workspace_id in (select id from personal_workspaces)
        ),
        'exam_topics', (
            select count(*) from public.exam_topics item
            where item.workspace_id in (select id from personal_workspaces)
        ),
        'error_entries', (
            select count(*) from public.error_entries item
            where item.workspace_id in (select id from personal_workspaces)
        ),
        'quiz_attempts', (
            select count(*) from public.quiz_attempts item
            where item.workspace_id in (select id from personal_workspaces)
        ),
        'quiz_answers', (
            select count(*) from public.quiz_answers item
            where item.workspace_id in (select id from personal_workspaces)
        ),
        'migration_batches', (
            select count(*) from public.migration_batches item
            where item.workspace_id in (select id from personal_workspaces)
        ),
        'personal_exam_settings', (
            select count(*) from public.exam_settings item
            where item.user_id = target_user_id
        ),
        'personal_exam_subjects', (
            select count(*) from public.exam_subjects item
            where item.user_id = target_user_id
        ),
        'personal_exam_topics', (
            select count(*) from public.exam_topics item
            where item.user_id = target_user_id
        ),
        'personal_flashcard_progress', (
            select count(*) from public.flashcard_progress item
            where item.user_id = target_user_id
        ),
        'personal_error_entries', (
            select count(*) from public.error_entries item
            where item.user_id = target_user_id
        ),
        'personal_quiz_attempts', (
            select count(*) from public.quiz_attempts item
            where item.user_id = target_user_id
        ),
        'personal_quiz_answers', (
            select count(*) from public.quiz_answers item
            where item.user_id = target_user_id
        ),
        'personal_subject_performance', (
            select count(*) from public.subject_performance item
            where item.user_id = target_user_id
        ),
        'personal_migration_batches', (
            select count(*) from public.migration_batches item
            where item.user_id = target_user_id
        ),
        'ai_daily_usage_days', (
            select count(*) from public.ai_daily_usage item
            where item.user_id = target_user_id
        )
    );
$$;

create or replace function public.preview_user_deletion(target_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
begin
    if target_user_id is null or not exists (
        select 1 from auth.users target where target.id = target_user_id
    ) then
        raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND';
    end if;

    return private.build_user_deletion_preview(target_user_id);
end;
$$;

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
    if confirmation is distinct from 'EXCLUIR ' || target_user_id::text then
        raise exception using errcode = 'P0001', message = 'INVALID_DELETION_CONFIRMATION';
    end if;

    deletion_preview := public.preview_user_deletion(target_user_id);

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
        target_user_id,
        deletion_preview,
        approval_expires_at
    )
    on conflict (target_user_id) do update
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

create or replace function private.guard_and_audit_auth_user_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
    approval private.user_deletion_approvals%rowtype;
    current_snapshot jsonb;
begin
    select candidate.*
    into approval
    from private.user_deletion_approvals candidate
    where candidate.target_user_id = old.id
      and candidate.expires_at > now()
    for update;

    if not found then
        raise exception using errcode = 'P0001', message = 'USER_DELETION_REQUIRES_FRESH_PREVIEW';
    end if;

    -- Impede que uma gravação concorrente altere o espaço entre a nova
    -- conferência e a remoção em cascata executada na mesma transação.
    perform 1
    from public.workspaces workspace
    where workspace.owner_id = old.id
    for update;

    current_snapshot := private.build_user_deletion_preview(old.id);

    if current_snapshot is distinct from approval.snapshot then
        raise exception using errcode = 'P0001', message = 'USER_DATA_CHANGED_REVIEW_DELETION_AGAIN';
    end if;

    if (current_snapshot ->> 'shared_workspaces_owned')::bigint > 0 then
        raise exception using errcode = 'P0001', message = 'TRANSFER_SHARED_WORKSPACE_OWNERSHIP_FIRST';
    end if;

    insert into private.user_deletion_audit (
        approval_id,
        target_user_id,
        snapshot
    ) values (
        approval.approval_id,
        old.id,
        current_snapshot
    );

    delete from private.user_deletion_approvals pending
    where pending.target_user_id = old.id;

    return old;
end;
$$;

drop trigger if exists auth_user_delete_guard on auth.users;
create trigger auth_user_delete_guard
before delete on auth.users
for each row execute function private.guard_and_audit_auth_user_delete();

alter table public.workspaces
    drop constraint if exists workspaces_owner_id_fkey;

alter table public.workspaces
    add constraint workspaces_owner_id_fkey
    foreign key (owner_id) references auth.users(id) on delete cascade;

revoke all on function private.build_user_deletion_preview(uuid) from public, anon, authenticated;
revoke all on function private.guard_and_audit_auth_user_delete() from public, anon, authenticated;
revoke all on function public.preview_user_deletion(uuid) from public, anon, authenticated;
revoke all on function public.prepare_user_deletion(uuid, text) from public, anon, authenticated;

grant execute on function public.preview_user_deletion(uuid) to service_role;
grant execute on function public.prepare_user_deletion(uuid, text) to service_role;

commit;
