import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ENTIDADES = new Map(Object.entries({
    aacute: "á", acirc: "â", agrave: "à", amp: "&", atilde: "ã",
    ccedil: "ç", eacute: "é", ecirc: "ê", iacute: "í", ldquo: "“",
    nbsp: " ", oacute: "ó", ocirc: "ô", ordf: "ª", ordm: "º",
    otilde: "õ", rdquo: "”", rsquo: "’", sect: "§", uacute: "ú", uuml: "ü"
}));

const WINDOWS_1252 = new Map(Object.entries({
    "128": "€", "130": "‚", "131": "ƒ", "132": "„", "133": "…", "134": "†", "135": "‡",
    "136": "ˆ", "137": "‰", "138": "Š", "139": "‹", "140": "Œ", "142": "Ž", "145": "‘",
    "146": "’", "147": "“", "148": "”", "149": "•", "150": "–", "151": "—", "152": "˜",
    "153": "™", "154": "š", "155": "›", "156": "œ", "158": "ž", "159": "Ÿ"
}));

function decodificarEntidades(texto) {
    return texto
        .replace(/&#(\d+);/g, (_, numero) => String.fromCodePoint(Number(numero)))
        .replace(/&#x([\da-f]+);/gi, (_, numero) => String.fromCodePoint(Number.parseInt(numero, 16)))
        .replace(/&([a-z][a-z0-9]+);/gi, (original, nome) => {
            const valor = ENTIDADES.get(nome.toLowerCase());
            if (!valor) return original;
            return /^[A-Z]/.test(nome) ? valor.toLocaleUpperCase("pt-BR") : valor;
        })
        .replace(/[\u0080-\u009f]/g, caractere => WINDOWS_1252.get(String(caractere.codePointAt(0))) || caractere);
}

function textosDoHtml(html) {
    const separadorSemantico = "\u0000";
    const texto = decodificarEntidades(html
        .replace(/<br\s*\/?>/gi, separadorSemantico)
        .replace(/<[^>]+>/g, " "))
        .normalize("NFC");
    return texto
        .split(separadorSemantico)
        .map(trecho => trecho.replace(/\s+/g, " ").trim())
        .filter(Boolean);
}

export function blocosDoHtml(html) {
    const limpo = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
    return [...limpo.matchAll(/<(p|h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi)]
        .flatMap(resultado => textosDoHtml(resultado[2]));
}

function tituloEstrutural(texto) {
    const resultado = texto.match(/^(PARTE|LIVRO|TÍTULO|CAPÍTULO|SEÇÃO|SUBSEÇÃO)\s+([IVXLCDM]+|ÚNICO|GERAL|ESPECIAL)(?:\s*[-–—:]?\s*(.*))?$/iu);
    if (!resultado) return null;
    const marcadorOrdinal = resultado[2].toUpperCase();
    return {
        nivel: resultado[1].toUpperCase(),
        marcador: `${resultado[1].toUpperCase()} ${marcadorOrdinal}`,
        descricao: resultado[3]?.trim() || "",
        aguardaDescricao: !resultado[3]?.trim() && !["GERAL", "ESPECIAL"].includes(marcadorOrdinal)
    };
}

function chaveArtigo(numero) {
    return `art-${numero.toLowerCase()}`;
}

const PADRAO_ARTIGO = /^Art\.\s*(\d{1,3})\s*(?:º|o)?\s*(?:-\s*([A-Z](?:-[A-Z])*))?\s*\.?\s*/iu;

function notaEditorialIsolada(texto) {
    return /^(?:\([^)]*\)\s*)+$/u.test(texto);
}

function pareceEpigrafeDeArtigo(blocos, indice) {
    const bloco = blocos[indice];
    if (!bloco || bloco.length > 180 || tituloEstrutural(bloco) || PADRAO_ARTIGO.test(bloco) || notaEditorialIsolada(bloco)) return false;
    if (/^(?:Parágrafo|§|Pena\b|[IVXLCDM]+\s*[-–—]|[a-z]\)|Revogad[oa]\b)/iu.test(bloco)) return false;
    for (let proximo = indice + 1; proximo < blocos.length; proximo += 1) {
        if (notaEditorialIsolada(blocos[proximo])) continue;
        return PADRAO_ARTIGO.test(blocos[proximo]);
    }
    return false;
}

export function extrairDispositivos(html, { raiz = "" } = {}) {
    const niveis = ["PARTE", "LIVRO", "TÍTULO", "CAPÍTULO", "SEÇÃO", "SUBSEÇÃO"];
    const hierarquia = new Map();
    const dispositivos = [];
    let estruturaPendente = null;
    let estruturaComplementavel = null;
    let epigrafePendente = "";
    let atual = null;
    const blocos = blocosDoHtml(html);

    const concluir = () => {
        if (!atual) return;
        atual.conteudo = atual.paragrafos.join("\n\n").trim();
        delete atual.paragrafos;
        dispositivos.push(atual);
        atual = null;
    };

    for (let indiceBloco = 0; indiceBloco < blocos.length; indiceBloco += 1) {
        const bloco = blocos[indiceBloco];
        const estrutura = tituloEstrutural(bloco);
        if (estrutura) {
            concluir();
            estruturaComplementavel = null;
            const indice = niveis.indexOf(estrutura.nivel);
            niveis.slice(indice).forEach(nivel => hierarquia.delete(nivel));
            hierarquia.set(estrutura.nivel, estrutura.descricao ? `${estrutura.marcador} — ${estrutura.descricao}` : estrutura.marcador);
            estruturaPendente = estrutura.aguardaDescricao ? estrutura.nivel : null;
            continue;
        }
        if (estruturaPendente && /^(?:\([^)]*\)\s*)+$/u.test(bloco)) continue;
        if (estruturaPendente && bloco.length <= 180 && !/^ART\./i.test(bloco)) {
            hierarquia.set(estruturaPendente, `${hierarquia.get(estruturaPendente)} — ${bloco.toLocaleUpperCase("pt-BR")}`);
            estruturaComplementavel = estruturaPendente;
            estruturaPendente = null;
            continue;
        }
        if (estruturaComplementavel && bloco.length <= 180 && bloco === bloco.toLocaleUpperCase("pt-BR") && !/^ART\./i.test(bloco)) {
            hierarquia.set(estruturaComplementavel, `${hierarquia.get(estruturaComplementavel)} ${bloco}`);
            continue;
        }
        estruturaComplementavel = null;
        if (/^ATO DAS DISPOSIÇÕES CONSTITUCIONAIS TRANSITÓRIAS$/iu.test(bloco)) {
            concluir();
            hierarquia.set("RAIZ", bloco);
            continue;
        }

        if (epigrafePendente && notaEditorialIsolada(bloco)) continue;
        if (pareceEpigrafeDeArtigo(blocos, indiceBloco)) {
            epigrafePendente = bloco.replace(/\s*(?:\([^)]*\)\s*)+$/u, "").trim();
            continue;
        }

        const artigo = bloco.match(PADRAO_ARTIGO);
        if (artigo) {
            concluir();
            estruturaComplementavel = null;
            const numero = `${artigo[1]}${artigo[2] ? `-${artigo[2]}` : ""}`.toUpperCase();
            const caminho = [raiz, ...niveis.map(nivel => hierarquia.get(nivel))].filter(Boolean);
            atual = {
                chave: chaveArtigo(numero),
                sequencia: dispositivos.length + 1,
                caminho,
                titulo: epigrafePendente || caminho.at(-1) || raiz,
                rotulo: `Art. ${numero}${Number(numero) <= 9 ? "º" : "."}`,
                paragrafos: [bloco.slice(artigo[0].length).trim()].filter(Boolean)
            };
            epigrafePendente = "";
            continue;
        }
        if (atual) atual.paragrafos.push(bloco);
    }
    concluir();
    return dispositivos;
}

