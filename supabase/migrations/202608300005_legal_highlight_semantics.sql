begin;

alter table public.user_legal_highlights
    drop constraint user_legal_highlights_color_check;

alter table public.user_legal_highlights
    add constraint user_legal_highlights_color_check
    check (color in ('yellow', 'red', 'green', 'blue', 'pink'));

comment on column public.user_legal_highlights.color is
    'Cor didática do grifo: yellow=regra, red=exceção/prazo, green=competência, blue=sanção; pink é mantido para compatibilidade.';

commit;
