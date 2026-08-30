begin;

create table public.user_legal_bookmarks (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    subject_id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    provision_id uuid not null references public.legal_provisions(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (user_id, subject_id, provision_id),
    foreign key (subject_id, workspace_id)
        references public.subjects(id, workspace_id) on delete cascade
);

create table public.user_legal_reading_history (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    subject_id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    provision_id uuid not null references public.legal_provisions(id) on delete cascade,
    visit_count integer not null default 1 check (visit_count between 1 and 1000000),
    first_read_at timestamptz not null default now(),
    last_read_at timestamptz not null default now(),
    primary key (user_id, subject_id, provision_id),
    foreign key (subject_id, workspace_id)
        references public.subjects(id, workspace_id) on delete cascade
);

create index user_legal_bookmarks_lookup_idx
    on public.user_legal_bookmarks(user_id, workspace_id, subject_id, created_at desc);
create index user_legal_reading_history_recent_idx
    on public.user_legal_reading_history(user_id, workspace_id, subject_id, last_read_at desc);

alter table public.user_legal_bookmarks enable row level security;
alter table public.user_legal_bookmarks force row level security;
alter table public.user_legal_reading_history enable row level security;
alter table public.user_legal_reading_history force row level security;

create policy user_legal_bookmarks_select_self
on public.user_legal_bookmarks for select to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy user_legal_bookmarks_insert_self
on public.user_legal_bookmarks for insert to authenticated
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy user_legal_bookmarks_delete_self
on public.user_legal_bookmarks for delete to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy user_legal_reading_history_select_self
on public.user_legal_reading_history for select to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy user_legal_reading_history_insert_self
on public.user_legal_reading_history for insert to authenticated
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy user_legal_reading_history_update_self
on public.user_legal_reading_history for update to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id))
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

revoke all on table public.user_legal_bookmarks from public, anon, authenticated;
revoke all on table public.user_legal_reading_history from public, anon, authenticated;
grant select, insert, delete on table public.user_legal_bookmarks to authenticated;
grant select, insert, update on table public.user_legal_reading_history to authenticated;

comment on table public.user_legal_bookmarks is
    'Artigos jurídicos favoritos, privados por usuário e matéria.';
comment on table public.user_legal_reading_history is
    'Histórico privado usado para artigos recentes e retomada da última leitura.';

commit;
