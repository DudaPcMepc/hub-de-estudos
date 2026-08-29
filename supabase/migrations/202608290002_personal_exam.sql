begin;

-- Cada participante mantém a própria configuração e matriz de concurso.
alter table public.exam_settings add column user_id uuid references auth.users(id) on delete cascade;
update public.exam_settings settings
   set user_id = workspace.owner_id
  from public.workspaces workspace
 where workspace.id = settings.workspace_id;
alter table public.exam_settings alter column user_id set not null;
alter table public.exam_settings alter column user_id set default auth.uid();
alter table public.exam_settings drop constraint exam_settings_pkey;
alter table public.exam_settings add primary key (workspace_id, user_id);

alter table public.exam_subjects add column user_id uuid references auth.users(id) on delete cascade;
update public.exam_subjects item
   set user_id = workspace.owner_id
  from public.workspaces workspace
 where workspace.id = item.workspace_id;
alter table public.exam_subjects alter column user_id set not null;
alter table public.exam_subjects alter column user_id set default auth.uid();
alter table public.exam_subjects drop constraint exam_subjects_workspace_id_subject_id_key;
alter table public.exam_subjects add constraint exam_subjects_user_subject_key
    unique (workspace_id, user_id, subject_id);
alter table public.exam_subjects add constraint exam_subjects_id_workspace_user_key
    unique (id, workspace_id, user_id);
create index exam_subjects_user_idx on public.exam_subjects(workspace_id, user_id);

-- O checklist é uma cópia pessoal do conteúdo do edital. Ele não altera os
-- tópicos compartilhados usados na área de matérias.
create table public.exam_topics (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    exam_subject_id uuid not null,
    title text not null check (char_length(title) between 1 and 1000),
    checked boolean not null default false,
    position integer not null default 0 check (position >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (exam_subject_id, workspace_id, user_id)
        references public.exam_subjects(id, workspace_id, user_id) on delete cascade,
    unique (exam_subject_id, position)
);

create index exam_topics_user_idx on public.exam_topics(workspace_id, user_id, exam_subject_id, position);

-- Preserva para o proprietário o checklist que existia no modelo compartilhado.
insert into public.exam_topics (workspace_id, user_id, exam_subject_id, title, checked, position)
select item.workspace_id,
       item.user_id,
       item.id,
       topic.title,
       topic.status = 'dominado',
       row_number() over (partition by item.id order by topic.position, topic.created_at, topic.id) - 1
  from public.exam_subjects item
  join public.topics topic
    on topic.workspace_id = item.workspace_id
   and topic.subject_id = item.subject_id;

create trigger exam_topics_set_updated_at
before update on public.exam_topics
for each row execute function private.set_updated_at();

alter table public.exam_topics enable row level security;
alter table public.exam_topics force row level security;

drop policy exam_settings_select_member on public.exam_settings;
drop policy exam_settings_insert_editor on public.exam_settings;
drop policy exam_settings_update_editor on public.exam_settings;
drop policy exam_settings_delete_editor on public.exam_settings;

create policy exam_settings_select_self on public.exam_settings for select to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy exam_settings_insert_self on public.exam_settings for insert to authenticated
with check (user_id = (select auth.uid()) and updated_by = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy exam_settings_update_self on public.exam_settings for update to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id))
with check (user_id = (select auth.uid()) and updated_by = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy exam_settings_delete_self on public.exam_settings for delete to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

drop policy exam_subjects_select_member on public.exam_subjects;
drop policy exam_subjects_insert_editor on public.exam_subjects;
drop policy exam_subjects_update_editor on public.exam_subjects;
drop policy exam_subjects_delete_editor on public.exam_subjects;

create policy exam_subjects_select_self on public.exam_subjects for select to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy exam_subjects_insert_self on public.exam_subjects for insert to authenticated
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy exam_subjects_update_self on public.exam_subjects for update to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id))
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy exam_subjects_delete_self on public.exam_subjects for delete to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy exam_topics_select_self on public.exam_topics for select to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy exam_topics_insert_self on public.exam_topics for insert to authenticated
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy exam_topics_update_self on public.exam_topics for update to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id))
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy exam_topics_delete_self on public.exam_topics for delete to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

revoke all on table public.exam_topics from anon;
grant select, insert, update, delete on table public.exam_topics to authenticated;

comment on table public.exam_settings is 'Configuração pessoal do concurso dentro de um espaço de estudos.';
comment on table public.exam_subjects is 'Matriz pessoal de matérias do concurso.';
comment on table public.exam_topics is 'Checklist pessoal de tópicos do edital, separado dos tópicos compartilhados.';

commit;
