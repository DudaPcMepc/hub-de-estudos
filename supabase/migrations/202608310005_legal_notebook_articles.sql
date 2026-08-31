begin;

create table public.user_vade_collection_provisions (
    collection_id uuid not null,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    document_id uuid not null references public.legal_documents(id) on delete restrict,
    provision_id uuid not null references public.legal_provisions(id) on delete cascade,
    position integer not null default 0 check (position between 0 and 9999),
    added_at timestamptz not null default now(),
    primary key (collection_id, provision_id),
    foreign key (collection_id, workspace_id, user_id)
        references public.user_vade_collections(id, workspace_id, user_id) on delete cascade
);

create index user_vade_collection_provisions_order_idx
    on public.user_vade_collection_provisions(user_id, workspace_id, collection_id, document_id, position);

alter table public.user_vade_collection_provisions enable row level security;
alter table public.user_vade_collection_provisions force row level security;

create policy user_vade_collection_provisions_select_self
on public.user_vade_collection_provisions for select to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create or replace function public.set_user_vade_provision(
    p_collection_id uuid,
    p_provision_id uuid,
    p_save boolean default true
)
returns table(
    saved_collection_id uuid,
    saved_document_id uuid,
    saved_provision_id uuid,
    saved_position integer,
    saved_added_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    target_workspace_id uuid;
    target_document_id uuid;
    next_position integer;
begin
    if current_user_id is null then
        raise exception 'Sessão inválida.';
    end if;
    if p_collection_id is null or p_provision_id is null or p_save is null then
        raise exception 'Caderno, artigo ou operação inválidos.';
    end if;

    select collection.workspace_id
    into target_workspace_id
    from public.user_vade_collections as collection
    where collection.id = p_collection_id
      and collection.user_id = current_user_id
      and private.is_workspace_member(collection.workspace_id)
    for update;

    if target_workspace_id is null then
        raise exception 'Caderno jurídico não encontrado para este usuário.';
    end if;

    select document.id
    into target_document_id
    from public.legal_provisions as provision
    join public.legal_document_versions as version on version.id = provision.version_id
    join public.legal_documents as document
      on document.id = version.document_id
     and document.current_version_id = version.id
     and document.active = true
    where provision.id = p_provision_id;

    if target_document_id is null then
        raise exception 'Este artigo não pertence à versão oficial disponível.';
    end if;

    if not p_save then
        delete from public.user_vade_collection_provisions as item
        where item.collection_id = p_collection_id
          and item.workspace_id = target_workspace_id
          and item.user_id = current_user_id
          and item.provision_id = p_provision_id;
        return;
    end if;

    if not exists (
        select 1
        from public.user_vade_collection_provisions as item
        where item.collection_id = p_collection_id
          and item.user_id = current_user_id
          and item.provision_id = p_provision_id
    ) and (
        select count(*)
        from public.user_vade_collection_provisions as item
        where item.collection_id = p_collection_id
          and item.user_id = current_user_id
    ) >= 500 then
        raise exception 'Cada caderno pode conter no máximo 500 artigos.';
    end if;

    select coalesce(max(item.position), -1) + 1
    into next_position
    from public.user_vade_collection_provisions as item
    where item.collection_id = p_collection_id
      and item.user_id = current_user_id;

    insert into public.user_vade_collection_provisions (
        collection_id, workspace_id, user_id, document_id, provision_id, position
    ) values (
        p_collection_id, target_workspace_id, current_user_id,
        target_document_id, p_provision_id, next_position
    )
    on conflict (collection_id, provision_id) do nothing;

    return query
    select
        item.collection_id,
        item.document_id,
        item.provision_id,
        item.position,
        item.added_at
    from public.user_vade_collection_provisions as item
    where item.collection_id = p_collection_id
      and item.workspace_id = target_workspace_id
      and item.user_id = current_user_id
      and item.provision_id = p_provision_id;
end;
$$;

revoke all on table public.user_vade_collection_provisions from public, anon, authenticated;
revoke all on function public.set_user_vade_provision(uuid, uuid, boolean) from public, anon, authenticated;

grant select on table public.user_vade_collection_provisions to authenticated;
grant execute on function public.set_user_vade_provision(uuid, uuid, boolean) to authenticated;

comment on table public.user_vade_collection_provisions is
    'Artigos oficiais salvos em cadernos jurídicos privados e isolados por usuário.';
comment on function public.set_user_vade_provision(uuid, uuid, boolean) is
    'Adiciona ou remove um artigo da versão oficial atual em um caderno pertencente ao usuário autenticado.';

commit;
