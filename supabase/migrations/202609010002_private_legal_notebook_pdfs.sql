begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'private-legal-notebook-pdfs',
    'private-legal-notebook-pdfs',
    false,
    26214400,
    array['application/pdf']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table public.user_vade_files (
    id uuid primary key default gen_random_uuid(),
    collection_id uuid not null,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    storage_path text not null unique,
    original_name text not null check (char_length(btrim(original_name)) between 1 and 255),
    display_name text not null check (char_length(btrim(display_name)) between 1 and 200),
    description text not null default '' check (char_length(description) <= 1000),
    mime_type text not null default 'application/pdf' check (mime_type = 'application/pdf'),
    size_bytes bigint not null check (size_bytes between 1 and 26214400),
    upload_status text not null default 'pending' check (upload_status in ('pending', 'ready')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (collection_id, workspace_id, user_id)
        references public.user_vade_collections(id, workspace_id, user_id) on delete restrict,
    check (
        storage_path = concat(
            user_id::text, '/', workspace_id::text, '/', collection_id::text, '/', id::text, '.pdf'
        )
    ),
    unique (id, workspace_id, user_id)
);

create index user_vade_files_collection_idx
    on public.user_vade_files(user_id, workspace_id, collection_id, updated_at desc);

create or replace function private.limit_user_vade_files()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.user_id is distinct from (select auth.uid())
       or not private.is_workspace_member(new.workspace_id) then
        raise exception 'O PDF precisa pertencer ao usuário e ao espaço autenticados.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(new.collection_id::text, 0));
    if (
        select count(*)
        from public.user_vade_files as file
        where file.collection_id = new.collection_id
          and file.workspace_id = new.workspace_id
          and file.user_id = new.user_id
    ) >= 20 then
        raise exception 'Cada caderno pode conter no máximo 20 PDFs privados.';
    end if;
    return new;
end;
$$;

create or replace function private.protect_user_vade_file_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.id is distinct from old.id
       or new.collection_id is distinct from old.collection_id
       or new.workspace_id is distinct from old.workspace_id
       or new.user_id is distinct from old.user_id
       or new.storage_path is distinct from old.storage_path
       or new.original_name is distinct from old.original_name
       or new.mime_type is distinct from old.mime_type
       or new.size_bytes is distinct from old.size_bytes then
        raise exception 'A identidade do PDF é imutável. Remova e envie o arquivo novamente.';
    end if;
    if new.upload_status is distinct from old.upload_status
       and not (old.upload_status = 'pending' and new.upload_status = 'ready') then
        raise exception 'O estado do envio só pode avançar de pendente para pronto.';
    end if;
    return new;
end;
$$;

create trigger user_vade_files_limit
before insert on public.user_vade_files
for each row execute function private.limit_user_vade_files();

create trigger user_vade_files_set_updated_at
before update on public.user_vade_files
for each row execute function private.set_updated_at();

create trigger user_vade_files_protect_identity
before update on public.user_vade_files
for each row execute function private.protect_user_vade_file_identity();

alter table public.user_vade_files enable row level security;
alter table public.user_vade_files force row level security;

create policy user_vade_files_select_self
on public.user_vade_files for select to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy user_vade_files_insert_self
on public.user_vade_files for insert to authenticated
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy user_vade_files_update_self
on public.user_vade_files for update to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id))
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy private_legal_notebook_pdfs_select_self
on storage.objects for select to authenticated
using (
    bucket_id = 'private-legal-notebook-pdfs'
    and exists (
        select 1
        from public.user_vade_files as file
        where file.storage_path = storage.objects.name
          and file.user_id = (select auth.uid())
          and file.upload_status = 'ready'
          and private.is_workspace_member(file.workspace_id)
    )
);

create policy private_legal_notebook_pdfs_insert_self
on storage.objects for insert to authenticated
with check (
    bucket_id = 'private-legal-notebook-pdfs'
    and exists (
        select 1
        from public.user_vade_files as file
        where file.storage_path = storage.objects.name
          and file.user_id = (select auth.uid())
          and file.upload_status = 'pending'
          and private.is_workspace_member(file.workspace_id)
    )
);

create policy private_legal_notebook_pdfs_delete_self
on storage.objects for delete to authenticated
using (
    bucket_id = 'private-legal-notebook-pdfs'
    and exists (
        select 1
        from public.user_vade_files as file
        where file.storage_path = storage.objects.name
          and file.user_id = (select auth.uid())
          and private.is_workspace_member(file.workspace_id)
    )
);

