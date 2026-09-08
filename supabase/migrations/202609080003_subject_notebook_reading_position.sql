begin;

create table public.user_subject_notebook_positions (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    subject_id uuid not null,
    last_page_id uuid not null,
    updated_at timestamptz not null default now(),
    primary key (workspace_id, user_id, subject_id),
    foreign key (subject_id, workspace_id) references public.subjects(id, workspace_id) on delete cascade,
    foreign key (last_page_id, workspace_id, user_id, subject_id)
        references public.user_subject_notebook_nodes(id, workspace_id, user_id, subject_id) on delete cascade
);

create or replace function private.validate_subject_notebook_position()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
    if not exists (
        select 1
        from public.user_subject_notebook_nodes node
        where node.id = new.last_page_id
          and node.workspace_id = new.workspace_id
          and node.user_id = new.user_id
          and node.subject_id = new.subject_id
          and node.node_type = 'page'
    ) then
        raise exception 'A posição de leitura precisa apontar para uma página válida desta matéria.';
    end if;
    new.updated_at := now();
    return new;
end;
$$;

create trigger validate_subject_notebook_position
before insert or update on public.user_subject_notebook_positions
for each row execute function private.validate_subject_notebook_position();

alter table public.user_subject_notebook_positions enable row level security;
alter table public.user_subject_notebook_positions force row level security;

create policy user_subject_notebook_positions_select_self
on public.user_subject_notebook_positions for select to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy user_subject_notebook_positions_insert_self
on public.user_subject_notebook_positions for insert to authenticated
with check (user_id = (select auth.uid()) and private.can_edit_workspace(workspace_id));

create policy user_subject_notebook_positions_update_self
on public.user_subject_notebook_positions for update to authenticated
using (user_id = (select auth.uid()) and private.can_edit_workspace(workspace_id))
with check (user_id = (select auth.uid()) and private.can_edit_workspace(workspace_id));

create policy user_subject_notebook_positions_delete_self
on public.user_subject_notebook_positions for delete to authenticated
using (user_id = (select auth.uid()) and private.can_edit_workspace(workspace_id));

revoke all on table public.user_subject_notebook_positions from public, anon;
grant select, insert, update, delete on table public.user_subject_notebook_positions to authenticated;
revoke all on function private.validate_subject_notebook_position() from public, anon, authenticated;

comment on table public.user_subject_notebook_positions is
    'Última página privada aberta por usuário em cada matéria.';

commit;
