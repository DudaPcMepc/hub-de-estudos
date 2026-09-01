begin;

create table public.user_vade_collection_sections (
    id uuid primary key default gen_random_uuid(),
    collection_id uuid not null,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null check (char_length(btrim(name)) between 1 and 120),
    position smallint not null default 0 check (position between 0 and 999),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (id, collection_id, workspace_id, user_id),
    foreign key (collection_id, workspace_id, user_id)
        references public.user_vade_collections(id, workspace_id, user_id) on delete cascade
);

alter table public.user_vade_collection_provisions
    add column section_id uuid references public.user_vade_collection_sections(id) on delete set null;

create index user_vade_collection_sections_order_idx
    on public.user_vade_collection_sections(user_id, workspace_id, collection_id, position);
create index user_vade_collection_provisions_section_idx
    on public.user_vade_collection_provisions(user_id, workspace_id, collection_id, section_id, position);

create trigger user_vade_collection_sections_set_updated_at
before update on public.user_vade_collection_sections
for each row execute function private.set_updated_at();

alter table public.user_vade_collection_sections enable row level security;
alter table public.user_vade_collection_sections force row level security;

create policy user_vade_collection_sections_select_self
on public.user_vade_collection_sections for select to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create or replace function public.create_user_vade_section(
    p_collection_id uuid,
    p_name text
)
returns table(saved_id uuid, saved_name text, saved_position integer, saved_created_at timestamptz, saved_updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    target_workspace_id uuid;
    clean_name text := btrim(coalesce(p_name, ''));
    next_position smallint;
begin
    if current_user_id is null then raise exception 'Sessão inválida.'; end if;
    if p_collection_id is null or char_length(clean_name) not between 1 and 120 then
        raise exception 'Caderno ou nome de seção inválidos.';
    end if;

    select collection.workspace_id into target_workspace_id
    from public.user_vade_collections as collection
    where collection.id = p_collection_id
      and collection.user_id = current_user_id
      and private.is_workspace_member(collection.workspace_id)
    for update;
    if target_workspace_id is null then raise exception 'Caderno jurídico não encontrado.'; end if;
    if (select count(*) from public.user_vade_collection_sections as section
        where section.collection_id = p_collection_id and section.user_id = current_user_id) >= 100 then
        raise exception 'Cada caderno pode conter no máximo 100 seções.';
    end if;

    select (coalesce(max(section.position), -1) + 1)::smallint into next_position
    from public.user_vade_collection_sections as section
    where section.collection_id = p_collection_id and section.user_id = current_user_id;

    return query
    insert into public.user_vade_collection_sections (collection_id, workspace_id, user_id, name, position)
    values (p_collection_id, target_workspace_id, current_user_id, clean_name, next_position)
    returning id, name, position::integer, created_at, updated_at;
end;
$$;

create or replace function public.rename_user_vade_section(
    p_section_id uuid,
    p_name text
)
returns table(saved_id uuid, saved_name text, saved_position integer, saved_created_at timestamptz, saved_updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    clean_name text := btrim(coalesce(p_name, ''));
begin
    if current_user_id is null then raise exception 'Sessão inválida.'; end if;
    if p_section_id is null or char_length(clean_name) not between 1 and 120 then
        raise exception 'Seção ou nome inválidos.';
    end if;

    return query
    update public.user_vade_collection_sections as section
    set name = clean_name
    where section.id = p_section_id
      and section.user_id = current_user_id
      and private.is_workspace_member(section.workspace_id)
    returning section.id, section.name, section.position::integer, section.created_at, section.updated_at;

    if not found then raise exception 'Seção não encontrada.'; end if;
end;
$$;

create or replace function public.delete_user_vade_section(p_section_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    affected_count integer;
begin
    if current_user_id is null then raise exception 'Sessão inválida.'; end if;
    if p_section_id is null then raise exception 'Seção inválida.'; end if;

    delete from public.user_vade_collection_sections as section
    where section.id = p_section_id
      and section.user_id = current_user_id
      and private.is_workspace_member(section.workspace_id);
    get diagnostics affected_count = row_count;
    if affected_count <> 1 then raise exception 'Seção não encontrada.'; end if;
    return true;
end;
$$;

create or replace function public.replace_user_vade_section_order(
    p_collection_id uuid,
    p_section_ids uuid[]
)
returns table(saved_section_id uuid, saved_position integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    target_workspace_id uuid;
    requested_count integer := coalesce(cardinality(p_section_ids), 0);
    existing_count integer;
begin
    if current_user_id is null then raise exception 'Sessão inválida.'; end if;
    if p_collection_id is null or p_section_ids is null or requested_count > 100 then
        raise exception 'Caderno ou ordem de seções inválidos.';
    end if;
    if requested_count <> (select count(distinct requested_id) from unnest(p_section_ids) as requested(requested_id)) then
        raise exception 'A ordem contém seções repetidas.';
    end if;

    select collection.workspace_id into target_workspace_id
    from public.user_vade_collections as collection
    where collection.id = p_collection_id
      and collection.user_id = current_user_id
      and private.is_workspace_member(collection.workspace_id)
    for update;
    if target_workspace_id is null then raise exception 'Caderno jurídico não encontrado.'; end if;

    select count(*) into existing_count
    from public.user_vade_collection_sections as section
    where section.collection_id = p_collection_id
      and section.workspace_id = target_workspace_id
      and section.user_id = current_user_id;
    if requested_count <> existing_count or requested_count <> (
        select count(*) from public.user_vade_collection_sections as section
        where section.collection_id = p_collection_id
          and section.workspace_id = target_workspace_id
          and section.user_id = current_user_id
          and section.id = any(p_section_ids)
    ) then
        raise exception 'A ordem precisa conter exatamente as seções atuais do caderno.';
    end if;

    update public.user_vade_collection_sections as section
    set position = (requested.ordinality - 1)::smallint
    from unnest(p_section_ids) with ordinality as requested(section_id, ordinality)
    where section.id = requested.section_id
      and section.collection_id = p_collection_id
      and section.workspace_id = target_workspace_id
      and section.user_id = current_user_id;

    return query
    select section.id, section.position::integer
    from public.user_vade_collection_sections as section
    where section.collection_id = p_collection_id
      and section.workspace_id = target_workspace_id
      and section.user_id = current_user_id
    order by section.position;
end;
$$;

create or replace function public.set_user_vade_provision_section(
    p_collection_id uuid,
    p_provision_id uuid,
    p_section_id uuid default null
)
returns table(saved_provision_id uuid, saved_section_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    target_workspace_id uuid;
begin
    if current_user_id is null then raise exception 'Sessão inválida.'; end if;
    if p_collection_id is null or p_provision_id is null then raise exception 'Caderno ou artigo inválidos.'; end if;

    select collection.workspace_id into target_workspace_id
    from public.user_vade_collections as collection
    where collection.id = p_collection_id
      and collection.user_id = current_user_id
      and private.is_workspace_member(collection.workspace_id);
    if target_workspace_id is null then raise exception 'Caderno jurídico não encontrado.'; end if;

    if p_section_id is not null and not exists (
        select 1 from public.user_vade_collection_sections as section
        where section.id = p_section_id
          and section.collection_id = p_collection_id
          and section.workspace_id = target_workspace_id
          and section.user_id = current_user_id
    ) then
        raise exception 'A seção não pertence a este caderno.';
    end if;

    return query
    update public.user_vade_collection_provisions as item
    set section_id = p_section_id
    where item.collection_id = p_collection_id
      and item.workspace_id = target_workspace_id
      and item.user_id = current_user_id
      and item.provision_id = p_provision_id
    returning item.provision_id, item.section_id;
    if not found then raise exception 'Artigo não encontrado neste caderno.'; end if;
end;
$$;

revoke all on table public.user_vade_collection_sections from public, anon, authenticated;
revoke all on function public.create_user_vade_section(uuid, text) from public, anon, authenticated;
revoke all on function public.rename_user_vade_section(uuid, text) from public, anon, authenticated;
revoke all on function public.delete_user_vade_section(uuid) from public, anon, authenticated;
revoke all on function public.replace_user_vade_section_order(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.set_user_vade_provision_section(uuid, uuid, uuid) from public, anon, authenticated;

grant select on table public.user_vade_collection_sections to authenticated;
grant execute on function public.create_user_vade_section(uuid, text) to authenticated;
grant execute on function public.rename_user_vade_section(uuid, text) to authenticated;
grant execute on function public.delete_user_vade_section(uuid) to authenticated;
grant execute on function public.replace_user_vade_section_order(uuid, uuid[]) to authenticated;
grant execute on function public.set_user_vade_provision_section(uuid, uuid, uuid) to authenticated;

comment on table public.user_vade_collection_sections is
    'Seções privadas usadas pelo usuário para organizar artigos dentro de um Caderno jurídico.';
comment on column public.user_vade_collection_provisions.section_id is
    'Seção privada opcional à qual o artigo salvo está associado.';

commit;
