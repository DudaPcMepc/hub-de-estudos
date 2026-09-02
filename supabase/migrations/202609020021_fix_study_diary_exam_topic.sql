begin;

create or replace function public.record_study_review(
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

    if task_record.exam_topic_id is not null then
        if mark_exam_topic_complete then
            update public.exam_topics topic
               set checked = true
             where topic.id = task_record.exam_topic_id
               and topic.workspace_id = task_record.workspace_id
               and topic.user_id = (select auth.uid());
        end if;
        select topic.checked, topic.updated_at into topic_checked, topic_updated_at
          from public.exam_topics topic
         where topic.id = task_record.exam_topic_id
           and topic.workspace_id = task_record.workspace_id
           and topic.user_id = (select auth.uid());
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
    exam_topic_checked := coalesce(topic_checked, false);
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

comment on function public.record_study_review(uuid, integer, text, boolean, text, text, date) is
    'Atomically records a private study diary entry and schedules the next review.';

commit;