export function validarDispositivos(nome, dispositivos, {
    ultimoObrigatorio,
    minimo,
    artigosObrigatorios = [],
    artigosBaseDispensados = []
}) {
    const chaves = dispositivos.map(item => item.chave);
    const duplicadas = chaves.filter((chave, indice) => chaves.indexOf(chave) !== indice);
    const numeros = new Set(chaves.map(chave => Number(chave.match(/^art-(\d+)/)?.[1])).filter(Number.isFinite));
    const dispensados = new Set(artigosBaseDispensados);
    const ausentes = Array.from({ length: ultimoObrigatorio }, (_, indice) => indice + 1)
        .filter(numero => !numeros.has(numero) && !dispensados.has(numero));
    const chavesAusentes = artigosObrigatorios.filter(chave => !chaves.includes(chave));
    const vazios = dispositivos.filter(item => item.conteudo.length < 3).map(item => item.chave);
    if (dispositivos.length < minimo || duplicadas.length || ausentes.length || chavesAusentes.length || vazios.length) {
        throw new Error(`${nome} reprovado: ${dispositivos.length} dispositivos; duplicados=${duplicadas.join(",") || "nenhum"}; ausentes=${ausentes.join(",") || "nenhum"}; chaves obrigatórias ausentes=${chavesAusentes.join(",") || "nenhuma"}; vazios=${vazios.join(",") || "nenhum"}.`);
    }
    return { nome, quantidade: dispositivos.length, primeiro: chaves[0], ultimo: chaves.at(-1), maiorConteudo: Math.max(...dispositivos.map(item => item.conteudo.length)) };
}

function literalJson(valor) {
    const texto = JSON.stringify(valor);
    if (texto.includes("$dados$")) throw new Error("O conteúdo conflita com o delimitador SQL.");
    return `$dados$${texto}$dados$`;
}

export { literalJson as literalJsonSql };

