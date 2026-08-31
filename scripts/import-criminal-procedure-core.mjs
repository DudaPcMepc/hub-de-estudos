import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extrairDispositivos, literalJsonSql, validarDispositivos } from "./import-legal-sources.mjs";

const PROCESS_SUBJECT_ID = "10000000-0000-4000-8000-000000000003";

const DOCUMENTOS = Object.freeze({
    cpp: {
        documentId: "20000000-0000-4000-8000-000000000004",
        versionId: "21000000-0000-4000-8000-000000000006",
        slug: "codigo-processo-penal-decreto-lei-3689-1941",
        titulo: "Código de Processo Penal — Decreto-Lei nº 3.689, de 3 de outubro de 1941",
        tituloCurto: "Código de Processo Penal",
        raiz: "CÓDIGO DE PROCESSO PENAL",
        versao: "Texto compilado consultado em 31/08/2026",
        escopo: "Texto compilado integral do Decreto-Lei nº 3.689/1941 — arts. 1º a 811 e artigos acrescidos",
        url: "https://www.planalto.gov.br/ccivil_03/decreto-lei/del3689compilado.htm",
        fonte: "Presidência da República — Código de Processo Penal compilado",
        posicao: 0
    },
    prisao: {
        documentId: "20000000-0000-4000-8000-000000000005",
        versionId: "21000000-0000-4000-8000-000000000007",
        slug: "prisao-temporaria-lei-7960-1989",
        titulo: "Lei de Prisão Temporária — Lei nº 7.960, de 21 de dezembro de 1989",
        tituloCurto: "Prisão Temporária",
        raiz: "LEI DE PRISÃO TEMPORÁRIA",
        versao: "Texto oficial consultado em 31/08/2026",
        escopo: "Texto integral da Lei nº 7.960/1989 — arts. 1º a 7º",
        url: "https://www.planalto.gov.br/ccivil_03/leis/l7960.htm",
        fonte: "Presidência da República — Lei de Prisão Temporária",
        posicao: 1
    }
});

function sqlDocumento(configuracao, dispositivos) {
    return `insert into public.legal_documents (
    id, slug, title, short_title, jurisdiction, issuing_body, active
) values (
    '${configuracao.documentId}',
    '${configuracao.slug}',
    '${configuracao.titulo}',
    '${configuracao.tituloCurto}',
    'federal',
    'Presidência da República — Casa Civil',
    true
);

insert into public.legal_document_versions (
    id, document_id, version_label, content_scope, official_source_url,
    official_source_label, source_checked_on
) values (
    '${configuracao.versionId}',
    '${configuracao.documentId}',
    '${configuracao.versao}',
    '${configuracao.escopo}',
    '${configuracao.url}',
    '${configuracao.fonte}',
    '2026-08-31'
);

insert into public.legal_provisions (
    version_id, provision_key, sequence, heading_path, heading, label, content
)
select
    '${configuracao.versionId}', item.chave, item.sequencia, item.caminho, item.titulo, item.rotulo, item.conteudo
from jsonb_to_recordset(${literalJsonSql(dispositivos)}::jsonb)
    as item(chave text, sequencia integer, caminho text[], titulo text, rotulo text, conteudo text);

update public.legal_documents
set current_version_id = '${configuracao.versionId}'
where id = '${configuracao.documentId}';

insert into public.catalog_subject_documents (catalog_subject_id, document_id, position)
values ('${PROCESS_SUBJECT_ID}', '${configuracao.documentId}', ${configuracao.posicao});`;
}

export function gerarMigrationNucleoProcessual(cpp, prisaoTemporaria) {
    return `-- Gerado por scripts/import-criminal-procedure-core.mjs a partir de fontes oficiais do Planalto.
-- Mantém CPP e Prisão Temporária separados, embora ambos pertençam ao catálogo de Processo Penal.
-- Não editar os artigos manualmente: execute novamente o importador e revise o relatório estrutural.

begin;

${sqlDocumento(DOCUMENTOS.cpp, cpp)}

${sqlDocumento(DOCUMENTOS.prisao, prisaoTemporaria)}

commit;
`;
}

async function principal() {
    const argumentos = Object.fromEntries(process.argv.slice(2).reduce((pares, item, indice, todos) => {
        if (item.startsWith("--")) pares.push([item.slice(2), todos[indice + 1]]);
        return pares;
    }, []));
    if (!argumentos.cpp || !argumentos.prisao || !argumentos.out) {
        throw new Error("Uso: node scripts/import-criminal-procedure-core.mjs --cpp codigo-processo-penal.html --prisao prisao-temporaria.html --out migration.sql");
    }

    const [htmlCpp, htmlPrisao] = await Promise.all([
        readFile(resolve(argumentos.cpp), "latin1"),
        readFile(resolve(argumentos.prisao), "latin1")
    ]);
    const cpp = extrairDispositivos(htmlCpp, { raiz: DOCUMENTOS.cpp.raiz });
    const prisaoTemporaria = extrairDispositivos(htmlPrisao, { raiz: DOCUMENTOS.prisao.raiz });
    const relatorio = [
        validarDispositivos("Código de Processo Penal", cpp, {
            ultimoObrigatorio: 811,
            minimo: 840,
            artigosBaseDispensados: [194, 405, 557, 558, 559, 560, 562, 611],
            artigosObrigatorios: ["art-1", "art-3-a", "art-28-a", "art-310", "art-811"]
        }),
        validarDispositivos("Lei de Prisão Temporária", prisaoTemporaria, {
            ultimoObrigatorio: 7,
            minimo: 7,
            artigosObrigatorios: ["art-1", "art-2", "art-7"]
        })
    ];

    await writeFile(resolve(argumentos.out), gerarMigrationNucleoProcessual(cpp, prisaoTemporaria), "utf8");
    console.log(JSON.stringify({ relatorio, destino: resolve(argumentos.out) }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1"))) {
    principal().catch(erro => {
        console.error(erro.message);
        process.exitCode = 1;
    });
}
