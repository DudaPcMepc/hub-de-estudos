begin;

alter table public.user_vade_collection_provisions
    add column reviewed_at timestamptz;

alter table public.user_vade_collections
    add column last_provision_id uuid references public.legal_provisions(id) on delete set null;

create or replace function public.set_user_vade_provision_review(
    p_collection_id uuid,
    p_provision_id uuid,
    p_reviewed boolean
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    review_time timestamptz := case when p_reviewed then now() else null end;
    affected_count integer;
begin
    if current_user_id is null then raise exception 'Sessão inválida.'; end if;
    if p_collection_id is null or p_provision_id is null or p_reviewed is null then
        raise exception 'Caderno, artigo ou revisão inválidos.';
    end if;

    update public.user_vade_collection_provisions as item
    set reviewed_at = review_time
    where item.collection_id = p_collection_id
      and item.provision_id = p_provision_id
      and item.user_id = current_user_id
      and private.is_workspace_member(item.workspace_id);
    get diagnostics affected_count = row_count;

    if affected_count <> 1 then
        raise exception 'Artigo não encontrado neste caderno.';
    end if;
    return review_time;
end;
$$;

create or replace function public.replace_user_vade_provision_order(
    p_collection_id uuid,
    p_provision_ids uuid[]
)
returns table(saved_provision_id uuid, saved_position integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    target_workspace_id uuid;
    requested_count integer := coalesce(cardinality(p_provision_ids), 0);
    existing_count integer;
begin
    if current_user_id is null then raise exception 'Sessão inválida.'; end if;
    if p_collection_id is null or p_provision_ids is null then
        raise exception 'Caderno ou ordem inválidos.';
    end if;
    if requested_count > 500 then raise exception 'Cada caderno pode conter no máximo 500 artigos.'; end if;
    if requested_count <> (
        select count(distinct requested_id)
        from unnest(p_provision_ids) as requested(requested_id)
    ) then
        raise exception 'A ordem contém artigos repetidos.';
    end if;

    select collection.workspace_id
    into target_workspace_id
    from public.user_vade_collections as collection
    where collection.id = p_collection_id
      and collection.user_id = current_user_id
      and private.is_workspace_member(collection.workspace_id)
    for update;

    if target_workspace_id is null then raise exception 'Caderno jurídico não encontrado.'; end if;

    select count(*)
    into existing_count
    from public.user_vade_collection_provisions as item
    where item.collection_id = p_collection_id
      and item.workspace_id = target_workspace_id
      and item.user_id = current_user_id;

    if requested_count <> existing_count or requested_count <> (
        select count(*)
        from public.user_vade_collection_provisions as item
        where item.collection_id = p_collection_id
          and item.workspace_id = target_workspace_id
          and item.user_id = current_user_id
          and item.provision_id = any(p_provision_ids)
    ) then
        raise exception 'A ordem precisa conter exatamente os artigos atuais do caderno.';
    end if;

    update public.user_vade_collection_provisions as item
    set position = (requested.ordinality - 1)::integer
    from unnest(p_provision_ids) with ordinality as requested(provision_id, ordinality)
    where item.collection_id = p_collection_id
      and item.workspace_id = target_workspace_id
      and item.user_id = current_user_id
      and item.provision_id = requested.provision_id;

    return query
    select item.provision_id, item.position
    from public.user_vade_collection_provisions as item
    where item.collection_id = p_collection_id
      and item.workspace_id = target_workspace_id
      and item.user_id = current_user_id
    order by item.position;
end;
$$;

create or replace function public.remember_user_vade_provision(
    p_collection_id uuid,
    p_provision_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    affected_count integer;
begin
    if current_user_id is null then raise exception 'Sessão inválida.'; end if;
    if p_collection_id is null or p_provision_id is null then
        raise exception 'Caderno ou artigo inválidos.';
    end if;

    update public.user_vade_collections as collection
    set last_provision_id = p_provision_id
    where collection.id = p_collection_id
      and collection.user_id = current_user_id
      and private.is_workspace_member(collection.workspace_id)
      and exists (
          select 1
          from public.user_vade_collection_provisions as item
          where item.collection_id = collection.id
            and item.workspace_id = collection.workspace_id
            and item.user_id = current_user_id
            and item.provision_id = p_provision_id
      );
    get diagnostics affected_count = row_count;

    if affected_count <> 1 then
        raise exception 'Artigo não encontrado neste caderno.';
    end if;
    return p_provision_id;
end;
$$;

create or replace function private.clear_removed_user_vade_last_provision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.user_vade_collections as collection
    set last_provision_id = null
    where collection.id = old.collection_id
      and collection.user_id = old.user_id
      and collection.workspace_id = old.workspace_id
      and collection.last_provision_id = old.provision_id;
    return old;
end;
$$;

drop trigger if exists clear_removed_user_vade_last_provision on public.user_vade_collection_provisions;
create trigger clear_removed_user_vade_last_provision
after delete on public.user_vade_collection_provisions
for each row execute function private.clear_removed_user_vade_last_provision();

revoke all on function public.set_user_vade_provision_review(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.replace_user_vade_provision_order(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.remember_user_vade_provision(uuid, uuid) from public, anon, authenticated;

grant execute on function public.set_user_vade_provision_review(uuid, uuid, boolean) to authenticated;
grant execute on function public.replace_user_vade_provision_order(uuid, uuid[]) to authenticated;
grant execute on function public.remember_user_vade_provision(uuid, uuid) to authenticated;

comment on column public.user_vade_collection_provisions.reviewed_at is
    'Momento da última marcação pessoal de revisão; nulo significa pendente.';
comment on column public.user_vade_collections.last_provision_id is
    'Último artigo aberto pelo usuário no modo de revisão deste caderno.';

commit;
