begin;

alter table public.error_entries
    add column exam_topic_id uuid references public.exam_topics(id) on delete set null;

create index error_entries_exam_topic_idx
    on public.error_entries(workspace_id, user_id, exam_topic_id)
    where exam_topic_id is not null;

create or replace function private.validate_error_exam_topic()
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
        raise exception using errcode = '23503', message = 'error_exam_topic_owner_or_subject_mismatch';
    end if;

    return new;
end;
$$;

create trigger error_entries_validate_exam_topic
before insert or update of exam_topic_id, subject_id, workspace_id, user_id
on public.error_entries
for each row execute function private.validate_error_exam_topic();

revoke all on function private.validate_error_exam_topic()
    from public, anon, authenticated;

alter function public.import_local_hub(uuid, jsonb, text)
    rename to import_local_hub_core_v5;

revoke all on function public.import_local_hub_core_v5(uuid, jsonb, text)
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
    mapped_exam_topic_id uuid;
    linked_errors integer := 0;
begin
    result := public.import_local_hub_core_v5(target_workspace_id, payload, payload_checksum);
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

        mapped_exam_topic_id := null;
        if nullif(error_record->>'topicoEditalId', '') is not null then
            select item.new_id into mapped_exam_topic_id
              from public.migration_items item
             where item.batch_id = import_batch_id
               and item.entity_type = 'exam_topic'
               and item.legacy_id = error_record->>'topicoEditalId';
            if mapped_exam_topic_id is null then
                raise exception using errcode = '23503', message = 'error_exam_topic_mapping_not_found';
            end if;
        end if;

        update public.error_entries entry
           set exam_topic_id = mapped_exam_topic_id
         where entry.id = mapped_error_id
           and entry.workspace_id = target_workspace_id
           and entry.user_id = current_user_id;
        if mapped_exam_topic_id is not null then
            linked_errors := linked_errors + 1;
        end if;
    end loop;

    return result || jsonb_build_object('linked_errors', linked_errors);
end;
$$;

revoke all on function public.import_local_hub(uuid, jsonb, text) from public, anon;
grant execute on function public.import_local_hub(uuid, jsonb, text) to authenticated;

comment on column public.error_entries.exam_topic_id is
    'Optional private link between an error entry and the owner''s personal exam topic.';

commit;
