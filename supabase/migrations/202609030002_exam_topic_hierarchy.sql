begin;

alter table public.exam_topics
    add column parent_topic_id uuid references public.exam_topics(id) on delete set null;

create index exam_topics_parent_idx
    on public.exam_topics(workspace_id, user_id, exam_subject_id, parent_topic_id, position)
    where parent_topic_id is not null;

create or replace function private.validate_exam_topic_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.parent_topic_id is null then
        return new;
    end if;
    if new.parent_topic_id = new.id then
        raise exception using errcode = '23514', message = 'exam_topic_cannot_parent_itself';
    end if;
    if not exists (
        select 1
          from public.exam_topics parent
         where parent.id = new.parent_topic_id
           and parent.workspace_id = new.workspace_id
           and parent.user_id = new.user_id
           and parent.exam_subject_id = new.exam_subject_id
           and parent.parent_topic_id is null
    ) then
        raise exception using errcode = '23503', message = 'exam_topic_parent_mismatch';
    end if;
    if exists (
        select 1
          from public.exam_topics child
         where child.parent_topic_id = new.id
    ) then
        raise exception using errcode = '23514', message = 'exam_topic_hierarchy_too_deep';
    end if;
    return new;
end;
$$;

create trigger exam_topics_validate_parent
before insert or update of parent_topic_id, workspace_id, user_id, exam_subject_id
on public.exam_topics
for each row execute function private.validate_exam_topic_parent();

alter function public.import_local_hub(uuid, jsonb, text)
    rename to import_local_hub_core_v9;

revoke all on function public.import_local_hub_core_v9(uuid, jsonb, text)
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
    exam_subject_record jsonb;
    topic_record jsonb;
    mapped_topic_id uuid;
    mapped_parent_id uuid;
begin
    result := public.import_local_hub_core_v9(target_workspace_id, payload, payload_checksum);
    if coalesce(result->>'status', '') <> 'concluido' then
        return result;
    end if;
    import_batch_id := (result->>'batch_id')::uuid;

    for exam_subject_record in
        select value
          from jsonb_array_elements(coalesce(payload->'edital'->'materias', '[]'::jsonb))
    loop
        for topic_record in
            select value
              from jsonb_array_elements(coalesce(exam_subject_record->'topicos', '[]'::jsonb))
        loop
            if nullif(topic_record->>'paiId', '') is null then
                continue;
            end if;
            if topic_record->>'paiId' = topic_record->>'id' then
                raise exception using errcode = '23514', message = 'invalid_exam_topic_parent';
            end if;

            select item.new_id into mapped_topic_id
              from public.migration_items item
             where item.batch_id = import_batch_id
               and item.entity_type = 'exam_topic'
               and item.legacy_id = topic_record->>'id';
            select item.new_id into mapped_parent_id
              from public.migration_items item
             where item.batch_id = import_batch_id
               and item.entity_type = 'exam_topic'
               and item.legacy_id = topic_record->>'paiId';

            if mapped_topic_id is null or mapped_parent_id is null then
                raise exception using errcode = '23503', message = 'exam_topic_parent_mapping_not_found';
            end if;

            update public.exam_topics topic
               set parent_topic_id = mapped_parent_id
             where topic.id = mapped_topic_id
               and topic.workspace_id = target_workspace_id
               and topic.user_id = (select auth.uid());
            if not found then
                raise exception using errcode = '23503', message = 'exam_topic_mapping_not_found';
            end if;
        end loop;
    end loop;

    return result;
end;
$$;

revoke all on function public.import_local_hub(uuid, jsonb, text)
    from public, anon;
grant execute on function public.import_local_hub(uuid, jsonb, text)
    to authenticated;

comment on column public.exam_topics.parent_topic_id is
    'Tema opcional do subtópico pessoal; limitado a dois níveis e ao mesmo usuário, matéria e espaço.';

commit;
