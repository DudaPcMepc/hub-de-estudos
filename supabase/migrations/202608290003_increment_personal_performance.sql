begin;

create or replace function public.increment_subject_performance(
    target_workspace_id uuid,
    target_subject_id uuid,
    was_correct boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    result_row public.subject_performance%rowtype;
begin
    if current_user_id is null then
        raise exception using errcode = '42501', message = 'authentication_required';
    end if;
    if target_workspace_id is null or not exists (
        select 1
          from public.workspace_members membership
         where membership.workspace_id = target_workspace_id
           and membership.user_id = current_user_id
    ) then
        raise exception using errcode = '42501', message = 'workspace_access_denied';
    end if;
    if target_subject_id is null or not exists (
        select 1
          from public.subjects subject
         where subject.id = target_subject_id
           and subject.workspace_id = target_workspace_id
    ) then
        raise exception using errcode = '23503', message = 'subject_not_found';
    end if;

    insert into public.subject_performance (
        workspace_id, subject_id, user_id, correct_answers, total_answers
    )
    values (
        target_workspace_id,
        target_subject_id,
        current_user_id,
        case when was_correct then 1 else 0 end,
        1
    )
    on conflict (subject_id, user_id) do update
       set correct_answers = public.subject_performance.correct_answers + case when excluded.correct_answers = 1 then 1 else 0 end,
           total_answers = public.subject_performance.total_answers + 1
     where public.subject_performance.workspace_id = excluded.workspace_id
    returning * into result_row;

    if result_row.subject_id is null then
        raise exception using errcode = '23505', message = 'performance_workspace_mismatch';
    end if;

    return jsonb_build_object(
        'acertos', result_row.correct_answers,
        'total', result_row.total_answers
    );
end;
$$;

revoke all on function public.increment_subject_performance(uuid, uuid, boolean) from public, anon;
grant execute on function public.increment_subject_performance(uuid, uuid, boolean) to authenticated;

comment on function public.increment_subject_performance(uuid, uuid, boolean) is
    'Atomically records one personal quiz answer for a workspace subject.';

commit;
