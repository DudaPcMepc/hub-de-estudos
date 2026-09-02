import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extrairDispositivos, literalJsonSql, validarDispositivos } from "./import-legal-sources.mjs";

const DOCUMENT_ID = "20000000-0000-4000-8000-000000000010";
const VERSION_ID = "21000000-0000-4000-8000-000000000012";
const PENAL_CATALOG_SUBJECT_ID = "10000000-0000-4000-8000-000000000002";
const CRIMINAL_PROCEDURE_CATALOG_SUBJECT_ID = "10000000-0000-4000-8000-000000000003";
const GUARDS_CATALOG_SUBJECT_ID = "10000000-0000-4000-8000-000000000005";
const OFFICIAL_SOURCE_URL = "https://www2.camara.leg.br/legin/fed/lei/1990/lei-8072-25-julho-1990-372192-normaatualizada-pl.html";
const RAIZ = "LEI DOS CRIMES HEDIONDOS";
const ARTIGOS_CODIGO_PENAL_CITADOS = new Set(["art-159", "art-213", "art-214", "art-223", "art-267", "art-270"]);

export function normalizarDispositivosCrimesHediondos(dispositivos) {
    const artigo6 = dispositivos.find(item => item.chave === "art-6");
    const citados = dispositivos.filter(item => ARTIGOS_CODIGO_PENAL_CITADOS.has(item.chave));
    if (!artigo6 || citados.length !== ARTIGOS_CODIGO_PENAL_CITADOS.size) {
        throw new Error("As alterações do Código Penal citadas no art. 6º não foram reconhecidas integralmente.");
    }
    artigo6.conteudo = `${artigo6.conteudo}\n\n${citados.map(item => `${item.rotulo} ${item.conteudo}`).join("\n\n")}\n\n”`;

    return dispositivos
        .filter(item => {
            const numero = Number(item.chave.match(/^art-(\d+)$/u)?.[1]);
            return Number.isInteger(numero) && numero >= 1 && numero <= 13;
        })
        .map((item, indice) => ({
            ...item,
            sequencia: indice + 1,
            caminho: [RAIZ],
            titulo: RAIZ
        }));
}

export function validarIntegridadeCrimesHediondos(dispositivos) {
    const relatorio = validarDispositivos("Lei dos Crimes Hediondos", dispositivos, {
        ultimoObrigatorio: 13,
        minimo: 13,
        artigosObrigatorios: ["art-1", "art-2", "art-5", "art-6", "art-7", "art-13"]
    });
    const texto = dispositivos.map(item => item.conteudo).join("\n");
    const trechosObrigatorios = [
        "vicaricídio",
        "Lei nº 15.384, de 9/4/2026",
        "Lei nº 15.487, de 6/8/2026",
        "Lei nº 15.358, de 24/3/2026",
        "Art. 270."
    ];
    const ausentes = trechosObrigatorios.filter(trecho => !texto.includes(trecho));
    const artigosEstranhos = dispositivos.filter(item => Number(item.chave.slice(4)) > 13).map(item => item.chave);
    if (dispositivos.length !== 13 || ausentes.length || artigosEstranhos.length) {
        throw new Error(`Lei dos Crimes Hediondos reprovada: artigos=${dispositivos.length}; trechos ausentes=${ausentes.join(",") || "nenhum"}; artigos estranhos=${artigosEstranhos.join(",") || "nenhum"}.`);
    }
    return relatorio;
}

export function gerarMigrationCrimesHediondos(dispositivos) {
    return `-- Gerado por scripts/import-heinous-crimes-law.mjs a partir do texto oficial atualizado da Câmara dos Deputados.
-- Os artigos de outros diplomas citados nos arts. 5º a 10 permanecem dentro do dispositivo que os alterou.
-- Não editar o conteúdo manualmente: execute novamente o importador e revise o relatório estrutural.

begin;

insert into public.legal_documents (
    id, slug, title, short_title, jurisdiction, issuing_body, active
) values (
    '${DOCUMENT_ID}',
    'crimes-hediondos-lei-8072-1990',
    'Lei dos Crimes Hediondos — Lei nº 8.072, de 25 de julho de 1990',
    'Crimes Hediondos',
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
    'Texto integral da Lei nº 8.072/1990 — arts. 1º a 13',
    '${OFFICIAL_SOURCE_URL}',
    'Câmara dos Deputados — Lei dos Crimes Hediondos atualizada',
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
    ('${PENAL_CATALOG_SUBJECT_ID}', '${DOCUMENT_ID}', 3),
    ('${CRIMINAL_PROCEDURE_CATALOG_SUBJECT_ID}', '${DOCUMENT_ID}', 3),
    ('${GUARDS_CATALOG_SUBJECT_ID}', '${DOCUMENT_ID}', 3);

commit;
`;
}

async function principal() {
    const argumentos = Object.fromEntries(process.argv.slice(2).reduce((pares, item, indice, todos) => {
        if (item.startsWith("--")) pares.push([item.slice(2), todos[indice + 1]]);
        return pares;
    }, []));
    if (!argumentos.input || !argumentos.out) {
        throw new Error("Uso: node scripts/import-heinous-crimes-law.mjs --input crimes-hediondos.html --out migration.sql");
    }

    const html = await readFile(resolve(argumentos.input), "utf8");
    const extraidos = extrairDispositivos(html, { raiz: RAIZ });
    const dispositivos = normalizarDispositivosCrimesHediondos(extraidos);
    const relatorio = validarIntegridadeCrimesHediondos(dispositivos);

    await writeFile(resolve(argumentos.out), gerarMigrationCrimesHediondos(dispositivos), "utf8");
    console.log(JSON.stringify({ relatorio, destino: resolve(argumentos.out) }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1"))) {
    principal().catch(erro => {
        console.error(erro.message);
        process.exitCode = 1;
    });
}
