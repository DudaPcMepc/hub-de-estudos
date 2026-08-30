begin;

create table public.legal_documents (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique
        check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    title text not null check (char_length(title) between 1 and 300),
    short_title text not null check (char_length(short_title) between 1 and 100),
    jurisdiction text not null default 'federal'
        check (jurisdiction in ('federal', 'estadual', 'municipal')),
    issuing_body text not null check (char_length(issuing_body) between 1 and 200),
    active boolean not null default true,
    current_version_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.legal_document_versions (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null references public.legal_documents(id) on delete cascade,
    version_label text not null check (char_length(version_label) between 1 and 200),
    content_scope text not null check (char_length(content_scope) between 1 and 300),
    official_source_url text not null
        check (official_source_url ~ '^https://'),
    official_source_label text not null
        check (char_length(official_source_label) between 1 and 200),
    source_checked_on date not null,
    created_at timestamptz not null default now(),
    unique (id, document_id),
    unique (document_id, version_label)
);

alter table public.legal_documents
    add constraint legal_documents_current_version_fk
    foreign key (current_version_id, id)
    references public.legal_document_versions(id, document_id)
    deferrable initially deferred;

create table public.legal_provisions (
    id uuid primary key default gen_random_uuid(),
    version_id uuid not null references public.legal_document_versions(id) on delete cascade,
    provision_key text not null
        check (provision_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    sequence integer not null check (sequence >= 0),
    heading_path text[] not null default '{}'
        check (cardinality(heading_path) <= 10),
    heading text not null default '' check (char_length(heading) <= 500),
    label text not null check (char_length(label) between 1 and 100),
    content text not null check (char_length(content) between 1 and 50000),
    created_at timestamptz not null default now(),
    unique (version_id, provision_key),
    unique (version_id, sequence)
);

create table public.catalog_subject_documents (
    catalog_subject_id uuid not null references public.catalog_subjects(id) on delete cascade,
    document_id uuid not null references public.legal_documents(id) on delete cascade,
    position smallint not null default 0 check (position between 0 and 100),
    primary key (catalog_subject_id, document_id)
);

create table public.user_legal_highlights (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    subject_id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    provision_id uuid not null references public.legal_provisions(id) on delete cascade,
    selected_text text not null check (char_length(selected_text) between 1 and 2000),
    prefix_text text not null default '' check (char_length(prefix_text) <= 300),
    suffix_text text not null default '' check (char_length(suffix_text) <= 300),
    color text not null default 'yellow'
        check (color in ('yellow', 'green', 'blue', 'pink')),
    note text not null default '' check (char_length(note) <= 5000),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (subject_id, workspace_id)
        references public.subjects(id, workspace_id) on delete cascade
);

create index legal_provisions_version_sequence_idx
    on public.legal_provisions(version_id, sequence);
create index user_legal_highlights_lookup_idx
    on public.user_legal_highlights(user_id, workspace_id, subject_id, provision_id);

create trigger legal_documents_set_updated_at
before update on public.legal_documents
for each row execute function private.set_updated_at();

create trigger user_legal_highlights_set_updated_at
before update on public.user_legal_highlights
for each row execute function private.set_updated_at();

alter table public.legal_documents enable row level security;
alter table public.legal_documents force row level security;
alter table public.legal_document_versions enable row level security;
alter table public.legal_document_versions force row level security;
alter table public.legal_provisions enable row level security;
alter table public.legal_provisions force row level security;
alter table public.catalog_subject_documents enable row level security;
alter table public.catalog_subject_documents force row level security;
alter table public.user_legal_highlights enable row level security;
alter table public.user_legal_highlights force row level security;

create policy legal_documents_select_authenticated
on public.legal_documents for select to authenticated using (active = true);
create policy legal_document_versions_select_authenticated
on public.legal_document_versions for select to authenticated using (true);
create policy legal_provisions_select_authenticated
on public.legal_provisions for select to authenticated using (true);
create policy catalog_subject_documents_select_authenticated
on public.catalog_subject_documents for select to authenticated using (true);

create policy user_legal_highlights_select_self
on public.user_legal_highlights for select to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy user_legal_highlights_insert_self
on public.user_legal_highlights for insert to authenticated
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy user_legal_highlights_update_self
on public.user_legal_highlights for update to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id))
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy user_legal_highlights_delete_self
on public.user_legal_highlights for delete to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

revoke all on table public.legal_documents from public, anon, authenticated;
revoke all on table public.legal_document_versions from public, anon, authenticated;
revoke all on table public.legal_provisions from public, anon, authenticated;
revoke all on table public.catalog_subject_documents from public, anon, authenticated;
revoke all on table public.user_legal_highlights from public, anon, authenticated;

