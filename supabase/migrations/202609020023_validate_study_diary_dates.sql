begin;

create or replace function private.validate_study_session_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.user_id <> (select auth.uid()) then
        raise exception using errcode = '42501', message = 'study_log_owner_mismatch';
    end if;
    if new.studied_on is null or new.studied_on > current_date + 1 then
        raise exception using errcode = '22023', message = 'invalid_study_log_date';
    end if;
    if new.subject_id is not null and not exists (
        select 1 from public.subjects subject
         where subject.id = new.subject_id and subject.workspace_id = new.workspace_id
    ) then
        raise exception using errcode = '23503', message = 'study_log_subject_mismatch';
    end if;
    if new.task_id is not null and not exists (
        select 1 from public.study_tasks task
         where task.id = new.task_id and task.workspace_id = new.workspace_id and task.assigned_to = new.user_id
    ) then
        raise exception using errcode = '23503', message = 'study_log_task_mismatch';
    end if;
    if new.exam_topic_id is not null and not exists (
        select 1 from public.exam_topics topic
         where topic.id = new.exam_topic_id and topic.workspace_id = new.workspace_id
           and topic.user_id = new.user_id
           and (new.subject_id is null or topic.subject_id = new.subject_id)
    ) then
        raise exception using errcode = '23503', message = 'study_log_exam_topic_mismatch';
    end if;
    return new;
end;
$$;

revoke all on function private.validate_study_session_log() from public, anon, authenticated;

commit;
