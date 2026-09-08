begin;

alter table public.user_subject_notebook_nodes
    add column deleted_at timestamptz,
    add column deleted_root_id uuid;

create index user_subject_notebook_nodes_trash_idx
    on public.user_subject_notebook_nodes(workspace_id, user_id, subject_id, deleted_at)
    where deleted_at is not null;

create or replace function public.trash_subject_notebook_node(p_node_id uuid)
returns integer language plpgsql security invoker
set search_path = pg_catalog, public, private as $$
declare affected integer;
begin
    if auth.uid() is null then raise exception 'Sessão inválida.'; end if;
    if not exists (select 1 from public.user_subject_notebook_nodes where id = p_node_id and user_id = auth.uid() and deleted_at is null)
        then raise exception 'Item do caderno não encontrado.'; end if;
    with recursive subtree as (
        select id from public.user_subject_notebook_nodes where id = p_node_id and user_id = auth.uid()
        union all
        select child.id from public.user_subject_notebook_nodes child join subtree parent on child.parent_id = parent.id
        where child.user_id = auth.uid()
    )
    update public.user_subject_notebook_nodes node
    set deleted_at = now(), deleted_root_id = p_node_id
    where node.id in (select id from subtree);
    get diagnostics affected = row_count;
    return affected;
end;
$$;

create or replace function public.restore_subject_notebook_node(p_node_id uuid)
returns integer language plpgsql security invoker
set search_path = pg_catalog, public, private as $$
declare affected integer;
begin
    if auth.uid() is null then raise exception 'Sessão inválida.'; end if;
    update public.user_subject_notebook_nodes set deleted_at = null, deleted_root_id = null
    where user_id = auth.uid() and deleted_root_id = p_node_id and deleted_at is not null;
    get diagnostics affected = row_count;
    if affected = 0 then raise exception 'Item não encontrado na lixeira.'; end if;
    return affected;
end;
$$;

create or replace function public.delete_subject_notebook_node_forever(p_node_id uuid)
returns integer language plpgsql security invoker
set search_path = pg_catalog, public, private as $$
declare affected integer;
begin
    if auth.uid() is null then raise exception 'Sessão inválida.'; end if;
    delete from public.user_subject_notebook_nodes
    where id = p_node_id and user_id = auth.uid() and deleted_at is not null and deleted_root_id = p_node_id;
    get diagnostics affected = row_count;
    if affected = 0 then raise exception 'Item não encontrado na lixeira.'; end if;
    return affected;
end;
$$;

create or replace function public.empty_subject_notebook_trash(p_subject_id uuid)
returns integer language plpgsql security invoker
set search_path = pg_catalog, public, private as $$
declare affected integer;
begin
    if auth.uid() is null then raise exception 'Sessão inválida.'; end if;
    delete from public.user_subject_notebook_nodes
    where user_id = auth.uid() and subject_id = p_subject_id and deleted_at is not null and deleted_root_id = id;
    get diagnostics affected = row_count;
    return affected;
end;
$$;

create or replace function public.purge_expired_subject_notebook_trash(p_subject_id uuid)
returns integer language plpgsql security invoker
set search_path = pg_catalog, public, private as $$
declare affected integer;
begin
    if auth.uid() is null then raise exception 'Sessão inválida.'; end if;
    delete from public.user_subject_notebook_nodes
    where user_id = auth.uid() and subject_id = p_subject_id
      and deleted_at < now() - interval '30 days' and deleted_root_id = id;
    get diagnostics affected = row_count;
    return affected;
end;
$$;

revoke all on function public.trash_subject_notebook_node(uuid) from public, anon;
revoke all on function public.restore_subject_notebook_node(uuid) from public, anon;
revoke all on function public.delete_subject_notebook_node_forever(uuid) from public, anon;
revoke all on function public.empty_subject_notebook_trash(uuid) from public, anon;
revoke all on function public.purge_expired_subject_notebook_trash(uuid) from public, anon;
grant execute on function public.trash_subject_notebook_node(uuid) to authenticated;
grant execute on function public.restore_subject_notebook_node(uuid) to authenticated;
grant execute on function public.delete_subject_notebook_node_forever(uuid) to authenticated;
grant execute on function public.empty_subject_notebook_trash(uuid) to authenticated;
grant execute on function public.purge_expired_subject_notebook_trash(uuid) to authenticated;

comment on column public.user_subject_notebook_nodes.deleted_at is 'Momento em que o item foi enviado à lixeira; nulo enquanto ativo.';
comment on column public.user_subject_notebook_nodes.deleted_root_id is 'Raiz da exclusão recuperável usada para restaurar toda a subárvore.';

commit;
