begin;

create unique index migration_batches_one_completed_checksum
    on public.migration_batches (workspace_id, user_id, checksum)
    where status = 'concluido' and checksum is not null;

create or replace function public.import_local_hub(
    target_workspace_id uuid,
    payload jsonb,
    payload_checksum text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    import_batch_id uuid;
    existing_batch_id uuid;
    subject_record jsonb;
    topic_record jsonb;
    note_record jsonb;
    flashcard_record jsonb;
    link_record jsonb;
    task_record jsonb;
    exam_subject_record jsonb;
    error_record jsonb;
    performance_record record;
    new_subject_id uuid;
    new_entity_id uuid;
    mapped_subject_id uuid;
    legacy_subject_id text;
    note_tags text[];
    subject_position integer := 0;
    child_position integer;
    subjects_count integer := 0;
    topics_count integer := 0;
    notes_count integer := 0;
    flashcards_count integer := 0;
    links_count integer := 0;
    tasks_count integer := 0;
    exam_subjects_count integer := 0;
    errors_count integer := 0;
    performance_count integer := 0;
    failure_code text;
begin
    if current_user_id is null then
        raise exception using errcode = '42501', message = 'authentication_required';
    end if;
    if target_workspace_id is null or not private.can_edit_workspace(target_workspace_id) then
        raise exception using errcode = '42501', message = 'workspace_access_denied';
    end if;
    if payload is null or jsonb_typeof(payload) <> 'object' or octet_length(payload::text) > 5242880 then
        raise exception using errcode = '22023', message = 'invalid_payload';
    end if;
    if payload_checksum is null or payload_checksum !~ '^[a-f0-9]{64}$' then
        raise exception using errcode = '22023', message = 'invalid_checksum';
    end if;
    if jsonb_typeof(payload->'materias') <> 'array'
        or jsonb_typeof(payload->'tarefas') <> 'array'
        or jsonb_typeof(payload->'edital') <> 'object'
        or jsonb_typeof(payload->'erros') <> 'array'
        or jsonb_typeof(payload->'desempenho') <> 'object' then
        raise exception using errcode = '22023', message = 'invalid_payload_shape';
    end if;

    select migration.id
      into existing_batch_id
      from public.migration_batches migration
     where migration.workspace_id = target_workspace_id
       and migration.user_id = current_user_id
       and migration.checksum = payload_checksum
       and migration.status = 'concluido'
     limit 1;

    if existing_batch_id is not null then
        return jsonb_build_object('status', 'ja_importado', 'batch_id', existing_batch_id);
    end if;

    insert into public.migration_batches (workspace_id, user_id, source, status, checksum)
    values (target_workspace_id, current_user_id, 'localStorage', 'iniciado', payload_checksum)
    returning id into import_batch_id;

    begin
        if exists (select 1 from public.subjects where workspace_id = target_workspace_id)
            or exists (select 1 from public.study_tasks where workspace_id = target_workspace_id)
            or exists (select 1 from public.exam_settings where workspace_id = target_workspace_id)
            or exists (select 1 from public.error_entries where workspace_id = target_workspace_id)
            or exists (select 1 from public.subject_performance where workspace_id = target_workspace_id) then
            raise exception using errcode = 'P0001', message = 'workspace_not_empty';
        end if;

        for subject_record in select value from jsonb_array_elements(payload->'materias') loop
            legacy_subject_id := subject_record->>'id';
            if legacy_subject_id is null or char_length(legacy_subject_id) not between 1 and 200 then
                raise exception using errcode = '22023', message = 'invalid_subject_legacy_id';
            end if;

            new_subject_id := gen_random_uuid();
            insert into public.subjects (id, workspace_id, name, description, color, priority, position, created_by)
            values (
                new_subject_id,
                target_workspace_id,
                subject_record->>'nome',
                coalesce(subject_record->>'desc', ''),
                case when subject_record->>'cor' in ('primary', 'secondary', 'success', 'danger', 'warning', 'info', 'light', 'dark') then subject_record->>'cor' else 'primary' end,
                case when subject_record->>'prioridade' in ('alta', 'media', 'baixa') then subject_record->>'prioridade' else 'media' end,
                subject_position,
                current_user_id
            );
            subjects_count := subjects_count + 1;
            subject_position := subject_position + 1;

            insert into public.migration_items (batch_id, entity_type, legacy_id, new_id)
            values (import_batch_id, 'subject', legacy_subject_id, new_subject_id);

            child_position := 0;
            for topic_record in select value from jsonb_array_elements(coalesce(subject_record->'topicos', '[]'::jsonb)) loop
                new_entity_id := gen_random_uuid();
                insert into public.topics (id, workspace_id, subject_id, title, status, review_count, position, created_by)
                values (
                    new_entity_id, target_workspace_id, new_subject_id, topic_record->>'titulo',
                    case when topic_record->>'status' in ('nao', 'estudando', 'revisar', 'dominado') then topic_record->>'status' else 'nao' end,
                    coalesce((topic_record->>'revisoes')::integer, 0), child_position, current_user_id
                );
                insert into public.migration_items (batch_id, entity_type, legacy_id, new_id)
                values (import_batch_id, 'topic', topic_record->>'id', new_entity_id);
                topics_count := topics_count + 1;
                child_position := child_position + 1;
            end loop;

            for note_record in select value from jsonb_array_elements(coalesce(subject_record->'notas', '[]'::jsonb)) loop
                select coalesce(array_agg(tag.value #>> '{}'), array[]::text[])
                  into note_tags
                  from jsonb_array_elements(coalesce(note_record->'tags', '[]'::jsonb)) as tag(value);
                new_entity_id := gen_random_uuid();
                insert into public.notes (id, workspace_id, subject_id, title, content, tags, pinned, created_by, updated_by)
                values (
                    new_entity_id, target_workspace_id, new_subject_id,
                    coalesce(note_record->>'titulo', ''), coalesce(note_record->>'conteudo', ''), note_tags,
                    coalesce((note_record->>'fixada')::boolean, false), current_user_id, current_user_id
                );
                insert into public.migration_items (batch_id, entity_type, legacy_id, new_id)
                values (import_batch_id, 'note', note_record->>'id', new_entity_id);
                notes_count := notes_count + 1;
            end loop;

            for flashcard_record in select value from jsonb_array_elements(coalesce(subject_record->'cards', '[]'::jsonb)) loop
                new_entity_id := gen_random_uuid();
                insert into public.flashcards (id, workspace_id, subject_id, front, back, created_by)
                values (
                    new_entity_id, target_workspace_id, new_subject_id,
                    flashcard_record->>'frente', flashcard_record->>'verso', current_user_id
                );
                insert into public.flashcard_progress (workspace_id, flashcard_id, user_id, box, next_review, correct_count, error_count)
                values (
                    target_workspace_id, new_entity_id, current_user_id,
                    coalesce((flashcard_record->>'caixa')::smallint, 1),
                    coalesce(nullif(flashcard_record->>'proxima', '')::date, current_date),
                    coalesce((flashcard_record->>'acertos')::integer, 0),
                    coalesce((flashcard_record->>'erros')::integer, 0)
                );
                insert into public.migration_items (batch_id, entity_type, legacy_id, new_id)
                values (import_batch_id, 'flashcard', flashcard_record->>'id', new_entity_id);
                flashcards_count := flashcards_count + 1;
            end loop;

            for link_record in select value from jsonb_array_elements(coalesce(subject_record->'links', '[]'::jsonb)) loop
                new_entity_id := gen_random_uuid();
                insert into public.study_links (id, workspace_id, subject_id, title, url, created_by)
                values (
                    new_entity_id, target_workspace_id, new_subject_id,
                    link_record->>'titulo', link_record->>'url', current_user_id
                );
                insert into public.migration_items (batch_id, entity_type, legacy_id, new_id)
                values (import_batch_id, 'study_link', link_record->>'id', new_entity_id);
                links_count := links_count + 1;
            end loop;
        end loop;

        for task_record in select value from jsonb_array_elements(payload->'tarefas') loop
            select item.new_id into mapped_subject_id
              from public.migration_items item
             where item.batch_id = import_batch_id and item.entity_type = 'subject' and item.legacy_id = task_record->>'materiaId';
            if mapped_subject_id is null then
                raise exception using errcode = '23503', message = 'task_subject_not_found';
            end if;
            new_entity_id := gen_random_uuid();
            insert into public.study_tasks (id, workspace_id, subject_id, topic, due_date, status, assigned_to, created_by)
            values (
                new_entity_id, target_workspace_id, mapped_subject_id, task_record->>'topico',
                nullif(task_record->>'data', '')::date,
                case when task_record->>'status' in ('pendente', 'concluido') then task_record->>'status' else 'pendente' end,
                current_user_id, current_user_id
            );
            insert into public.migration_items (batch_id, entity_type, legacy_id, new_id)
            values (import_batch_id, 'study_task', task_record->>'id', new_entity_id);
            tasks_count := tasks_count + 1;
        end loop;

        if coalesce(payload->'edital'->>'nomeConcurso', '') <> ''
            or coalesce(payload->'edital'->>'banca', '') <> ''
            or coalesce(payload->'edital'->>'vagas', '') <> ''
            or coalesce(payload->'edital'->>'dataProva', '') <> ''
            or jsonb_array_length(payload->'edital'->'materias') > 0 then
            insert into public.exam_settings (workspace_id, exam_name, board_name, vacancies, exam_date, updated_by)
            values (
                target_workspace_id,
                coalesce(payload->'edital'->>'nomeConcurso', ''),
                coalesce(payload->'edital'->>'banca', ''),
                coalesce(payload->'edital'->>'vagas', ''),
                nullif(payload->'edital'->>'dataProva', '')::date,
                current_user_id
            );
        end if;

        for exam_subject_record in select value from jsonb_array_elements(payload->'edital'->'materias') loop
            select item.new_id into mapped_subject_id
              from public.migration_items item
             where item.batch_id = import_batch_id and item.entity_type = 'subject' and item.legacy_id = exam_subject_record->>'materiaId';
            if mapped_subject_id is null then
                raise exception using errcode = '23503', message = 'exam_subject_not_found';
            end if;
            new_entity_id := gen_random_uuid();
            insert into public.exam_subjects (id, workspace_id, subject_id, question_count, weight)
            values (
                new_entity_id, target_workspace_id, mapped_subject_id,
                coalesce((exam_subject_record->>'questoes')::integer, 0),
                coalesce((exam_subject_record->>'peso')::numeric, 1)
            );
            insert into public.migration_items (batch_id, entity_type, legacy_id, new_id)
            values (import_batch_id, 'exam_subject', exam_subject_record->>'id', new_entity_id);
            exam_subjects_count := exam_subjects_count + 1;
        end loop;

        for error_record in select value from jsonb_array_elements(payload->'erros') loop
            select item.new_id into mapped_subject_id
              from public.migration_items item
             where item.batch_id = import_batch_id and item.entity_type = 'subject' and item.legacy_id = error_record->>'materiaId';
            if mapped_subject_id is null then
                raise exception using errcode = '23503', message = 'error_subject_not_found';
            end if;
            new_entity_id := gen_random_uuid();
            insert into public.error_entries (id, workspace_id, subject_id, user_id, theme, observation, occurred_on)
            values (
                new_entity_id, target_workspace_id, mapped_subject_id, current_user_id,
                error_record->>'tema', coalesce(error_record->>'obs', ''),
                coalesce(nullif(error_record->>'data', '')::date, current_date)
            );
            insert into public.migration_items (batch_id, entity_type, legacy_id, new_id)
            values (import_batch_id, 'error_entry', error_record->>'id', new_entity_id);
            errors_count := errors_count + 1;
        end loop;

        for performance_record in select key, value from jsonb_each(payload->'desempenho') loop
            select item.new_id into mapped_subject_id
              from public.migration_items item
             where item.batch_id = import_batch_id and item.entity_type = 'subject' and item.legacy_id = performance_record.key;
            if mapped_subject_id is null then
                raise exception using errcode = '23503', message = 'performance_subject_not_found';
            end if;
            insert into public.subject_performance (workspace_id, subject_id, user_id, correct_answers, total_answers)
            values (
                target_workspace_id, mapped_subject_id, current_user_id,
                coalesce((performance_record.value->>'acertos')::integer, 0),
                coalesce((performance_record.value->>'total')::integer, 0)
            );
            performance_count := performance_count + 1;
        end loop;

        update public.migration_batches
           set status = 'concluido',
               item_counts = jsonb_build_object(
                   'subjects', subjects_count,
                   'topics', topics_count,
                   'notes', notes_count,
                   'flashcards', flashcards_count,
                   'study_links', links_count,
                   'study_tasks', tasks_count,
                   'exam_subjects', exam_subjects_count,
                   'error_entries', errors_count,
                   'subject_performance', performance_count
               ),
               completed_at = now()
         where id = import_batch_id;

        return jsonb_build_object(
            'status', 'concluido',
            'batch_id', import_batch_id,
            'item_counts', jsonb_build_object(
                'subjects', subjects_count,
                'topics', topics_count,
                'notes', notes_count,
                'flashcards', flashcards_count,
                'study_links', links_count,
                'study_tasks', tasks_count,
                'exam_subjects', exam_subjects_count,
                'error_entries', errors_count,
                'subject_performance', performance_count
            )
        );
    exception when others then
        get stacked diagnostics failure_code = returned_sqlstate;
        update public.migration_batches
           set status = 'falhou',
               item_counts = jsonb_build_object('error_code', failure_code),
               completed_at = now()
         where id = import_batch_id;
        return jsonb_build_object('status', 'falhou', 'batch_id', import_batch_id, 'error_code', failure_code);
    end;
end;
$$;

revoke all on function public.import_local_hub(uuid, jsonb, text) from public, anon;
grant execute on function public.import_local_hub(uuid, jsonb, text) to authenticated;

comment on function public.import_local_hub(uuid, jsonb, text) is
    'Imports one validated local Hub payload atomically into an empty editable workspace, with audit and checksum idempotency.';

commit;
