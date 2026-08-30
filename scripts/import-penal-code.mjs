import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extrairDispositivos, literalJsonSql, validarDispositivos } from "./import-legal-sources.mjs";

const DOCUMENT_ID = "20000000-0000-4000-8000-000000000003";
const VERSION_ID = "21000000-0000-4000-8000-000000000004";
const CORRECTED_VERSION_ID = "21000000-0000-4000-8000-000000000005";
const PENAL_CATALOG_SUBJECT_ID = "10000000-0000-4000-8000-000000000002";
const OFFICIAL_SOURCE_URL = "https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm";

export function gerarMigrationCodigoPenal(dispositivos) {
    return `-- Gerado por scripts/import-penal-code.mjs a partir do texto compilado oficial do Planalto.
-- Não editar os artigos manualmente: execute novamente o importador e revise o relatório estrutural.

begin;

insert into public.legal_documents (
    id, slug, title, short_title, jurisdiction, issuing_body, active
) values (
    '${DOCUMENT_ID}',
    'codigo-penal-decreto-lei-2848-1940',
    'Código Penal — Decreto-Lei nº 2.848, de 7 de dezembro de 1940',
    'Código Penal',
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
    'Texto compilado consultado em 30/08/2026',
    'Texto compilado integral do Decreto-Lei nº 2.848/1940 — arts. 1º a 361 e artigos acrescidos',
    '${OFFICIAL_SOURCE_URL}',
    'Presidência da República — Código Penal compilado',
    '2026-08-30'
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
values ('${PENAL_CATALOG_SUBJECT_ID}', '${DOCUMENT_ID}', 0);

commit;
`;
}

export function gerarMigrationCorrecaoCodigoPenal(dispositivos) {
    return `-- Corrige a associação das epígrafes aos artigos do Código Penal sem apagar a versão anterior.
-- Gerado por scripts/import-penal-code.mjs a partir do texto compilado oficial do Planalto.

begin;

insert into public.legal_document_versions (
    id, document_id, version_label, content_scope, official_source_url,
    official_source_label, source_checked_on
) values (
    '${CORRECTED_VERSION_ID}',
    '${DOCUMENT_ID}',
    'Texto compilado consultado em 30/08/2026 — epígrafes revisadas',
    'Texto compilado integral do Decreto-Lei nº 2.848/1940 — arts. 1º a 361 e artigos acrescidos',
    '${OFFICIAL_SOURCE_URL}',
    'Presidência da República — Código Penal compilado',
    '2026-08-30'
);

insert into public.legal_provisions (
    version_id, provision_key, sequence, heading_path, heading, label, content
)
select
    '${CORRECTED_VERSION_ID}', item.chave, item.sequencia, item.caminho, item.titulo, item.rotulo, item.conteudo
from jsonb_to_recordset(${literalJsonSql(dispositivos)}::jsonb)
    as item(chave text, sequencia integer, caminho text[], titulo text, rotulo text, conteudo text);

update public.user_legal_highlights as registro
set provision_id = novo.id
from public.legal_provisions as antigo
join public.legal_provisions as novo
    on novo.version_id = '${CORRECTED_VERSION_ID}'
    and novo.provision_key = antigo.provision_key
where registro.provision_id = antigo.id
  and antigo.version_id = '${VERSION_ID}';

update public.user_legal_bookmarks as registro
set provision_id = novo.id
from public.legal_provisions as antigo
join public.legal_provisions as novo
    on novo.version_id = '${CORRECTED_VERSION_ID}'
    and novo.provision_key = antigo.provision_key
where registro.provision_id = antigo.id
  and antigo.version_id = '${VERSION_ID}';

update public.user_legal_reading_history as registro
set provision_id = novo.id
from public.legal_provisions as antigo
join public.legal_provisions as novo
    on novo.version_id = '${CORRECTED_VERSION_ID}'
    and novo.provision_key = antigo.provision_key
where registro.provision_id = antigo.id
  and antigo.version_id = '${VERSION_ID}';

update public.legal_documents
set current_version_id = '${CORRECTED_VERSION_ID}'
where id = '${DOCUMENT_ID}';

commit;
`;
}

async function principal() {
    const argumentos = Object.fromEntries(process.argv.slice(2).reduce((pares, item, indice, todos) => {
        if (item.startsWith("--")) pares.push([item.slice(2), todos[indice + 1]]);
        return pares;
    }, []));
    if (!argumentos.input || !argumentos.out) {
        throw new Error("Uso: node scripts/import-penal-code.mjs --input codigo-penal.html --out migration.sql");
    }

    const html = await readFile(resolve(argumentos.input), "latin1");
    const dispositivos = extrairDispositivos(html, { raiz: "CÓDIGO PENAL" });
    const relatorio = validarDispositivos("Código Penal", dispositivos, {
        ultimoObrigatorio: 361,
        minimo: 420,
        artigosBaseDispensados: [107, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196],
        artigosObrigatorios: ["art-1", "art-121-a", "art-121-b", "art-155", "art-213", "art-312", "art-361"]
    });
    const migration = argumentos.mode === "correction"
        ? gerarMigrationCorrecaoCodigoPenal(dispositivos)
        : gerarMigrationCodigoPenal(dispositivos);
    await writeFile(resolve(argumentos.out), migration, "utf8");
    console.log(JSON.stringify({ relatorio, destino: resolve(argumentos.out) }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1"))) {
    principal().catch(erro => {
        console.error(erro.message);
        process.exitCode = 1;
    });
}
