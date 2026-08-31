-- Remove metadados editoriais do Planalto que haviam sido anexados aos últimos artigos.
-- Os IDs dos dispositivos permanecem iguais para preservar grifos, favoritos e histórico.

begin;

update public.legal_provisions
set content = 'Revogam-se as disposições em contrário.'
where version_id = '21000000-0000-4000-8000-000000000006'
  and provision_key = 'art-811';

update public.legal_provisions
set content = 'Revogam-se as disposições em contrário.'
where version_id = '21000000-0000-4000-8000-000000000007'
  and provision_key = 'art-7';

commit;
