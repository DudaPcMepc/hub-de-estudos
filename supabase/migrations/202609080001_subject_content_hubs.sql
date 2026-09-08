begin;

create table public.catalog_subject_modules (
    id uuid primary key default gen_random_uuid(),
    catalog_subject_id uuid not null references public.catalog_subjects(id) on delete cascade,
    title text not null check (char_length(btrim(title)) between 1 and 180),
    description text not null default '' check (char_length(description) <= 2000),
    position smallint not null default 0 check (position between 0 and 1000),
    status text not null default 'draft' check (status in ('draft', 'published')),
    published_at timestamptz,
    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (id, catalog_subject_id)
);

create table public.catalog_subject_materials (
    id uuid primary key default gen_random_uuid(),
    catalog_subject_id uuid not null references public.catalog_subjects(id) on delete cascade,
    module_id uuid not null,
    kind text not null default 'lesson'
        check (kind in ('lesson', 'summary', 'revision', 'simulation', 'link', 'file')),
    title text not null check (char_length(btrim(title)) between 1 and 240),
    description text not null default '' check (char_length(description) <= 3000),
    body text not null default '' check (char_length(body) <= 200000),
    external_url text,
    position smallint not null default 0 check (position between 0 and 2000),
    status text not null default 'draft' check (status in ('draft', 'published')),
    metadata jsonb not null default '{}'::jsonb
        check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 20000),
    published_at timestamptz,
    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (module_id, catalog_subject_id)
        references public.catalog_subject_modules(id, catalog_subject_id) on delete cascade,
    check (
        external_url is null
        or (
            char_length(external_url) <= 4000
            and external_url ~* '^https://[^[:space:]]+$'
        )
    )
);

create index catalog_subject_modules_lookup_idx
    on public.catalog_subject_modules(catalog_subject_id, status, position, created_at);
create index catalog_subject_materials_lookup_idx
    on public.catalog_subject_materials(catalog_subject_id, module_id, status, position, created_at);

create trigger catalog_subject_modules_set_updated_at
before update on public.catalog_subject_modules
for each row execute function private.set_updated_at();

create trigger catalog_subject_materials_set_updated_at
before update on public.catalog_subject_materials
for each row execute function private.set_updated_at();

alter table public.catalog_subject_modules enable row level security;
alter table public.catalog_subject_modules force row level security;
alter table public.catalog_subject_materials enable row level security;
alter table public.catalog_subject_materials force row level security;

create policy catalog_subject_modules_select_published
on public.catalog_subject_modules for select to authenticated
using (status = 'published');

create policy catalog_subject_materials_select_published
on public.catalog_subject_materials for select to authenticated
using (
    status = 'published'
    and exists (
        select 1
        from public.catalog_subject_modules as module
        where module.id = catalog_subject_materials.module_id
          and module.catalog_subject_id = catalog_subject_materials.catalog_subject_id
          and module.status = 'published'
    )
);

revoke all on table public.catalog_subject_modules from public, anon, authenticated;
revoke all on table public.catalog_subject_materials from public, anon, authenticated;
grant select on table public.catalog_subject_modules to authenticated;
grant select on table public.catalog_subject_materials to authenticated;

comment on table public.catalog_subject_modules is
    'Módulos editoriais globais das matérias-base. Somente conteúdo publicado é visível aos estudantes.';
comment on table public.catalog_subject_materials is
    'Aulas, resumos, revisões, simulados e referências administrados pela plataforma.';

commit;