grant select on table public.legal_documents to authenticated;
grant select on table public.legal_document_versions to authenticated;
grant select on table public.legal_provisions to authenticated;
grant select on table public.catalog_subject_documents to authenticated;
grant select, insert, update, delete on table public.user_legal_highlights to authenticated;

insert into public.legal_documents (
    id, slug, title, short_title, jurisdiction, issuing_body, active
) values (
    '20000000-0000-4000-8000-000000000001',
    'constituicao-federal-1988',
    'Constituição da República Federativa do Brasil de 1988',
    'Constituição Federal',
    'federal',
    'Câmara dos Deputados',
    true
);

insert into public.legal_document_versions (
    id, document_id, version_label, content_scope, official_source_url,
    official_source_label, source_checked_on
) values (
    '21000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'Atualizada até a Emenda Constitucional nº 139/2026',
    'Módulo inicial: Título I — arts. 1º a 4º',
    'https://www2.camara.leg.br/atividade-legislativa/legislacao/constituicao1988/arquivos/ConstituicaoTextoAtualizado_EC%20139.html',
    'Câmara dos Deputados — texto atualizado',
    '2026-08-30'
);

update public.legal_documents
set current_version_id = '21000000-0000-4000-8000-000000000001'
where id = '20000000-0000-4000-8000-000000000001';

insert into public.legal_provisions (
    id, version_id, provision_key, sequence, heading_path, heading, label, content
) values
(
    '22000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    'art-1', 1,
    array['TÍTULO I', 'DOS PRINCÍPIOS FUNDAMENTAIS'],
    'Dos Princípios Fundamentais', 'Art. 1º',
    E'A República Federativa do Brasil, formada pela união indissolúvel dos Estados e Municípios e do Distrito Federal, constitui-se em Estado democrático de direito e tem como fundamentos:\n\nI - a soberania;\n\nII - a cidadania;\n\nIII - a dignidade da pessoa humana;\n\nIV - os valores sociais do trabalho e da livre iniciativa;\n\nV - o pluralismo político.\n\nParágrafo único. Todo o poder emana do povo, que o exerce por meio de representantes eleitos ou diretamente, nos termos desta Constituição.'
),
(
    '22000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000001',
    'art-2', 2,
    array['TÍTULO I', 'DOS PRINCÍPIOS FUNDAMENTAIS'],
    'Dos Princípios Fundamentais', 'Art. 2º',
    'São Poderes da União, independentes e harmônicos entre si, o Legislativo, o Executivo e o Judiciário.'
),
(
    '22000000-0000-4000-8000-000000000003',
    '21000000-0000-4000-8000-000000000001',
    'art-3', 3,
    array['TÍTULO I', 'DOS PRINCÍPIOS FUNDAMENTAIS'],
    'Dos Princípios Fundamentais', 'Art. 3º',
    E'Constituem objetivos fundamentais da República Federativa do Brasil:\n\nI - construir uma sociedade livre, justa e solidária;\n\nII - garantir o desenvolvimento nacional;\n\nIII - erradicar a pobreza e a marginalização e reduzir as desigualdades sociais e regionais;\n\nIV - promover o bem de todos, sem preconceitos de origem, raça, sexo, cor, idade e quaisquer outras formas de discriminação.'
),
(
    '22000000-0000-4000-8000-000000000004',
    '21000000-0000-4000-8000-000000000001',
    'art-4', 4,
    array['TÍTULO I', 'DOS PRINCÍPIOS FUNDAMENTAIS'],
    'Dos Princípios Fundamentais', 'Art. 4º',
    E'A República Federativa do Brasil rege-se nas suas relações internacionais pelos seguintes princípios:\n\nI - independência nacional;\n\nII - prevalência dos direitos humanos;\n\nIII - autodeterminação dos povos;\n\nIV - não-intervenção;\n\nV - igualdade entre os Estados;\n\nVI - defesa da paz;\n\nVII - solução pacífica dos conflitos;\n\nVIII - repúdio ao terrorismo e ao racismo;\n\nIX - cooperação entre os povos para o progresso da humanidade;\n\nX - concessão de asilo político.\n\nParágrafo único. A República Federativa do Brasil buscará a integração econômica, política, social e cultural dos povos da América Latina, visando à formação de uma comunidade latino-americana de nações.'
);

insert into public.catalog_subject_documents (catalog_subject_id, document_id, position)
values (
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    0
);

comment on table public.legal_documents is
    'Metadados públicos de normas oficiais compartilhadas por todos os usuários.';
comment on table public.legal_document_versions is
    'Versões verificáveis de normas, sempre vinculadas à fonte oficial e ao escopo importado.';
comment on table public.legal_provisions is
    'Dispositivos estruturados e imutáveis de uma versão de documento jurídico.';
comment on table public.user_legal_highlights is
    'Grifos e notas privados, isolados por usuário, matéria e espaço de estudos.';

commit;
