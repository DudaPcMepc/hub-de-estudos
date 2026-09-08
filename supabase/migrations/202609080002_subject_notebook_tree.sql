begin;

create table public.user_subject_notebook_nodes (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    subject_id uuid not null,
    parent_id uuid,
    topic_id uuid references public.topics(id) on delete set null,
    node_type text not null check (node_type in ('folder', 'notebook', 'page')),
    title text not null check (char_length(btrim(title)) between 1 and 240),
    content text not null default '' check (char_length(content) <= 500000),
    color text not null default '#b8322a' check (color ~ '^#[0-9a-fA-F]{6}$'),
    cover_style text not null default 'solid' check (cover_style in ('solid', 'gradient', 'minimal')),
    paper_style text not null default 'lined' check (paper_style in ('plain', 'lined', 'grid', 'dotted')),
    position integer not null default 0 check (position between 0 and 100000),
    version integer not null default 1 check (version > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (subject_id, workspace_id) references public.subjects(id, workspace_id) on delete cascade,
    unique (id, workspace_id, user_id, subject_id),
    foreign key (parent_id, workspace_id, user_id, subject_id)
        references public.user_subject_notebook_nodes(id, workspace_id, user_id, subject_id) on delete cascade
);

create index user_subject_notebook_nodes_lookup_idx
    on public.user_subject_notebook_nodes(workspace_id, user_id, subject_id, parent_id, position, created_at);
create index user_subject_notebook_nodes_topic_idx
    on public.user_subject_notebook_nodes(topic_id) where topic_id is not null;

create or replace function private.validate_subject_notebook_node()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
    parent_type text;
    topic_subject_id uuid;
begin
    if new.topic_id is not null then
        select subject_id into topic_subject_id from public.topics
        where id = new.topic_id and workspace_id = new.workspace_id;
        if topic_subject_id is distinct from new.subject_id then
            raise exception 'O tópico precisa pertencer à mesma matéria.';
        end if;
    end if;

    if new.parent_id is null then
        if new.node_type = 'page' then raise exception 'Uma página precisa pertencer a um caderno.'; end if;
        return new;
    end if;
    if new.parent_id = new.id then raise exception 'Um item não pode conter a si mesmo.'; end if;

    select node_type into parent_type
    from public.user_subject_notebook_nodes
    where id = new.parent_id and workspace_id = new.workspace_id
      and user_id = new.user_id and subject_id = new.subject_id;
    if parent_type is null then raise exception 'Pasta ou caderno de destino inválido.'; end if;
    if new.node_type in ('folder', 'notebook') and parent_type <> 'folder' then
        raise exception 'Pastas e cadernos só podem ficar dentro de pastas.';
    end if;
    if new.node_type = 'page' and parent_type <> 'notebook' then
        raise exception 'Páginas só podem ficar dentro de cadernos.';
    end if;

    if new.node_type = 'folder' and exists (
        with recursive ancestors as (
            select id, parent_id from public.user_subject_notebook_nodes
            where id = new.parent_id and workspace_id = new.workspace_id and user_id = new.user_id and subject_id = new.subject_id
            union all
            select node.id, node.parent_id from public.user_subject_notebook_nodes node
            join ancestors parent on node.id = parent.parent_id
            where node.workspace_id = new.workspace_id and node.user_id = new.user_id and node.subject_id = new.subject_id
        ) select 1 from ancestors where id = new.id
    ) then raise exception 'Uma pasta não pode ser movida para dentro dela mesma.';
    end if;
    return new;
end;
$$;

create or replace function private.bump_subject_notebook_node()
returns trigger language plpgsql set search_path = pg_catalog, public, private as $$
begin new.version := old.version + 1; new.updated_at := now(); return new; end;
$$;

create trigger validate_subject_notebook_node
before insert or update of parent_id, topic_id, node_type, subject_id, workspace_id, user_id
on public.user_subject_notebook_nodes for each row execute function private.validate_subject_notebook_node();
create trigger bump_subject_notebook_node
before update on public.user_subject_notebook_nodes for each row execute function private.bump_subject_notebook_node();

alter table public.user_subject_notebook_nodes enable row level security;
alter table public.user_subject_notebook_nodes force row level security;
create policy user_subject_notebook_nodes_select_self on public.user_subject_notebook_nodes for select to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy user_subject_notebook_nodes_insert_self on public.user_subject_notebook_nodes for insert to authenticated
with check (user_id = (select auth.uid()) and private.can_edit_workspace(workspace_id));
create policy user_subject_notebook_nodes_update_self on public.user_subject_notebook_nodes for update to authenticated
using (user_id = (select auth.uid()) and private.can_edit_workspace(workspace_id))
with check (user_id = (select auth.uid()) and private.can_edit_workspace(workspace_id));
create policy user_subject_notebook_nodes_delete_self on public.user_subject_notebook_nodes for delete to authenticated
using (user_id = (select auth.uid()) and private.can_edit_workspace(workspace_id));

revoke all on table public.user_subject_notebook_nodes from public, anon;
grant select, insert, update, delete on table public.user_subject_notebook_nodes to authenticated;

create or replace function public.reorder_subject_notebook_nodes(
    p_subject_id uuid,
    p_parent_id uuid,
    p_node_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
    current_user_id uuid := auth.uid();
    current_workspace_id uuid;
    sibling_count integer;
begin
    if current_user_id is null then raise exception 'Sessão inválida.'; end if;
    select workspace_id into current_workspace_id from public.subjects where id = p_subject_id;
    if current_workspace_id is null then raise exception 'Matéria inválida.'; end if;

    select count(*) into sibling_count
    from public.user_subject_notebook_nodes
    where workspace_id = current_workspace_id and user_id = current_user_id
      and subject_id = p_subject_id and parent_id is not distinct from p_parent_id;

    if coalesce(array_length(p_node_ids, 1), 0) <> sibling_count
       or (select count(distinct requested.id) from unnest(p_node_ids) as requested(id)) <> sibling_count
       or exists (
            select 1 from unnest(p_node_ids) as requested(id)
            where not exists (
                select 1 from public.user_subject_notebook_nodes node
                where node.id = requested.id and node.workspace_id = current_workspace_id
                  and node.user_id = current_user_id and node.subject_id = p_subject_id
                  and node.parent_id is not distinct from p_parent_id
            )
       ) then
        raise exception 'A ordem precisa conter exatamente os itens desta pasta.';
    end if;

    update public.user_subject_notebook_nodes node
    set position = (ordered.ordinality - 1)::integer
    from unnest(p_node_ids) with ordinality ordered(id, ordinality)
    where node.id = ordered.id and node.workspace_id = current_workspace_id
      and node.user_id = current_user_id and node.subject_id = p_subject_id;
end;
$$;

revoke all on function public.reorder_subject_notebook_nodes(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.reorder_subject_notebook_nodes(uuid, uuid, uuid[]) to authenticated;
revoke all on function private.validate_subject_notebook_node() from public, anon, authenticated;
revoke all on function private.bump_subject_notebook_node() from public, anon, authenticated;

comment on table public.user_subject_notebook_nodes is
    'Árvore privada de pastas, cadernos e páginas por usuário e matéria.';

commit;
