import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extrairDispositivos, literalJsonSql, validarDispositivos } from "./import-legal-sources.mjs";

const DOCUMENT_ID = "20000000-0000-4000-8000-000000000011";
const VERSION_ID = "21000000-0000-4000-8000-000000000013";
const PENAL_CATALOG_SUBJECT_ID = "10000000-0000-4000-8000-000000000002";
const CRIMINAL_PROCEDURE_CATALOG_SUBJECT_ID = "10000000-0000-4000-8000-000000000003";
const GUARDS_CATALOG_SUBJECT_ID = "10000000-0000-4000-8000-000000000005";
const HUMAN_RIGHTS_CATALOG_SUBJECT_ID = "10000000-0000-4000-8000-000000000008";
const OFFICIAL_SOURCE_URL = "https://www2.camara.leg.br/legin/fed/lei/1997/lei-9455-7-abril-1997-349431-normaatualizada-pl.html";
const RAIZ = "LEI DOS CRIMES DE TORTURA";

export function normalizarDispositivosLeiTortura(dispositivos) {
    return dispositivos.map(item => ({ ...item, caminho: [RAIZ], titulo: RAIZ }));
}

export function validarIntegridadeLeiTortura(dispositivos) {
    const relatorio = validarDispositivos("Lei dos Crimes de Tortura", dispositivos, {
        ultimoObrigatorio: 4,
        minimo: 4,
        artigosObrigatorios: ["art-1", "art-2", "art-3", "art-4"]
    });
    const texto = dispositivos.map(item => item.conteudo).join("\n");
    const trechosObrigatorios = [
        "Lei nº 15.410, de 20/5/2026",
        "submeter mulher, reiteradamente",
        "o crime é cometido por agente público",
        "inafiançável e insuscetível de graça ou anistia",
        "quando o crime não tenha sido cometido em território nacional"
    ];
    const ausentes = trechosObrigatorios.filter(trecho => !texto.includes(trecho));
    if (dispositivos.length !== 4 || ausentes.length) {
        throw new Error(`Lei de Tortura reprovada: artigos=${dispositivos.length}; trechos ausentes=${ausentes.join(",") || "nenhum"}.`);
    }
    return relatorio;
}

export function gerarMigrationLeiTortura(dispositivos) {
    return `-- Gerado por scripts/import-torture-law.mjs a partir do texto oficial atualizado da Câmara dos Deputados.
-- Não editar os artigos manualmente: execute novamente o importador e revise o relatório estrutural.

begin;

insert into public.legal_documents (
    id, slug, title, short_title, jurisdiction, issuing_body, active
) values (
    '${DOCUMENT_ID}',
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
    '${VERSION_ID}',
    '${DOCUMENT_ID}',
    'Texto atualizado consultado em 01/09/2026',
    'Texto integral da Lei nº 9.455/1997 — arts. 1º a 4º',
    '${OFFICIAL_SOURCE_URL}',
    'Câmara dos Deputados — Lei dos Crimes de Tortura atualizada',
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
values
    ('${PENAL_CATALOG_SUBJECT_ID}', '${DOCUMENT_ID}', 4),
    ('${CRIMINAL_PROCEDURE_CATALOG_SUBJECT_ID}', '${DOCUMENT_ID}', 4),
    ('${GUARDS_CATALOG_SUBJECT_ID}', '${DOCUMENT_ID}', 4),
    ('${HUMAN_RIGHTS_CATALOG_SUBJECT_ID}', '${DOCUMENT_ID}', 1);

commit;
`;
}

async function principal() {
    const argumentos = Object.fromEntries(process.argv.slice(2).reduce((pares, item, indice, todos) => {
        if (item.startsWith("--")) pares.push([item.slice(2), todos[indice + 1]]);
        return pares;
    }, []));
    if (!argumentos.input || !argumentos.out) {
        throw new Error("Uso: node scripts/import-torture-law.mjs --input lei-tortura.html --out migration.sql");
    }

    const html = await readFile(resolve(argumentos.input), "utf8");
    const dispositivos = normalizarDispositivosLeiTortura(extrairDispositivos(html, { raiz: RAIZ }));
    const relatorio = validarIntegridadeLeiTortura(dispositivos);

    await writeFile(resolve(argumentos.out), gerarMigrationLeiTortura(dispositivos), "utf8");
    console.log(JSON.stringify({ relatorio, destino: resolve(argumentos.out) }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1"))) {
    principal().catch(erro => {
        console.error(erro.message);
        process.exitCode = 1;
    });
}