function gerarMigration(constituicao, adct) {
    const urlConstituicao = "https://www2.camara.leg.br/atividade-legislativa/legislacao/constituicao1988/arquivos/ConstituicaoTextoAtualizado_EC%20139.html";
    const urlAdct = "https://www2.camara.leg.br/atividade-legislativa/legislacao/constituicao1988/arquivos/constituicao-adct-de-1988_ec-136.html";
    return `-- Gerado por scripts/import-legal-sources.mjs a partir de fontes oficiais da Câmara dos Deputados.\n-- Não editar os artigos manualmente: execute novamente o importador e revise o relatório estrutural.\n\nbegin;\n\nupdate public.legal_document_versions\nset version_label = 'EC 139/2026 — módulo inicial (arts. 1º a 4º)'\nwhere id = '21000000-0000-4000-8000-000000000001';\n\ninsert into public.legal_document_versions (\n    id, document_id, version_label, content_scope, official_source_url, official_source_label, source_checked_on\n) values (\n    '21000000-0000-4000-8000-000000000002',\n    '20000000-0000-4000-8000-000000000001',\n    'Atualizada até a Emenda Constitucional nº 139/2026',\n    'Texto integral da Constituição Federal — arts. 1º a 250 e artigos acrescidos',\n    '${urlConstituicao}',\n    'Câmara dos Deputados — Constituição atualizada',\n    '2026-08-30'\n);\n\ninsert into public.legal_provisions (version_id, provision_key, sequence, heading_path, heading, label, content)\nselect\n    '21000000-0000-4000-8000-000000000002', item.chave, item.sequencia, item.caminho, item.titulo, item.rotulo, item.conteudo\nfrom jsonb_to_recordset(${literalJson(constituicao)}::jsonb)\n    as item(chave text, sequencia integer, caminho text[], titulo text, rotulo text, conteudo text);\n\nupdate public.user_legal_highlights as grifo\nset provision_id = novo.id\nfrom public.legal_provisions as antigo\njoin public.legal_provisions as novo\n    on novo.version_id = '21000000-0000-4000-8000-000000000002'\n    and novo.provision_key = antigo.provision_key\nwhere grifo.provision_id = antigo.id\n  and antigo.version_id = '21000000-0000-4000-8000-000000000001';\n\nupdate public.legal_documents\nset current_version_id = '21000000-0000-4000-8000-000000000002'\nwhere id = '20000000-0000-4000-8000-000000000001';\n\ninsert into public.legal_documents (\n    id, slug, title, short_title, jurisdiction, issuing_body, active\n) values (\n    '20000000-0000-4000-8000-000000000002',\n    'ato-disposicoes-constitucionais-transitorias-1988',\n    'Ato das Disposições Constitucionais Transitórias de 1988',\n    'ADCT', 'federal', 'Câmara dos Deputados', true\n);\n\ninsert into public.legal_document_versions (\n    id, document_id, version_label, content_scope, official_source_url, official_source_label, source_checked_on\n) values (\n    '21000000-0000-4000-8000-000000000003',\n    '20000000-0000-4000-8000-000000000002',\n    'Atualizado até a Emenda Constitucional nº 136/2025',\n    'Texto integral vigente do ADCT; as ECs 137, 138 e 139 não alteraram este ato',\n    '${urlAdct}',\n    'Câmara dos Deputados — ADCT atualizado',\n    '2026-08-30'\n);\n\ninsert into public.legal_provisions (version_id, provision_key, sequence, heading_path, heading, label, content)\nselect\n    '21000000-0000-4000-8000-000000000003', item.chave, item.sequencia, item.caminho, item.titulo, item.rotulo, item.conteudo\nfrom jsonb_to_recordset(${literalJson(adct)}::jsonb)\n    as item(chave text, sequencia integer, caminho text[], titulo text, rotulo text, conteudo text);\n\nupdate public.legal_documents\nset current_version_id = '21000000-0000-4000-8000-000000000003'\nwhere id = '20000000-0000-4000-8000-000000000002';\n\ninsert into public.catalog_subject_documents (catalog_subject_id, document_id, position)\nvalues ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 1);\n\ncommit;\n`;
}

async function principal() {
    const argumentos = Object.fromEntries(process.argv.slice(2).reduce((pares, item, indice, todos) => {
        if (item.startsWith("--")) pares.push([item.slice(2), todos[indice + 1]]);
        return pares;
    }, []));
    if (!argumentos.constitution || !argumentos.adct || !argumentos.out) {
        throw new Error("Uso: node scripts/import-legal-sources.mjs --constitution arquivo.html --adct arquivo.html --out migration.sql");
    }
    const [htmlConstituicao, htmlAdct] = await Promise.all([
        readFile(resolve(argumentos.constitution), "latin1"),
        readFile(resolve(argumentos.adct), "latin1")
    ]);
    const constituicao = extrairDispositivos(htmlConstituicao);
    const adct = extrairDispositivos(htmlAdct, { raiz: "ATO DAS DISPOSIÇÕES CONSTITUCIONAIS TRANSITÓRIAS" });
    const relatorio = [
        validarDispositivos("Constituição", constituicao, { ultimoObrigatorio: 250, minimo: 250 }),
        validarDispositivos("ADCT", adct, { ultimoObrigatorio: 138, minimo: 138 })
    ];
    await writeFile(resolve(argumentos.out), gerarMigration(constituicao, adct), "utf8");
    console.log(JSON.stringify({ relatorio, destino: resolve(argumentos.out) }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1"))) {
    principal().catch(erro => {
        console.error(erro.message);
        process.exitCode = 1;
    });
}
