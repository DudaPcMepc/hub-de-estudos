import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
    blocosDoHtml,
    extrairDispositivos,
    literalJsonSql,
    validarDispositivos
} from "./import-legal-sources.mjs";

const DOCUMENT_ID = "20000000-0000-4000-8000-000000000008";
const VERSION_ID = "21000000-0000-4000-8000-000000000010";
const PENAL_CATALOG_SUBJECT_ID = "10000000-0000-4000-8000-000000000002";
const GUARDS_CATALOG_SUBJECT_ID = "10000000-0000-4000-8000-000000000005";
const OFFICIAL_SOURCE_URL = "https://www.planalto.gov.br/ccivil_03/leis/2003/l10.826compilado.htm";
const RAIZ = "ESTATUTO DO DESARMAMENTO";
const CAMINHO_ANEXO = "ANEXO — TABELA DE TAXAS";

export function prepararHtmlEstatutoDesarmamento(html) {
    return html.replace(/<\/?(?:span|font|a|b|strong|i|em|u|sup|sub)\b[^>]*>/gi, "");
}

function normalizarOrdinais(texto) {
    return texto
        .replace(/\bn\s*o(?=\s*\d)/giu, "nº")
        .replace(/\bart\.\s*(\d+)\s*o\b/giu, "art. $1º")
        .replace(/\b(\d+)o\b/gu, "$1º");
}

function rotuloNormalizado(item) {
    const artigo = item.chave.match(/^art-(\d+)(?:-(.+))?$/u);
    if (!artigo?.[2]) return item.rotulo;
    const numero = Number(artigo[1]);
    return `Art. ${numero}${numero <= 9 ? "º" : ""}-${artigo[2].toUpperCase()}`;
}

export function normalizarDispositivosEstatutoDesarmamento(dispositivos) {
    return dispositivos.map(item => ({
        ...item,
        caminho: item.caminho.map(normalizarOrdinais),
        titulo: normalizarOrdinais(item.titulo),
        rotulo: rotuloNormalizado(item),
        conteudo: normalizarOrdinais(item.conteudo).replace(/deckaradas/gu, "declaradas")
    }));
}

export function extrairAnexoTaxasEstatutoDesarmamento(html, { sequencia = 42 } = {}) {
    const preparado = prepararHtmlEstatutoDesarmamento(html);
    const inicio = preparado.search(/ANEXO\s*<br\s*\/?>/iu);
    if (inicio < 0) throw new Error("O Anexo de taxas do Estatuto do Desarmamento não foi encontrado.");
    const tabela = preparado.slice(inicio).match(/<table\b[^>]*>[\s\S]*?<\/table>/iu)?.[0];
    if (!tabela) throw new Error("A tabela de taxas do Estatuto do Desarmamento não foi encontrada.");

    const linhas = [...tabela.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)].reduce((resultado, linha) => {
        const celulas = [...linha[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/giu)]
            .map(celula => {
                const textoSemTags = celula[1].replace(/<[^>]+>/g, " ");
                return normalizarOrdinais(blocosDoHtml(`<p>${textoSemTags}</p>`).join(" ")).trim();
            });
        const descricao = celulas[0] || "";
        const valor = celulas[1] || "";
        if (!descricao && !valor) return resultado;
        const iniciaLinha = /^(?:ATO ADMINISTRATIVO|(?:VIII|VII|VI|IV|V|III|II|I)\s+-|-\s)/u.test(descricao);
        if (descricao && (iniciaLinha || !resultado.length)) {
            resultado.push({ descricao, valor });
        } else if (descricao) {
            resultado.at(-1).descricao = `${resultado.at(-1).descricao} ${descricao}`;
            if (valor) resultado.at(-1).valor = [resultado.at(-1).valor, valor].filter(Boolean).join(" ");
        } else if (valor) {
            resultado.at(-1).valor = [resultado.at(-1).valor, valor].filter(Boolean).join(" ");
        }
        return resultado;
    }, []);
    const conteudo = linhas
        .map(linha => `${linha.descricao}${linha.valor ? ` — ${linha.valor}` : ""}`)
        .join("\n");

    return {
        chave: "anexo-tabela-taxas",
        sequencia,
        caminho: [RAIZ, CAMINHO_ANEXO],
        titulo: CAMINHO_ANEXO,
        rotulo: "Anexo",
        conteudo: `Redação dada pela Lei nº 11.706, de 2008.\n\nTABELA DE TAXAS\n\n${conteudo}`
    };
}

