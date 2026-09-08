begin;

alter table public.quiz_attempts
    add column exam_topic_id uuid references public.exam_topics(id) on delete set null,
    add column exam_name text not null default '' check (char_length(exam_name) <= 500),
    add column board_name text not null default '' check (char_length(board_name) <= 300),
    add column duration_seconds integer check (duration_seconds is null or duration_seconds between 0 and 86400);

alter table public.quiz_answers
    add column position smallint not null default 1 check (position between 1 and 100);

create unique index quiz_answers_attempt_position_idx
    on public.quiz_answers(attempt_id, position);

create index quiz_attempts_user_completed_idx
    on public.quiz_attempts(workspace_id, user_id, completed_at desc)
    where status = 'concluido';

create or replace function private.validate_quiz_attempt_topic()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.exam_topic_id is null then
        return new;
    end if;
    if not exists (
        select 1
          from public.exam_topics topic
          join public.exam_subjects exam_subject
            on exam_subject.id = topic.exam_subject_id
           and exam_subject.workspace_id = topic.workspace_id
           and exam_subject.user_id = topic.user_id
         where topic.id = new.exam_topic_id
           and topic.workspace_id = new.workspace_id
           and topic.user_id = new.user_id
           and exam_subject.subject_id = new.subject_id
    ) then
        raise exception using errcode = '23503', message = 'quiz_attempt_exam_topic_mismatch';
    end if;
    return new;
end;
$$;

create trigger quiz_attempts_validate_exam_topic
before insert or update of exam_topic_id, subject_id, workspace_id, user_id
on public.quiz_attempts
for each row execute function private.validate_quiz_attempt_topic();

revoke all on function private.validate_quiz_attempt_topic()
    from public, anon, authenticated;

