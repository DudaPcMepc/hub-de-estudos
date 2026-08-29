begin;

create extension if not exists pgcrypto;
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- -----------------------------------------------------------------------------
-- Identidade, espaços e participantes
-- -----------------------------------------------------------------------------

create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text not null check (char_length(display_name) between 1 and 120),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.workspaces (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(name) between 1 and 120),
    kind text not null default 'shared' check (kind in ('personal', 'shared')),
    owner_id uuid not null references auth.users(id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index workspaces_one_personal_per_owner
    on public.workspaces(owner_id)
    where kind = 'personal';

create table public.workspace_members (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    role text not null check (role in ('owner', 'editor', 'viewer')),
    joined_at timestamptz not null default now(),
    primary key (workspace_id, user_id)
);

create index workspace_members_user_id_idx on public.workspace_members(user_id);

-- -----------------------------------------------------------------------------
-- Conteúdo compartilhado do Hub
-- -----------------------------------------------------------------------------

create table public.subjects (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    name text not null check (char_length(name) between 1 and 500),
    description text not null default '' check (char_length(description) <= 5000),
    color text not null default 'primary' check (color in ('primary', 'secondary', 'success', 'danger', 'warning', 'info', 'light', 'dark')),
    priority text not null default 'media' check (priority in ('alta', 'media', 'baixa')),
    position integer not null default 0 check (position >= 0),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (id, workspace_id)
);

create index subjects_workspace_id_idx on public.subjects(workspace_id, position);

create table public.topics (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    subject_id uuid not null,
    title text not null check (char_length(title) between 1 and 1000),
    status text not null default 'nao' check (status in ('nao', 'estudando', 'revisar', 'dominado')),
    review_count integer not null default 0 check (review_count >= 0),
    position integer not null default 0 check (position >= 0),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (subject_id, workspace_id) references public.subjects(id, workspace_id) on delete cascade,
    unique (id, workspace_id)
);

create index topics_subject_id_idx on public.topics(subject_id, position);
create index topics_workspace_id_idx on public.topics(workspace_id);

create table public.notes (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    subject_id uuid not null,
    title text not null default '' check (char_length(title) <= 500),
    content text not null default '' check (char_length(content) <= 500000),
    tags text[] not null default '{}',
    pinned boolean not null default false,
    version integer not null default 1 check (version > 0),
    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (coalesce(array_length(tags, 1), 0) <= 100),
    foreign key (subject_id, workspace_id) references public.subjects(id, workspace_id) on delete cascade,
    unique (id, workspace_id)
);

create index notes_subject_id_idx on public.notes(subject_id, pinned, updated_at desc);
create index notes_workspace_id_idx on public.notes(workspace_id);

create table public.flashcards (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    subject_id uuid not null,
    front text not null check (char_length(front) between 1 and 5000),
    back text not null check (char_length(back) between 1 and 10000),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (subject_id, workspace_id) references public.subjects(id, workspace_id) on delete cascade,
    unique (id, workspace_id)
);

create index flashcards_subject_id_idx on public.flashcards(subject_id);
create index flashcards_workspace_id_idx on public.flashcards(workspace_id);

create table public.study_links (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    subject_id uuid not null,
    title text not null check (char_length(title) between 1 and 500),
    url text not null check (char_length(url) between 1 and 4000 and url ~* '^https?://'),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (subject_id, workspace_id) references public.subjects(id, workspace_id) on delete cascade,
    unique (id, workspace_id)
);

create index study_links_subject_id_idx on public.study_links(subject_id);
create index study_links_workspace_id_idx on public.study_links(workspace_id);

create table public.study_tasks (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    subject_id uuid,
    topic text not null check (char_length(topic) between 1 and 2000),
    due_date date,
    status text not null default 'pendente' check (status in ('pendente', 'concluido')),
    assigned_to uuid references auth.users(id) on delete set null,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (subject_id, workspace_id) references public.subjects(id, workspace_id) on delete cascade,
    unique (id, workspace_id)
);

create index study_tasks_workspace_due_idx on public.study_tasks(workspace_id, due_date);
create index study_tasks_assigned_to_idx on public.study_tasks(assigned_to, status);

create table public.exam_settings (
    workspace_id uuid primary key references public.workspaces(id) on delete cascade,
    exam_name text not null default '' check (char_length(exam_name) <= 500),
    board_name text not null default '' check (char_length(board_name) <= 300),
    vacancies text not null default '' check (char_length(vacancies) <= 100),
    exam_date date,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.exam_subjects (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    subject_id uuid not null,
    question_count integer not null default 0 check (question_count between 0 and 100000),
    weight numeric(10, 2) not null default 1 check (weight between 0 and 100000),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (subject_id, workspace_id) references public.subjects(id, workspace_id) on delete cascade,
    unique (workspace_id, subject_id),
    unique (id, workspace_id)
);

create index exam_subjects_workspace_id_idx on public.exam_subjects(workspace_id);

-- -----------------------------------------------------------------------------
-- Dados individuais dentro de um espaço
-- -----------------------------------------------------------------------------

create table public.flashcard_progress (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    flashcard_id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    box smallint not null default 1 check (box between 1 and 5),
    next_review date not null default current_date,
    correct_count integer not null default 0 check (correct_count >= 0),
    error_count integer not null default 0 check (error_count >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (flashcard_id, workspace_id) references public.flashcards(id, workspace_id) on delete cascade,
    unique (flashcard_id, user_id)
);

create index flashcard_progress_user_due_idx on public.flashcard_progress(user_id, next_review);
create index flashcard_progress_workspace_id_idx on public.flashcard_progress(workspace_id);

create table public.error_entries (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    subject_id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    theme text not null check (char_length(theme) between 1 and 4000),
    observation text not null default '' check (char_length(observation) <= 10000),
    occurred_on date not null default current_date,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (subject_id, workspace_id) references public.subjects(id, workspace_id) on delete cascade,
    unique (id, workspace_id)
);

create index error_entries_user_subject_idx on public.error_entries(user_id, subject_id, occurred_on desc);
create index error_entries_workspace_id_idx on public.error_entries(workspace_id);

create table public.quiz_attempts (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    subject_id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    topic text not null default '' check (char_length(topic) <= 2000),
    difficulty text not null default 'Médio' check (difficulty in ('Fácil', 'Médio', 'Difícil')),
    status text not null default 'em_andamento' check (status in ('em_andamento', 'concluido', 'cancelado')),
    total_questions integer not null default 0 check (total_questions between 0 and 100),
    correct_answers integer not null default 0 check (correct_answers between 0 and total_questions),
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    foreign key (subject_id, workspace_id) references public.subjects(id, workspace_id) on delete cascade,
    unique (id, workspace_id),
    unique (id, workspace_id, user_id)
);

create index quiz_attempts_user_started_idx on public.quiz_attempts(user_id, started_at desc);
create index quiz_attempts_workspace_id_idx on public.quiz_attempts(workspace_id);

create table public.quiz_answers (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    attempt_id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    question text not null check (char_length(question) between 1 and 4000),
    options jsonb not null,
    correct_index smallint not null check (correct_index between 0 and 3),
    selected_index smallint check (selected_index between 0 and 3),
    explanation text not null default '' check (char_length(explanation) <= 8000),
    is_correct boolean,
    answered_at timestamptz,
    created_at timestamptz not null default now(),
    check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4),
    foreign key (attempt_id, workspace_id, user_id) references public.quiz_attempts(id, workspace_id, user_id) on delete cascade
);

create index quiz_answers_attempt_id_idx on public.quiz_answers(attempt_id);
create index quiz_answers_user_id_idx on public.quiz_answers(user_id);

create table public.subject_performance (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    subject_id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    correct_answers integer not null default 0 check (correct_answers >= 0),
    total_answers integer not null default 0 check (total_answers >= 0 and correct_answers <= total_answers),
    updated_at timestamptz not null default now(),
    primary key (subject_id, user_id),
    foreign key (subject_id, workspace_id) references public.subjects(id, workspace_id) on delete cascade
);

create index subject_performance_user_id_idx on public.subject_performance(user_id);
create index subject_performance_workspace_id_idx on public.subject_performance(workspace_id);

-- -----------------------------------------------------------------------------
-- Auditoria da importação dos dados locais
-- -----------------------------------------------------------------------------

create table public.migration_batches (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    source text not null default 'localStorage' check (char_length(source) between 1 and 100),
    status text not null default 'iniciado' check (status in ('iniciado', 'concluido', 'falhou', 'revertido')),
    checksum text check (checksum is null or char_length(checksum) <= 200),
    item_counts jsonb not null default '{}'::jsonb check (jsonb_typeof(item_counts) = 'object'),
    created_at timestamptz not null default now(),
    completed_at timestamptz
);

create index migration_batches_user_id_idx on public.migration_batches(user_id, created_at desc);

create table public.migration_items (
    id uuid primary key default gen_random_uuid(),
    batch_id uuid not null references public.migration_batches(id) on delete cascade,
    entity_type text not null check (char_length(entity_type) between 1 and 80),
    legacy_id text not null check (char_length(legacy_id) between 1 and 200),
    new_id uuid not null,
    created_at timestamptz not null default now(),
    unique (batch_id, entity_type, legacy_id)
);

create index migration_items_batch_id_idx on public.migration_items(batch_id);

-- -----------------------------------------------------------------------------
-- Funções internas usadas pelas políticas e triggers
-- -----------------------------------------------------------------------------

create or replace function private.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.workspace_members membership
        where membership.workspace_id = target_workspace_id
          and membership.user_id = (select auth.uid())
    );
$$;

create or replace function private.is_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.workspaces workspace
        where workspace.id = target_workspace_id
          and workspace.owner_id = (select auth.uid())
    );
