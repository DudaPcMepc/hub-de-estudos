begin;

create table public.user_vade_notes (
    id uuid primary key default gen_random_uuid(),
    collection_id uuid not null,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    provision_id uuid references public.legal_provisions(id) on delete set null,
    kind text not null default 'note' check (kind in ('note', 'summary')),
    title text not null default '' check (char_length(title) <= 500),
    content text not null default '' check (char_length(content) <= 500000),
    tags text[] not null default '{}',
    pinned boolean not null default false,
    version integer not null default 1 check (version > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (coalesce(array_length(tags, 1), 0) <= 100),
    check (octet_length(tags::text) <= 12000),
    foreign key (collection_id, workspace_id, user_id)
        references public.user_vade_collections(id, workspace_id, user_id) on delete cascade,
    unique (id, workspace_id, user_id)
);

create index user_vade_notes_collection_idx
    on public.user_vade_notes(user_id, workspace_id, collection_id, pinned desc, updated_at desc);
create index user_vade_notes_provision_idx
    on public.user_vade_notes(user_id, workspace_id, provision_id)
    where provision_id is not null;

create trigger user_vade_notes_bump_version
before update on public.user_vade_notes
for each row execute function private.bump_note_version();

alter table public.user_vade_notes enable row level security;
alter table public.user_vade_notes force row level security;

create policy user_vade_notes_select_self
on public.user_vade_notes for select to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy user_vade_notes_insert_self
on public.user_vade_notes for insert to authenticated
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy user_vade_notes_update_self
on public.user_vade_notes for update to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id))
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy user_vade_notes_delete_self
on public.user_vade_notes for delete to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

revoke all on table public.user_vade_notes from public, anon, authenticated;
grant select, insert, update, delete on table public.user_vade_notes to authenticated;

comment on table public.user_vade_notes is
    'Anotações e resumos privados dos cadernos jurídicos, isolados por usuário e preservados quando um artigo sai do caderno.';
comment on column public.user_vade_notes.provision_id is
    'Vínculo opcional com um dispositivo legal; não depende de o artigo continuar salvo no caderno.';
comment on column public.user_vade_notes.kind is
    'Classificação simples da escrita privada: note para anotação e summary para resumo.';

commit;
