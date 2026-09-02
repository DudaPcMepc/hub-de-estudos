import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extrairDispositivos, literalJsonSql, validarDispositivos } from "./import-legal-sources.mjs";

const DOCUMENT_ID = "20000000-0000-4000-8000-000000000012";
const VERSION_ID = "21000000-0000-4000-8000-000000000014";
const PENAL_CATALOG_SUBJECT_ID = "10000000-0000-4000-8000-000000000002";
const CRIMINAL_PROCEDURE_CATALOG_SUBJECT_ID = "10000000-0000-4000-8000-000000000003";
const GUARDS_CATALOG_SUBJECT_ID = "10000000-0000-4000-8000-000000000005";
const OFFICIAL_SOURCE_URL = "https://www.planalto.gov.br/ccivil_03/_ato2004-2006/2006/lei/l11343.htm";
const RAIZ = "LEI DE DROGAS";

function normalizarTexto(texto) {
    return String(texto || "")
        .replace(/SIS\s+TEMA/gu, "SISTEMA")
        .replace(/\s+([,.;:])/gu, "$1");
}

function rotuloNormalizado(item) {
    const artigo = item.chave.match(/^art-(\d+)(?:-(.+))?$/u);
    if (!artigo?.[2]) return item.rotulo;
    const numero = Number(artigo[1]);
    return `Art. ${numero}${numero <= 9 ? "º" : ""}-${artigo[2].toUpperCase()}`;
}

export function normalizarDispositivosLeiDrogas(dispositivos) {
    const porChave = new Map();
    for (const item of dispositivos) porChave.set(item.chave, item);

    return [...porChave.values()].map((item, indice) => {
        const caminho = item.caminho.map(normalizarTexto).map(parte => {
            if (parte === "CAPÍTULO II — A") return "CAPÍTULO II-A";
            if (parte === "TÍTULO V — A") return "TÍTULO V-A — DO FINANCIAMENTO DAS POLÍTICAS SOBRE DROGAS";
            return parte;
        });
        return {
            ...item,
            sequencia: indice + 1,
            caminho,
            titulo: caminho.at(-1) || RAIZ,
            rotulo: rotuloNormalizado(item),
            conteudo: normalizarTexto(item.conteudo)
        };
    });
}

export function validarIntegridadeLeiDrogas(dispositivos) {
    const relatorio = validarDispositivos("Lei de Drogas", dispositivos, {
        ultimoObrigatorio: 75,
        minimo: 100,
        artigosObrigatorios: [
            "art-1", "art-7-a", "art-8-f", "art-19-a", "art-23-a", "art-23-b",
            "art-26-a", "art-28", "art-33", "art-40-a", "art-50-a", "art-60-a",
            "art-62-a", "art-63-f", "art-67-a", "art-75"
        ]
    });
    const texto = dispositivos.map(item => item.conteudo).join("\n");
    const trechosObrigatorios = [
        "Sistema Nacional de Políticas Públicas sobre Drogas",
        "Lei nº 15.581, de 2025",
        "Lei nº 15.358, de 2026",
        "organização criminosa ultraviolenta",
        "prática, habitual ou não, dos crimes definidos nesta Lei",
        "inafiançáveis e insuscetíveis de sursis"
    ];
    const ausentes = trechosObrigatorios.filter(trecho => !texto.includes(trecho));
    const chaves = dispositivos.map(item => item.chave);
    const duplicadas = chaves.filter((chave, indice) => chaves.indexOf(chave) !== indice);
    const textoCorrompido = /�|SIS TEMA/u.test(texto) || dispositivos.some(item => /�|SIS TEMA/u.test(item.titulo));
    const artigo61 = dispositivos.find(item => item.chave === "art-61");
    if (dispositivos.length !== 100 || ausentes.length || duplicadas.length || textoCorrompido || !artigo61?.conteudo.includes("habitual ou não")) {
        throw new Error(`Lei de Drogas reprovada: artigos=${dispositivos.length}; trechos ausentes=${ausentes.join(",") || "nenhum"}; duplicados=${duplicadas.join(",") || "nenhum"}; texto corrompido=${textoCorrompido}.`);
    }
    return relatorio;
}

export function gerarMigrationLeiDrogas(dispositivos) {
    return `-- Gerado por scripts/import-drug-law.mjs a partir do texto compilado oficial do Planalto.
-- O importador elimina a redação anterior duplicada do art. 61 e preserva apenas o texto vigente.
-- Não editar o conteúdo manualmente: execute novamente o importador e revise o relatório estrutural.

begin;

insert into public.legal_documents (
    id, slug, title, short_title, jurisdiction, issuing_body, active
) values (
    '${DOCUMENT_ID}',
    'lei-drogas-11343-2006',
    'Lei de Drogas — Lei nº 11.343, de 23 de agosto de 2006',
    'Lei de Drogas',
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
    'Texto compilado consultado em 01/09/2026',
    'Texto integral da Lei nº 11.343/2006 — arts. 1º a 75 e artigos acrescidos',
    '${OFFICIAL_SOURCE_URL}',
    'Presidência da República — Lei de Drogas compilada',
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
    ('${PENAL_CATALOG_SUBJECT_ID}', '${DOCUMENT_ID}', 5),
    ('${CRIMINAL_PROCEDURE_CATALOG_SUBJECT_ID}', '${DOCUMENT_ID}', 5),
    ('${GUARDS_CATALOG_SUBJECT_ID}', '${DOCUMENT_ID}', 5);

commit;
`;
}

async function principal() {
    const argumentos = Object.fromEntries(process.argv.slice(2).reduce((pares, item, indice, todos) => {
        if (item.startsWith("--")) pares.push([item.slice(2), todos[indice + 1]]);
        return pares;
    }, []));
    if (!argumentos.input || !argumentos.out) {
        throw new Error("Uso: node scripts/import-drug-law.mjs --input lei-drogas.html --out migration.sql");
    }

    const html = await readFile(resolve(argumentos.input), "latin1");
    const extraidos = extrairDispositivos(html, { raiz: RAIZ });
    const dispositivos = normalizarDispositivosLeiDrogas(extraidos);
    const relatorio = validarIntegridadeLeiDrogas(dispositivos);

    await writeFile(resolve(argumentos.out), gerarMigrationLeiDrogas(dispositivos), "utf8");
    console.log(JSON.stringify({ relatorio, destino: resolve(argumentos.out) }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1"))) {
    principal().catch(erro => {
        console.error(erro.message);
        process.exitCode = 1;
    });
}