create or replace function public.create_quiz_attempt(
    target_workspace_id uuid,
    target_subject_id uuid,
    target_exam_topic_id uuid,
    target_topic text,
    target_difficulty text,
    target_exam_name text,
    target_board_name text,
    target_questions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    attempt_id uuid;
    question_record jsonb;
    question_position bigint;
    options_value jsonb;
    correct_value integer;
begin
    if current_user_id is null then
        raise exception using errcode = '42501', message = 'authentication_required';
    end if;
    if not private.is_workspace_member(target_workspace_id) then
        raise exception using errcode = '42501', message = 'workspace_access_denied';
    end if;
    if not exists (
        select 1 from public.subjects subject
         where subject.id = target_subject_id and subject.workspace_id = target_workspace_id
    ) then
        raise exception using errcode = '23503', message = 'quiz_subject_not_found';
    end if;
    if target_difficulty not in ('Fácil', 'Médio', 'Difícil')
       or char_length(coalesce(target_topic, '')) > 2000
       or char_length(coalesce(target_exam_name, '')) > 500
       or char_length(coalesce(target_board_name, '')) > 300
       or jsonb_typeof(target_questions) <> 'array'
       or jsonb_array_length(target_questions) not between 1 and 20 then
        raise exception using errcode = '22023', message = 'quiz_attempt_invalid';
    end if;

    insert into public.quiz_attempts (
        workspace_id, subject_id, user_id, exam_topic_id, topic, difficulty,
        exam_name, board_name, status, total_questions, correct_answers
    ) values (
        target_workspace_id, target_subject_id, current_user_id, target_exam_topic_id,
        trim(coalesce(target_topic, '')), target_difficulty, trim(coalesce(target_exam_name, '')),
        trim(coalesce(target_board_name, '')), 'em_andamento', jsonb_array_length(target_questions), 0
    ) returning id into attempt_id;

    for question_record, question_position in
        select item.value, item.ordinality
          from jsonb_array_elements(target_questions) with ordinality as item(value, ordinality)
    loop
        options_value := question_record->'options';
        if coalesce(question_record->>'correctIndex', '') !~ '^[0-3]$' then
            raise exception using errcode = '22023', message = 'quiz_question_correct_index_invalid';
        end if;
        correct_value := (question_record->>'correctIndex')::integer;
        if char_length(trim(coalesce(question_record->>'question', ''))) not between 1 and 4000
           or jsonb_typeof(options_value) <> 'array'
           or jsonb_array_length(options_value) <> 4
           or exists (
                select 1 from jsonb_array_elements_text(options_value) option_value
                 where char_length(trim(option_value)) not between 1 and 2000
           )
           or char_length(coalesce(question_record->>'explanation', '')) > 8000 then
            raise exception using errcode = '22023', message = 'quiz_question_invalid';
        end if;

        insert into public.quiz_answers (
            workspace_id, attempt_id, user_id, question, options, correct_index,
            explanation, position
        ) values (
            target_workspace_id, attempt_id, current_user_id,
            trim(question_record->>'question'), options_value, correct_value,
            trim(coalesce(question_record->>'explanation', '')), question_position
        );
    end loop;

    return jsonb_build_object(
        'id', attempt_id,
        'startedAt', (select started_at from public.quiz_attempts where id = attempt_id),
        'answers', (
            select jsonb_agg(jsonb_build_object('id', answer.id, 'position', answer.position) order by answer.position)
              from public.quiz_answers answer
             where answer.attempt_id = attempt_id
        )
    );
end;
$$;

create or replace function public.record_quiz_answer(
    target_workspace_id uuid,
    target_attempt_id uuid,
    target_answer_id uuid,
    target_selected_index integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    attempt_record public.quiz_attempts%rowtype;
    answer_record public.quiz_answers%rowtype;
    correct_value boolean;
    remaining_count integer;
    error_result jsonb := null;
begin
    if current_user_id is null then
        raise exception using errcode = '42501', message = 'authentication_required';
    end if;
    if target_selected_index not between 0 and 3 then
        raise exception using errcode = '22023', message = 'quiz_selected_index_invalid';
    end if;

    select * into attempt_record
      from public.quiz_attempts attempt
     where attempt.id = target_attempt_id
       and attempt.workspace_id = target_workspace_id
       and attempt.user_id = current_user_id
     for update;
    if not found then
        raise exception using errcode = '42501', message = 'quiz_attempt_access_denied';
    end if;

    select * into answer_record
      from public.quiz_answers answer
     where answer.id = target_answer_id
       and answer.attempt_id = target_attempt_id
       and answer.workspace_id = target_workspace_id
       and answer.user_id = current_user_id
     for update;
    if not found then
        raise exception using errcode = '42501', message = 'quiz_answer_access_denied';
    end if;

    if answer_record.selected_index is not null then
        if answer_record.selected_index <> target_selected_index then
            raise exception using errcode = '23505', message = 'quiz_answer_already_recorded';
        end if;
        return jsonb_build_object(
            'isCorrect', answer_record.is_correct,
            'completed', attempt_record.status = 'concluido',
            'correctAnswers', attempt_record.correct_answers,
            'totalQuestions', attempt_record.total_questions,
            'completedAt', attempt_record.completed_at,
            'durationSeconds', attempt_record.duration_seconds,
            'alreadyRecorded', true
        );
    end if;

    correct_value := target_selected_index = answer_record.correct_index;
    update public.quiz_answers answer
       set selected_index = target_selected_index,
           is_correct = correct_value,
           answered_at = now()
     where answer.id = answer_record.id;

    insert into public.subject_performance (
        workspace_id, subject_id, user_id, correct_answers, total_answers
    ) values (
        target_workspace_id, attempt_record.subject_id, current_user_id,
        case when correct_value then 1 else 0 end, 1
    )
    on conflict (subject_id, user_id) do update
       set correct_answers = public.subject_performance.correct_answers + case when correct_value then 1 else 0 end,
           total_answers = public.subject_performance.total_answers + 1,
           updated_at = now()
     where public.subject_performance.workspace_id = target_workspace_id;

    if not correct_value then
        error_result := public.record_quiz_error(
            target_workspace_id,
            attempt_record.subject_id,
            attempt_record.exam_topic_id,
            answer_record.question,
            answer_record.options->>target_selected_index,
            answer_record.options->>answer_record.correct_index,
            answer_record.explanation,
            attempt_record.topic,
            attempt_record.difficulty,
            attempt_record.board_name
        );
    end if;

    select count(*) into remaining_count
      from public.quiz_answers answer
     where answer.attempt_id = attempt_record.id
       and answer.selected_index is null;

    update public.quiz_attempts attempt
       set correct_answers = attempt.correct_answers + case when correct_value then 1 else 0 end,
           status = case when remaining_count = 0 then 'concluido' else attempt.status end,
           completed_at = case when remaining_count = 0 then now() else attempt.completed_at end,
           duration_seconds = case when remaining_count = 0 then least(86400, greatest(0, extract(epoch from (now() - attempt.started_at))::integer)) else attempt.duration_seconds end
     where attempt.id = attempt_record.id
     returning * into attempt_record;

    return jsonb_build_object(
        'isCorrect', correct_value,
        'completed', attempt_record.status = 'concluido',
        'correctAnswers', attempt_record.correct_answers,
        'totalQuestions', attempt_record.total_questions,
        'completedAt', attempt_record.completed_at,
        'durationSeconds', attempt_record.duration_seconds,
        'error', error_result,
        'alreadyRecorded', false
    );
end;
$$;

revoke all on function public.create_quiz_attempt(uuid, uuid, uuid, text, text, text, text, jsonb)
    from public, anon;
grant execute on function public.create_quiz_attempt(uuid, uuid, uuid, text, text, text, text, jsonb)
    to authenticated;
revoke all on function public.record_quiz_answer(uuid, uuid, uuid, integer)
    from public, anon;
grant execute on function public.record_quiz_answer(uuid, uuid, uuid, integer)
    to authenticated;

alter function public.import_local_hub(uuid, jsonb, text)
    rename to import_local_hub_core_v8;

revoke all on function public.import_local_hub_core_v8(uuid, jsonb, text)
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
    attempt_record jsonb;
    answer_record jsonb;
    mapped_subject_id uuid;
    mapped_exam_topic_id uuid;
    new_attempt_id uuid;
    new_answer_id uuid;
    selected_value integer;
    correct_value integer;
    answer_position integer;
    answer_count integer;
    correct_count integer;
    attempts_count integer;
    answers_count integer;
begin
    if jsonb_typeof(coalesce(payload->'simulados', '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(payload->'simulados', '[]'::jsonb)) > 200 then
        raise exception using errcode = '22023', message = 'invalid_quiz_history';
    end if;

    result := public.import_local_hub_core_v8(target_workspace_id, payload, payload_checksum);
    if coalesce(result->>'status', '') <> 'concluido' then
        return result;
    end if;
    import_batch_id := (result->>'batch_id')::uuid;

    for attempt_record in
        select value from jsonb_array_elements(coalesce(payload->'simulados', '[]'::jsonb))
    loop
        if char_length(coalesce(attempt_record->>'id', '')) not between 1 and 200
           or jsonb_typeof(coalesce(attempt_record->'respostas', '[]'::jsonb)) <> 'array'
           or jsonb_array_length(coalesce(attempt_record->'respostas', '[]'::jsonb)) not between 1 and 20
           or attempt_record->>'status' not in ('em_andamento', 'concluido', 'cancelado') then
            raise exception using errcode = '22023', message = 'invalid_quiz_attempt';
        end if;

        select item.new_id into mapped_subject_id
          from public.migration_items item
         where item.batch_id = import_batch_id
           and item.entity_type = 'subject'
           and item.legacy_id = attempt_record->>'materiaId';
        if mapped_subject_id is null then
            raise exception using errcode = '23503', message = 'quiz_subject_mapping_not_found';
        end if;

        mapped_exam_topic_id := null;
        if nullif(attempt_record->>'topicoEditalId', '') is not null then
            select item.new_id into mapped_exam_topic_id
              from public.migration_items item
             where item.batch_id = import_batch_id
               and item.entity_type = 'exam_topic'
               and item.legacy_id = attempt_record->>'topicoEditalId';
            if mapped_exam_topic_id is null then
                raise exception using errcode = '23503', message = 'quiz_exam_topic_mapping_not_found';
            end if;
        end if;

        new_attempt_id := gen_random_uuid();
        insert into public.quiz_attempts (
            id, workspace_id, subject_id, user_id, exam_topic_id, topic, difficulty,
            exam_name, board_name, status, total_questions, correct_answers,
            started_at, completed_at, duration_seconds
        ) values (
            new_attempt_id, target_workspace_id, mapped_subject_id, current_user_id,
            mapped_exam_topic_id, left(coalesce(attempt_record->>'tema', ''), 2000),
            case when attempt_record->>'dificuldade' in ('Fácil', 'Médio', 'Difícil') then attempt_record->>'dificuldade' else 'Médio' end,
            left(coalesce(attempt_record->>'concurso', ''), 500), left(coalesce(attempt_record->>'banca', ''), 300),
            attempt_record->>'status', jsonb_array_length(attempt_record->'respostas'), 0,
            coalesce(nullif(attempt_record->>'iniciadoEm', '')::timestamptz, now()),
            case when attempt_record->>'status' = 'concluido' then nullif(attempt_record->>'concluidoEm', '')::timestamptz else null end,
            case when nullif(attempt_record->>'duracaoSegundos', '') is null then null else greatest(0, least(86400, (attempt_record->>'duracaoSegundos')::integer)) end
        );
        insert into public.migration_items (batch_id, entity_type, legacy_id, new_id)
        values (import_batch_id, 'quiz_attempt', attempt_record->>'id', new_attempt_id);

        answer_position := 0;
        for answer_record in select value from jsonb_array_elements(attempt_record->'respostas') loop
            answer_position := answer_position + 1;
            if char_length(coalesce(answer_record->>'id', '')) not between 1 and 200
               or char_length(trim(coalesce(answer_record->>'pergunta', ''))) not between 1 and 4000
               or jsonb_typeof(answer_record->'opcoes') <> 'array'
               or jsonb_array_length(answer_record->'opcoes') <> 4
               or coalesce(answer_record->>'respostaCorretaIndex', '') !~ '^[0-3]$'
               or exists (select 1 from jsonb_array_elements_text(answer_record->'opcoes') option_value where char_length(trim(option_value)) not between 1 and 2000) then
                raise exception using errcode = '22023', message = 'invalid_quiz_answer';
            end if;
            correct_value := (answer_record->>'respostaCorretaIndex')::integer;
            selected_value := case
                when nullif(answer_record->>'respostaEscolhidaIndex', '') is null then null
                when answer_record->>'respostaEscolhidaIndex' ~ '^[0-3]$' then (answer_record->>'respostaEscolhidaIndex')::integer
                else -1
            end;
            if selected_value = -1 then
                raise exception using errcode = '22023', message = 'invalid_quiz_selected_answer';
            end if;
            new_answer_id := gen_random_uuid();
            insert into public.quiz_answers (
                id, workspace_id, attempt_id, user_id, question, options, correct_index,
                selected_index, explanation, is_correct, answered_at, position
            ) values (
                new_answer_id, target_workspace_id, new_attempt_id, current_user_id,
                trim(answer_record->>'pergunta'), answer_record->'opcoes', correct_value,
                selected_value, left(coalesce(answer_record->>'explicacao', ''), 8000),
                case when selected_value is null then null else selected_value = correct_value end,
                case when selected_value is null then null else coalesce(nullif(answer_record->>'respondidaEm', '')::timestamptz, now()) end,
                answer_position
            );
            insert into public.migration_items (batch_id, entity_type, legacy_id, new_id)
            values (import_batch_id, 'quiz_answer', answer_record->>'id', new_answer_id);
        end loop;

        select count(*)::integer, (count(*) filter (where answer.is_correct))::integer
          into answer_count, correct_count
          from public.quiz_answers answer where answer.attempt_id = new_attempt_id;
        update public.quiz_attempts attempt
           set total_questions = answer_count, correct_answers = correct_count
         where attempt.id = new_attempt_id;
    end loop;

    select count(*)::integer into attempts_count from public.quiz_attempts attempt
     where attempt.workspace_id = target_workspace_id and attempt.user_id = current_user_id;
    select count(*)::integer into answers_count from public.quiz_answers answer
     where answer.workspace_id = target_workspace_id and answer.user_id = current_user_id;
    update public.migration_batches
       set item_counts = jsonb_set(jsonb_set(item_counts, '{quiz_attempts}', to_jsonb(attempts_count), true), '{quiz_answers}', to_jsonb(answers_count), true)
     where id = import_batch_id;
    return result || jsonb_build_object('quiz_attempts', attempts_count, 'quiz_answers', answers_count);
end;
$$;

revoke all on function public.import_local_hub(uuid, jsonb, text) from public, anon;
grant execute on function public.import_local_hub(uuid, jsonb, text) to authenticated;

comment on function public.create_quiz_attempt(uuid, uuid, uuid, text, text, text, text, jsonb) is
    'Atomically stores a private AI quiz and all questions for the authenticated user.';
comment on function public.record_quiz_answer(uuid, uuid, uuid, integer) is
    'Atomically records one private answer, performance, completion, and an error entry when needed.';
comment on function public.import_local_hub(uuid, jsonb, text) is
    'Imports a validated Hub backup including the authenticated user private quiz history.';

commit;
