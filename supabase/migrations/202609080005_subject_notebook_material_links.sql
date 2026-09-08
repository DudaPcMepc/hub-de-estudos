begin;

create table public.user_subject_notebook_material_links (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    subject_id uuid not null,
    node_id uuid not null,
    study_link_id uuid not null,
    created_at timestamptz not null default now(),
    foreign key (node_id, workspace_id, user_id, subject_id)
        references public.user_subject_notebook_nodes(id, workspace_id, user_id, subject_id) on delete cascade,
    foreign key (study_link_id, workspace_id)
        references public.study_links(id, workspace_id) on delete cascade,
    unique (node_id, study_link_id, user_id)
);

create index user_subject_notebook_material_links_lookup_idx
    on public.user_subject_notebook_material_links(workspace_id, user_id, subject_id, node_id, created_at);

create or replace function private.validate_subject_notebook_material_link()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
    linked_subject_id uuid;
    linked_node_type text;
begin
    select subject_id into linked_subject_id
    from public.study_links
    where id = new.study_link_id and workspace_id = new.workspace_id;

    if linked_subject_id is distinct from new.subject_id then
        raise exception 'O material precisa pertencer à mesma matéria da página.';
    end if;

    select node_type into linked_node_type
    from public.user_subject_notebook_nodes
    where id = new.node_id and workspace_id = new.workspace_id
      and user_id = new.user_id and subject_id = new.subject_id
      and deleted_at is null;

    if linked_node_type is distinct from 'page' then
        raise exception 'Materiais só podem ser anexados a páginas ativas.';
    end if;

    return new;
end;
$$;

create trigger validate_subject_notebook_material_link
before insert or update on public.user_subject_notebook_material_links
for each row execute function private.validate_subject_notebook_material_link();

alter table public.user_subject_notebook_material_links enable row level security;
alter table public.user_subject_notebook_material_links force row level security;

create policy user_subject_notebook_material_links_select_self
on public.user_subject_notebook_material_links for select to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy user_subject_notebook_material_links_insert_self
on public.user_subject_notebook_material_links for insert to authenticated
with check (user_id = (select auth.uid()) and private.can_edit_workspace(workspace_id));

create policy user_subject_notebook_material_links_delete_self
on public.user_subject_notebook_material_links for delete to authenticated
using (user_id = (select auth.uid()) and private.can_edit_workspace(workspace_id));

revoke all on table public.user_subject_notebook_material_links from public, anon;
grant select, insert, delete on table public.user_subject_notebook_material_links to authenticated;
revoke all on function private.validate_subject_notebook_material_link() from public, anon, authenticated;

comment on table public.user_subject_notebook_material_links is
    'Vínculos privados entre páginas dos cadernos das matérias e materiais já salvos na mesma disciplina.';

commit;
