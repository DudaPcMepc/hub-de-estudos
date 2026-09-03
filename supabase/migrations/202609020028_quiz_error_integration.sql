begin;

alter table public.error_entries
    add column source_type text not null default 'manual'
        check (source_type in ('manual', 'flashcard', 'legal_highlight', 'quiz_ai')),
    add column source_fingerprint text
        check (source_fingerprint is null or char_length(source_fingerprint) between 32 and 64),
    add column question_text text not null default '' check (char_length(question_text) <= 4000),
    add column selected_answer text not null default '' check (char_length(selected_answer) <= 2000),
    add column correct_answer text not null default '' check (char_length(correct_answer) <= 2000),
    add column explanation text not null default '' check (char_length(explanation) <= 8000),
    add column quiz_topic text not null default '' check (char_length(quiz_topic) <= 2000),
    add column quiz_difficulty text not null default ''
        check (quiz_difficulty in ('', 'Fácil', 'Médio', 'Difícil')),
    add column board_name text not null default '' check (char_length(board_name) <= 300),
    add column occurrence_count integer not null default 1 check (occurrence_count between 1 and 100000),
    add column last_occurred_at timestamptz not null default now();

create unique index error_entries_quiz_fingerprint_idx
    on public.error_entries(workspace_id, user_id, subject_id, source_type, source_fingerprint)
    where source_type = 'quiz_ai' and source_fingerprint is not null;

