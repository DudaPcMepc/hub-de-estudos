begin;

alter table public.user_vade_files
    add column page_count integer,
    add column last_page integer not null default 1,
    add column last_read_at timestamptz,
    add constraint user_vade_files_page_count_check
        check (page_count is null or page_count between 1 and 100000),
    add constraint user_vade_files_last_page_check
        check (last_page between 1 and 100000),
    add constraint user_vade_files_reading_progress_check
        check (page_count is null or last_page <= page_count);

grant update (page_count, last_page, last_read_at)
on table public.user_vade_files to authenticated;

comment on column public.user_vade_files.page_count is
    'Total de páginas informado pelo proprietário para calcular o progresso privado de leitura.';
comment on column public.user_vade_files.last_page is
    'Última página marcada pelo proprietário; usada para retomar a leitura no leitor nativo.';
comment on column public.user_vade_files.last_read_at is
    'Momento da última abertura ou atualização do progresso privado do PDF.';

commit;