$$;

create or replace function private.can_edit_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.workspace_members membership
        where membership.workspace_id = target_workspace_id
          and membership.user_id = (select auth.uid())
          and membership.role in ('owner', 'editor')
    );
$$;

create or replace function private.shares_workspace(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select target_user_id = (select auth.uid())
        or exists (
            select 1
            from public.workspace_members mine
            join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
            where mine.user_id = (select auth.uid())
              and theirs.user_id = target_user_id
        );
$$;

create or replace function private.owns_migration_batch(target_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.migration_batches batch
        where batch.id = target_batch_id
          and batch.user_id = (select auth.uid())
          and private.is_workspace_member(batch.workspace_id)
    );
$$;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create or replace function private.bump_note_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    new.version = old.version + 1;
    new.updated_at = now();
    return new;
end;
$$;

create or replace function private.prevent_workspace_owner_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.owner_id is distinct from old.owner_id then
        raise exception 'A transferência de propriedade exige um fluxo administrativo específico.';
    end if;
    return new;
end;
$$;

create or replace function private.validate_workspace_membership_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    expected_owner_id uuid;
begin
    select workspace.owner_id
      into expected_owner_id
      from public.workspaces workspace
     where workspace.id = new.workspace_id;

    if expected_owner_id is null then
        raise exception 'Espaço inexistente.';
    end if;

    if new.role = 'owner' and new.user_id <> expected_owner_id then
        raise exception 'Somente o proprietário do espaço pode ter o papel owner.';
    end if;

    if tg_op = 'UPDATE'
       and old.user_id = expected_owner_id
       and (new.user_id is distinct from old.user_id or new.role <> 'owner') then
        raise exception 'O proprietário não pode ser removido ou rebaixado.';
    end if;

    return new;
end;
$$;

create or replace function private.add_workspace_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.workspace_members (workspace_id, user_id, role)
    values (new.id, new.owner_id, 'owner')
    on conflict (workspace_id, user_id) do update set role = 'owner';
    return new;
end;
$$;

create or replace function private.validate_task_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.assigned_to is not null and not exists (
        select 1
        from public.workspace_members membership
        where membership.workspace_id = new.workspace_id
          and membership.user_id = new.assigned_to
    ) then
        raise exception 'A pessoa responsável precisa participar do espaço.';
    end if;
    return new;
end;
$$;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    profile_name text;
begin
    profile_name := left(
        coalesce(
            nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
            nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
            'Usuário'
        ),
        120
    );

    insert into public.profiles (id, display_name)
    values (new.id, profile_name)
    on conflict (id) do nothing;

    insert into public.workspaces (name, kind, owner_id)
    values ('Meu Hub', 'personal', new.id)
    on conflict (owner_id) where kind = 'personal' do nothing;

    return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Triggers de consistência
-- -----------------------------------------------------------------------------

create trigger workspaces_add_owner_membership
after insert on public.workspaces
for each row execute function private.add_workspace_owner_membership();

create trigger workspaces_prevent_owner_change
before update of owner_id on public.workspaces
for each row execute function private.prevent_workspace_owner_change();

create trigger workspace_members_validate_role
before insert or update on public.workspace_members
for each row execute function private.validate_workspace_membership_role();

create trigger study_tasks_validate_assignee
before insert or update of assigned_to, workspace_id on public.study_tasks
for each row execute function private.validate_task_assignee();

create trigger notes_bump_version
before update on public.notes
for each row execute function private.bump_note_version();

create trigger profiles_set_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger workspaces_set_updated_at before update on public.workspaces for each row execute function private.set_updated_at();
create trigger subjects_set_updated_at before update on public.subjects for each row execute function private.set_updated_at();
create trigger topics_set_updated_at before update on public.topics for each row execute function private.set_updated_at();
create trigger flashcards_set_updated_at before update on public.flashcards for each row execute function private.set_updated_at();
create trigger study_links_set_updated_at before update on public.study_links for each row execute function private.set_updated_at();
create trigger study_tasks_set_updated_at before update on public.study_tasks for each row execute function private.set_updated_at();
create trigger exam_settings_set_updated_at before update on public.exam_settings for each row execute function private.set_updated_at();
create trigger exam_subjects_set_updated_at before update on public.exam_subjects for each row execute function private.set_updated_at();
create trigger flashcard_progress_set_updated_at before update on public.flashcard_progress for each row execute function private.set_updated_at();
create trigger error_entries_set_updated_at before update on public.error_entries for each row execute function private.set_updated_at();
create trigger subject_performance_set_updated_at before update on public.subject_performance for each row execute function private.set_updated_at();

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

-- Também prepara usuários que eventualmente já existam quando a migration for aplicada.
insert into public.profiles (id, display_name)
select
    existing_user.id,
    left(
        coalesce(
            nullif(trim(existing_user.raw_user_meta_data ->> 'display_name'), ''),
            nullif(split_part(coalesce(existing_user.email, ''), '@', 1), ''),
            'Usuário'
        ),
        120
    )
from auth.users existing_user
on conflict (id) do nothing;

insert into public.workspaces (name, kind, owner_id)
select 'Meu Hub', 'personal', existing_user.id
from auth.users existing_user
on conflict (owner_id) where kind = 'personal' do nothing;

-- -----------------------------------------------------------------------------
-- Row Level Security: acesso negado por padrão
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.subjects enable row level security;
alter table public.topics enable row level security;
alter table public.notes enable row level security;
alter table public.flashcards enable row level security;
alter table public.study_links enable row level security;
alter table public.study_tasks enable row level security;
alter table public.exam_settings enable row level security;
alter table public.exam_subjects enable row level security;
alter table public.flashcard_progress enable row level security;
alter table public.error_entries enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_answers enable row level security;
alter table public.subject_performance enable row level security;
alter table public.migration_batches enable row level security;
alter table public.migration_items enable row level security;

alter table public.profiles force row level security;
alter table public.workspaces force row level security;
alter table public.workspace_members force row level security;
alter table public.subjects force row level security;
alter table public.topics force row level security;
alter table public.notes force row level security;
alter table public.flashcards force row level security;
alter table public.study_links force row level security;
alter table public.study_tasks force row level security;
alter table public.exam_settings force row level security;
alter table public.exam_subjects force row level security;
alter table public.flashcard_progress force row level security;
alter table public.error_entries force row level security;
alter table public.quiz_attempts force row level security;
alter table public.quiz_answers force row level security;
alter table public.subject_performance force row level security;
alter table public.migration_batches force row level security;
alter table public.migration_items force row level security;

create policy profiles_select_shared on public.profiles
for select to authenticated
using (private.shares_workspace(id));

create policy profiles_update_self on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy workspaces_select_member on public.workspaces
for select to authenticated
using (private.is_workspace_member(id));

create policy workspaces_insert_owner on public.workspaces
for insert to authenticated
with check (owner_id = (select auth.uid()));

create policy workspaces_update_owner on public.workspaces
for update to authenticated
using (private.is_workspace_owner(id))
with check (owner_id = (select auth.uid()));

create policy workspaces_delete_owner on public.workspaces
for delete to authenticated
using (private.is_workspace_owner(id));

create policy workspace_members_select_member on public.workspace_members
for select to authenticated
using (private.is_workspace_member(workspace_id));

create policy workspace_members_insert_owner on public.workspace_members
for insert to authenticated
with check (private.is_workspace_owner(workspace_id));

create policy workspace_members_update_owner on public.workspace_members
for update to authenticated
using (private.is_workspace_owner(workspace_id))
with check (private.is_workspace_owner(workspace_id));

create policy workspace_members_delete_owner on public.workspace_members
for delete to authenticated
using (private.is_workspace_owner(workspace_id) and role <> 'owner');

-- Conteúdo compartilhado: todos os membros leem; owner e editor escrevem.
create policy subjects_select_member on public.subjects for select to authenticated using (private.is_workspace_member(workspace_id));
create policy subjects_insert_editor on public.subjects for insert to authenticated with check (private.can_edit_workspace(workspace_id) and created_by = (select auth.uid()));
create policy subjects_update_editor on public.subjects for update to authenticated using (private.can_edit_workspace(workspace_id)) with check (private.can_edit_workspace(workspace_id));
create policy subjects_delete_editor on public.subjects for delete to authenticated using (private.can_edit_workspace(workspace_id));

create policy topics_select_member on public.topics for select to authenticated using (private.is_workspace_member(workspace_id));
create policy topics_insert_editor on public.topics for insert to authenticated with check (private.can_edit_workspace(workspace_id) and created_by = (select auth.uid()));
create policy topics_update_editor on public.topics for update to authenticated using (private.can_edit_workspace(workspace_id)) with check (private.can_edit_workspace(workspace_id));
create policy topics_delete_editor on public.topics for delete to authenticated using (private.can_edit_workspace(workspace_id));

create policy notes_select_member on public.notes for select to authenticated using (private.is_workspace_member(workspace_id));
create policy notes_insert_editor on public.notes for insert to authenticated with check (private.can_edit_workspace(workspace_id) and created_by = (select auth.uid()) and updated_by = (select auth.uid()));
create policy notes_update_editor on public.notes for update to authenticated using (private.can_edit_workspace(workspace_id)) with check (private.can_edit_workspace(workspace_id) and updated_by = (select auth.uid()));
create policy notes_delete_editor on public.notes for delete to authenticated using (private.can_edit_workspace(workspace_id));

create policy flashcards_select_member on public.flashcards for select to authenticated using (private.is_workspace_member(workspace_id));
create policy flashcards_insert_editor on public.flashcards for insert to authenticated with check (private.can_edit_workspace(workspace_id) and created_by = (select auth.uid()));
create policy flashcards_update_editor on public.flashcards for update to authenticated using (private.can_edit_workspace(workspace_id)) with check (private.can_edit_workspace(workspace_id));
create policy flashcards_delete_editor on public.flashcards for delete to authenticated using (private.can_edit_workspace(workspace_id));

create policy study_links_select_member on public.study_links for select to authenticated using (private.is_workspace_member(workspace_id));
create policy study_links_insert_editor on public.study_links for insert to authenticated with check (private.can_edit_workspace(workspace_id) and created_by = (select auth.uid()));
create policy study_links_update_editor on public.study_links for update to authenticated using (private.can_edit_workspace(workspace_id)) with check (private.can_edit_workspace(workspace_id));
create policy study_links_delete_editor on public.study_links for delete to authenticated using (private.can_edit_workspace(workspace_id));

create policy study_tasks_select_member on public.study_tasks for select to authenticated using (private.is_workspace_member(workspace_id));
create policy study_tasks_insert_editor on public.study_tasks for insert to authenticated with check (private.can_edit_workspace(workspace_id) and created_by = (select auth.uid()));
create policy study_tasks_update_editor on public.study_tasks for update to authenticated using (private.can_edit_workspace(workspace_id)) with check (private.can_edit_workspace(workspace_id));
create policy study_tasks_delete_editor on public.study_tasks for delete to authenticated using (private.can_edit_workspace(workspace_id));

create policy exam_settings_select_member on public.exam_settings for select to authenticated using (private.is_workspace_member(workspace_id));
create policy exam_settings_insert_editor on public.exam_settings for insert to authenticated with check (private.can_edit_workspace(workspace_id) and updated_by = (select auth.uid()));
create policy exam_settings_update_editor on public.exam_settings for update to authenticated using (private.can_edit_workspace(workspace_id)) with check (private.can_edit_workspace(workspace_id) and updated_by = (select auth.uid()));
create policy exam_settings_delete_editor on public.exam_settings for delete to authenticated using (private.can_edit_workspace(workspace_id));

create policy exam_subjects_select_member on public.exam_subjects for select to authenticated using (private.is_workspace_member(workspace_id));
create policy exam_subjects_insert_editor on public.exam_subjects for insert to authenticated with check (private.can_edit_workspace(workspace_id));
create policy exam_subjects_update_editor on public.exam_subjects for update to authenticated using (private.can_edit_workspace(workspace_id)) with check (private.can_edit_workspace(workspace_id));
create policy exam_subjects_delete_editor on public.exam_subjects for delete to authenticated using (private.can_edit_workspace(workspace_id));

-- Dados individuais: somente o próprio usuário pode ler e escrever.
create policy flashcard_progress_select_self on public.flashcard_progress for select to authenticated using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy flashcard_progress_insert_self on public.flashcard_progress for insert to authenticated with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy flashcard_progress_update_self on public.flashcard_progress for update to authenticated using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id)) with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy flashcard_progress_delete_self on public.flashcard_progress for delete to authenticated using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy error_entries_select_self on public.error_entries for select to authenticated using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy error_entries_insert_self on public.error_entries for insert to authenticated with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy error_entries_update_self on public.error_entries for update to authenticated using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id)) with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy error_entries_delete_self on public.error_entries for delete to authenticated using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy quiz_attempts_select_self on public.quiz_attempts for select to authenticated using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy quiz_attempts_insert_self on public.quiz_attempts for insert to authenticated with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy quiz_attempts_update_self on public.quiz_attempts for update to authenticated using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id)) with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy quiz_attempts_delete_self on public.quiz_attempts for delete to authenticated using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy quiz_answers_select_self on public.quiz_answers for select to authenticated using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy quiz_answers_insert_self on public.quiz_answers for insert to authenticated with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy quiz_answers_update_self on public.quiz_answers for update to authenticated using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id)) with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy quiz_answers_delete_self on public.quiz_answers for delete to authenticated using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy subject_performance_select_self on public.subject_performance for select to authenticated using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy subject_performance_insert_self on public.subject_performance for insert to authenticated with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy subject_performance_update_self on public.subject_performance for update to authenticated using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id)) with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy subject_performance_delete_self on public.subject_performance for delete to authenticated using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy migration_batches_select_self on public.migration_batches for select to authenticated using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy migration_batches_insert_self on public.migration_batches for insert to authenticated with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy migration_batches_update_self on public.migration_batches for update to authenticated using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id)) with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy migration_batches_delete_self on public.migration_batches for delete to authenticated using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy migration_items_select_self on public.migration_items for select to authenticated using (private.owns_migration_batch(batch_id));
create policy migration_items_insert_self on public.migration_items for insert to authenticated with check (private.owns_migration_batch(batch_id));
create policy migration_items_delete_self on public.migration_items for delete to authenticated using (private.owns_migration_batch(batch_id));

-- -----------------------------------------------------------------------------
-- Privilégios: nenhuma tabela é acessível pelo papel anônimo.
-- -----------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

revoke all on function private.is_workspace_member(uuid) from public, anon;
revoke all on function private.is_workspace_owner(uuid) from public, anon;
revoke all on function private.can_edit_workspace(uuid) from public, anon;
revoke all on function private.shares_workspace(uuid) from public, anon;
revoke all on function private.owns_migration_batch(uuid) from public, anon;

grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.is_workspace_owner(uuid) to authenticated;
grant execute on function private.can_edit_workspace(uuid) to authenticated;
grant execute on function private.shares_workspace(uuid) to authenticated;
grant execute on function private.owns_migration_batch(uuid) to authenticated;

revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.bump_note_version() from public, anon, authenticated;
revoke all on function private.prevent_workspace_owner_change() from public, anon, authenticated;
revoke all on function private.validate_workspace_membership_role() from public, anon, authenticated;
revoke all on function private.add_workspace_owner_membership() from public, anon, authenticated;
revoke all on function private.validate_task_assignee() from public, anon, authenticated;
revoke all on function private.handle_new_auth_user() from public, anon, authenticated;

commit;