create or replace function public.record_quiz_error(
    target_workspace_id uuid,
    target_subject_id uuid,
    target_exam_topic_id uuid,
    target_question text,
    target_selected_answer text,
    target_correct_answer text,
    target_explanation text,
    target_quiz_topic text,
    target_difficulty text,
    target_board_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    normalized_question text;
    question_fingerprint text;
    saved_entry public.error_entries%rowtype;
begin
    if current_user_id is null then
        raise exception using errcode = '42501', message = 'authentication_required';
    end if;
    if not private.is_workspace_member(target_workspace_id) then
        raise exception using errcode = '42501', message = 'workspace_access_denied';
    end if;
    if not exists (
        select 1 from public.subjects subject
         where subject.id = target_subject_id
           and subject.workspace_id = target_workspace_id
    ) then
        raise exception using errcode = '23503', message = 'quiz_error_subject_not_found';
    end if;
    if target_exam_topic_id is not null and not exists (
        select 1
          from public.exam_topics topic
          join public.exam_subjects exam_subject
            on exam_subject.id = topic.exam_subject_id
           and exam_subject.workspace_id = topic.workspace_id
           and exam_subject.user_id = topic.user_id
         where topic.id = target_exam_topic_id
           and topic.workspace_id = target_workspace_id
           and topic.user_id = current_user_id
           and exam_subject.subject_id = target_subject_id
    ) then
        raise exception using errcode = '23503', message = 'quiz_error_exam_topic_mismatch';
    end if;

    normalized_question := lower(regexp_replace(trim(coalesce(target_question, '')), '\s+', ' ', 'g'));
    if char_length(normalized_question) < 1 or char_length(target_question) > 4000 then
        raise exception using errcode = '22023', message = 'quiz_error_question_invalid';
    end if;
    if char_length(coalesce(target_selected_answer, '')) > 2000
       or char_length(coalesce(target_correct_answer, '')) < 1
       or char_length(coalesce(target_correct_answer, '')) > 2000
       or char_length(coalesce(target_explanation, '')) > 8000
       or char_length(coalesce(target_quiz_topic, '')) > 2000
       or char_length(coalesce(target_board_name, '')) > 300
       or coalesce(target_difficulty, '') not in ('', 'Fácil', 'Médio', 'Difícil') then
        raise exception using errcode = '22023', message = 'quiz_error_metadata_invalid';
    end if;

    question_fingerprint := md5(normalized_question);
    insert into public.error_entries (
        workspace_id, subject_id, user_id, theme, observation, occurred_on, exam_topic_id,
        review_state, next_review_on, source_type, source_fingerprint, question_text,
        selected_answer, correct_answer, explanation, quiz_topic, quiz_difficulty,
        board_name, occurrence_count, last_occurred_at
    ) values (
        target_workspace_id, target_subject_id, current_user_id,
        left(trim(target_question), 4000),
        left(trim(coalesce(target_explanation, '')), 10000),
        current_date, target_exam_topic_id, 'pending', current_date, 'quiz_ai',
        question_fingerprint, trim(target_question), trim(coalesce(target_selected_answer, '')),
        trim(target_correct_answer), trim(coalesce(target_explanation, '')),
        trim(coalesce(target_quiz_topic, '')), coalesce(target_difficulty, ''),
        trim(coalesce(target_board_name, '')), 1, now()
    )
    on conflict (workspace_id, user_id, subject_id, source_type, source_fingerprint)
        where source_type = 'quiz_ai' and source_fingerprint is not null
    do update set
        theme = excluded.theme,
        observation = excluded.observation,
        occurred_on = current_date,
        exam_topic_id = coalesce(excluded.exam_topic_id, public.error_entries.exam_topic_id),
        review_state = 'pending',
        next_review_on = current_date,
        selected_answer = excluded.selected_answer,
        correct_answer = excluded.correct_answer,
        explanation = excluded.explanation,
        quiz_topic = excluded.quiz_topic,
        quiz_difficulty = excluded.quiz_difficulty,
        board_name = excluded.board_name,
        occurrence_count = least(100000, public.error_entries.occurrence_count + 1),
        last_occurred_at = now(),
        updated_at = now()
    returning * into saved_entry;

    return jsonb_build_object(
        'id', saved_entry.id,
        'occurredOn', saved_entry.occurred_on,
        'examTopicId', saved_entry.exam_topic_id,
        'reviewState', saved_entry.review_state,
        'nextReview', saved_entry.next_review_on,
        'sourceFingerprint', saved_entry.source_fingerprint,
        'occurrenceCount', saved_entry.occurrence_count,
        'lastOccurredAt', saved_entry.last_occurred_at
    );
end;
$$;

revoke all on function public.record_quiz_error(uuid, uuid, uuid, text, text, text, text, text, text, text)
    from public, anon;
grant execute on function public.record_quiz_error(uuid, uuid, uuid, text, text, text, text, text, text, text)
    to authenticated;

alter function public.import_local_hub(uuid, jsonb, text)
    rename to import_local_hub_core_v7;

revoke all on function public.import_local_hub_core_v7(uuid, jsonb, text)
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
    current_user_id uuid := (select auth.uid());
    error_record jsonb;
    mapped_error_id uuid;
begin
    result := public.import_local_hub_core_v7(target_workspace_id, payload, payload_checksum);
    if coalesce(result->>'status', '') <> 'concluido' then
        return result;
    end if;

    import_batch_id := (result->>'batch_id')::uuid;
    for error_record in select value from jsonb_array_elements(coalesce(payload->'erros', '[]'::jsonb)) loop
        select item.new_id into mapped_error_id
          from public.migration_items item
         where item.batch_id = import_batch_id
           and item.entity_type = 'error_entry'
           and item.legacy_id = error_record->>'id';

        update public.error_entries entry
           set source_type = case when error_record->>'origem' = 'quiz_ai' then 'quiz_ai' else 'manual' end,
               source_fingerprint = nullif(error_record->>'impressaoDigital', ''),
               question_text = left(coalesce(error_record->>'enunciado', ''), 4000),
               selected_answer = left(coalesce(error_record->>'respostaEscolhida', ''), 2000),
               correct_answer = left(coalesce(error_record->>'respostaCorreta', ''), 2000),
               explanation = left(coalesce(error_record->>'explicacao', ''), 8000),
               quiz_topic = left(coalesce(error_record->>'temaSimulado', ''), 2000),
               quiz_difficulty = case when error_record->>'dificuldade' in ('Fácil', 'Médio', 'Difícil') then error_record->>'dificuldade' else '' end,
               board_name = left(coalesce(error_record->>'banca', ''), 300),
               occurrence_count = greatest(1, least(100000, coalesce((error_record->>'ocorrencias')::integer, 1))),
               last_occurred_at = coalesce(nullif(error_record->>'ultimaOcorrenciaEm', '')::timestamptz, now())
         where entry.id = mapped_error_id
           and entry.workspace_id = target_workspace_id
           and entry.user_id = current_user_id;
    end loop;

    return result;
end;
$$;

revoke all on function public.import_local_hub(uuid, jsonb, text) from public, anon;
grant execute on function public.import_local_hub(uuid, jsonb, text) to authenticated;

comment on function public.record_quiz_error(uuid, uuid, uuid, text, text, text, text, text, text, text) is
    'Privately creates or reactivates one deduplicated AI quiz error for the authenticated user.';

commit;
