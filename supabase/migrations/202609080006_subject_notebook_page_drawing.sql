begin;

alter table public.user_subject_notebook_nodes
    add column drawing_data jsonb not null default '{"strokes":[]}'::jsonb
    check (
        jsonb_typeof(drawing_data) = 'object'
        and jsonb_typeof(coalesce(drawing_data->'strokes', '[]'::jsonb)) = 'array'
        and octet_length(drawing_data::text) <= 2000000
    );

comment on column public.user_subject_notebook_nodes.drawing_data is
    'Traços privados da escrita livre de uma página, preservados separadamente do texto.';

commit;
