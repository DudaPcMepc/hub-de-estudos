begin;

alter table public.user_subject_notebook_material_links
    add column current_page integer not null default 1 check (current_page between 1 and 100000),
    add column total_pages integer check (total_pages between 1 and 100000),
    add column last_read_at timestamptz,
    add constraint subject_notebook_material_progress_valid
        check (total_pages is null or current_page <= total_pages);

create policy user_subject_notebook_material_links_update_self
on public.user_subject_notebook_material_links for update to authenticated
using (user_id = (select auth.uid()) and private.can_edit_workspace(workspace_id))
with check (user_id = (select auth.uid()) and private.can_edit_workspace(workspace_id));

grant update on table public.user_subject_notebook_material_links to authenticated;

comment on column public.user_subject_notebook_material_links.current_page is
    'Última página informada pelo usuário no leitor integrado do material.';
comment on column public.user_subject_notebook_material_links.total_pages is
    'Total opcional de páginas informado pelo usuário para calcular o progresso.';
comment on column public.user_subject_notebook_material_links.last_read_at is
    'Momento da última abertura ou atualização do progresso no leitor integrado.';

commit;
