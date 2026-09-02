-- Gerado por scripts/import-torture-law.mjs a partir do texto oficial atualizado da Câmara dos Deputados.
-- Não editar os artigos manualmente: execute novamente o importador e revise o relatório estrutural.

begin;

insert into public.legal_documents (
    id, slug, title, short_title, jurisdiction, issuing_body, active
) values (
    '20000000-0000-4000-8000-000000000011',
    'tortura-lei-9455-1997',
    'Lei dos Crimes de Tortura — Lei nº 9.455, de 7 de abril de 1997',
    'Lei de Tortura',
    'federal',
    'Câmara dos Deputados',
    true
);

insert into public.legal_document_versions (
    id, document_id, version_label, content_scope, official_source_url,
    official_source_label, source_checked_on
) values (
    '21000000-0000-4000-8000-000000000013',
    '20000000-0000-4000-8000-000000000011',
    'Texto atualizado consultado em 01/09/2026',
    'Texto integral da Lei nº 9.455/1997 — arts. 1º a 4º',
    'https://www2.camara.leg.br/legin/fed/lei/1997/lei-9455-7-abril-1997-349431-normaatualizada-pl.html',
    'Câmara dos Deputados — Lei dos Crimes de Tortura atualizada',
    '2026-09-01'
);

insert into public.legal_provisions (
    version_id, provision_key, sequence, heading_path, heading, label, content
)
select
    '21000000-0000-4000-8000-000000000013', item.chave, item.sequencia, item.caminho, item.titulo, item.rotulo, item.conteudo
from jsonb_to_recordset($dados$[{"chave":"art-1","sequencia":1,"caminho":["LEI DOS CRIMES DE TORTURA"],"titulo":"LEI DOS CRIMES DE TORTURA","rotulo":"Art. 1º","conteudo":"Constitui crime de tortura:\n\nI - constranger alguém com emprego de violência ou grave ameaça, causando-lhe sofrimento físico ou mental:\n\na) com o fim de obter informação, declaração ou confissão da vítima ou de terceira pessoa;\n\nb) para provocar ação ou omissão de natureza criminosa;\n\nc) em razão de discriminação racial ou religiosa;\n\nII - submeter alguém, sob sua guarda, poder ou autoridade, com emprego de violência ou grave ameaça, a intenso sofrimento físico ou mental, como forma de aplicar castigo pessoal ou medida de caráter preventivo.\n\nIII - submeter mulher, reiteradamente, a intenso sofrimento físico ou mental, no contexto de violência doméstica e familiar, sem prejuízo da aplicação das penas correspondentes a outras infrações penais. (Inciso acrescido pela Lei nº 15.410, de 20/5/2026)\n\nPena - reclusão, de dois a oito anos.\n\n§ 1º Na mesma pena incorre quem submete pessoa presa ou sujeita a medida de segurança a sofrimento físico ou mental, por intermédio da prática de ato não previsto em lei ou não resultante de medida legal.\n\n§ 2º Aquele que se omite em face dessas condutas, quando tinha o dever de evitá-las ou apurá-las, incorre na pena de detenção de um a quatro anos.\n\n§ 3º Se resulta lesão corporal de natureza grave ou gravíssima, a pena é de reclusão de quatro a dez anos; se resulta morte, a reclusão é de oito a dezesseis anos.\n\n§ 4º Aumenta-se a pena de um sexto até um terço:\n\nI - se o crime é cometido por agente público;\n\nII - se o crime é cometido contra criança, gestante, portador de deficiência, adolescente ou maior de 60 (sessenta) anos; (Inciso com redação dada pela Lei nº 10.741, de 1º/10/2003, publicada no DOU de 3/10/2003, em vigor 90 dias após a publicação).\n\nIII - se o crime é cometido mediante seqüestro.\n\n§ 5º A condenação acarretará a perda do cargo, função ou emprego público e a interdição para seu exercício pelo dobro do prazo da pena aplicada.\n\n§ 6º O crime de tortura é inafiançável e insuscetível de graça ou anistia.\n\n§ 7º O condenado por crime previsto nesta Lei, salvo a hipótese do § 2º, iniciará o cumprimento da pena em regime fechado."},{"chave":"art-2","sequencia":2,"caminho":["LEI DOS CRIMES DE TORTURA"],"titulo":"LEI DOS CRIMES DE TORTURA","rotulo":"Art. 2º","conteudo":"O disposto nesta Lei aplica-se ainda quando o crime não tenha sido cometido em território nacional, sendo a vítima brasileira ou encontrando-se o agente em local sob jurisdição brasileira."},{"chave":"art-3","sequencia":3,"caminho":["LEI DOS CRIMES DE TORTURA"],"titulo":"LEI DOS CRIMES DE TORTURA","rotulo":"Art. 3º","conteudo":"Esta Lei entra em vigor na data de sua publicação."},{"chave":"art-4","sequencia":4,"caminho":["LEI DOS CRIMES DE TORTURA"],"titulo":"LEI DOS CRIMES DE TORTURA","rotulo":"Art. 4º","conteudo":"Revoga-se o art. 233 da Lei nº 8.069, de 13 de julho de 1990 - Estatuto da Criança e do Adolescente."}]$dados$::jsonb)
    as item(chave text, sequencia integer, caminho text[], titulo text, rotulo text, conteudo text);

update public.legal_documents
set current_version_id = '21000000-0000-4000-8000-000000000013'
where id = '20000000-0000-4000-8000-000000000011';

insert into public.catalog_subject_documents (catalog_subject_id, document_id, position)
values
    ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000011', 4),
    ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000011', 4),
    ('10000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000011', 4),
    ('10000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000011', 1);

commit;