export function validarIntegridadeEstatutoDesarmamento(dispositivos, anexo) {
    const relatorio = validarDispositivos("Estatuto do Desarmamento", dispositivos, {
        ultimoObrigatorio: 37,
        minimo: 41,
        artigosObrigatorios: ["art-1", "art-6", "art-7-a", "art-11-a", "art-21-a", "art-34-a", "art-37"]
    });
    const texto = dispositivos.map(item => item.conteudo).join("\n");
    const trechosObrigatorios = [
        "vendidas no País",
        "os integrantes de órgãos referidos",
        "Ministério da Justiça",
        "Incluído pela Lei nº 15.358, de 2026",
        "Lei nº 9.437, de 20 de fevereiro de 1997"
    ];
    const ausentes = trechosObrigatorios.filter(trecho => !texto.includes(trecho));
    const fragmentosInvalidos = ["o s integrantes", "çã o", "N acional", "Pú blica"].filter(trecho => texto.includes(trecho));
    if (dispositivos.length !== 41 || ausentes.length || fragmentosInvalidos.length) {
        throw new Error(`Estatuto do Desarmamento reprovado: artigos=${dispositivos.length}; trechos ausentes=${ausentes.join(",") || "nenhum"}; fragmentos inválidos=${fragmentosInvalidos.join(",") || "nenhum"}.`);
    }
    if (anexo.chave !== "anexo-tabela-taxas" || !anexo.conteudo.includes("VIII - Expedição de segunda via de porte de arma de fogo")) {
        throw new Error("O Anexo de taxas do Estatuto do Desarmamento está incompleto.");
    }
    return { ...relatorio, anexo: anexo.chave, total: dispositivos.length + 1 };
}

export function gerarMigrationEstatutoDesarmamento(dispositivos, anexo) {
    const conteudo = [...dispositivos, anexo];
    return `-- Gerado por scripts/import-disarmament-statute.mjs a partir do texto compilado oficial do Planalto.
-- Inclui os artigos vigentes e o Anexo oficial de taxas como item separado.
-- Não editar o conteúdo manualmente: execute novamente o importador e revise o relatório estrutural.

begin;

insert into public.legal_documents (
    id, slug, title, short_title, jurisdiction, issuing_body, active
) values (
    '${DOCUMENT_ID}',
    'estatuto-desarmamento-lei-10826-2003',
    'Estatuto do Desarmamento — Lei nº 10.826, de 22 de dezembro de 2003',
    'Estatuto do Desarmamento',
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
    'Texto integral da Lei nº 10.826/2003 — arts. 1º a 37, artigos acrescidos e Anexo de taxas',
    '${OFFICIAL_SOURCE_URL}',
    'Presidência da República — Estatuto do Desarmamento compilado',
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
values
    ('${PENAL_CATALOG_SUBJECT_ID}', '${DOCUMENT_ID}', 1),
    ('${GUARDS_CATALOG_SUBJECT_ID}', '${DOCUMENT_ID}', 1);

commit;
`;
}

async function principal() {
    const argumentos = Object.fromEntries(process.argv.slice(2).reduce((pares, item, indice, todos) => {
        if (item.startsWith("--")) pares.push([item.slice(2), todos[indice + 1]]);
        return pares;
    }, []));
    if (!argumentos.input || !argumentos.out) {
        throw new Error("Uso: node scripts/import-disarmament-statute.mjs --input estatuto-desarmamento.html --out migration.sql");
    }

    const html = await readFile(resolve(argumentos.input), "latin1");
    const preparado = prepararHtmlEstatutoDesarmamento(html);
    const dispositivos = normalizarDispositivosEstatutoDesarmamento(extrairDispositivos(preparado, { raiz: RAIZ }));
    const anexo = extrairAnexoTaxasEstatutoDesarmamento(html, { sequencia: dispositivos.length + 1 });
    const relatorio = validarIntegridadeEstatutoDesarmamento(dispositivos, anexo);

    await writeFile(resolve(argumentos.out), gerarMigrationEstatutoDesarmamento(dispositivos, anexo), "utf8");
    console.log(JSON.stringify({ relatorio, destino: resolve(argumentos.out) }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1"))) {
    principal().catch(erro => {
        console.error(erro.message);
        process.exitCode = 1;
    });
}
