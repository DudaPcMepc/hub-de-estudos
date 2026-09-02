begin;

create table public.study_session_logs (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    task_id uuid references public.study_tasks(id) on delete set null,
    subject_id uuid references public.subjects(id) on delete set null,
    exam_topic_id uuid references public.exam_topics(id) on delete set null,
    subject_name text not null check (char_length(subject_name) between 1 and 500),
    studied_content text not null check (char_length(studied_content) between 1 and 5000),
    private_notes text not null default '' check (char_length(private_notes) <= 20000),
    studied_on date not null default current_date,
    duration_minutes integer not null check (duration_minutes between 1 and 1440),
    retention_level text not null check (retention_level in ('forgot', 'partial', 'good', 'mastered')),
    event_kind text not null default 'study' check (event_kind in ('study', 'review')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (id, workspace_id)
);

create index study_session_logs_user_day_idx
    on public.study_session_logs(workspace_id, user_id, studied_on desc, created_at desc);
create index study_session_logs_exam_topic_idx
    on public.study_session_logs(exam_topic_id, studied_on desc)
    where exam_topic_id is not null;
create index study_session_logs_task_idx
    on public.study_session_logs(task_id, created_at desc)
    where task_id is not null;

create function private.validate_study_session_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.user_id <> (select auth.uid()) then
        raise exception using errcode = '42501', message = 'study_log_owner_mismatch';
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

create trigger study_session_logs_validate
before insert or update on public.study_session_logs
for each row execute function private.validate_study_session_log();

create trigger study_session_logs_set_updated_at
before update on public.study_session_logs
for each row execute function private.set_updated_at();

alter table public.study_session_logs enable row level security;
alter table public.study_session_logs force row level security;

create policy study_session_logs_select_self on public.study_session_logs
for select to authenticated using (user_id = (select auth.uid()));
create policy study_session_logs_insert_self on public.study_session_logs
for insert to authenticated with check (
    user_id = (select auth.uid())
    and private.is_workspace_member(workspace_id)
);
create policy study_session_logs_update_self on public.study_session_logs
for update to authenticated using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
create policy study_session_logs_delete_self on public.study_session_logs
for delete to authenticated using (user_id = (select auth.uid()));

revoke all on table public.study_session_logs from public, anon;
grant select, insert, update, delete on table public.study_session_logs to authenticated;

drop function public.record_study_review(uuid, integer, text, boolean);

create function public.record_study_review(
    target_task_id uuid,
    duration_minutes integer,
    retention text,
    mark_exam_topic_complete boolean default false,
    studied_content text default null,
    private_notes text default '',
    studied_on date default current_date
)
returns table (
    status text,
    retention_level text,
    next_review_date date,
    last_studied_at timestamptz,
    review_history jsonb,
    linked_exam_topic_id uuid,
    exam_topic_checked boolean,
    exam_topic_updated_at timestamptz,
    study_log_id uuid,
    logged_content text,
    logged_notes text,
    logged_studied_on date,
    logged_event_kind text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    task_record public.study_tasks%rowtype;
    interval_days integer;
    studied_at timestamptz := now();
    event jsonb;
    topic_checked boolean := false;
    topic_updated_at timestamptz;
    content_value text;
    notes_value text;
    subject_label text;
    event_kind_value text;
begin
    if duration_minutes not between 1 and 1440 then
        raise exception using errcode = '22023', message = 'invalid_duration_minutes';
    end if;
    if retention not in ('forgot', 'partial', 'good', 'mastered') then
        raise exception using errcode = '22023', message = 'invalid_retention_level';
    end if;
    if studied_on is null or studied_on > current_date + 1 then
        raise exception using errcode = '22023', message = 'invalid_studied_on';
    end if;

    select task.* into task_record
      from public.study_tasks task
     where task.id = target_task_id
       and task.assigned_to = (select auth.uid())
     for update;
    if task_record.id is null then
        raise exception using errcode = '42501', message = 'study_task_not_available';
    end if;

    content_value := coalesce(nullif(btrim(studied_content), ''), task_record.topic);
    notes_value := coalesce(private_notes, '');
    if char_length(content_value) > 5000 or char_length(notes_value) > 20000 then
        raise exception using errcode = '22023', message = 'study_log_text_too_long';
    end if;

    select subject.name into subject_label
      from public.subjects subject
     where subject.id = task_record.subject_id
       and subject.workspace_id = task_record.workspace_id;
    subject_label := coalesce(nullif(subject_label, ''), 'Matéria removida');
    event_kind_value := case when jsonb_array_length(task_record.review_history) = 0 then 'study' else 'review' end;

    select case retention
        when 'forgot' then settings.review_interval_forgot
        when 'partial' then settings.review_interval_partial
        when 'good' then settings.review_interval_good
        when 'mastered' then settings.review_interval_mastered
    end into interval_days
      from public.exam_settings settings
     where settings.workspace_id = task_record.workspace_id
       and settings.user_id = (select auth.uid());
    interval_days := coalesce(interval_days, case retention when 'forgot' then 1 when 'partial' then 3 when 'good' then 7 else 30 end);

    event := jsonb_build_object(
        'studiedAt', studied_at,
        'studiedOn', studied_on,
        'durationMinutes', duration_minutes,
        'retention', retention
    );

    update public.study_tasks task
       set status = 'concluido',
           retention_level = retention,
           next_review_date = studied_on + interval_days,
           last_studied_at = studied_at,
           review_history = task.review_history || jsonb_build_array(event)
     where task.id = task_record.id
     returning task.status, task.retention_level, task.next_review_date, task.last_studied_at, task.review_history
          into status, retention_level, next_review_date, last_studied_at, review_history;

    if mark_exam_topic_complete and task_record.exam_topic_id is not null then
        update public.exam_topics topic
           set checked = true,
               updated_by = (select auth.uid())
         where topic.id = task_record.exam_topic_id
           and topic.workspace_id = task_record.workspace_id
           and topic.user_id = (select auth.uid())
         returning topic.checked, topic.updated_at into topic_checked, topic_updated_at;
    end if;

    insert into public.study_session_logs (
        workspace_id, user_id, task_id, subject_id, exam_topic_id, subject_name,
        studied_content, private_notes, studied_on, duration_minutes, retention_level, event_kind
    ) values (
        task_record.workspace_id, (select auth.uid()), task_record.id, task_record.subject_id,
        task_record.exam_topic_id, subject_label, content_value, notes_value, studied_on,
        duration_minutes, retention, event_kind_value
    ) returning id into study_log_id;

    linked_exam_topic_id := task_record.exam_topic_id;
    exam_topic_checked := topic_checked;
    exam_topic_updated_at := topic_updated_at;
    logged_content := content_value;
    logged_notes := notes_value;
    logged_studied_on := studied_on;
    logged_event_kind := event_kind_value;
    return next;
end;
$$;

revoke all on function public.record_study_review(uuid, integer, text, boolean, text, text, date)
    from public, anon;
grant execute on function public.record_study_review(uuid, integer, text, boolean, text, text, date)
    to authenticated;

comment on table public.study_session_logs is
    'Private diary of completed study and review sessions, optionally linked to a personal exam topic.';
comment on column public.study_session_logs.private_notes is
    'Private optional notes visible only to the owning authenticated user.';

revoke all on function private.validate_study_session_log() from public, anon, authenticated;

alter function public.import_local_hub(uuid, jsonb, text)
    rename to import_local_hub_core_v3;

revoke all on function public.import_local_hub_core_v3(uuid, jsonb, text)
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
    log_record jsonb;
    mapped_task_id uuid;
    mapped_subject_id uuid;
    mapped_exam_topic_id uuid;
    inserted_logs integer := 0;
begin
    result := public.import_local_hub_core_v3(target_workspace_id, payload, payload_checksum);
    if coalesce(result->>'status', '') <> 'concluido' then
        return result;
    end if;

    import_batch_id := (result->>'batch_id')::uuid;
    delete from public.study_session_logs log
     where log.workspace_id = target_workspace_id
       and log.user_id = (select auth.uid());

    for log_record in select value from jsonb_array_elements(coalesce(payload->'registrosEstudo', '[]'::jsonb)) loop
        select item.new_id into mapped_task_id from public.migration_items item
         where item.batch_id = import_batch_id and item.entity_type = 'study_task' and item.legacy_id = log_record->>'tarefaId';
        select item.new_id into mapped_subject_id from public.migration_items item
         where item.batch_id = import_batch_id and item.entity_type = 'subject' and item.legacy_id = log_record->>'materiaId';
        mapped_exam_topic_id := null;
        if nullif(log_record->>'topicoEditalId', '') is not null then
            select item.new_id into mapped_exam_topic_id from public.migration_items item
             where item.batch_id = import_batch_id and item.entity_type = 'exam_topic' and item.legacy_id = log_record->>'topicoEditalId';
        end if;
        if mapped_subject_id is null then
            raise exception using errcode = '23503', message = 'study_log_subject_mapping_not_found';
        end if;

        insert into public.study_session_logs (
            workspace_id, user_id, task_id, subject_id, exam_topic_id, subject_name,
            studied_content, private_notes, studied_on, duration_minutes, retention_level, event_kind
        ) values (
            target_workspace_id, (select auth.uid()), mapped_task_id, mapped_subject_id, mapped_exam_topic_id,
            log_record->>'materiaNome', log_record->>'conteudo', coalesce(log_record->>'anotacoes', ''),
            (log_record->>'dataEstudo')::date, (log_record->>'minutos')::integer,
            log_record->>'retencao', coalesce(nullif(log_record->>'tipo', ''), 'study')
        );
        inserted_logs := inserted_logs + 1;
    end loop;

    return result || jsonb_build_object('study_session_logs', inserted_logs);
end;
$$;

revoke all on function public.import_local_hub(uuid, jsonb, text) from public, anon;
grant execute on function public.import_local_hub(uuid, jsonb, text) to authenticated;

comment on function public.import_local_hub(uuid, jsonb, text) is
    'Imports the validated Hub payload, including the private study diary.';

commit;
