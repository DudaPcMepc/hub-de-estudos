begin;

-- Catálogo global: identifica tipos de matéria sem transformar a matéria do
-- usuário em conteúdo público ou compartilhado.
create table public.catalog_subjects (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique
        check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    name text not null check (char_length(name) between 1 and 160),
    category text not null default 'geral'
        check (category in ('juridica', 'geral')),
    icon text not null default 'bi-book'
        check (char_length(icon) between 1 and 80 and icon ~ '^bi-[a-z0-9-]+$'),
    default_widget_types text[] not null default '{}',
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (cardinality(default_widget_types) <= 8),
    check (default_widget_types <@ array[
        'legal_library',
        'personal_vade',
        'private_documents',
        'community'
    ]::text[])
);

insert into public.catalog_subjects (id, slug, name, category, icon, default_widget_types)
values
    ('10000000-0000-4000-8000-000000000001', 'direito-constitucional', 'Direito Constitucional', 'juridica', 'bi-bank', array['legal_library', 'personal_vade']),
    ('10000000-0000-4000-8000-000000000002', 'direito-penal', 'Direito Penal', 'juridica', 'bi-shield-lock', array['legal_library', 'personal_vade']),
    ('10000000-0000-4000-8000-000000000003', 'processo-penal', 'Processo Penal', 'juridica', 'bi-shield-check', array['legal_library', 'personal_vade']),
    ('10000000-0000-4000-8000-000000000004', 'direito-administrativo', 'Direito Administrativo', 'juridica', 'bi-building', array['legal_library', 'personal_vade']),
    ('10000000-0000-4000-8000-000000000005', 'legislacao-gcm', 'Legislação de Guardas Municipais', 'juridica', 'bi-shield', array['legal_library', 'personal_vade']),
    ('10000000-0000-4000-8000-000000000006', 'legislacao-de-transito', 'Legislação de Trânsito', 'juridica', 'bi-signpost-2', array['legal_library', 'personal_vade']),
    ('10000000-0000-4000-8000-000000000007', 'etica-no-servico-publico', 'Ética no Serviço Público', 'geral', 'bi-person-check', array['private_documents']),
    ('10000000-0000-4000-8000-000000000008', 'direitos-humanos', 'Direitos Humanos', 'juridica', 'bi-globe-americas', array['legal_library', 'personal_vade']),
    ('10000000-0000-4000-8000-000000000009', 'lingua-portuguesa', 'Língua Portuguesa', 'geral', 'bi-alphabet-uppercase', array['private_documents']),
    ('10000000-0000-4000-8000-000000000010', 'matematica', 'Matemática', 'geral', 'bi-calculator', array['private_documents']),
    ('10000000-0000-4000-8000-000000000011', 'raciocinio-logico', 'Raciocínio Lógico', 'geral', 'bi-diagram-3', array['private_documents']),
    ('10000000-0000-4000-8000-000000000012', 'informatica', 'Informática', 'geral', 'bi-laptop', array['private_documents'])
on conflict (slug) do update
set name = excluded.name,
    category = excluded.category,
    icon = excluded.icon,
    default_widget_types = excluded.default_widget_types,
    active = true,
    updated_at = now();

-- O vínculo é opcional. Nenhuma matéria existente é associada automaticamente.
alter table public.subjects
    add column catalog_subject_id uuid
        references public.catalog_subjects(id) on delete set null;

create index subjects_catalog_subject_id_idx
    on public.subjects(catalog_subject_id)
    where catalog_subject_id is not null;

-- Preferências individuais: mesmo em um espaço compartilhado, cada participante
-- controla apenas a própria disposição de widgets.
create table public.user_subject_widgets (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    subject_id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    widget_type text not null
        check (widget_type in ('legal_library', 'personal_vade', 'private_documents', 'community')),
    enabled boolean not null default true,
    position smallint not null default 0 check (position between 0 and 50),
    config jsonb not null default '{}'::jsonb
        check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 20000),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (subject_id, workspace_id)
        references public.subjects(id, workspace_id) on delete cascade,
    unique (subject_id, user_id, widget_type)
);

create index user_subject_widgets_user_idx
    on public.user_subject_widgets(user_id, workspace_id, subject_id, position);

create trigger catalog_subjects_set_updated_at
before update on public.catalog_subjects
for each row execute function private.set_updated_at();

create trigger user_subject_widgets_set_updated_at
before update on public.user_subject_widgets
for each row execute function private.set_updated_at();

alter table public.catalog_subjects enable row level security;
alter table public.catalog_subjects force row level security;
alter table public.user_subject_widgets enable row level security;
alter table public.user_subject_widgets force row level security;

create policy catalog_subjects_select_authenticated
on public.catalog_subjects
for select
to authenticated
using (true);

create policy user_subject_widgets_select_self
on public.user_subject_widgets
for select
to authenticated
using (
    user_id = (select auth.uid())
    and private.is_workspace_member(workspace_id)
);

create policy user_subject_widgets_insert_self
on public.user_subject_widgets
for insert
to authenticated
with check (
    user_id = (select auth.uid())
    and private.is_workspace_member(workspace_id)
);

create policy user_subject_widgets_update_self
on public.user_subject_widgets
for update
to authenticated
using (
    user_id = (select auth.uid())
    and private.is_workspace_member(workspace_id)
)
with check (
    user_id = (select auth.uid())
    and private.is_workspace_member(workspace_id)
);

create policy user_subject_widgets_delete_self
on public.user_subject_widgets
for delete
to authenticated
using (
    user_id = (select auth.uid())
    and private.is_workspace_member(workspace_id)
);

revoke all on table public.catalog_subjects from public, anon, authenticated;
revoke all on table public.user_subject_widgets from public, anon, authenticated;

grant select on table public.catalog_subjects to authenticated;
grant select, insert, update, delete on table public.user_subject_widgets to authenticated;

comment on table public.catalog_subjects is
    'Catálogo global e administrado de tipos de matéria; não contém dados pessoais de estudo.';
comment on column public.subjects.catalog_subject_id is
    'Vínculo opcional e confirmado pelo usuário entre uma matéria do espaço e o catálogo global.';
comment on table public.user_subject_widgets is
    'Preferências privadas de widgets por usuário e por matéria do espaço.';

commit;