create or replace function public.finalize_user_vade_file(p_file_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    target_path text;
begin
    if current_user_id is null or p_file_id is null then
        raise exception 'Sessão ou arquivo inválido.';
    end if;

    select file.storage_path
    into target_path
    from public.user_vade_files as file
    where file.id = p_file_id
      and file.user_id = current_user_id
      and private.is_workspace_member(file.workspace_id)
    for update;

    if target_path is null then
        raise exception 'PDF privado não encontrado para este usuário.';
    end if;
    if not exists (
        select 1
        from storage.objects as object
        where object.bucket_id = 'private-legal-notebook-pdfs'
          and object.name = target_path
    ) then
        raise exception 'O arquivo ainda não foi confirmado no armazenamento privado.';
    end if;

    update public.user_vade_files as file
    set upload_status = 'ready'
    where file.id = p_file_id
      and file.user_id = current_user_id
      and file.upload_status = 'pending';
    return p_file_id;
end;
$$;

create or replace function public.reconcile_user_vade_files(p_collection_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    recovered_count integer := 0;
    removed_count integer := 0;
begin
    if current_user_id is null or p_collection_id is null then
        raise exception 'Sessão ou caderno inválido.';
    end if;
    if not exists (
        select 1
        from public.user_vade_collections as collection
        where collection.id = p_collection_id
          and collection.user_id = current_user_id
          and private.is_workspace_member(collection.workspace_id)
    ) then
        raise exception 'Caderno jurídico não encontrado para este usuário.';
    end if;

    update public.user_vade_files as file
    set upload_status = 'ready'
    where file.collection_id = p_collection_id
      and file.user_id = current_user_id
      and file.upload_status = 'pending'
      and exists (
          select 1
          from storage.objects as object
          where object.bucket_id = 'private-legal-notebook-pdfs'
            and object.name = file.storage_path
      );
    get diagnostics recovered_count = row_count;

    delete from public.user_vade_files as file
    where file.collection_id = p_collection_id
      and file.user_id = current_user_id
      and file.upload_status = 'pending'
      and file.created_at < now() - interval '15 minutes'
      and not exists (
          select 1
          from storage.objects as object
          where object.bucket_id = 'private-legal-notebook-pdfs'
            and object.name = file.storage_path
      );
    get diagnostics removed_count = row_count;

    return jsonb_build_object('recovered', recovered_count, 'removed', removed_count);
end;
$$;

create or replace function public.remove_user_vade_file_metadata(p_file_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    target_path text;
begin
    if current_user_id is null or p_file_id is null then
        raise exception 'Sessão ou arquivo inválido.';
    end if;

    select file.storage_path
    into target_path
    from public.user_vade_files as file
    where file.id = p_file_id
      and file.user_id = current_user_id
      and private.is_workspace_member(file.workspace_id)
    for update;

    if target_path is null then
        raise exception 'PDF privado não encontrado para este usuário.';
    end if;
    if exists (
        select 1
        from storage.objects as object
        where object.bucket_id = 'private-legal-notebook-pdfs'
          and object.name = target_path
    ) then
        raise exception 'Remova o arquivo do armazenamento antes de apagar seu cadastro.';
    end if;

    delete from public.user_vade_files as file
    where file.id = p_file_id
      and file.user_id = current_user_id;
    return p_file_id;
end;
$$;

revoke all on table public.user_vade_files from public, anon, authenticated;
grant select, insert on table public.user_vade_files to authenticated;
grant update (display_name, description) on table public.user_vade_files to authenticated;

revoke all on function private.limit_user_vade_files() from public, anon, authenticated;
revoke all on function private.protect_user_vade_file_identity() from public, anon, authenticated;
revoke all on function public.finalize_user_vade_file(uuid) from public, anon, authenticated;
revoke all on function public.reconcile_user_vade_files(uuid) from public, anon, authenticated;
revoke all on function public.remove_user_vade_file_metadata(uuid) from public, anon, authenticated;
grant execute on function public.finalize_user_vade_file(uuid) to authenticated;
grant execute on function public.reconcile_user_vade_files(uuid) to authenticated;
grant execute on function public.remove_user_vade_file_metadata(uuid) to authenticated;

comment on table public.user_vade_files is
    'Metadados privados dos PDFs anexados a Cadernos jurídicos; o arquivo fica em bucket privado e nunca possui URL pública permanente.';
comment on column public.user_vade_files.storage_path is
    'Caminho imutável formado por usuário, espaço, caderno e identificador do arquivo.';
comment on column public.user_vade_files.size_bytes is
    'Tamanho validado do PDF, limitado a 25 MiB tanto na tabela quanto no bucket.';
comment on column public.user_vade_files.upload_status is
    'Estado interno do envio: pending enquanto o objeto é enviado e ready após confirmação no Storage.';
comment on function public.finalize_user_vade_file(uuid) is
    'Confirma o PDF como pronto somente depois que o objeto correspondente existir no Storage privado.';
comment on function public.reconcile_user_vade_files(uuid) is
    'Recupera envios concluídos sem confirmação e remove metadados pendentes abandonados há mais de 15 minutos.';
comment on function public.remove_user_vade_file_metadata(uuid) is
    'Remove o cadastro privado somente depois que o objeto correspondente deixou de existir no Storage.';

commit;
