import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
    blocosDoHtml,
    extrairDispositivos,
    literalJsonSql,
    validarDispositivos
} from "./import-legal-sources.mjs";

const DOCUMENT_ID = "20000000-0000-4000-8000-000000000006";
const VERSION_ID = "21000000-0000-4000-8000-000000000008";
const TRAFFIC_CATALOG_SUBJECT_ID = "10000000-0000-4000-8000-000000000006";
const OFFICIAL_SOURCE_URL = "https://www.planalto.gov.br/ccivil_03/leis/l9503compilado.htm";
const RAIZ = "CÓDIGO DE TRÂNSITO BRASILEIRO";
const CAMINHO_GLOSSARIO = "ANEXO I — DOS CONCEITOS E DEFINIÇÕES";

function slugSeguro(texto) {
    return texto
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

export function extrairGlossarioAnexoI(html, { sequenciaInicial = 1 } = {}) {
    const blocos = blocosDoHtml(html);
    const inicio = blocos.findIndex(bloco => bloco === "ANEXO I");
    if (inicio < 0) throw new Error("O Anexo I do CTB não foi encontrado na fonte oficial.");

    const termos = [];
    for (const bloco of blocos.slice(inicio + 1)) {
        if (bloco === "*" || /^\(Vide Resolução/iu.test(bloco)) break;
        const resultado = bloco.match(/^(.{2,100}?)\s+-\s+(.+)$/u);
        if (!resultado) continue;
        const termo = resultado[1].trim();
        const definicao = resultado[2].trim();
        termos.push({
            chave: `glossario-${slugSeguro(termo)}`,
            sequencia: sequenciaInicial + termos.length,
            caminho: [RAIZ, CAMINHO_GLOSSARIO],
            titulo: "Glossário oficial",
            rotulo: termo,
            conteudo: definicao
        });
    }
    return termos;
}

export function validarGlossarioCtb(termos) {
    const chaves = termos.map(item => item.chave);
    const duplicadas = chaves.filter((chave, indice) => chaves.indexOf(chave) !== indice);
    const obrigatorias = [
        "glossario-acostamento",
        "glossario-luz-indicadora-de-direcao-pisca-pisca",
        "glossario-transito",
        "glossario-veiculo-automotor"
    ];
    const ausentes = obrigatorias.filter(chave => !chaves.includes(chave));
    const invalidos = termos.filter(item => !item.rotulo || item.rotulo.length > 100 || item.conteudo.length < 3);
    if (termos.length < 125 || duplicadas.length || ausentes.length || invalidos.length) {
        throw new Error(`Glossário do CTB reprovado: ${termos.length} termos; duplicados=${duplicadas.join(",") || "nenhum"}; obrigatórios ausentes=${ausentes.join(",") || "nenhum"}; inválidos=${invalidos.map(item => item.chave).join(",") || "nenhum"}.`);
    }
    return { nome: "Anexo I — Glossário do CTB", quantidade: termos.length, primeiro: chaves[0], ultimo: chaves.at(-1) };
}

export function gerarMigrationCodigoTransito(dispositivos, glossario) {
    const conteudo = [...dispositivos, ...glossario];
    return `-- Gerado por scripts/import-traffic-code.mjs a partir do texto compilado oficial do Planalto.
-- Inclui os artigos do CTB e o glossário oficial do Anexo I como itens separados.
-- Não editar o conteúdo manualmente: execute novamente o importador e revise o relatório estrutural.

begin;

insert into public.legal_documents (
    id, slug, title, short_title, jurisdiction, issuing_body, active
) values (
    '${DOCUMENT_ID}',
    'codigo-de-transito-brasileiro-lei-9503-1997',
    'Código de Trânsito Brasileiro — Lei nº 9.503, de 23 de setembro de 1997',
    'Código de Trânsito Brasileiro',
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
    'Texto integral da Lei nº 9.503/1997 — arts. 1º a 341, artigos acrescidos e glossário do Anexo I',
    '${OFFICIAL_SOURCE_URL}',
    'Presidência da República — Código de Trânsito Brasileiro compilado',
    '2026-09-01'
);

insert into public.legal_provisions (
    version_id, provision_key, sequence, heading_path, heading, label, content
)
select
    '${VERSION_ID}', item.chave, item.sequencia, item.caminho, item.titulo, item.rotulo, item.conteudo
from jsonb_to_recordset(${literalJsonSql(conteudo)}::jsonb)
    as item(chave text, sequencia integer, caminho text[], titulo text, rotulo text, conteudo text);

update public.legal_documents
set current_version_id = '${VERSION_ID}'
where id = '${DOCUMENT_ID}';

insert into public.catalog_subject_documents (catalog_subject_id, document_id, position)
values ('${TRAFFIC_CATALOG_SUBJECT_ID}', '${DOCUMENT_ID}', 0);

commit;
`;
}

async function principal() {
    const argumentos = Object.fromEntries(process.argv.slice(2).reduce((pares, item, indice, todos) => {
        if (item.startsWith("--")) pares.push([item.slice(2), todos[indice + 1]]);
        return pares;
    }, []));
    if (!argumentos.input || !argumentos.out) {
        throw new Error("Uso: node scripts/import-traffic-code.mjs --input codigo-transito.html --out migration.sql");
    }

    const html = await readFile(resolve(argumentos.input), "latin1");
    const dispositivos = extrairDispositivos(html, { raiz: RAIZ });
    const glossario = extrairGlossarioAnexoI(html, { sequenciaInicial: dispositivos.length + 1 });
    const relatorio = [
        validarDispositivos("Código de Trânsito Brasileiro", dispositivos, {
            ultimoObrigatorio: 341,
            minimo: 385,
            artigosObrigatorios: ["art-1", "art-24-a", "art-147-a", "art-165-d", "art-326-c", "art-341"]
        }),
        validarGlossarioCtb(glossario)
    ];

    await writeFile(resolve(argumentos.out), gerarMigrationCodigoTransito(dispositivos, glossario), "utf8");
    console.log(JSON.stringify({
        relatorio,
        total: dispositivos.length + glossario.length,
        destino: resolve(argumentos.out)
    }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1"))) {
    principal().catch(erro => {
        console.error(erro.message);
        process.exitCode = 1;
    });
}
