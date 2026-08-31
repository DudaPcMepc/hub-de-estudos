begin;

create table public.user_mind_maps (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    subject_id uuid,
    name text not null check (char_length(btrim(name)) between 1 and 120),
    description text not null default '' check (char_length(description) <= 1000),
    viewport jsonb not null default '{"x":0,"y":0,"zoom":1}'::jsonb
        check (jsonb_typeof(viewport) = 'object' and octet_length(viewport::text) <= 20000),
    version integer not null default 1 check (version > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (subject_id, workspace_id)
        references public.subjects(id, workspace_id) on delete cascade,
    unique (id, workspace_id, user_id)
);

create table public.user_mind_map_elements (
    id uuid primary key,
    map_id uuid not null,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    element_type text not null check (element_type in ('node', 'edge', 'shape', 'stroke')),
    payload jsonb not null
        check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 100000),
    z_index integer not null default 0 check (z_index between 0 and 5000),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (map_id, workspace_id, user_id)
        references public.user_mind_maps(id, workspace_id, user_id) on delete cascade
);

create index user_mind_maps_lookup_idx
    on public.user_mind_maps(user_id, workspace_id, subject_id, updated_at desc);
create index user_mind_map_elements_order_idx
    on public.user_mind_map_elements(user_id, workspace_id, map_id, z_index, created_at);

create or replace function private.bump_user_mind_map_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    new.version := old.version + 1;
    new.updated_at := now();
    return new;
end;
$$;

create trigger user_mind_maps_bump_version
before update on public.user_mind_maps
for each row execute function private.bump_user_mind_map_version();

create trigger user_mind_map_elements_set_updated_at
before update on public.user_mind_map_elements
for each row execute function private.set_updated_at();

alter table public.user_mind_maps enable row level security;
alter table public.user_mind_maps force row level security;
alter table public.user_mind_map_elements enable row level security;
alter table public.user_mind_map_elements force row level security;

create policy user_mind_maps_select_self
on public.user_mind_maps for select to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy user_mind_maps_insert_self
on public.user_mind_maps for insert to authenticated
with check (
    user_id = (select auth.uid())
    and private.is_workspace_member(workspace_id)
    and (subject_id is null or exists (
        select 1 from public.subjects as subject
        where subject.id = user_mind_maps.subject_id
          and subject.workspace_id = user_mind_maps.workspace_id
    ))
);

create policy user_mind_maps_update_self
on public.user_mind_maps for update to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id))
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy user_mind_maps_delete_self
on public.user_mind_maps for delete to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy user_mind_map_elements_select_self
on public.user_mind_map_elements for select to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create or replace function public.replace_user_mind_map_elements(
    p_map_id uuid,
    p_expected_version integer,
    p_elements jsonb default '[]'::jsonb,
    p_viewport jsonb default '{"x":0,"y":0,"zoom":1}'::jsonb
)
returns table(saved_version integer, saved_updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    target_map public.user_mind_maps%rowtype;
    saved_map public.user_mind_maps%rowtype;
    element_count integer;
begin
    if current_user_id is null then raise exception 'Sessão inválida.'; end if;
    if p_map_id is null or p_expected_version is null or p_expected_version < 1 then
        raise exception 'Mapa ou versão inválidos.';
    end if;
    if p_elements is null or jsonb_typeof(p_elements) <> 'array' then
        raise exception 'A lista de elementos é inválida.';
    end if;
    if p_viewport is null or jsonb_typeof(p_viewport) <> 'object' or octet_length(p_viewport::text) > 20000 then
        raise exception 'A visualização do mapa é inválida.';
    end if;
    if octet_length(p_elements::text) > 2000000 then
        raise exception 'O mapa ultrapassa o limite seguro de 2 MB.';
    end if;

    element_count := jsonb_array_length(p_elements);
    if element_count > 500 then raise exception 'Cada mapa pode conter no máximo 500 elementos.'; end if;

    if exists (
        select 1 from jsonb_array_elements(p_elements) as source(item)
        where not (
            source.item ? 'id'
            and source.item ? 'type'
            and source.item ? 'payload'
            and (source.item->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            and source.item->>'type' in ('node', 'edge', 'shape', 'stroke')
            and jsonb_typeof(source.item->'payload') = 'object'
            and octet_length((source.item->'payload')::text) <= 100000
            and case
                when coalesce(source.item->>'zIndex', '0') ~ '^[0-9]{1,4}$'
                then coalesce((source.item->>'zIndex')::integer, 0) between 0 and 5000
                else false
            end
        )
    ) then
        raise exception 'O mapa contém elementos inválidos.';
    end if;

    if element_count <> (
        select count(distinct source.item->>'id')
        from jsonb_array_elements(p_elements) as source(item)
    ) then
        raise exception 'O mapa contém elementos repetidos.';
    end if;

    select map.* into target_map
    from public.user_mind_maps as map
    where map.id = p_map_id
      and map.user_id = current_user_id
      and private.is_workspace_member(map.workspace_id)
    for update;

    if not found then raise exception 'Mapa não encontrado para este usuário.'; end if;
    if target_map.version <> p_expected_version then
        raise exception 'Este mapa foi alterado em outra aba. Atualize antes de continuar.';
    end if;

    delete from public.user_mind_map_elements as element
    where element.map_id = target_map.id
      and element.workspace_id = target_map.workspace_id
      and element.user_id = current_user_id;

    insert into public.user_mind_map_elements (
        id, map_id, workspace_id, user_id, element_type, payload, z_index
    )
    select
        (source.item->>'id')::uuid,
        target_map.id,
        target_map.workspace_id,
        current_user_id,
        source.item->>'type',
        source.item->'payload',
        coalesce((source.item->>'zIndex')::integer, 0)
    from jsonb_array_elements(p_elements) as source(item);

    update public.user_mind_maps as map
    set viewport = p_viewport
    where map.id = target_map.id
      and map.workspace_id = target_map.workspace_id
      and map.user_id = current_user_id
    returning map.* into saved_map;

    return query select saved_map.version, saved_map.updated_at;
end;
$$;

revoke all on table public.user_mind_maps from public, anon, authenticated;
revoke all on table public.user_mind_map_elements from public, anon, authenticated;
revoke all on function public.replace_user_mind_map_elements(uuid, integer, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.bump_user_mind_map_version() from public, anon, authenticated;

grant select, insert, update, delete on table public.user_mind_maps to authenticated;
grant select on table public.user_mind_map_elements to authenticated;
grant execute on function public.replace_user_mind_map_elements(uuid, integer, jsonb, jsonb) to authenticated;

comment on table public.user_mind_maps is
    'Mapas mentais privados por usuário, vinculados opcionalmente a uma matéria.';
comment on table public.user_mind_map_elements is
    'Nós, conexões, formas e traços pertencentes a um mapa mental privado.';
comment on function public.replace_user_mind_map_elements(uuid, integer, jsonb, jsonb) is
    'Salva atomicamente um mapa mental após validar usuário, versão, limites e estrutura dos elementos.';

commit;
