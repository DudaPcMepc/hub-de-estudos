begin;

create table public.user_vade_collections (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null check (char_length(btrim(name)) between 1 and 120),
    description text not null default '' check (char_length(description) <= 1000),
    position smallint not null default 0 check (position between 0 and 1000),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (id, workspace_id, user_id)
);

create table public.user_vade_collection_documents (
    collection_id uuid not null,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    document_id uuid not null references public.legal_documents(id) on delete restrict,
    position smallint not null check (position between 0 and 99),
    added_at timestamptz not null default now(),
    primary key (collection_id, document_id),
    foreign key (collection_id, workspace_id, user_id)
        references public.user_vade_collections(id, workspace_id, user_id) on delete cascade
);

create index user_vade_collections_lookup_idx
    on public.user_vade_collections(user_id, workspace_id, position, created_at);
create index user_vade_collection_documents_order_idx
    on public.user_vade_collection_documents(user_id, workspace_id, collection_id, position);

create trigger user_vade_collections_set_updated_at
before update on public.user_vade_collections
for each row execute function private.set_updated_at();

alter table public.user_vade_collections enable row level security;
alter table public.user_vade_collections force row level security;
alter table public.user_vade_collection_documents enable row level security;
alter table public.user_vade_collection_documents force row level security;

create policy user_vade_collections_select_self
on public.user_vade_collections for select to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy user_vade_collections_insert_self
on public.user_vade_collections for insert to authenticated
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy user_vade_collections_update_self
on public.user_vade_collections for update to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id))
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy user_vade_collections_delete_self
on public.user_vade_collections for delete to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy user_vade_collection_documents_select_self
on public.user_vade_collection_documents for select to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create or replace function public.replace_user_vade_documents(
    p_collection_id uuid,
    p_document_ids uuid[] default '{}'::uuid[]
)
returns table(saved_document_id uuid, saved_position integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    target_workspace_id uuid;
    requested_count integer := coalesce(cardinality(p_document_ids), 0);
begin
    if current_user_id is null then
        raise exception 'Sessão inválida.';
    end if;
    if p_collection_id is null or p_document_ids is null then
        raise exception 'Coleção ou documentos inválidos.';
    end if;
    if requested_count > 100 then
        raise exception 'Cada Vade Mecum pode conter no máximo 100 normas.';
    end if;
    if requested_count <> (
        select count(distinct requested_document_id)
        from unnest(p_document_ids) as requested(requested_document_id)
    ) then
        raise exception 'A lista contém documentos repetidos.';
    end if;

    select collection.workspace_id
    into target_workspace_id
    from public.user_vade_collections as collection
    where collection.id = p_collection_id
      and collection.user_id = current_user_id
      and private.is_workspace_member(collection.workspace_id)
    for update;

    if target_workspace_id is null then
        raise exception 'Vade Mecum não encontrado para este usuário.';
    end if;
    if requested_count <> (
        select count(*)
        from public.legal_documents as document
        where document.id = any(p_document_ids)
          and document.active = true
    ) then
        raise exception 'A lista contém uma norma indisponível.';
    end if;

    delete from public.user_vade_collection_documents as item
    where item.collection_id = p_collection_id
      and item.workspace_id = target_workspace_id
      and item.user_id = current_user_id;

    insert into public.user_vade_collection_documents (
        collection_id, workspace_id, user_id, document_id, position
    )
    select
        p_collection_id,
        target_workspace_id,
        current_user_id,
        requested.document_id,
        (requested.ordinality - 1)::smallint
    from unnest(p_document_ids) with ordinality as requested(document_id, ordinality);

    return query
    select item.document_id, item.position::integer
    from public.user_vade_collection_documents as item
    where item.collection_id = p_collection_id
      and item.workspace_id = target_workspace_id
      and item.user_id = current_user_id
    order by item.position;
end;
$$;

revoke all on table public.user_vade_collections from public, anon, authenticated;
revoke all on table public.user_vade_collection_documents from public, anon, authenticated;
revoke all on function public.replace_user_vade_documents(uuid, uuid[]) from public, anon, authenticated;

grant select, insert, update, delete on table public.user_vade_collections to authenticated;
grant select on table public.user_vade_collection_documents to authenticated;
grant execute on function public.replace_user_vade_documents(uuid, uuid[]) to authenticated;

comment on table public.user_vade_collections is
    'Cadernos pessoais de Vade Mecum, isolados por usuário e espaço de estudos.';
comment on table public.user_vade_collection_documents is
    'Normas oficiais ordenadas dentro de cada Vade Mecum pessoal.';
comment on function public.replace_user_vade_documents(uuid, uuid[]) is
    'Substitui atomicamente a lista de normas de um Vade Mecum após validar usuário, espaço, limites e documentos ativos.';

commit;
