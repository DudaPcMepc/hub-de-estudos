begin;

create or replace function public.set_user_vade_provisions_review(
    p_collection_id uuid,
    p_provision_ids uuid[],
    p_reviewed boolean
)
returns table(saved_provision_id uuid, saved_reviewed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    target_workspace_id uuid;
    requested_count integer := coalesce(cardinality(p_provision_ids), 0);
    review_time timestamptz := case when p_reviewed then now() else null end;
begin
    if current_user_id is null then raise exception 'Sessão inválida.'; end if;
    if p_collection_id is null or p_provision_ids is null or p_reviewed is null then
        raise exception 'Caderno, artigos ou revisão inválidos.';
    end if;
    if requested_count < 1 or requested_count > 500 then
        raise exception 'Selecione entre 1 e 500 artigos.';
    end if;
    if requested_count <> (select count(distinct requested_id) from unnest(p_provision_ids) requested(requested_id)) then
        raise exception 'A seleção contém artigos inválidos ou repetidos.';
    end if;

    select collection.workspace_id into target_workspace_id
    from public.user_vade_collections collection
    where collection.id = p_collection_id
      and collection.user_id = current_user_id
      and private.is_workspace_member(collection.workspace_id)
    for update;
    if target_workspace_id is null then raise exception 'Caderno jurídico não encontrado.'; end if;

    if requested_count <> (
        select count(*) from public.user_vade_collection_provisions item
        where item.collection_id = p_collection_id
          and item.workspace_id = target_workspace_id
          and item.user_id = current_user_id
          and item.provision_id = any(p_provision_ids)
    ) then
        raise exception 'Um ou mais artigos não pertencem a este caderno.';
    end if;

    return query
    update public.user_vade_collection_provisions item
    set reviewed_at = review_time
    where item.collection_id = p_collection_id
      and item.workspace_id = target_workspace_id
      and item.user_id = current_user_id
      and item.provision_id = any(p_provision_ids)
    returning item.provision_id, item.reviewed_at;
end;
$$;

create or replace function public.set_user_vade_provisions_section(
    p_collection_id uuid,
    p_provision_ids uuid[],
    p_section_id uuid default null
)
returns table(saved_provision_id uuid, saved_section_id uuid, saved_position integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    target_workspace_id uuid;
    requested_count integer := coalesce(cardinality(p_provision_ids), 0);
    next_position integer;
begin
    if current_user_id is null then raise exception 'Sessão inválida.'; end if;
    if p_collection_id is null or p_provision_ids is null then raise exception 'Caderno ou artigos inválidos.'; end if;
    if requested_count < 1 or requested_count > 500 then raise exception 'Selecione entre 1 e 500 artigos.'; end if;
    if requested_count <> (select count(distinct requested_id) from unnest(p_provision_ids) requested(requested_id)) then
        raise exception 'A seleção contém artigos inválidos ou repetidos.';
    end if;

    select collection.workspace_id into target_workspace_id
    from public.user_vade_collections collection
    where collection.id = p_collection_id
      and collection.user_id = current_user_id
      and private.is_workspace_member(collection.workspace_id)
    for update;
    if target_workspace_id is null then raise exception 'Caderno jurídico não encontrado.'; end if;

    if p_section_id is not null and not exists (
        select 1 from public.user_vade_collection_sections section
        where section.id = p_section_id
          and section.collection_id = p_collection_id
          and section.workspace_id = target_workspace_id
          and section.user_id = current_user_id
    ) then
        raise exception 'A seção não pertence a este caderno.';
    end if;
    if requested_count <> (
        select count(*) from public.user_vade_collection_provisions item
        where item.collection_id = p_collection_id
          and item.workspace_id = target_workspace_id
          and item.user_id = current_user_id
          and item.provision_id = any(p_provision_ids)
    ) then
        raise exception 'Um ou mais artigos não pertencem a este caderno.';
    end if;

    select coalesce(max(item.position), -1) + 1 into next_position
    from public.user_vade_collection_provisions item
    where item.collection_id = p_collection_id
      and item.workspace_id = target_workspace_id
      and item.user_id = current_user_id;

    return query
    update public.user_vade_collection_provisions item
    set section_id = p_section_id,
        position = (next_position + requested.ordinality - 1)::integer
    from unnest(p_provision_ids) with ordinality requested(provision_id, ordinality)
    where item.collection_id = p_collection_id
      and item.workspace_id = target_workspace_id
      and item.user_id = current_user_id
      and item.provision_id = requested.provision_id
    returning item.provision_id, item.section_id, item.position;
end;
$$;

create or replace function public.remove_user_vade_provisions(
    p_collection_id uuid,
    p_provision_ids uuid[]
)
returns table(removed_provision_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    target_workspace_id uuid;
    requested_count integer := coalesce(cardinality(p_provision_ids), 0);
begin
    if current_user_id is null then raise exception 'Sessão inválida.'; end if;
    if p_collection_id is null or p_provision_ids is null then raise exception 'Caderno ou artigos inválidos.'; end if;
    if requested_count < 1 or requested_count > 500 then raise exception 'Selecione entre 1 e 500 artigos.'; end if;
    if requested_count <> (select count(distinct requested_id) from unnest(p_provision_ids) requested(requested_id)) then
        raise exception 'A seleção contém artigos inválidos ou repetidos.';
    end if;

    select collection.workspace_id into target_workspace_id
    from public.user_vade_collections collection
    where collection.id = p_collection_id
      and collection.user_id = current_user_id
      and private.is_workspace_member(collection.workspace_id)
    for update;
    if target_workspace_id is null then raise exception 'Caderno jurídico não encontrado.'; end if;

    if requested_count <> (
        select count(*) from public.user_vade_collection_provisions item
        where item.collection_id = p_collection_id
          and item.workspace_id = target_workspace_id
          and item.user_id = current_user_id
          and item.provision_id = any(p_provision_ids)
    ) then
        raise exception 'Um ou mais artigos não pertencem a este caderno.';
    end if;

    return query
    delete from public.user_vade_collection_provisions item
    where item.collection_id = p_collection_id
      and item.workspace_id = target_workspace_id
      and item.user_id = current_user_id
      and item.provision_id = any(p_provision_ids)
    returning item.provision_id;
end;
$$;

revoke all on function public.set_user_vade_provisions_review(uuid, uuid[], boolean) from public, anon, authenticated;
revoke all on function public.set_user_vade_provisions_section(uuid, uuid[], uuid) from public, anon, authenticated;
revoke all on function public.remove_user_vade_provisions(uuid, uuid[]) from public, anon, authenticated;

grant execute on function public.set_user_vade_provisions_review(uuid, uuid[], boolean) to authenticated;
grant execute on function public.set_user_vade_provisions_section(uuid, uuid[], uuid) to authenticated;
grant execute on function public.remove_user_vade_provisions(uuid, uuid[]) to authenticated;

comment on function public.set_user_vade_provisions_review(uuid, uuid[], boolean) is
    'Atualiza atomicamente a revisão de artigos privados de um único caderno jurídico.';
comment on function public.set_user_vade_provisions_section(uuid, uuid[], uuid) is
    'Move atomicamente artigos privados para uma seção do mesmo caderno, preservando a ordem informada.';
comment on function public.remove_user_vade_provisions(uuid, uuid[]) is
    'Remove atomicamente artigos de um caderno sem apagar grifos, favoritos ou histórico jurídico.';

commit;
