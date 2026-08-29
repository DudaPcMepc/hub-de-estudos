begin;

-- Mantém a importação original como núcleo validado e coloca uma camada nova
-- sobre ela para importar também o checklist pessoal criado na migration 002.
alter function public.import_local_hub(uuid, jsonb, text)
    rename to import_local_hub_core_v1;

revoke all on function public.import_local_hub_core_v1(uuid, jsonb, text)
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
    exam_subject_record jsonb;
    exam_topic_record jsonb;
    mapped_exam_subject_id uuid;
    existing_topic_id uuid;
    new_topic_id uuid;
    topic_position integer;
    exam_topics_count integer;
begin
    result := public.import_local_hub_core_v1(target_workspace_id, payload, payload_checksum);
    if coalesce(result->>'status', '') not in ('concluido', 'ja_importado') then
        return result;
    end if;

    import_batch_id := (result->>'batch_id')::uuid;

    for exam_subject_record in
        select value
          from jsonb_array_elements(coalesce(payload->'edital'->'materias', '[]'::jsonb))
    loop
        select item.new_id
          into mapped_exam_subject_id
          from public.migration_items item
         where item.batch_id = import_batch_id
           and item.entity_type = 'exam_subject'
           and item.legacy_id = exam_subject_record->>'id';

        if mapped_exam_subject_id is null then
            raise exception using errcode = '23503', message = 'exam_subject_mapping_not_found';
        end if;

        topic_position := 0;
        for exam_topic_record in
            select value
              from jsonb_array_elements(coalesce(exam_subject_record->'topicos', '[]'::jsonb))
        loop
            select item.new_id
              into existing_topic_id
              from public.migration_items item
             where item.batch_id = import_batch_id
               and item.entity_type = 'exam_topic'
               and item.legacy_id = exam_topic_record->>'id';

            if existing_topic_id is null then
                new_topic_id := gen_random_uuid();
                insert into public.exam_topics (
                    id,
                    workspace_id,
                    user_id,
                    exam_subject_id,
                    title,
                    checked,
                    position
                ) values (
                    new_topic_id,
                    target_workspace_id,
                    current_user_id,
                    mapped_exam_subject_id,
                    exam_topic_record->>'titulo',
                    coalesce((exam_topic_record->>'concluido')::boolean, false),
                    topic_position
                );

                insert into public.migration_items (batch_id, entity_type, legacy_id, new_id)
                values (import_batch_id, 'exam_topic', exam_topic_record->>'id', new_topic_id);
            end if;

            topic_position := topic_position + 1;
        end loop;
    end loop;

    select count(*)::integer
      into exam_topics_count
      from public.exam_topics topic
     where topic.workspace_id = target_workspace_id
       and topic.user_id = current_user_id;

    update public.migration_batches
       set item_counts = jsonb_set(item_counts, '{exam_topics}', to_jsonb(exam_topics_count), true)
     where id = import_batch_id;

    return result || jsonb_build_object('exam_topics', exam_topics_count);
end;
$$;

revoke all on function public.import_local_hub(uuid, jsonb, text) from public, anon;
grant execute on function public.import_local_hub(uuid, jsonb, text) to authenticated;

comment on function public.import_local_hub(uuid, jsonb, text) is
    'Imports a validated local Hub payload, including the personal exam checklist, with checksum idempotency.';

create or replace function public.restore_hub_backup(
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
    locked_workspace_id uuid;
    result jsonb;
    restored_batch_id uuid;
begin
    if current_user_id is null then
        raise exception using errcode = '42501', message = 'authentication_required';
    end if;

    select workspace.id
      into locked_workspace_id
      from public.workspaces workspace
     where workspace.id = target_workspace_id
       and workspace.owner_id = current_user_id
       and workspace.kind = 'personal'
     for update;

    if locked_workspace_id is null then
        raise exception using errcode = '42501', message = 'personal_workspace_owner_required';
    end if;

    -- Lotes anteriores continuam auditáveis, mas deixam de representar o
    -- conteúdo atual antes da substituição transacional.
    update public.migration_batches
       set status = 'revertido',
           completed_at = coalesce(completed_at, now())
     where workspace_id = target_workspace_id
       and user_id = current_user_id
       and status = 'concluido';

    delete from public.study_tasks where workspace_id = target_workspace_id;
    delete from public.exam_settings
     where workspace_id = target_workspace_id
       and user_id = current_user_id;
    delete from public.subjects where workspace_id = target_workspace_id;

    result := public.import_local_hub(target_workspace_id, payload, payload_checksum);
    if coalesce(result->>'status', '') <> 'concluido' then
        raise exception using errcode = 'P0001', message = 'restore_import_failed';
    end if;

    restored_batch_id := (result->>'batch_id')::uuid;
    update public.migration_batches
       set source = 'backup_restore'
     where id = restored_batch_id;

    return result || jsonb_build_object('restored', true);
end;
$$;

revoke all on function public.restore_hub_backup(uuid, jsonb, text) from public, anon;
grant execute on function public.restore_hub_backup(uuid, jsonb, text) to authenticated;

comment on function public.restore_hub_backup(uuid, jsonb, text) is
    'Atomically replaces only the authenticated owner personal workspace with a validated Hub backup.';

commit;
