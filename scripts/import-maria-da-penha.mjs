import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extrairDispositivos, literalJsonSql, validarDispositivos } from "./import-legal-sources.mjs";

const DOCUMENT_ID = "20000000-0000-4000-8000-000000000009";
const VERSION_ID = "21000000-0000-4000-8000-000000000011";
const PENAL_CATALOG_SUBJECT_ID = "10000000-0000-4000-8000-000000000002";
const CRIMINAL_PROCEDURE_CATALOG_SUBJECT_ID = "10000000-0000-4000-8000-000000000003";
const GUARDS_CATALOG_SUBJECT_ID = "10000000-0000-4000-8000-000000000005";
const HUMAN_RIGHTS_CATALOG_SUBJECT_ID = "10000000-0000-4000-8000-000000000008";
const OFFICIAL_SOURCE_URL = "https://www2.camara.leg.br/legin/fed/lei/2006/lei-11340-7-agosto-2006-545133-normaatualizada-pl.html";
const RAIZ = "LEI MARIA DA PENHA";

function rotuloNormalizado(item) {
    const artigo = item.chave.match(/^art-(\d+)(?:-(.+))?$/u);
    if (!artigo?.[2]) return item.rotulo;
    const numero = Number(artigo[1]);
    return `Art. ${numero}${numero <= 9 ? "º" : ""}-${artigo[2].toUpperCase()}`;
}

export function normalizarDispositivosMariaDaPenha(dispositivos) {
    return dispositivos.map(item => ({ ...item, rotulo: rotuloNormalizado(item) }));
}

export function validarIntegridadeMariaDaPenha(dispositivos) {
    const relatorio = validarDispositivos("Lei Maria da Penha", dispositivos, {
        ultimoObrigatorio: 46,
        minimo: 57,
        artigosObrigatorios: [
            "art-1", "art-10-a", "art-12-a", "art-12-d", "art-14-a", "art-16-a",
            "art-17-a", "art-24-a", "art-38-a", "art-40-a", "art-46"
        ]
    });
    const texto = dispositivos.map(item => item.conteudo).join("\n");
    const trechosObrigatorios = [
        "Lei nº 15.455, de 1º/7/2026",
        "Lei nº 15.411, de 20/5/2026",
        "Lei nº 15.383, de 9/4/2026",
        "Lei nº 15.412, de 20/5/2026",
        "monitoração eletrônica"
    ];
    const ausentes = trechosObrigatorios.filter(trecho => !texto.includes(trecho));
    if (dispositivos.length !== 57 || ausentes.length) {
        throw new Error(`Lei Maria da Penha reprovada: artigos=${dispositivos.length}; trechos ausentes=${ausentes.join(",") || "nenhum"}.`);
    }
    return relatorio;
}

export function gerarMigrationMariaDaPenha(dispositivos) {
    return `-- Gerado por scripts/import-maria-da-penha.mjs a partir do texto oficial atualizado da Câmara dos Deputados.
-- Não editar os artigos manualmente: execute novamente o importador e revise o relatório estrutural.

begin;

insert into public.legal_documents (
    id, slug, title, short_title, jurisdiction, issuing_body, active
) values (
    '${DOCUMENT_ID}',
    'lei-maria-penha-11340-2006',
    'Lei Maria da Penha — Lei nº 11.340, de 7 de agosto de 2006',
    'Lei Maria da Penha',
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
    'Texto integral da Lei nº 11.340/2006 — arts. 1º a 46 e artigos acrescidos',
    '${OFFICIAL_SOURCE_URL}',
    'Câmara dos Deputados — Lei Maria da Penha atualizada',
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
    ('${PENAL_CATALOG_SUBJECT_ID}', '${DOCUMENT_ID}', 2),
    ('${CRIMINAL_PROCEDURE_CATALOG_SUBJECT_ID}', '${DOCUMENT_ID}', 2),
    ('${GUARDS_CATALOG_SUBJECT_ID}', '${DOCUMENT_ID}', 2),
    ('${HUMAN_RIGHTS_CATALOG_SUBJECT_ID}', '${DOCUMENT_ID}', 0);

commit;
`;
}

async function principal() {
    const argumentos = Object.fromEntries(process.argv.slice(2).reduce((pares, item, indice, todos) => {
        if (item.startsWith("--")) pares.push([item.slice(2), todos[indice + 1]]);
        return pares;
    }, []));
    if (!argumentos.input || !argumentos.out) {
        throw new Error("Uso: node scripts/import-maria-da-penha.mjs --input lei-maria-da-penha.html --out migration.sql");
    }

    const html = await readFile(resolve(argumentos.input), "utf8");
    const dispositivos = normalizarDispositivosMariaDaPenha(extrairDispositivos(html, { raiz: RAIZ }));
    const relatorio = validarIntegridadeMariaDaPenha(dispositivos);

    await writeFile(resolve(argumentos.out), gerarMigrationMariaDaPenha(dispositivos), "utf8");
    console.log(JSON.stringify({ relatorio, destino: resolve(argumentos.out) }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1"))) {
    principal().catch(erro => {
        console.error(erro.message);
        process.exitCode = 1;
    });
}
