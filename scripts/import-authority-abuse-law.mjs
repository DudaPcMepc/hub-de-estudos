import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extrairDispositivos, literalJsonSql, validarDispositivos } from "./import-legal-sources.mjs";

const DOCUMENT_ID = "20000000-0000-4000-8000-000000000013";
const VERSION_ID = "21000000-0000-4000-8000-000000000015";
const PENAL_CATALOG_SUBJECT_ID = "10000000-0000-4000-8000-000000000002";
const CRIMINAL_PROCEDURE_CATALOG_SUBJECT_ID = "10000000-0000-4000-8000-000000000003";
const GUARDS_CATALOG_SUBJECT_ID = "10000000-0000-4000-8000-000000000005";
const OFFICIAL_SOURCE_URL = "https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2019/lei/l13869.htm";
const RAIZ = "LEI DE ABUSO DE AUTORIDADE";

function rotuloNormalizado(item) {
    const artigo = item.chave.match(/^art-(\d+)(?:-(.+))?$/u);
    if (!artigo?.[2]) return item.rotulo;
    const numero = Number(artigo[1]);
    return `Art. ${numero}${numero <= 9 ? "º" : ""}-${artigo[2].toUpperCase()}`;
}

export function normalizarDispositivosAbusoAutoridade(dispositivos) {
    const porChave = new Map();
    for (const item of dispositivos) porChave.set(item.chave, item);

    return [...porChave.values()].map((item, indice) => ({
        ...item,
        sequencia: indice + 1,
        titulo: item.caminho.at(-1) || RAIZ,
        rotulo: rotuloNormalizado(item),
        conteudo: item.conteudo.replace(/Decreto-Lei nº 2\.848, de 7 de dezembro de 194\s+0/gu, "Decreto-Lei nº 2.848, de 7 de dezembro de 1940")
    }));
}

export function validarIntegridadeAbusoAutoridade(dispositivos) {
    const relatorio = validarDispositivos("Lei de Abuso de Autoridade", dispositivos, {
        ultimoObrigatorio: 45,
        minimo: 46,
        artigosObrigatorios: ["art-1", "art-2", "art-3", "art-9", "art-15-a", "art-16", "art-20", "art-30", "art-32", "art-38", "art-43", "art-45"]
    });
    const texto = dispositivos.map(item => item.conteudo).join("\n");
    const trechosObrigatorios = [
        "finalidade específica de prejudicar outrem",
        "Os crimes previstos nesta Lei são de ação penal pública incondicionada",
        "Decretar medida de privação da liberdade em manifesta desconformidade",
        "Lei nº 14.321, de 2022",
        "gerando indevida revitimização",
        "Impedir, sem justa causa, a entrevista pessoal e reservada do preso com seu advogado",
        "Constitui crime violar direito ou prerrogativa de advogado"
    ];
    const ausentes = trechosObrigatorios.filter(trecho => !texto.includes(trecho));
    const chaves = dispositivos.map(item => item.chave);
    const duplicadas = chaves.filter((chave, indice) => chaves.indexOf(chave) !== indice);
    const vetosSubstituidos = ["art-3", "art-9", "art-16", "art-20", "art-30", "art-32", "art-38", "art-43"]
        .filter(chave => dispositivos.find(item => item.chave === chave)?.conteudo.trim() === "(VETADO).");
    if (dispositivos.length !== 46 || ausentes.length || duplicadas.length || vetosSubstituidos.length || /194\s+0/u.test(texto)) {
        throw new Error(`Lei de Abuso de Autoridade reprovada: artigos=${dispositivos.length}; trechos ausentes=${ausentes.join(",") || "nenhum"}; duplicados=${duplicadas.join(",") || "nenhum"}; vetos não recompostos=${vetosSubstituidos.join(",") || "nenhum"}.`);
    }
    return relatorio;
}

export function gerarMigrationAbusoAutoridade(dispositivos) {
    return `-- Gerado por scripts/import-authority-abuse-law.mjs a partir do texto compilado oficial do Planalto.
-- O importador substitui os vetos originais pelos dispositivos posteriormente promulgados.
-- Não editar o conteúdo manualmente: execute novamente o importador e revise o relatório estrutural.

begin;

insert into public.legal_documents (
    id, slug, title, short_title, jurisdiction, issuing_body, active
) values (
    '${DOCUMENT_ID}',
    'abuso-autoridade-lei-13869-2019',
    'Lei de Abuso de Autoridade — Lei nº 13.869, de 5 de setembro de 2019',
    'Abuso de Autoridade',
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
    'Texto compilado consultado em 02/09/2026',
    'Texto integral da Lei nº 13.869/2019 — arts. 1º a 45 e art. 15-A',
    '${OFFICIAL_SOURCE_URL}',
    'Presidência da República — Lei de Abuso de Autoridade compilada',
    '2026-09-02'
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
    ('${PENAL_CATALOG_SUBJECT_ID}', '${DOCUMENT_ID}', 6),
    ('${CRIMINAL_PROCEDURE_CATALOG_SUBJECT_ID}', '${DOCUMENT_ID}', 6),
    ('${GUARDS_CATALOG_SUBJECT_ID}', '${DOCUMENT_ID}', 6);

commit;
`;
}

async function principal() {
    const argumentos = Object.fromEntries(process.argv.slice(2).reduce((pares, item, indice, todos) => {
        if (item.startsWith("--")) pares.push([item.slice(2), todos[indice + 1]]);
        return pares;
    }, []));
    if (!argumentos.input || !argumentos.out) {
        throw new Error("Uso: node scripts/import-authority-abuse-law.mjs --input lei-abuso-autoridade.html --out migration.sql");
    }

    const html = await readFile(resolve(argumentos.input), "latin1");
    const extraidos = extrairDispositivos(html, { raiz: RAIZ });
    const dispositivos = normalizarDispositivosAbusoAutoridade(extraidos);
    const relatorio = validarIntegridadeAbusoAutoridade(dispositivos);

    await writeFile(resolve(argumentos.out), gerarMigrationAbusoAutoridade(dispositivos), "utf8");
    console.log(JSON.stringify({ relatorio, destino: resolve(argumentos.out) }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1"))) {
    principal().catch(erro => {
        console.error(erro.message);
        process.exitCode = 1;
    });
}
