begin;

alter table public.study_tasks
    add column exam_topic_id uuid references public.exam_topics(id) on delete set null,
    add column planned_minutes integer check (planned_minutes between 1 and 1440),
    add column retention_level text check (retention_level in ('forgot', 'partial', 'good', 'mastered')),
    add column next_review_date date,
    add column last_studied_at timestamptz,
    add column review_history jsonb not null default '[]'::jsonb
        check (jsonb_typeof(review_history) = 'array' and jsonb_array_length(review_history) <= 500);

alter table public.exam_settings
    add column review_interval_forgot integer not null default 1 check (review_interval_forgot between 1 and 3650),
    add column review_interval_partial integer not null default 3 check (review_interval_partial between 1 and 3650),
    add column review_interval_good integer not null default 7 check (review_interval_good between 1 and 3650),
    add column review_interval_mastered integer not null default 30 check (review_interval_mastered between 1 and 3650);

create index study_tasks_exam_topic_idx
    on public.study_tasks(exam_topic_id)
    where exam_topic_id is not null;

create index study_tasks_review_queue_idx
    on public.study_tasks(workspace_id, assigned_to, next_review_date)
    where next_review_date is not null;

create or replace function private.validate_task_exam_topic()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.exam_topic_id is null then
        return new;
    end if;

    if new.assigned_to is null or not exists (
        select 1
          from public.exam_topics topic
          join public.exam_subjects exam_subject
            on exam_subject.id = topic.exam_subject_id
           and exam_subject.workspace_id = topic.workspace_id
           and exam_subject.user_id = topic.user_id
         where topic.id = new.exam_topic_id
           and topic.workspace_id = new.workspace_id
           and topic.user_id = new.assigned_to
           and exam_subject.subject_id = new.subject_id
    ) then
        raise exception using errcode = '23503', message = 'task_exam_topic_owner_mismatch';
    end if;

    return new;
end;
$$;

create trigger study_tasks_validate_exam_topic
before insert or update of exam_topic_id, subject_id, workspace_id, assigned_to
on public.study_tasks
for each row execute function private.validate_task_exam_topic();

drop policy study_tasks_select_member on public.study_tasks;
drop policy study_tasks_insert_editor on public.study_tasks;
drop policy study_tasks_update_editor on public.study_tasks;
drop policy study_tasks_delete_editor on public.study_tasks;

