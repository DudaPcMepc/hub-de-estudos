import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extrairDispositivos, literalJsonSql, validarDispositivos } from "./import-legal-sources.mjs";

const DOCUMENT_ID = "20000000-0000-4000-8000-000000000007";
const VERSION_ID = "21000000-0000-4000-8000-000000000009";
const GUARDS_CATALOG_SUBJECT_ID = "10000000-0000-4000-8000-000000000005";
const OFFICIAL_SOURCE_URL = "https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l13022.htm";
const RAIZ = "ESTATUTO GERAL DAS GUARDAS MUNICIPAIS";

export function normalizarEstruturaEstatutoGuardas(dispositivos) {
    return dispositivos.map(item => ({
        ...item,
        caminho: item.caminho.map(parte => parte.replace(/COMPETÉNCIAS/gu, "COMPETÊNCIAS")),
        titulo: item.titulo.replace(/COMPETÉNCIAS/gu, "COMPETÊNCIAS")
    }));
}

export function gerarMigrationEstatutoGuardas(dispositivos) {
    return `-- Gerado por scripts/import-municipal-guards-statute.mjs a partir do texto oficial do Planalto.
-- Não editar os artigos manualmente: execute novamente o importador e revise o relatório estrutural.

begin;

insert into public.legal_documents (
    id, slug, title, short_title, jurisdiction, issuing_body, active
) values (
    '${DOCUMENT_ID}',
    'estatuto-geral-guardas-municipais-lei-13022-2014',
    'Estatuto Geral das Guardas Municipais — Lei nº 13.022, de 8 de agosto de 2014',
    'Estatuto das Guardas Municipais',
    'federal',
    'Presidência da República — Casa Civil',
    true
);

insert into public.legal_document_versions (
    id, document_id, version_label, content_scope, official_source_url,
    official_source_label, source_checked_on
) values (
    '${VERSION_ID}',
    '${DOCUMENT_ID}',
    'Texto oficial consultado em 01/09/2026',
    'Texto integral da Lei nº 13.022/2014 — arts. 1º a 23',
    '${OFFICIAL_SOURCE_URL}',
    'Presidência da República — Estatuto Geral das Guardas Municipais',
    '2026-09-01'
);

insert into public.legal_provisions (
    version_id, provision_key, sequence, heading_path, heading, label, content
)
select
    '${VERSION_ID}', item.chave, item.sequencia, item.caminho, item.titulo, item.rotulo, item.conteudo
from jsonb_to_recordset(${literalJsonSql(dispositivos)}::jsonb)
    as item(chave text, sequencia integer, caminho text[], titulo text, rotulo text, conteudo text);

update public.legal_documents
set current_version_id = '${VERSION_ID}'
where id = '${DOCUMENT_ID}';

insert into public.catalog_subject_documents (catalog_subject_id, document_id, position)
values ('${GUARDS_CATALOG_SUBJECT_ID}', '${DOCUMENT_ID}', 0);

commit;
`;
}

async function principal() {
    const argumentos = Object.fromEntries(process.argv.slice(2).reduce((pares, item, indice, todos) => {
        if (item.startsWith("--")) pares.push([item.slice(2), todos[indice + 1]]);
        return pares;
    }, []));
    if (!argumentos.input || !argumentos.out) {
        throw new Error("Uso: node scripts/import-municipal-guards-statute.mjs --input estatuto-guardas.html --out migration.sql");
    }

    const html = await readFile(resolve(argumentos.input), "latin1");
    const dispositivos = normalizarEstruturaEstatutoGuardas(extrairDispositivos(html, { raiz: RAIZ }));
    const relatorio = validarDispositivos("Estatuto Geral das Guardas Municipais", dispositivos, {
        ultimoObrigatorio: 23,
        minimo: 23,
        artigosObrigatorios: ["art-1", "art-3", "art-5", "art-13", "art-18", "art-23"]
    });

    await writeFile(resolve(argumentos.out), gerarMigrationEstatutoGuardas(dispositivos), "utf8");
    console.log(JSON.stringify({ relatorio, destino: resolve(argumentos.out) }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1"))) {
    principal().catch(erro => {
        console.error(erro.message);
        process.exitCode = 1;
    });
}
