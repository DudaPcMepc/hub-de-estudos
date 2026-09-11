begin;

create table public.quiz_filter_presets (
    id uuid primary key,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    name varchar(100) not null,
    subject_ref varchar(100) not null,
    exam_topic_ref varchar(100) not null default '',
    topic varchar(240) not null default '',
    board_name varchar(120) not null default '',
    difficulty text not null check (difficulty in ('Fácil', 'Médio', 'Difícil')),
    question_count smallint not null check (question_count in (3, 5, 10)),
    source text not null check (source in ('ia', 'historico', 'erros')),
    question_profile text not null check (question_profile in ('todas', 'erradas', 'nao_respondidas')),
    history_days smallint check (history_days is null or history_days in (7, 30, 90)),
    avoid_recent_correct boolean not null default true,
    position smallint not null check (position between 0 and 11),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (workspace_id, user_id, position)
);

create index quiz_filter_presets_owner_idx
    on public.quiz_filter_presets(workspace_id, user_id, position);

alter table public.quiz_filter_presets enable row level security;
alter table public.quiz_filter_presets force row level security;

create policy quiz_filter_presets_select_self on public.quiz_filter_presets
    for select to authenticated
    using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy quiz_filter_presets_insert_self on public.quiz_filter_presets
    for insert to authenticated
    with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy quiz_filter_presets_update_self on public.quiz_filter_presets
    for update to authenticated
    using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id))
    with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy quiz_filter_presets_delete_self on public.quiz_filter_presets
    for delete to authenticated
    using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

grant select, insert, update, delete on table public.quiz_filter_presets to authenticated;

create or replace function public.replace_quiz_filter_presets(
    target_workspace_id uuid,
    target_presets jsonb
)
returns setof public.quiz_filter_presets
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    preset jsonb;
    preset_index integer := 0;
    preset_id uuid;
    history_days_value smallint;
begin
    if current_user_id is null then
        raise exception using errcode = '42501', message = 'authentication_required';
    end if;
    if not private.is_workspace_member(target_workspace_id) then
        raise exception using errcode = '42501', message = 'workspace_access_denied';
    end if;
    if target_presets is null or jsonb_typeof(target_presets) <> 'array' or jsonb_array_length(target_presets) > 12 then
        raise exception using errcode = '22023', message = 'invalid_quiz_filter_presets';
    end if;

    delete from public.quiz_filter_presets saved
     where saved.workspace_id = target_workspace_id
       and saved.user_id = current_user_id;

    for preset in select value from jsonb_array_elements(target_presets) loop
        if jsonb_typeof(preset) <> 'object'
            or coalesce(preset->>'id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
            or length(coalesce(preset->>'nome', '')) > 100
            or length(coalesce(preset->>'materiaId', '')) not between 1 and 100
            or length(coalesce(preset->>'topicoEditalId', '')) > 100
            or length(coalesce(preset->>'tema', '')) > 240
            or length(coalesce(preset->>'banca', '')) > 120
            or coalesce(preset->>'dificuldade', '') not in ('Fácil', 'Médio', 'Difícil')
            or coalesce(preset->>'quantidade', '') not in ('3', '5', '10')
            or coalesce(preset->>'origem', '') not in ('ia', 'historico', 'erros')
            or coalesce(preset->>'perfil', '') not in ('todas', 'erradas', 'nao_respondidas')
            or coalesce(preset->>'periodoDias', '') not in ('', '7', '30', '90') then
            raise exception using errcode = '22023', message = 'invalid_quiz_filter_preset';
        end if;

        preset_id := (preset->>'id')::uuid;
        history_days_value := case when coalesce(preset->>'periodoDias', '') = '' then null else (preset->>'periodoDias')::smallint end;
        insert into public.quiz_filter_presets (
            id, workspace_id, user_id, name, subject_ref, exam_topic_ref, topic,
            board_name, difficulty, question_count, source, question_profile,
            history_days, avoid_recent_correct, position
        ) values (
            preset_id, target_workspace_id, current_user_id,
            coalesce(nullif(preset->>'nome', ''), 'Filtro de simulado'),
            preset->>'materiaId', coalesce(preset->>'topicoEditalId', ''),
            coalesce(preset->>'tema', ''), coalesce(preset->>'banca', ''),
            preset->>'dificuldade', (preset->>'quantidade')::smallint,
            preset->>'origem', preset->>'perfil', history_days_value,
            coalesce((preset->>'evitarAcertadasRecentes')::boolean, true), preset_index
        );
        preset_index := preset_index + 1;
    end loop;

    return query
        select saved.* from public.quiz_filter_presets saved
         where saved.workspace_id = target_workspace_id
           and saved.user_id = current_user_id
         order by saved.position;
end;
$$;

revoke all on function public.replace_quiz_filter_presets(uuid, jsonb) from public, anon;
grant execute on function public.replace_quiz_filter_presets(uuid, jsonb) to authenticated;

alter function public.restore_hub_backup(uuid, jsonb, text)
    rename to restore_hub_backup_core_v2;
revoke all on function public.restore_hub_backup_core_v2(uuid, jsonb, text)
    from public, anon, authenticated;

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
    result jsonb;
begin
    result := public.restore_hub_backup_core_v2(target_workspace_id, payload, payload_checksum);
    if coalesce(result->>'status', '') <> 'concluido' or coalesce((result->>'restored')::boolean, false) is not true then
        raise exception using errcode = 'P0001', message = 'restore_import_failed';
    end if;

    perform public.replace_quiz_filter_presets(
        target_workspace_id,
        coalesce(payload->'filtrosSimuladoSalvos', '[]'::jsonb)
    );
    return result || jsonb_build_object('quiz_filter_presets', jsonb_array_length(coalesce(payload->'filtrosSimuladoSalvos', '[]'::jsonb)));
end;
$$;

revoke all on function public.restore_hub_backup(uuid, jsonb, text) from public, anon;
grant execute on function public.restore_hub_backup(uuid, jsonb, text) to authenticated;

comment on table public.quiz_filter_presets is
    'Private, reusable quiz filter combinations synchronized per authenticated user.';
comment on function public.replace_quiz_filter_presets(uuid, jsonb) is
    'Atomically replaces up to twelve private quiz filter presets for the authenticated user.';

commit;
