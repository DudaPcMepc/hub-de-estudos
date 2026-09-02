begin;

alter table public.flashcard_progress
    add column exam_topic_id uuid references public.exam_topics(id) on delete set null;

create index flashcard_progress_exam_topic_idx
    on public.flashcard_progress(workspace_id, user_id, exam_topic_id)
    where exam_topic_id is not null;

create or replace function private.validate_flashcard_exam_topic()
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
          from public.flashcards card
          join public.exam_topics topic
            on topic.id = new.exam_topic_id
           and topic.workspace_id = new.workspace_id
           and topic.user_id = new.user_id
          join public.exam_subjects exam_subject
            on exam_subject.id = topic.exam_subject_id
           and exam_subject.workspace_id = topic.workspace_id
           and exam_subject.user_id = topic.user_id
         where card.id = new.flashcard_id
           and card.workspace_id = new.workspace_id
           and exam_subject.subject_id = card.subject_id
    ) then
        raise exception using errcode = '23503', message = 'flashcard_exam_topic_owner_or_subject_mismatch';
    end if;

    return new;
end;
$$;

create trigger flashcard_progress_validate_exam_topic
before insert or update of exam_topic_id, flashcard_id, workspace_id, user_id
on public.flashcard_progress
for each row execute function private.validate_flashcard_exam_topic();

revoke all on function private.validate_flashcard_exam_topic()
    from public, anon, authenticated;

comment on column public.flashcard_progress.exam_topic_id is
    'Optional personal exam topic used to organize this user''s copy of a shared flashcard.';

alter function public.import_local_hub(uuid, jsonb, text)
    rename to import_local_hub_core_v4;

revoke all on function public.import_local_hub_core_v4(uuid, jsonb, text)
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
    subject_record jsonb;
    flashcard_record jsonb;
    mapped_flashcard_id uuid;
    mapped_exam_topic_id uuid;
    linked_flashcards integer := 0;
begin
    result := public.import_local_hub_core_v4(target_workspace_id, payload, payload_checksum);
    if coalesce(result->>'status', '') <> 'concluido' then
        return result;
    end if;

    import_batch_id := (result->>'batch_id')::uuid;
    for subject_record in
        select value from jsonb_array_elements(coalesce(payload->'materias', '[]'::jsonb))
    loop
        for flashcard_record in
            select value from jsonb_array_elements(coalesce(subject_record->'cards', '[]'::jsonb))
        loop
            select item.new_id into mapped_flashcard_id
              from public.migration_items item
             where item.batch_id = import_batch_id
               and item.entity_type = 'flashcard'
               and item.legacy_id = flashcard_record->>'id';

            mapped_exam_topic_id := null;
            if nullif(flashcard_record->>'topicoEditalId', '') is not null then
                select item.new_id into mapped_exam_topic_id
                  from public.migration_items item
                 where item.batch_id = import_batch_id
                   and item.entity_type = 'exam_topic'
                   and item.legacy_id = flashcard_record->>'topicoEditalId';
                if mapped_exam_topic_id is null then
                    raise exception using errcode = '23503', message = 'flashcard_exam_topic_mapping_not_found';
                end if;
            end if;

            update public.flashcard_progress progress
               set exam_topic_id = mapped_exam_topic_id
             where progress.workspace_id = target_workspace_id
               and progress.user_id = current_user_id
               and progress.flashcard_id = mapped_flashcard_id;
            if mapped_exam_topic_id is not null then
                linked_flashcards := linked_flashcards + 1;
            end if;
        end loop;
    end loop;

    return result || jsonb_build_object('linked_flashcards', linked_flashcards);
end;
$$;

revoke all on function public.import_local_hub(uuid, jsonb, text) from public, anon;
grant execute on function public.import_local_hub(uuid, jsonb, text) to authenticated;

comment on function public.import_local_hub(uuid, jsonb, text) is
    'Imports the validated Hub payload and restores each user''s private flashcard-to-exam-topic links.';

commit;
