begin;

alter table public.error_entries
    add column review_state text not null default 'pending'
        check (review_state in ('pending', 'scheduled', 'mastered')),
    add column next_review_on date not null default current_date,
    add column last_reviewed_at timestamptz,
    add column last_retention_level text
        check (last_retention_level is null or last_retention_level in ('forgot', 'partial', 'mastered')),
    add column review_count integer not null default 0 check (review_count >= 0),
    add column reinforced_at timestamptz;

create index error_entries_user_due_idx
    on public.error_entries(workspace_id, user_id, next_review_on)
    where review_state <> 'mastered';

create table public.error_review_events (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    error_entry_id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    retention_level text not null check (retention_level in ('forgot', 'partial', 'mastered')),
    reviewed_at timestamptz not null default now(),
    next_review_on date not null,
    foreign key (error_entry_id, workspace_id)
        references public.error_entries(id, workspace_id) on delete cascade
);

create index error_review_events_entry_idx
    on public.error_review_events(workspace_id, user_id, error_entry_id, reviewed_at desc);

alter table public.error_review_events enable row level security;
alter table public.error_review_events force row level security;

create policy error_review_events_select_self on public.error_review_events
    for select to authenticated
    using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy error_review_events_insert_self on public.error_review_events
    for insert to authenticated
    with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy error_review_events_delete_self on public.error_review_events
    for delete to authenticated
    using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

grant select, insert, delete on table public.error_review_events to authenticated;

create or replace function public.record_error_review(
    target_workspace_id uuid,
    target_error_entry_id uuid,
    target_retention_level text,
    target_next_review_on date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    updated_entry public.error_entries%rowtype;
    review_event_id uuid;
    reviewed_at_value timestamptz := now();
begin
    if current_user_id is null then
        raise exception using errcode = '42501', message = 'authentication_required';
    end if;
    if target_retention_level not in ('forgot', 'partial', 'mastered') then
        raise exception using errcode = '22023', message = 'invalid_error_retention_level';
    end if;
    if target_next_review_on < current_date or target_next_review_on > current_date + 3650 then
        raise exception using errcode = '22023', message = 'invalid_error_next_review';
    end if;

    update public.error_entries entry
       set review_state = case when target_retention_level = 'mastered' then 'mastered' else 'scheduled' end,
           next_review_on = target_next_review_on,
           last_reviewed_at = reviewed_at_value,
           last_retention_level = target_retention_level,
           review_count = entry.review_count + 1
     where entry.id = target_error_entry_id
       and entry.workspace_id = target_workspace_id
       and entry.user_id = current_user_id
       and private.is_workspace_member(entry.workspace_id)
     returning entry.* into updated_entry;

    if updated_entry.id is null then
        raise exception using errcode = '42501', message = 'error_entry_not_found_or_forbidden';
    end if;

    insert into public.error_review_events (
        workspace_id, error_entry_id, user_id, retention_level, reviewed_at, next_review_on
    ) values (
        target_workspace_id, target_error_entry_id, current_user_id,
        target_retention_level, reviewed_at_value, target_next_review_on
    ) returning id into review_event_id;

    return jsonb_build_object(
        'reviewId', review_event_id,
        'reviewState', updated_entry.review_state,
        'nextReview', updated_entry.next_review_on,
        'lastReviewedAt', updated_entry.last_reviewed_at,
        'lastRetention', updated_entry.last_retention_level,
        'reviewCount', updated_entry.review_count
    );
end;
$$;

revoke all on function public.record_error_review(uuid, uuid, text, date) from public, anon;
grant execute on function public.record_error_review(uuid, uuid, text, date) to authenticated;

comment on function public.record_error_review(uuid, uuid, text, date) is
    'Atomically records a private error review and updates its next due date.';

alter function public.import_local_hub(uuid, jsonb, text)
    rename to import_local_hub_core_v6;

revoke all on function public.import_local_hub_core_v6(uuid, jsonb, text)
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
    review_record jsonb;
    mapped_error_id uuid;
    review_state_value text;
    next_review_value date;
    last_reviewed_value timestamptz;
    reinforced_value timestamptz;
    review_count_value integer;
begin
    result := public.import_local_hub_core_v6(target_workspace_id, payload, payload_checksum);
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

        review_state_value := case
            when error_record->>'estadoRevisao' in ('pending', 'scheduled', 'mastered') then error_record->>'estadoRevisao'
            else 'pending'
        end;
        next_review_value := case
            when coalesce(error_record->>'proximaRevisao', '') ~ '^\d{4}-\d{2}-\d{2}$' then (error_record->>'proximaRevisao')::date
            else current_date
        end;
        last_reviewed_value := case
            when nullif(error_record->>'ultimaRevisaoEm', '') is not null then (error_record->>'ultimaRevisaoEm')::timestamptz
            else null
        end;
        reinforced_value := case
            when nullif(error_record->>'reforcadoEm', '') is not null then (error_record->>'reforcadoEm')::timestamptz
            else null
        end;
        review_count_value := greatest(0, least(100000, coalesce((error_record->>'revisoes')::integer, 0)));

        update public.error_entries entry
           set review_state = review_state_value,
               next_review_on = next_review_value,
               last_reviewed_at = last_reviewed_value,
               last_retention_level = case when error_record->>'ultimaRetencao' in ('forgot', 'partial', 'mastered') then error_record->>'ultimaRetencao' else null end,
               review_count = review_count_value,
               reinforced_at = reinforced_value
         where entry.id = mapped_error_id
           and entry.workspace_id = target_workspace_id
           and entry.user_id = current_user_id;

        for review_record in select value from jsonb_array_elements(coalesce(error_record->'historicoRevisoes', '[]'::jsonb)) loop
            insert into public.error_review_events (
                id, workspace_id, error_entry_id, user_id, retention_level, reviewed_at, next_review_on
            ) values (
                case when coalesce(review_record->>'id', '') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
                    then (review_record->>'id')::uuid else gen_random_uuid() end,
                target_workspace_id,
                mapped_error_id,
                current_user_id,
                review_record->>'retention',
                (review_record->>'reviewedAt')::timestamptz,
                (review_record->>'nextReview')::date
            );
        end loop;
    end loop;

    return result || jsonb_build_object('error_reviews', (
        select count(*) from public.error_review_events event
         where event.workspace_id = target_workspace_id and event.user_id = current_user_id
    ));
end;
$$;

revoke all on function public.import_local_hub(uuid, jsonb, text) from public, anon;
grant execute on function public.import_local_hub(uuid, jsonb, text) to authenticated;

commit;