create policy study_tasks_select_self on public.study_tasks for select to authenticated
using (assigned_to = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy study_tasks_insert_self on public.study_tasks for insert to authenticated
with check (assigned_to = (select auth.uid()) and created_by = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy study_tasks_update_self on public.study_tasks for update to authenticated
using (assigned_to = (select auth.uid()) and private.is_workspace_member(workspace_id))
with check (assigned_to = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy study_tasks_delete_self on public.study_tasks for delete to authenticated
using (assigned_to = (select auth.uid()) and private.is_workspace_member(workspace_id));

create or replace function public.record_study_review(
    target_task_id uuid,
    duration_minutes integer,
    retention text,
    mark_exam_topic_complete boolean default false
)
returns table (
    status text,
    retention_level text,
    next_review_date date,
    last_studied_at timestamptz,
    review_history jsonb,
    exam_topic_checked boolean,
    exam_topic_updated_at timestamptz,
    linked_exam_topic_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    task_record public.study_tasks%rowtype;
    interval_days integer;
    event jsonb;
begin
    if current_user_id is null then
        raise exception using errcode = '42501', message = 'authentication_required';
    end if;
    if duration_minutes is null or duration_minutes not between 1 and 1440 then
        raise exception using errcode = '22023', message = 'invalid_study_duration';
    end if;
    if retention not in ('forgot', 'partial', 'good', 'mastered') then
        raise exception using errcode = '22023', message = 'invalid_retention_level';
    end if;

    select task.*
      into task_record
      from public.study_tasks task
     where task.id = target_task_id
       and task.assigned_to = current_user_id
     for update;

    if task_record.id is null then
        raise exception using errcode = '42501', message = 'study_task_not_available';
    end if;

    select case retention
               when 'forgot' then settings.review_interval_forgot
               when 'partial' then settings.review_interval_partial
               when 'good' then settings.review_interval_good
               else settings.review_interval_mastered
           end
      into interval_days
      from public.exam_settings settings
     where settings.workspace_id = task_record.workspace_id
       and settings.user_id = current_user_id;
    interval_days := coalesce(interval_days, case retention when 'forgot' then 1 when 'partial' then 3 when 'good' then 7 else 30 end);

    event := jsonb_build_object(
        'studiedAt', now(),
        'durationMinutes', duration_minutes,
        'retention', retention
    );

    update public.study_tasks task
       set status = 'concluido',
           retention_level = retention,
           next_review_date = current_date + interval_days,
           last_studied_at = now(),
           review_history = task.review_history || jsonb_build_array(event)
     where task.id = task_record.id
     returning task.status,
               task.retention_level,
               task.next_review_date,
               task.last_studied_at,
               task.review_history
          into status, retention_level, next_review_date, last_studied_at, review_history;

    exam_topic_checked := false;
    exam_topic_updated_at := null;
    linked_exam_topic_id := task_record.exam_topic_id;
    if task_record.exam_topic_id is not null then
        if mark_exam_topic_complete then
            update public.exam_topics topic
               set checked = true
             where topic.id = task_record.exam_topic_id
               and topic.workspace_id = task_record.workspace_id
               and topic.user_id = current_user_id;
        end if;
        select topic.checked, topic.updated_at
          into exam_topic_checked, exam_topic_updated_at
          from public.exam_topics topic
         where topic.id = task_record.exam_topic_id
           and topic.workspace_id = task_record.workspace_id
           and topic.user_id = current_user_id;
    end if;

    return next;
end;
$$;

revoke all on function public.record_study_review(uuid, integer, text, boolean) from public, anon;
grant execute on function public.record_study_review(uuid, integer, text, boolean) to authenticated;

comment on function public.record_study_review(uuid, integer, text, boolean) is
    'Atomically records one private study review, schedules the next interval and optionally completes the linked personal exam topic.';

comment on column public.study_tasks.review_history is
    'Private chronological review events used for time, recurrence and retention metrics.';

alter function public.import_local_hub(uuid, jsonb, text)
    rename to import_local_hub_core_v2;

revoke all on function public.import_local_hub_core_v2(uuid, jsonb, text)
    from public, anon, authenticated;

create or replace function public.import_local_hub(
    target_workspace_id uuid,
    payload jsonb,
    payload_checksum text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    result jsonb;
    import_batch_id uuid;
    task_record jsonb;
    review_record jsonb;
    mapped_task_id uuid;
    mapped_exam_topic_id uuid;
    sanitized_history jsonb;
    duration_value integer;
    retention_value text;
    study_instant timestamptz;
    updated_tasks integer := 0;
begin
    result := public.import_local_hub_core_v2(target_workspace_id, payload, payload_checksum);
    if coalesce(result->>'status', '') not in ('concluido', 'ja_importado') then
        return result;
    end if;

    import_batch_id := (result->>'batch_id')::uuid;
    for task_record in select value from jsonb_array_elements(coalesce(payload->'tarefas', '[]'::jsonb)) loop
        select item.new_id into mapped_task_id
          from public.migration_items item
         where item.batch_id = import_batch_id
           and item.entity_type = 'study_task'
           and item.legacy_id = task_record->>'id';
        if mapped_task_id is null then
            raise exception using errcode = '23503', message = 'study_task_mapping_not_found';
        end if;

        mapped_exam_topic_id := null;
        if nullif(task_record->>'topicoEditalId', '') is not null then
            select item.new_id into mapped_exam_topic_id
              from public.migration_items item
             where item.batch_id = import_batch_id
               and item.entity_type = 'exam_topic'
               and item.legacy_id = task_record->>'topicoEditalId';
            if mapped_exam_topic_id is null then
                raise exception using errcode = '23503', message = 'study_task_exam_topic_mapping_not_found';
            end if;
        end if;

        sanitized_history := '[]'::jsonb;
        if jsonb_typeof(coalesce(task_record->'historicoRevisoes', '[]'::jsonb)) <> 'array'
            or jsonb_array_length(coalesce(task_record->'historicoRevisoes', '[]'::jsonb)) > 500 then
            raise exception using errcode = '22023', message = 'invalid_review_history';
        end if;
        for review_record in select value from jsonb_array_elements(coalesce(task_record->'historicoRevisoes', '[]'::jsonb)) loop
            duration_value := (review_record->>'durationMinutes')::integer;
            retention_value := review_record->>'retention';
            study_instant := (review_record->>'studiedAt')::timestamptz;
            if duration_value not between 1 and 1440
                or retention_value not in ('forgot', 'partial', 'good', 'mastered')
                or study_instant is null then
                raise exception using errcode = '22023', message = 'invalid_review_event';
            end if;
            sanitized_history := sanitized_history || jsonb_build_array(jsonb_build_object(
                'studiedAt', study_instant,
                'durationMinutes', duration_value,
                'retention', retention_value
            ));
        end loop;

        update public.study_tasks task
           set exam_topic_id = mapped_exam_topic_id,
               planned_minutes = nullif(task_record->>'minutosPlanejados', '')::integer,
               retention_level = case when task_record->>'retencao' in ('forgot', 'partial', 'good', 'mastered') then task_record->>'retencao' else null end,
               next_review_date = nullif(task_record->>'proximaRevisao', '')::date,
               last_studied_at = nullif(task_record->>'ultimoEstudoEm', '')::timestamptz,
               review_history = sanitized_history
         where task.id = mapped_task_id
           and task.workspace_id = target_workspace_id;
        updated_tasks := updated_tasks + 1;
    end loop;

    update public.exam_settings settings
       set review_interval_forgot = coalesce(nullif(payload->'edital'->'intervalosRevisao'->>'forgot', '')::integer, 1),
           review_interval_partial = coalesce(nullif(payload->'edital'->'intervalosRevisao'->>'partial', '')::integer, 3),
           review_interval_good = coalesce(nullif(payload->'edital'->'intervalosRevisao'->>'good', '')::integer, 7),
           review_interval_mastered = coalesce(nullif(payload->'edital'->'intervalosRevisao'->>'mastered', '')::integer, 30)
     where settings.workspace_id = target_workspace_id
       and settings.user_id = (select auth.uid());

    return result || jsonb_build_object('study_review_tasks', updated_tasks);
end;
$$;

revoke all on function public.import_local_hub(uuid, jsonb, text) from public, anon;
grant execute on function public.import_local_hub(uuid, jsonb, text) to authenticated;

comment on function public.import_local_hub(uuid, jsonb, text) is
    'Imports the validated Hub payload, including private spaced-review task history.';

commit;
