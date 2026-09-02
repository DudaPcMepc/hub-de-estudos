import { supabase } from "./supabase-client.js";

// Permanece falso até os testes de gravação serem autorizados e concluídos.
export const GRAVACAO_REMOTA_HABILITADA = true;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CORES = new Set(["primary", "secondary", "success", "danger", "warning", "info", "light", "dark"]);
const PRIORIDADES = new Set(["alta", "media", "baixa"]);
const STATUS_TOPICOS = new Set(["nao", "estudando", "revisar", "dominado"]);
const STATUS_TAREFAS = new Set(["pendente", "concluido"]);
const TIPOS_WIDGET = new Set(["legal_library", "personal_vade", "private_documents", "community"]);
const CORES_GRIFO = new Set(["yellow", "red", "green", "blue", "pink"]);
const TIPOS_ANOTACAO_VADE = new Set(["note", "summary"]);
const BUCKET_PDFS_VADE = "private-legal-notebook-pdfs";
const LIMITE_PDF_VADE_BYTES = 25 * 1024 * 1024;

let contextoAtivo = null;
let mapasLegados = new Map();
let idsLocaisPorRemotos = new Map();
let versoesNotas = new Map();
let versaoConfiguracaoEdital = null;
let versoesMateriasEdital = new Map();
let versoesTopicosEdital = new Map();

function erroRepositorio(mensagem, causa) {
    return new Error(mensagem, causa ? { cause: causa } : undefined);
}

function obterContexto() {
    if (!supabase || !contextoAtivo) throw erroRepositorio("O repositório remoto não está conectado a uma sessão válida.");
    return contextoAtivo;
}

function exigirContexto() {
    if (!GRAVACAO_REMOTA_HABILITADA) throw erroRepositorio("A gravação remota ainda não foi habilitada.");
    return obterContexto();
}

function exigirUuidNovo(id, entidade) {
    const valor = String(id || "");
    if (!UUID.test(valor)) throw erroRepositorio(`${entidade} nova precisa de um identificador UUID válido.`);
    return valor;
}

function resolverId(tipo, id) {
    const valor = String(id || "");
    const remoto = mapasLegados.get(tipo)?.get(valor);
    if (remoto) return remoto;
    if (UUID.test(valor)) return valor;
    throw erroRepositorio(`Não foi possível relacionar ${tipo} com o registro migrado.`);
}

function registrarId(tipo, idLocal, idRemoto) {
    if (!mapasLegados.has(tipo)) mapasLegados.set(tipo, new Map());
    if (!idsLocaisPorRemotos.has(tipo)) idsLocaisPorRemotos.set(tipo, new Map());
    const local = String(idLocal);
    mapasLegados.get(tipo).set(local, idRemoto);
    idsLocaisPorRemotos.get(tipo).set(idRemoto, local);
}

function verificarResposta(resposta, mensagem) {
    if (resposta.error) throw erroRepositorio(mensagem, resposta.error);
    return resposta.data;
}

function verificarRegistro(resposta, mensagem) {
    const dados = verificarResposta(resposta, mensagem);
    if (!dados) throw erroRepositorio(`${mensagem} O registro não foi encontrado neste espaço de estudos.`);
    return dados;
}

function texto(valor, limite, campo, obrigatorio = false) {
    const resultado = String(valor ?? "");
    if ((obrigatorio && !resultado.trim()) || resultado.length > limite) throw erroRepositorio(`${campo} inválido.`);
    return resultado;
}

function urlHttp(valor) {
    const original = texto(valor, 4000, "URL do link", true).trim();
    try {
        const url = new URL(original);
        if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
            throw new Error("Protocolo ou credenciais não permitidos.");
        }
        return url.href;
    } catch (causa) {
        throw erroRepositorio("URL do link inválida. Use um endereço http:// ou https:// sem credenciais.", causa);
    }
}

function dataIso(valor, campo, obrigatoria = false) {
    const resultado = String(valor ?? "").trim();
    if (!resultado && !obrigatoria) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(resultado)) throw erroRepositorio(`${campo} inválida.`);
    const data = new Date(`${resultado}T00:00:00Z`);
    if (Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== resultado) throw erroRepositorio(`${campo} inválida.`);
    return resultado;
}

function instanteIso(valor, campo) {
    const resultado = String(valor ?? "").trim();
    if (!resultado || Number.isNaN(Date.parse(resultado))) throw erroRepositorio(`${campo} inválida.`);
    return resultado;
}

function numeroLimitado(valor, campo, minimo, maximo, inteiro = false) {
    const numero = Number(valor);
    if (!Number.isFinite(numero) || numero < minimo || numero > maximo || (inteiro && !Number.isInteger(numero))) {
        throw erroRepositorio(`${campo} inválido.`);
    }
    return numero;
}

function tagsValidas(tags) {
    if (!Array.isArray(tags) || tags.length > 100) throw erroRepositorio("Tags inválidas.");
    return tags.map(tag => texto(tag, 100, "Tag"));
}

export async function prepararRepositorioRemoto(contexto) {
    if (!contexto?.userId || !contexto?.workspaceId) throw erroRepositorio("Contexto de usuário incompleto.");
    const loteResposta = await supabase
        .from("migration_batches")
        .select("id")
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .eq("status", "concluido")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (loteResposta.error) throw erroRepositorio("Não foi possível consultar o histórico de migração.", loteResposta.error);

    const [itensResposta, notasResposta] = await Promise.all([
        loteResposta.data
            ? supabase.from("migration_items").select("entity_type, legacy_id, new_id").eq("batch_id", loteResposta.data.id)
            : Promise.resolve({ data: [], error: null }),
        supabase.from("notes").select("id, version").eq("workspace_id", contexto.workspaceId)
    ]);
    const itens = verificarResposta(itensResposta, "Não foi possível carregar o mapa da migração.") || [];
    const notas = verificarResposta(notasResposta, "Não foi possível carregar as versões das notas.") || [];

    mapasLegados = new Map();
    idsLocaisPorRemotos = new Map();
    itens.forEach(item => registrarId(item.entity_type, item.legacy_id, item.new_id));
    versoesNotas = new Map(notas.map(nota => [nota.id, Number(nota.version)]));
    versaoConfiguracaoEdital = null;
    versoesMateriasEdital = new Map();
    versoesTopicosEdital = new Map();
    contextoAtivo = Object.freeze({
        userId: contexto.userId,
        workspaceId: contexto.workspaceId,
        role: contexto.role
    });
}

export function encerrarRepositorioRemoto() {
    contextoAtivo = null;
    mapasLegados = new Map();
    idsLocaisPorRemotos = new Map();
    versoesNotas = new Map();
    versaoConfiguracaoEdital = null;
    versoesMateriasEdital = new Map();
    versoesTopicosEdital = new Map();
}

export async function carregarMateriasRemotas() {
    const contexto = obterContexto();
    const resposta = await supabase.from("subjects")
        .select("id, name, description, color, priority, position, catalog_subject_id")
        .eq("workspace_id", contexto.workspaceId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
    const materias = verificarResposta(resposta, "Não foi possível carregar as matérias do Supabase.") || [];
    const idsLegados = idsLocaisPorRemotos.get("subject");
    return materias.map(materia => ({
        id: idsLegados?.get(materia.id) || materia.id,
        nome: materia.name,
        desc: materia.description || "",
        cor: CORES.has(materia.color) ? materia.color : "primary",
        prioridade: PRIORIDADES.has(materia.priority) ? materia.priority : "media",
        catalogoId: materia.catalog_subject_id || "",
        position: Number(materia.position)
    }));
}

export async function carregarCatalogoMaterias() {
    obterContexto();
    const resposta = await supabase.from("catalog_subjects")
        .select("id, slug, name, category, icon, default_widget_types")
        .eq("active", true)
        .order("category", { ascending: true })
        .order("name", { ascending: true });
    const itens = verificarResposta(resposta, "Não foi possível carregar o catálogo de matérias.") || [];
    return itens.map(item => ({
        id: item.id,
        slug: item.slug,
        nome: item.name,
        categoria: item.category,
        icone: item.icon,
        widgetsPadrao: Array.isArray(item.default_widget_types)
            ? item.default_widget_types.filter(tipo => TIPOS_WIDGET.has(tipo))
            : []
    }));
}

export async function carregarWidgetsMaterias() {
    const contexto = obterContexto();
    const resposta = await supabase.from("user_subject_widgets")
        .select("subject_id, widget_type, enabled, position, config")
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .order("subject_id", { ascending: true })
        .order("position", { ascending: true });
    const itens = verificarResposta(resposta, "Não foi possível carregar as preferências da biblioteca.") || [];
    const materiasLegadas = idsLocaisPorRemotos.get("subject");
    return itens.filter(item => TIPOS_WIDGET.has(item.widget_type)).map(item => ({
        materiaId: materiasLegadas?.get(item.subject_id) || item.subject_id,
        tipo: item.widget_type,
        ativo: item.enabled === true,
        posicao: Math.max(0, Number(item.position) || 0),
        configuracao: item.config && typeof item.config === "object" && !Array.isArray(item.config) ? item.config : {}
    }));
}

export async function salvarLayoutWidgets(idMateriaLocal, layout) {
    const contexto = exigirContexto();
    const subjectId = resolverId("subject", idMateriaLocal);
    if (!Array.isArray(layout) || layout.length > TIPOS_WIDGET.size) {
        throw erroRepositorio("A configuração dos widgets é inválida.");
    }
    const tipos = layout.map(item => item?.tipo);
    if (tipos.some(tipo => !TIPOS_WIDGET.has(tipo)) || new Set(tipos).size !== tipos.length) {
        throw erroRepositorio("A configuração contém widgets inválidos ou repetidos.");
    }
    const registros = layout.map((item, posicao) => ({
        workspace_id: contexto.workspaceId,
        subject_id: subjectId,
        user_id: contexto.userId,
        widget_type: item.tipo,
        enabled: item.ativo === true,
        position: posicao,
        config: item.configuracao && typeof item.configuracao === "object" && !Array.isArray(item.configuracao)
            ? item.configuracao
            : {}
    }));
    if (!registros.length) return [];
    const resposta = await supabase.from("user_subject_widgets")
        .upsert(registros, { onConflict: "subject_id,user_id,widget_type" })
        .select("widget_type, enabled, position, config")
        .order("position", { ascending: true });
    const salvos = verificarResposta(resposta, "Não foi possível salvar a organização dos widgets.") || [];
    if (salvos.length !== registros.length) throw erroRepositorio("O Supabase não confirmou todos os widgets configurados.");
    return salvos.map(item => ({
        materiaId: idMateriaLocal,
        tipo: item.widget_type,
        ativo: item.enabled === true,
        posicao: Number(item.position),
        configuracao: item.config || {}
    }));
}

const TAMANHO_PAGINA_DISPOSITIVOS_JURIDICOS = 1000;

export async function carregarDispositivosJuridicosPorVersao(versaoId) {
    obterContexto();
    const dispositivos = [];
    for (let inicio = 0; ; inicio += TAMANHO_PAGINA_DISPOSITIVOS_JURIDICOS) {
        const resposta = await supabase.from("legal_provisions")
            .select("id, version_id, provision_key, sequence, heading_path, heading, label, content")
            .eq("version_id", versaoId)
            .order("sequence", { ascending: true })
            .range(inicio, inicio + TAMANHO_PAGINA_DISPOSITIVOS_JURIDICOS - 1);
        const pagina = verificarResposta(resposta, "Não foi possível carregar os artigos dos documentos jurídicos.") || [];
        dispositivos.push(...pagina);
        if (pagina.length < TAMANHO_PAGINA_DISPOSITIVOS_JURIDICOS) break;
    }
    return dispositivos.map(item => ({
        id: item.id,
        chave: item.provision_key,
        sequencia: Number(item.sequence),
        caminho: Array.isArray(item.heading_path) ? item.heading_path : [],
        titulo: item.heading || "",
        rotulo: item.label,
        conteudo: item.content
    }));
}

export async function carregarBibliotecaJuridica() {
    obterContexto();
    const [documentosResposta, vinculosResposta] = await Promise.all([
        supabase.from("legal_documents")
            .select("id, slug, title, short_title, issuing_body, current_version_id")
            .eq("active", true)
            .order("title", { ascending: true }),
        supabase.from("catalog_subject_documents")
            .select("catalog_subject_id, document_id, position")
            .order("position", { ascending: true })
    ]);
    const documentos = verificarResposta(documentosResposta, "Não foi possível carregar os documentos jurídicos.") || [];
    const vinculos = verificarResposta(vinculosResposta, "Não foi possível carregar as sugestões jurídicas das matérias.") || [];
    const versoesAtuaisIds = [...new Set(documentos.map(item => item.current_version_id).filter(Boolean))];
    const versoesResposta = versoesAtuaisIds.length
        ? await supabase.from("legal_document_versions")
            .select("id, document_id, version_label, content_scope, official_source_url, official_source_label, source_checked_on")
            .in("id", versoesAtuaisIds)
        : { data: [], error: null };
    const versoes = verificarResposta(versoesResposta, "Não foi possível carregar as versões dos documentos jurídicos.") || [];
    return documentos.map(documento => {
        const versao = versoes.find(item => item.id === documento.current_version_id);
        return {
            id: documento.id,
            slug: documento.slug,
            titulo: documento.title,
            tituloCurto: documento.short_title,
            orgao: documento.issuing_body,
            catalogoIds: vinculos.filter(item => item.document_id === documento.id).map(item => item.catalog_subject_id),
            versao: versao ? {
                id: versao.id,
                rotulo: versao.version_label,
                escopo: versao.content_scope,
                fonteUrl: versao.official_source_url,
                fonteNome: versao.official_source_label,
                conferidaEm: versao.source_checked_on,
                carregada: false,
                dispositivos: []
            } : null
        };
    }).filter(documento => documento.versao);
}

export async function carregarColecoesVade() {
    const contexto = obterContexto();
    const [colecoesResposta, documentosResposta, artigosResposta, secoesResposta] = await Promise.all([
        supabase.from("user_vade_collections")
            .select("id, name, description, position, last_provision_id, created_at, updated_at")
            .eq("workspace_id", contexto.workspaceId)
            .eq("user_id", contexto.userId)
            .order("position", { ascending: true })
            .order("created_at", { ascending: true }),
        supabase.from("user_vade_collection_documents")
            .select("collection_id, document_id, position, added_at")
            .eq("workspace_id", contexto.workspaceId)
            .eq("user_id", contexto.userId)
            .order("collection_id", { ascending: true })
            .order("position", { ascending: true }),
        supabase.from("user_vade_collection_provisions")
            .select("collection_id, document_id, provision_id, section_id, position, added_at, reviewed_at, documento:legal_documents(short_title), dispositivo:legal_provisions(label, heading)")
            .eq("workspace_id", contexto.workspaceId)
            .eq("user_id", contexto.userId)
            .order("collection_id", { ascending: true })
            .order("position", { ascending: true }),
        supabase.from("user_vade_collection_sections")
            .select("id, collection_id, name, position, created_at, updated_at")
            .eq("workspace_id", contexto.workspaceId)
            .eq("user_id", contexto.userId)
            .order("collection_id", { ascending: true })
            .order("position", { ascending: true })
    ]);
    const colecoes = verificarResposta(colecoesResposta, "Não foi possível carregar seus cadernos jurídicos.") || [];
    const documentos = verificarResposta(documentosResposta, "Não foi possível carregar as normas dos seus cadernos.") || [];
    const artigos = verificarResposta(artigosResposta, "Não foi possível carregar os artigos dos seus cadernos.") || [];
    const secoes = verificarResposta(secoesResposta, "Não foi possível carregar as seções dos seus cadernos.") || [];
    return colecoes.map(colecao => ({
        id: colecao.id,
        nome: colecao.name,
        descricao: colecao.description || "",
        posicao: Number(colecao.position) || 0,
        ultimoDispositivoId: colecao.last_provision_id || null,
        criadoEm: colecao.created_at,
        atualizadoEm: colecao.updated_at,
        documentos: documentos.filter(item => item.collection_id === colecao.id).map(item => ({
            documentoId: item.document_id,
            posicao: Number(item.position) || 0,
            adicionadoEm: item.added_at
        })),
        secoes: secoes.filter(item => item.collection_id === colecao.id).map(item => ({
            id: item.id,
            nome: item.name,
            posicao: Number(item.position) || 0,
            criadoEm: item.created_at,
            atualizadoEm: item.updated_at
        })),
        artigos: artigos.filter(item => item.collection_id === colecao.id).map(item => ({
            documentoId: item.document_id,
            dispositivoId: item.provision_id,
            secaoId: item.section_id || null,
            documentoTitulo: item.documento?.short_title || "Norma jurídica",
            rotulo: item.dispositivo?.label || "Artigo",
            titulo: item.dispositivo?.heading || "",
            posicao: Number(item.position) || 0,
            adicionadoEm: item.added_at,
            revisadoEm: item.reviewed_at || null
        }))
    }));
}

function mapearAnotacaoColecaoVade(item) {
    return {
        id: item.id,
        colecaoId: item.collection_id,
        dispositivoId: item.provision_id || null,
        tipo: item.kind,
        titulo: item.title || "",
        conteudo: item.content || "",
        tags: Array.isArray(item.tags) ? item.tags : [],
        fixada: item.pinned === true,
        versao: Number(item.version) || 1,
        criadoEm: item.created_at,
        atualizadoEm: item.updated_at
    };
}

function tipoAnotacaoVade(valor) {
    const tipo = String(valor || "note");
    if (!TIPOS_ANOTACAO_VADE.has(tipo)) throw erroRepositorio("Tipo da anotação jurídica inválido.");
    return tipo;
}

export async function carregarAnotacoesColecaoVade(id) {
    const contexto = obterContexto();
    const colecaoId = exigirUuidNovo(id, "Caderno jurídico");
    const resposta = await supabase.from("user_vade_notes")
        .select("id, collection_id, provision_id, kind, title, content, tags, pinned, version, created_at, updated_at")
        .eq("collection_id", colecaoId)
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .order("pinned", { ascending: false })
        .order("updated_at", { ascending: false });
    return (verificarResposta(resposta, "Não foi possível carregar as anotações do caderno.") || [])
        .map(mapearAnotacaoColecaoVade);
}

export async function criarAnotacaoColecaoVade(id, anotacao) {
    const contexto = exigirContexto();
    const colecaoId = exigirUuidNovo(id, "Caderno jurídico");
    const anotacaoId = exigirUuidNovo(anotacao?.id, "Anotação jurídica");
    const dispositivoId = anotacao?.dispositivoId
        ? exigirUuidNovo(anotacao.dispositivoId, "Artigo jurídico")
        : null;
    const resposta = await supabase.from("user_vade_notes").insert({
        id: anotacaoId,
        collection_id: colecaoId,
        workspace_id: contexto.workspaceId,
        user_id: contexto.userId,
        provision_id: dispositivoId,
        kind: tipoAnotacaoVade(anotacao?.tipo),
        title: texto(anotacao?.titulo, 500, "Título da anotação"),
        content: texto(anotacao?.conteudo, 500000, "Conteúdo da anotação"),
        tags: tagsValidas(anotacao?.tags || []),
        pinned: anotacao?.fixada === true
    }).select("id, collection_id, provision_id, kind, title, content, tags, pinned, version, created_at, updated_at").single();
    return mapearAnotacaoColecaoVade(verificarRegistro(resposta, "Não foi possível criar a anotação do caderno."));
}

export async function atualizarAnotacaoColecaoVade(id, alteracoes, versaoEsperada) {
    const contexto = exigirContexto();
    const anotacaoId = exigirUuidNovo(id, "Anotação jurídica");
    const versao = numeroLimitado(versaoEsperada, "Versão da anotação jurídica", 1, 2147483647, true);
    const valores = {};
    if (Object.hasOwn(alteracoes, "dispositivoId")) {
        valores.provision_id = alteracoes.dispositivoId
            ? exigirUuidNovo(alteracoes.dispositivoId, "Artigo jurídico")
            : null;
    }
    if (Object.hasOwn(alteracoes, "tipo")) valores.kind = tipoAnotacaoVade(alteracoes.tipo);
    if (Object.hasOwn(alteracoes, "titulo")) valores.title = texto(alteracoes.titulo, 500, "Título da anotação");
    if (Object.hasOwn(alteracoes, "conteudo")) valores.content = texto(alteracoes.conteudo, 500000, "Conteúdo da anotação");
    if (Object.hasOwn(alteracoes, "tags")) valores.tags = tagsValidas(alteracoes.tags);
    if (Object.hasOwn(alteracoes, "fixada")) valores.pinned = alteracoes.fixada === true;
    if (!Object.keys(valores).length) throw erroRepositorio("Nenhuma alteração válida foi informada para a anotação jurídica.");
    const resposta = await supabase.from("user_vade_notes").update(valores)
        .eq("id", anotacaoId)
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .eq("version", versao)
        .select("id, collection_id, provision_id, kind, title, content, tags, pinned, version, created_at, updated_at")
        .maybeSingle();
    const salvo = verificarResposta(resposta, "Não foi possível atualizar a anotação do caderno.");
    if (!salvo) throw erroRepositorio("Esta anotação foi alterada em outra aba. Recarregue o caderno antes de editar novamente.");
    return mapearAnotacaoColecaoVade(salvo);
}

export async function excluirAnotacaoColecaoVade(id, versaoEsperada) {
    const contexto = exigirContexto();
    const anotacaoId = exigirUuidNovo(id, "Anotação jurídica");
    const versao = numeroLimitado(versaoEsperada, "Versão da anotação jurídica", 1, 2147483647, true);
    const resposta = await supabase.from("user_vade_notes").delete()
        .eq("id", anotacaoId)
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .eq("version", versao)
        .select("id")
        .maybeSingle();
    const removido = verificarResposta(resposta, "Não foi possível excluir a anotação do caderno.");
    if (!removido) throw erroRepositorio("Esta anotação foi alterada em outra aba. Recarregue o caderno antes de excluí-la.");
    return removido.id;
}

function mapearPdfColecaoVade(item) {
    return {
        id: item.id,
        colecaoId: item.collection_id,
        nomeOriginal: item.original_name,
        nome: item.display_name,
        descricao: item.description || "",
        tamanho: Number(item.size_bytes) || 0,
        tipo: item.mime_type,
        totalPaginas: item.page_count == null ? null : Number(item.page_count),
        paginaAtual: Number(item.last_page) || 1,
        ultimaLeituraEm: item.last_read_at || null,
        criadoEm: item.created_at,
        atualizadoEm: item.updated_at
    };
}

async function validarPdfColecaoVade(arquivo) {
    if (!arquivo || typeof arquivo.slice !== "function" || typeof arquivo.size !== "number") {
        throw erroRepositorio("Selecione um arquivo PDF válido.");
    }
    if (arquivo.size < 1 || arquivo.size > LIMITE_PDF_VADE_BYTES) {
        throw erroRepositorio("O PDF precisa ter no máximo 25 MB.");
    }
    const nome = texto(arquivo.name, 255, "Nome original do PDF", true).trim();
    if (!nome.toLowerCase().endsWith(".pdf")) throw erroRepositorio("O arquivo precisa usar a extensão .pdf.");
    const cabecalho = new Uint8Array(await arquivo.slice(0, 5).arrayBuffer());
    if (String.fromCharCode(...cabecalho) !== "%PDF-") {
        throw erroRepositorio("O arquivo selecionado não possui uma assinatura PDF válida.");
    }
    return { nome, tamanho: arquivo.size };
}

export async function carregarPdfsColecaoVade(id) {
    const contexto = obterContexto();
    const colecaoId = exigirUuidNovo(id, "Caderno jurídico");
    verificarResposta(
        await supabase.rpc("reconcile_user_vade_files", { p_collection_id: colecaoId }),
        "Não foi possível conferir os envios pendentes deste caderno."
    );
    const resposta = await supabase.from("user_vade_files")
        .select("id, collection_id, original_name, display_name, description, mime_type, size_bytes, page_count, last_page, last_read_at, created_at, updated_at")
        .eq("collection_id", colecaoId)
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .eq("upload_status", "ready")
        .order("updated_at", { ascending: false });
    return (verificarResposta(resposta, "Não foi possível carregar os PDFs privados do caderno.") || [])
        .map(mapearPdfColecaoVade);
}

export async function enviarPdfColecaoVade(id, arquivo, metadados = {}) {
    const contexto = exigirContexto();
    const colecaoId = exigirUuidNovo(id, "Caderno jurídico");
    const arquivoId = exigirUuidNovo(metadados.id, "PDF privado");
    const validado = await validarPdfColecaoVade(arquivo);
    const nomePadrao = validado.nome.replace(/\.pdf$/i, "");
    const caminho = `${contexto.userId}/${contexto.workspaceId}/${colecaoId}/${arquivoId}.pdf`;
    const registroResposta = await supabase.from("user_vade_files").insert({
        id: arquivoId,
        collection_id: colecaoId,
        workspace_id: contexto.workspaceId,
        user_id: contexto.userId,
        storage_path: caminho,
        original_name: validado.nome,
        display_name: texto(metadados.nome || nomePadrao, 200, "Nome do PDF", true).trim(),
        description: texto(metadados.descricao, 1000, "Descrição do PDF"),
        mime_type: "application/pdf",
        size_bytes: validado.tamanho,
        upload_status: "pending"
    }).select("id").single();
    verificarRegistro(registroResposta, "Não foi possível preparar o PDF privado.");
    const envio = await supabase.storage.from(BUCKET_PDFS_VADE).upload(caminho, arquivo, {
        cacheControl: "3600",
        contentType: "application/pdf",
        upsert: false
    });
    if (envio.error) {
        const limpeza = await supabase.rpc("remove_user_vade_file_metadata", { p_file_id: arquivoId });
        if (limpeza.error) {
            throw erroRepositorio("O envio falhou e o cadastro temporário não pôde ser limpo. Recarregue o caderno antes de tentar novamente.", envio.error);
        }
        throw erroRepositorio("Não foi possível enviar o PDF privado. O cadastro temporário foi removido.", envio.error);
    }
    const finalizacao = await supabase.rpc("finalize_user_vade_file", { p_file_id: arquivoId });
    if (finalizacao.error) {
        throw erroRepositorio("O PDF chegou ao espaço privado, mas a confirmação ficou pendente. Reabra a aba Materiais para recuperá-lo automaticamente.", finalizacao.error);
    }
    const salvo = await supabase.from("user_vade_files")
        .select("id, collection_id, original_name, display_name, description, mime_type, size_bytes, page_count, last_page, last_read_at, created_at, updated_at")
        .eq("id", arquivoId)
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .eq("upload_status", "ready")
        .maybeSingle();
    return mapearPdfColecaoVade(verificarRegistro(salvo, "O PDF foi enviado, mas ainda não está disponível para leitura."));
}

export async function atualizarPdfColecaoVade(id, alteracoes) {
    const contexto = exigirContexto();
    const arquivoId = exigirUuidNovo(id, "PDF privado");
    const valores = {};
    if (Object.hasOwn(alteracoes, "nome")) valores.display_name = texto(alteracoes.nome, 200, "Nome do PDF", true).trim();
    if (Object.hasOwn(alteracoes, "descricao")) valores.description = texto(alteracoes.descricao, 1000, "Descrição do PDF");
    if (Object.hasOwn(alteracoes, "paginaAtual")) valores.last_page = numeroLimitado(alteracoes.paginaAtual, "Página atual", 1, 100000, true);
    if (Object.hasOwn(alteracoes, "totalPaginas")) valores.page_count = numeroLimitado(alteracoes.totalPaginas, "Total de páginas", 1, 100000, true);
    if (alteracoes.registrarLeitura === true) valores.last_read_at = new Date().toISOString();
    if (valores.page_count && valores.last_page && valores.last_page > valores.page_count) {
        throw erroRepositorio("A página atual não pode ser maior que o total de páginas.");
    }
    if (!Object.keys(valores).length) throw erroRepositorio("Nenhuma alteração válida foi informada para o PDF.");
    const resposta = await supabase.from("user_vade_files").update(valores)
        .eq("id", arquivoId)
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .select("id, collection_id, original_name, display_name, description, mime_type, size_bytes, page_count, last_page, last_read_at, created_at, updated_at")
        .maybeSingle();
    return mapearPdfColecaoVade(verificarRegistro(resposta, "Não foi possível atualizar o PDF privado."));
}

export async function criarUrlPdfColecaoVade(id) {
    const contexto = obterContexto();
    const arquivoId = exigirUuidNovo(id, "PDF privado");
    const resposta = await supabase.from("user_vade_files")
        .select("storage_path")
        .eq("id", arquivoId)
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .eq("upload_status", "ready")
        .maybeSingle();
    const arquivo = verificarRegistro(resposta, "Não foi possível localizar o PDF privado.");
    const assinatura = await supabase.storage.from(BUCKET_PDFS_VADE).createSignedUrl(arquivo.storage_path, 300);
    const dados = verificarResposta(assinatura, "Não foi possível abrir o PDF privado.");
    if (!dados?.signedUrl) throw erroRepositorio("O endereço temporário do PDF não foi criado.");
    return dados.signedUrl;
}

export async function excluirPdfColecaoVade(id) {
    const contexto = exigirContexto();
    const arquivoId = exigirUuidNovo(id, "PDF privado");
    const consulta = await supabase.from("user_vade_files")
        .select("storage_path")
        .eq("id", arquivoId)
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .maybeSingle();
    const arquivo = verificarRegistro(consulta, "Não foi possível localizar o PDF privado.");
    verificarResposta(
        await supabase.storage.from(BUCKET_PDFS_VADE).remove([arquivo.storage_path]),
        "Não foi possível remover o arquivo privado."
    );
    return verificarRegistro(
        await supabase.rpc("remove_user_vade_file_metadata", { p_file_id: arquivoId }),
        "O arquivo foi removido, mas o cadastro precisa ser atualizado novamente."
    );
}

export async function criarColecaoVade(colecao) {
    const contexto = exigirContexto();
    const id = exigirUuidNovo(colecao?.id, "Caderno jurídico");
    const resposta = await supabase.from("user_vade_collections").insert({
        id,
        workspace_id: contexto.workspaceId,
        user_id: contexto.userId,
        name: texto(colecao?.nome, 120, "Nome do caderno jurídico", true).trim(),
        description: texto(colecao?.descricao, 1000, "Descrição do caderno jurídico"),
        position: numeroLimitado(colecao?.posicao ?? 0, "Posição do caderno jurídico", 0, 1000, true)
    }).select("id, name, description, position, created_at, updated_at").single();
    const salvo = verificarRegistro(resposta, "Não foi possível criar o caderno jurídico.");
    return {
        id: salvo.id,
        nome: salvo.name,
        descricao: salvo.description || "",
        posicao: Number(salvo.position) || 0,
        criadoEm: salvo.created_at,
        atualizadoEm: salvo.updated_at,
        documentos: [],
        secoes: [],
        artigos: [],
        ultimoDispositivoId: null
    };
}

export async function atualizarColecaoVade(id, alteracoes, atualizadoEm) {
    const contexto = exigirContexto();
    const colecaoId = exigirUuidNovo(id, "Caderno jurídico");
    const versaoEsperada = instanteIso(atualizadoEm, "Versão do caderno jurídico");
    const valores = {};
    if (Object.hasOwn(alteracoes, "nome")) valores.name = texto(alteracoes.nome, 120, "Nome do caderno jurídico", true).trim();
    if (Object.hasOwn(alteracoes, "descricao")) valores.description = texto(alteracoes.descricao, 1000, "Descrição do caderno jurídico");
    if (Object.hasOwn(alteracoes, "posicao")) valores.position = numeroLimitado(alteracoes.posicao, "Posição do caderno jurídico", 0, 1000, true);
    if (!Object.keys(valores).length) throw erroRepositorio("Nenhuma alteração válida foi informada para o caderno jurídico.");
    const resposta = await supabase.from("user_vade_collections").update(valores)
        .eq("id", colecaoId)
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .eq("updated_at", versaoEsperada)
        .select("id, name, description, position, created_at, updated_at")
        .maybeSingle();
    const salvo = verificarResposta(resposta, "Não foi possível atualizar o caderno jurídico.");
    if (!salvo) throw erroRepositorio("Este caderno jurídico foi alterado em outra aba. Atualize a página antes de editar novamente.");
    return {
        id: salvo.id,
        nome: salvo.name,
        descricao: salvo.description || "",
        posicao: Number(salvo.position) || 0,
        criadoEm: salvo.created_at,
        atualizadoEm: salvo.updated_at
    };
}

export async function salvarDocumentosColecaoVade(id, documentosIds) {
    exigirContexto();
    const colecaoId = exigirUuidNovo(id, "Caderno jurídico");
    if (!Array.isArray(documentosIds) || documentosIds.length > 100) {
        throw erroRepositorio("A lista de normas do caderno jurídico é inválida.");
    }
    const ids = documentosIds.map(documentoId => exigirUuidNovo(documentoId, "Norma jurídica"));
    if (new Set(ids).size !== ids.length) throw erroRepositorio("A lista do caderno jurídico contém normas repetidas.");
    const resposta = await supabase.rpc("replace_user_vade_documents", {
        p_collection_id: colecaoId,
        p_document_ids: ids
    });
    const salvos = verificarResposta(resposta, "Não foi possível organizar as normas do caderno jurídico.") || [];
    if (salvos.length !== ids.length) throw erroRepositorio("O Supabase não confirmou todas as normas do caderno jurídico.");
    return salvos.map(item => ({
        documentoId: item.saved_document_id,
        posicao: Number(item.saved_position) || 0
    }));
}

export async function salvarArtigoColecaoVade(id, dispositivoId, adicionar = true) {
    exigirContexto();
    const colecaoId = exigirUuidNovo(id, "Caderno jurídico");
    const artigoId = exigirUuidNovo(dispositivoId, "Artigo jurídico");
    if (typeof adicionar !== "boolean") throw erroRepositorio("A operação do caderno jurídico é inválida.");
    const resposta = await supabase.rpc("set_user_vade_provision", {
        p_collection_id: colecaoId,
        p_provision_id: artigoId,
        p_save: adicionar
    });
    const salvos = verificarResposta(resposta, adicionar
        ? "Não foi possível salvar o artigo no caderno."
        : "Não foi possível remover o artigo do caderno.") || [];
    if (!adicionar) return null;
    const salvo = salvos[0];
    if (!salvo || salvo.saved_collection_id !== colecaoId || salvo.saved_provision_id !== artigoId) {
        throw erroRepositorio("O Supabase não confirmou o artigo salvo no caderno.");
    }
    return {
        documentoId: salvo.saved_document_id,
        dispositivoId: salvo.saved_provision_id,
        posicao: Number(salvo.saved_position) || 0,
        adicionadoEm: salvo.saved_added_at
    };
}

export async function salvarRevisaoArtigoColecaoVade(id, dispositivoId, revisado = true) {
    exigirContexto();
    const colecaoId = exigirUuidNovo(id, "Caderno jurídico");
    const artigoId = exigirUuidNovo(dispositivoId, "Artigo jurídico");
    if (typeof revisado !== "boolean") throw erroRepositorio("O estado de revisão do artigo é inválido.");
    const resposta = await supabase.rpc("set_user_vade_provision_review", {
        p_collection_id: colecaoId,
        p_provision_id: artigoId,
        p_reviewed: revisado
    });
    const valor = verificarResposta(resposta, "Não foi possível atualizar a revisão do artigo.");
    if (revisado && !valor) throw erroRepositorio("O Supabase não confirmou a revisão do artigo.");
    return valor || null;
}

function validarArtigosLoteColecaoVade(id, dispositivosIds) {
    const colecaoId = exigirUuidNovo(id, "Caderno jurídico");
    if (!Array.isArray(dispositivosIds) || dispositivosIds.length < 1 || dispositivosIds.length > 500) {
        throw erroRepositorio("Selecione entre 1 e 500 artigos do caderno.");
    }
    const ids = dispositivosIds.map(dispositivoId => exigirUuidNovo(dispositivoId, "Artigo jurídico"));
    if (new Set(ids).size !== ids.length) throw erroRepositorio("A seleção contém artigos repetidos.");
    return { colecaoId, ids };
}

export async function salvarRevisaoArtigosColecaoVade(id, dispositivosIds, revisado = true) {
    exigirContexto();
    const { colecaoId, ids } = validarArtigosLoteColecaoVade(id, dispositivosIds);
    if (typeof revisado !== "boolean") throw erroRepositorio("O estado de revisão dos artigos é inválido.");
    const resposta = await supabase.rpc("set_user_vade_provisions_review", {
        p_collection_id: colecaoId,
        p_provision_ids: ids,
        p_reviewed: revisado
    });
    const salvos = verificarResposta(resposta, "Não foi possível atualizar a revisão dos artigos.") || [];
    if (salvos.length !== ids.length) throw erroRepositorio("O Supabase não confirmou todos os artigos selecionados.");
    return salvos.map(item => ({ dispositivoId: item.saved_provision_id, revisadoEm: item.saved_reviewed_at || null }));
}

export async function moverArtigosParaSecaoColecaoVade(id, dispositivosIds, secaoId = null) {
    exigirContexto();
    const { colecaoId, ids } = validarArtigosLoteColecaoVade(id, dispositivosIds);
    const secaoValidada = secaoId ? exigirUuidNovo(secaoId, "Seção do caderno") : null;
    const resposta = await supabase.rpc("set_user_vade_provisions_section", {
        p_collection_id: colecaoId,
        p_provision_ids: ids,
        p_section_id: secaoValidada
    });
    const salvos = verificarResposta(resposta, "Não foi possível mover os artigos para a seção.") || [];
    if (salvos.length !== ids.length) throw erroRepositorio("O Supabase não confirmou todos os artigos movidos.");
    return salvos.map(item => ({
        dispositivoId: item.saved_provision_id,
        secaoId: item.saved_section_id || null,
        posicao: Number(item.saved_position) || 0
    }));
}

export async function removerArtigosColecaoVade(id, dispositivosIds) {
    exigirContexto();
    const { colecaoId, ids } = validarArtigosLoteColecaoVade(id, dispositivosIds);
    const resposta = await supabase.rpc("remove_user_vade_provisions", {
        p_collection_id: colecaoId,
        p_provision_ids: ids
    });
    const removidos = verificarResposta(resposta, "Não foi possível remover os artigos do caderno.") || [];
    const confirmados = removidos.map(item => item.removed_provision_id);
    if (confirmados.length !== ids.length || confirmados.some(dispositivoId => !ids.includes(dispositivoId))) {
        throw erroRepositorio("O Supabase não confirmou todos os artigos removidos.");
    }
    return confirmados;
}

export async function salvarOrdemArtigosColecaoVade(id, dispositivosIds) {
    exigirContexto();
    const colecaoId = exigirUuidNovo(id, "Caderno jurídico");
    if (!Array.isArray(dispositivosIds) || dispositivosIds.length > 500) {
        throw erroRepositorio("A ordem dos artigos do caderno é inválida.");
    }
    const ids = dispositivosIds.map(dispositivoId => exigirUuidNovo(dispositivoId, "Artigo jurídico"));
    if (new Set(ids).size !== ids.length) throw erroRepositorio("A ordem contém artigos repetidos.");
    const resposta = await supabase.rpc("replace_user_vade_provision_order", {
        p_collection_id: colecaoId,
        p_provision_ids: ids
    });
    const salvos = verificarResposta(resposta, "Não foi possível reordenar os artigos do caderno.") || [];
    if (salvos.length !== ids.length) throw erroRepositorio("O Supabase não confirmou a nova ordem dos artigos.");
    return salvos.map(item => ({
        dispositivoId: item.saved_provision_id,
        posicao: Number(item.saved_position) || 0
    }));
}

export async function salvarUltimoArtigoColecaoVade(id, dispositivoId) {
    exigirContexto();
    const colecaoId = exigirUuidNovo(id, "Caderno jurídico");
    const artigoId = exigirUuidNovo(dispositivoId, "Artigo jurídico");
    const resposta = await supabase.rpc("remember_user_vade_provision", {
        p_collection_id: colecaoId,
        p_provision_id: artigoId
    });
    const salvo = verificarResposta(resposta, "Não foi possível guardar a posição de leitura do caderno.");
    if (salvo !== artigoId) throw erroRepositorio("O Supabase não confirmou a posição de leitura do caderno.");
    return salvo;
}

function mapearSecaoVade(item) {
    return {
        id: item.saved_id,
        nome: item.saved_name,
        posicao: Number(item.saved_position) || 0,
        criadoEm: item.saved_created_at,
        atualizadoEm: item.saved_updated_at
    };
}

export async function criarSecaoColecaoVade(id, nome) {
    exigirContexto();
    const resposta = await supabase.rpc("create_user_vade_section", {
        p_collection_id: exigirUuidNovo(id, "Caderno jurídico"),
        p_name: texto(nome, 120, "Nome da seção", true).trim()
    });
    const salvo = (verificarResposta(resposta, "Não foi possível criar a seção do caderno.") || [])[0];
    if (!salvo) throw erroRepositorio("O Supabase não confirmou a nova seção.");
    return mapearSecaoVade(salvo);
}

export async function renomearSecaoColecaoVade(id, nome) {
    exigirContexto();
    const resposta = await supabase.rpc("rename_user_vade_section", {
        p_section_id: exigirUuidNovo(id, "Seção do caderno"),
        p_name: texto(nome, 120, "Nome da seção", true).trim()
    });
    const salvo = (verificarResposta(resposta, "Não foi possível renomear a seção.") || [])[0];
    if (!salvo) throw erroRepositorio("O Supabase não confirmou a seção renomeada.");
    return mapearSecaoVade(salvo);
}

export async function excluirSecaoColecaoVade(id) {
    exigirContexto();
    const resposta = await supabase.rpc("delete_user_vade_section", {
        p_section_id: exigirUuidNovo(id, "Seção do caderno")
    });
    if (verificarResposta(resposta, "Não foi possível excluir a seção.") !== true) {
        throw erroRepositorio("O Supabase não confirmou a exclusão da seção.");
    }
}

export async function salvarOrdemSecoesColecaoVade(id, secoesIds) {
    exigirContexto();
    if (!Array.isArray(secoesIds) || secoesIds.length > 100) throw erroRepositorio("A ordem das seções é inválida.");
    const ids = secoesIds.map(secaoId => exigirUuidNovo(secaoId, "Seção do caderno"));
    if (new Set(ids).size !== ids.length) throw erroRepositorio("A ordem contém seções repetidas.");
    const resposta = await supabase.rpc("replace_user_vade_section_order", {
        p_collection_id: exigirUuidNovo(id, "Caderno jurídico"),
        p_section_ids: ids
    });
    const salvos = verificarResposta(resposta, "Não foi possível reordenar as seções.") || [];
    if (salvos.length !== ids.length) throw erroRepositorio("O Supabase não confirmou a nova ordem das seções.");
    return salvos.map(item => ({ id: item.saved_section_id, posicao: Number(item.saved_position) || 0 }));
}

export async function moverArtigoParaSecaoColecaoVade(id, dispositivoId, secaoId = null) {
    exigirContexto();
    const resposta = await supabase.rpc("set_user_vade_provision_section", {
        p_collection_id: exigirUuidNovo(id, "Caderno jurídico"),
        p_provision_id: exigirUuidNovo(dispositivoId, "Artigo jurídico"),
        p_section_id: secaoId ? exigirUuidNovo(secaoId, "Seção do caderno") : null
    });
    const salvo = (verificarResposta(resposta, "Não foi possível mover o artigo para a seção.") || [])[0];
    if (!salvo || salvo.saved_provision_id !== dispositivoId || (salvo.saved_section_id || null) !== (secaoId || null)) {
        throw erroRepositorio("O Supabase não confirmou a seção do artigo.");
    }
    return salvo.saved_section_id || null;
}

export async function excluirColecaoVade(id) {
    const contexto = exigirContexto();
    const colecaoId = exigirUuidNovo(id, "Caderno jurídico");
    const arquivosResposta = await supabase.from("user_vade_files")
        .select("upload_status")
        .eq("collection_id", colecaoId)
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .limit(1)
        .maybeSingle();
    const arquivo = verificarResposta(arquivosResposta, "Não foi possível conferir os materiais privados do caderno.");
    if (arquivo?.upload_status === "pending") {
        throw erroRepositorio("Há um envio de PDF ainda pendente neste caderno. Reabra Materiais e aguarde a recuperação antes de excluí-lo.");
    }
    if (arquivo) {
        throw erroRepositorio("Este caderno possui PDFs privados. Remova os materiais na aba Materiais antes de excluir o caderno.");
    }
    verificarRegistro(await supabase.from("user_vade_collections").delete()
        .eq("id", colecaoId)
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .select("id")
        .maybeSingle(), "Não foi possível excluir o caderno jurídico.");
}

export async function carregarMapasMentais(materiaIdLocal) {
    const contexto = obterContexto();
    const subjectId = resolverId("subject", materiaIdLocal);
    const resposta = await supabase.from("user_mind_maps")
        .select("id, name, description, viewport, version, created_at, updated_at")
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .eq("subject_id", subjectId)
        .order("updated_at", { ascending: false });
    const mapas = verificarResposta(resposta, "Não foi possível carregar seus mapas mentais.") || [];
    return mapas.map(mapa => ({
        id: mapa.id,
        nome: mapa.name,
        descricao: mapa.description || "",
        viewport: mapa.viewport || { x: 0, y: 0, zoom: 1 },
        versao: Number(mapa.version) || 1,
        criadoEm: mapa.created_at,
        atualizadoEm: mapa.updated_at
    }));
}

export async function carregarMapaMental(id) {
    const contexto = obterContexto();
    const mapaId = exigirUuidNovo(id, "Mapa mental");
    const [mapaResposta, elementosResposta] = await Promise.all([
        supabase.from("user_mind_maps")
            .select("id, name, description, viewport, version, created_at, updated_at")
            .eq("id", mapaId)
            .eq("workspace_id", contexto.workspaceId)
            .eq("user_id", contexto.userId)
            .single(),
        supabase.from("user_mind_map_elements")
            .select("id, element_type, payload, z_index, created_at, updated_at")
            .eq("map_id", mapaId)
            .eq("workspace_id", contexto.workspaceId)
            .eq("user_id", contexto.userId)
            .order("z_index", { ascending: true })
            .order("created_at", { ascending: true })
    ]);
    const mapa = verificarRegistro(mapaResposta, "Não foi possível abrir o mapa mental.");
    const elementos = verificarResposta(elementosResposta, "Não foi possível carregar os elementos do mapa mental.") || [];
    return {
        id: mapa.id,
        nome: mapa.name,
        descricao: mapa.description || "",
        viewport: mapa.viewport || { x: 0, y: 0, zoom: 1 },
        versao: Number(mapa.version) || 1,
        criadoEm: mapa.created_at,
        atualizadoEm: mapa.updated_at,
        elementos: elementos.map(elemento => ({
            id: elemento.id,
            type: elemento.element_type,
            payload: elemento.payload && typeof elemento.payload === "object" && !Array.isArray(elemento.payload) ? elemento.payload : {},
            zIndex: Number(elemento.z_index) || 0
        }))
    };
}

export async function criarMapaMental(materiaIdLocal, mapa) {
    const contexto = exigirContexto();
    const id = exigirUuidNovo(mapa?.id, "Mapa mental");
    const resposta = await supabase.from("user_mind_maps").insert({
        id,
        workspace_id: contexto.workspaceId,
        user_id: contexto.userId,
        subject_id: resolverId("subject", materiaIdLocal),
        name: texto(mapa?.nome, 120, "Nome do mapa", true).trim(),
        description: texto(mapa?.descricao, 1000, "Descrição do mapa"),
        viewport: { x: 0, y: 0, zoom: 1 }
    }).select("id, name, description, viewport, version, created_at, updated_at").single();
    const salvo = verificarRegistro(resposta, "Não foi possível criar o mapa mental.");
    return {
        id: salvo.id,
        nome: salvo.name,
        descricao: salvo.description || "",
        viewport: salvo.viewport || { x: 0, y: 0, zoom: 1 },
        versao: Number(salvo.version) || 1,
        criadoEm: salvo.created_at,
        atualizadoEm: salvo.updated_at,
        elementos: []
    };
}

export async function atualizarMapaMental(id, alteracoes, versaoEsperada) {
    const contexto = exigirContexto();
    const mapaId = exigirUuidNovo(id, "Mapa mental");
    const versao = numeroLimitado(versaoEsperada, "Versão do mapa", 1, Number.MAX_SAFE_INTEGER, true);
    const valores = {};
    if (Object.hasOwn(alteracoes, "nome")) valores.name = texto(alteracoes.nome, 120, "Nome do mapa", true).trim();
    if (Object.hasOwn(alteracoes, "descricao")) valores.description = texto(alteracoes.descricao, 1000, "Descrição do mapa");
    if (!Object.keys(valores).length) throw erroRepositorio("Nenhuma alteração válida foi informada para o mapa mental.");
    const resposta = await supabase.from("user_mind_maps").update(valores)
        .eq("id", mapaId)
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .eq("version", versao)
        .select("id, name, description, viewport, version, created_at, updated_at")
        .maybeSingle();
    const salvo = verificarResposta(resposta, "Não foi possível atualizar o mapa mental.");
    if (!salvo) throw erroRepositorio("Este mapa foi alterado em outra aba. Atualize antes de continuar.");
    return {
        id: salvo.id,
        nome: salvo.name,
        descricao: salvo.description || "",
        viewport: salvo.viewport || { x: 0, y: 0, zoom: 1 },
        versao: Number(salvo.version) || versao + 1,
        criadoEm: salvo.created_at,
        atualizadoEm: salvo.updated_at
    };
}

export async function salvarConteudoMapaMental(id, elementos, viewport, versaoEsperada) {
    exigirContexto();
    const mapaId = exigirUuidNovo(id, "Mapa mental");
    const versao = numeroLimitado(versaoEsperada, "Versão do mapa", 1, Number.MAX_SAFE_INTEGER, true);
    if (!Array.isArray(elementos) || elementos.length > 500) throw erroRepositorio("O mapa possui uma quantidade inválida de elementos.");
    const tipos = new Set(["node", "edge", "shape", "stroke"]);
    const ids = new Set();
    const seguros = elementos.map((elemento, indice) => {
        const elementoId = exigirUuidNovo(elemento?.id, "Elemento do mapa");
        if (ids.has(elementoId)) throw erroRepositorio("O mapa possui elementos repetidos.");
        ids.add(elementoId);
        if (!tipos.has(elemento?.type)) throw erroRepositorio("O mapa possui um tipo de elemento inválido.");
        if (!elemento.payload || typeof elemento.payload !== "object" || Array.isArray(elemento.payload)) throw erroRepositorio("O mapa possui conteúdo inválido.");
        if (JSON.stringify(elemento.payload).length > 100000) throw erroRepositorio("Um elemento do mapa ultrapassou o limite seguro.");
        return {
            id: elementoId,
            type: elemento.type,
            payload: elemento.payload,
            zIndex: numeroLimitado(elemento.zIndex ?? indice, "Camada do elemento", 0, 5000, true)
        };
    });
    if (!viewport || typeof viewport !== "object" || Array.isArray(viewport)) throw erroRepositorio("A visualização do mapa é inválida.");
    const resposta = await supabase.rpc("replace_user_mind_map_elements", {
        p_map_id: mapaId,
        p_expected_version: versao,
        p_elements: seguros,
        p_viewport: viewport
    });
    const salvos = verificarResposta(resposta, "Não foi possível salvar o conteúdo do mapa mental.") || [];
    if (salvos.length !== 1) throw erroRepositorio("O Supabase não confirmou o salvamento do mapa mental.");
    return {
        versao: Number(salvos[0].saved_version) || versao + 1,
        atualizadoEm: salvos[0].saved_updated_at
    };
}

export async function excluirMapaMental(id) {
    const contexto = exigirContexto();
    const mapaId = exigirUuidNovo(id, "Mapa mental");
    verificarRegistro(await supabase.from("user_mind_maps").delete()
        .eq("id", mapaId)
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .select("id")
        .maybeSingle(), "Não foi possível excluir o mapa mental.");
}

export async function carregarGrifosJuridicos() {
    const contexto = obterContexto();
    const resposta = await supabase.from("user_legal_highlights")
        .select("id, subject_id, provision_id, selected_text, prefix_text, suffix_text, color, note, created_at, updated_at")
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .order("created_at", { ascending: true });
    const itens = verificarResposta(resposta, "Não foi possível carregar seus grifos jurídicos.") || [];
    const materiasLegadas = idsLocaisPorRemotos.get("subject");
    return itens.map(item => ({
        id: item.id,
        materiaId: materiasLegadas?.get(item.subject_id) || item.subject_id,
        dispositivoId: item.provision_id,
        texto: item.selected_text,
        prefixo: item.prefix_text || "",
        sufixo: item.suffix_text || "",
        cor: CORES_GRIFO.has(item.color) ? item.color : "yellow",
        nota: item.note || "",
        criadoEm: item.created_at,
        atualizadoEm: item.updated_at
    }));
}

export async function carregarEstadoLeituraJuridica() {
    const contexto = obterContexto();
    const [favoritosResposta, historicoResposta] = await Promise.all([
        supabase.from("user_legal_bookmarks")
            .select("subject_id, provision_id, created_at")
            .eq("workspace_id", contexto.workspaceId)
            .eq("user_id", contexto.userId)
            .order("created_at", { ascending: false }),
        supabase.from("user_legal_reading_history")
            .select("subject_id, provision_id, visit_count, first_read_at, last_read_at")
            .eq("workspace_id", contexto.workspaceId)
            .eq("user_id", contexto.userId)
            .order("last_read_at", { ascending: false })
    ]);
    const favoritos = verificarResposta(favoritosResposta, "Não foi possível carregar seus artigos favoritos.") || [];
    const historico = verificarResposta(historicoResposta, "Não foi possível carregar seu histórico de leitura.") || [];
    const idsDispositivos = [...new Set([...favoritos, ...historico].map(item => item.provision_id).filter(Boolean))];
    const referenciasResposta = idsDispositivos.length
        ? await supabase.from("legal_provisions").select("id, version_id, label").in("id", idsDispositivos)
        : { data: [], error: null };
    const referencias = verificarResposta(referenciasResposta, "Não foi possível identificar seus artigos salvos.") || [];
    const referenciasPorId = new Map(referencias.map(item => [item.id, item]));
    const materiasLegadas = idsLocaisPorRemotos.get("subject");
    const materiaLocal = id => materiasLegadas?.get(id) || id;
    return {
        favoritos: favoritos.map(item => ({
            materiaId: materiaLocal(item.subject_id),
            dispositivoId: item.provision_id,
            versaoId: referenciasPorId.get(item.provision_id)?.version_id || null,
            rotulo: referenciasPorId.get(item.provision_id)?.label || "Artigo salvo",
            criadoEm: item.created_at
        })),
        historico: historico.map(item => ({
            materiaId: materiaLocal(item.subject_id),
            dispositivoId: item.provision_id,
            versaoId: referenciasPorId.get(item.provision_id)?.version_id || null,
            rotulo: referenciasPorId.get(item.provision_id)?.label || "Artigo recente",
            visitas: Number(item.visit_count) || 1,
            primeiraLeituraEm: item.first_read_at,
            ultimaLeituraEm: item.last_read_at
        }))
    };
}

export async function salvarFavoritoJuridico(idMateriaLocal, provisionId, favorito) {
    const contexto = exigirContexto();
    const subjectId = resolverId("subject", idMateriaLocal);
    const dispositivoId = exigirUuidNovo(provisionId, "Artigo selecionado");
    if (favorito === true) {
        const resposta = await supabase.from("user_legal_bookmarks").upsert({
            workspace_id: contexto.workspaceId,
            subject_id: subjectId,
            user_id: contexto.userId,
            provision_id: dispositivoId
        }, { onConflict: "user_id,subject_id,provision_id" })
            .select("provision_id, created_at")
            .single();
        const salvo = verificarRegistro(resposta, "Não foi possível favoritar o artigo.");
        return { materiaId: idMateriaLocal, dispositivoId: salvo.provision_id, criadoEm: salvo.created_at };
    }
    verificarRegistro(await supabase.from("user_legal_bookmarks").delete()
        .eq("workspace_id", contexto.workspaceId)
        .eq("subject_id", subjectId)
        .eq("user_id", contexto.userId)
        .eq("provision_id", dispositivoId)
        .select("provision_id")
        .maybeSingle(), "Não foi possível remover o artigo dos favoritos.");
    return null;
}

export async function registrarLeituraJuridica(idMateriaLocal, provisionId) {
    const contexto = exigirContexto();
    const subjectId = resolverId("subject", idMateriaLocal);
    const dispositivoId = exigirUuidNovo(provisionId, "Artigo selecionado");
    const resposta = await supabase.rpc("increment_legal_reading_history", {
        p_workspace_id: contexto.workspaceId,
        p_subject_id: subjectId,
        p_provision_id: dispositivoId
    })
        .single();
    const salvo = verificarRegistro(resposta, "Não foi possível registrar sua leitura.");
    return {
        materiaId: idMateriaLocal,
        dispositivoId: salvo.provision_id,
        visitas: Number(salvo.visit_count) || 1,
        primeiraLeituraEm: salvo.first_read_at,
        ultimaLeituraEm: salvo.last_read_at
    };
}

export async function criarGrifoJuridico(idMateriaLocal, grifo) {
    const contexto = exigirContexto();
    const subjectId = resolverId("subject", idMateriaLocal);
    const provisionId = exigirUuidNovo(grifo.dispositivoId, "Artigo selecionado");
    const resposta = await supabase.from("user_legal_highlights").insert({
        workspace_id: contexto.workspaceId,
        subject_id: subjectId,
        user_id: contexto.userId,
        provision_id: provisionId,
        selected_text: texto(grifo.texto, 2000, "Trecho selecionado", true),
        prefix_text: texto(grifo.prefixo, 300, "Contexto anterior"),
        suffix_text: texto(grifo.sufixo, 300, "Contexto posterior"),
        color: CORES_GRIFO.has(grifo.cor) ? grifo.cor : "yellow",
        note: texto(grifo.nota, 5000, "Nota do grifo")
    }).select("id, created_at, updated_at").single();
    const salvo = verificarRegistro(resposta, "Não foi possível salvar o grifo.");
    return { ...grifo, id: salvo.id, materiaId: idMateriaLocal, criadoEm: salvo.created_at, atualizadoEm: salvo.updated_at };
}

export async function atualizarNotaGrifoJuridico(id, nota, atualizadoEm) {
    const contexto = exigirContexto();
    const grifoId = exigirUuidNovo(id, "Grifo");
    const versaoEsperada = instanteIso(atualizadoEm, "Versão da anotação");
    const resposta = await supabase.from("user_legal_highlights").update({
        note: texto(nota, 5000, "Nota do grifo")
    })
        .eq("id", grifoId)
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .eq("updated_at", versaoEsperada)
        .select("id, note, updated_at")
        .maybeSingle();
    const salvo = verificarResposta(resposta, "Não foi possível salvar a anotação do grifo.");
    if (!salvo) throw erroRepositorio("Esta anotação foi alterada em outra aba. Atualize a página antes de editar novamente.");
    return { id: salvo.id, nota: salvo.note || "", atualizadoEm: salvo.updated_at };
}

export async function atualizarCorGrifoJuridico(id, cor, atualizadoEm) {
    const contexto = exigirContexto();
    const grifoId = exigirUuidNovo(id, "Grifo");
    const versaoEsperada = instanteIso(atualizadoEm, "Versão do grifo");
    if (!CORES_GRIFO.has(cor) || cor === "pink") throw erroRepositorio("Escolha uma cor de grifo válida.");
    const resposta = await supabase.from("user_legal_highlights").update({ color: cor })
        .eq("id", grifoId)
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .eq("updated_at", versaoEsperada)
        .select("id, color, updated_at")
        .maybeSingle();
    const salvo = verificarResposta(resposta, "Não foi possível alterar a cor do grifo.");
    if (!salvo) throw erroRepositorio("Este grifo foi alterado em outra aba. Atualize a página antes de editar novamente.");
    return { id: salvo.id, cor: salvo.color, atualizadoEm: salvo.updated_at };
}

export async function excluirGrifoJuridico(id) {
    const contexto = exigirContexto();
    const grifoId = exigirUuidNovo(id, "Grifo");
    verificarRegistro(await supabase.from("user_legal_highlights").delete()
        .eq("id", grifoId)
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .select("id")
        .maybeSingle(), "Não foi possível excluir o grifo.");
}

export async function carregarTopicosRemotos() {
    const contexto = obterContexto();
    const resposta = await supabase.from("topics")
        .select("id, subject_id, title, status, review_count, position")
        .eq("workspace_id", contexto.workspaceId)
        .order("subject_id", { ascending: true })
        .order("position", { ascending: true });
    const topicos = verificarResposta(resposta, "Não foi possível carregar os tópicos do Supabase.") || [];
    const materiasLegadas = idsLocaisPorRemotos.get("subject");
    const topicosLegados = idsLocaisPorRemotos.get("topic");
    return topicos.map(topico => ({
        id: topicosLegados?.get(topico.id) || topico.id,
        materiaId: materiasLegadas?.get(topico.subject_id) || topico.subject_id,
        titulo: topico.title,
        status: STATUS_TOPICOS.has(topico.status) ? topico.status : "nao",
        revisoes: Math.max(0, Number(topico.review_count) || 0),
        position: Number(topico.position)
    }));
}

export async function carregarNotasRemotas() {
    const contexto = obterContexto();
    const resposta = await supabase.from("notes")
        .select("id, subject_id, title, content, tags, pinned, version, created_at, updated_at")
        .eq("workspace_id", contexto.workspaceId)
        .order("subject_id", { ascending: true })
        .order("pinned", { ascending: false })
        .order("updated_at", { ascending: false });
    const notas = verificarResposta(resposta, "Não foi possível carregar as notas do Supabase.") || [];
    const materiasLegadas = idsLocaisPorRemotos.get("subject");
    const notasLegadas = idsLocaisPorRemotos.get("note");
    notas.forEach(nota => versoesNotas.set(nota.id, Number(nota.version)));
    return notas.map(nota => ({
        id: notasLegadas?.get(nota.id) || nota.id,
        materiaId: materiasLegadas?.get(nota.subject_id) || nota.subject_id,
        titulo: nota.title || "",
        conteudo: nota.content || "",
        tags: Array.isArray(nota.tags) ? nota.tags : [],
        fixada: nota.pinned === true,
        criadaEm: String(nota.created_at || "").slice(0, 10),
        atualizadaEm: String(nota.updated_at || "").slice(0, 10)
    }));
}

export async function carregarFlashcardsRemotos() {
    const contexto = obterContexto();
    const [cardsResposta, progressoResposta] = await Promise.all([
        supabase.from("flashcards")
            .select("id, subject_id, front, back")
            .eq("workspace_id", contexto.workspaceId)
            .order("subject_id", { ascending: true })
            .order("created_at", { ascending: true }),
        supabase.from("flashcard_progress")
            .select("flashcard_id, box, next_review, correct_count, error_count")
            .eq("workspace_id", contexto.workspaceId)
            .eq("user_id", contexto.userId)
    ]);
    const cards = verificarResposta(cardsResposta, "Não foi possível carregar os flashcards do Supabase.") || [];
    const progressos = verificarResposta(progressoResposta, "Não foi possível carregar o progresso dos flashcards.") || [];
    const progressoPorCard = new Map(progressos.map(item => [item.flashcard_id, item]));
    const semProgresso = cards.filter(card => !progressoPorCard.has(card.id));
    if (semProgresso.length) {
        const hoje = new Date().toISOString().slice(0, 10);
        const resposta = await supabase.from("flashcard_progress").upsert(semProgresso.map(card => ({
            workspace_id: contexto.workspaceId,
            flashcard_id: card.id,
            user_id: contexto.userId,
            box: 1,
            next_review: hoje,
            correct_count: 0,
            error_count: 0
        })), { onConflict: "flashcard_id,user_id", ignoreDuplicates: true });
        verificarResposta(resposta, "Não foi possível preparar o progresso individual dos flashcards.");
        semProgresso.forEach(card => progressoPorCard.set(card.id, {
            flashcard_id: card.id,
            box: 1,
            next_review: hoje,
            correct_count: 0,
            error_count: 0
        }));
    }
    const materiasLegadas = idsLocaisPorRemotos.get("subject");
    const cardsLegados = idsLocaisPorRemotos.get("flashcard");
    return cards.map(card => {
        const progresso = progressoPorCard.get(card.id) || {};
        return {
            id: cardsLegados?.get(card.id) || card.id,
            materiaId: materiasLegadas?.get(card.subject_id) || card.subject_id,
            frente: card.front,
            verso: card.back,
            caixa: Math.min(5, Math.max(1, Number(progresso.box) || 1)),
            proxima: progresso.next_review || new Date().toISOString().slice(0, 10),
            acertos: Math.max(0, Number(progresso.correct_count) || 0),
            erros: Math.max(0, Number(progresso.error_count) || 0)
        };
    });
}

export async function carregarLinksRemotos() {
    const contexto = obterContexto();
    const resposta = await supabase.from("study_links")
        .select("id, subject_id, title, url")
        .eq("workspace_id", contexto.workspaceId)
        .order("subject_id", { ascending: true })
        .order("created_at", { ascending: true });
    const links = verificarResposta(resposta, "Não foi possível carregar os materiais do Supabase.") || [];
    const materiasLegadas = idsLocaisPorRemotos.get("subject");
    const linksLegados = idsLocaisPorRemotos.get("study_link");
    return links.map(link => ({
        id: linksLegados?.get(link.id) || link.id,
        materiaId: materiasLegadas?.get(link.subject_id) || link.subject_id,
        titulo: link.title,
        url: link.url
    }));
}

export async function carregarTarefasRemotas() {
    const contexto = obterContexto();
    const resposta = await supabase.from("study_tasks")
        .select("id, subject_id, topic, due_date, status, assigned_to")
        .eq("workspace_id", contexto.workspaceId)
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });
    const tarefas = verificarResposta(resposta, "Não foi possível carregar o cronograma do Supabase.") || [];
    const materiasLegadas = idsLocaisPorRemotos.get("subject");
    const tarefasLegadas = idsLocaisPorRemotos.get("study_task");
    return tarefas.map(tarefa => ({
        id: tarefasLegadas?.get(tarefa.id) || tarefa.id,
        materiaId: materiasLegadas?.get(tarefa.subject_id) || tarefa.subject_id,
        topico: tarefa.topic,
        data: tarefa.due_date || "",
        status: STATUS_TAREFAS.has(tarefa.status) ? tarefa.status : "pendente",
        responsavelId: tarefa.assigned_to || null
    }));
}

export async function carregarErrosRemotos() {
    const contexto = obterContexto();
    const resposta = await supabase.from("error_entries")
        .select("id, subject_id, theme, observation, occurred_on")
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .order("occurred_on", { ascending: true })
        .order("created_at", { ascending: true });
    const erros = verificarResposta(resposta, "Não foi possível carregar o caderno de erros do Supabase.") || [];
    const materiasLegadas = idsLocaisPorRemotos.get("subject");
    const errosLegados = idsLocaisPorRemotos.get("error_entry");
    return erros.map(erro => ({
        id: errosLegados?.get(erro.id) || erro.id,
        materiaId: materiasLegadas?.get(erro.subject_id) || erro.subject_id,
        tema: erro.theme,
        obs: erro.observation || "",
        data: erro.occurred_on || ""
    }));
}

export async function carregarDesempenhoRemoto() {
    const contexto = obterContexto();
    const resposta = await supabase.from("subject_performance")
        .select("subject_id, correct_answers, total_answers")
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId);
    const registros = verificarResposta(resposta, "Não foi possível carregar o histórico de desempenho.") || [];
    const materiasLegadas = idsLocaisPorRemotos.get("subject");
    return registros.map(registro => {
        const total = Math.max(0, Number(registro.total_answers) || 0);
        return {
            materiaId: materiasLegadas?.get(registro.subject_id) || registro.subject_id,
            acertos: Math.min(total, Math.max(0, Number(registro.correct_answers) || 0)),
            total
        };
    });
}

export async function carregarEditalRemoto() {
    const contexto = obterContexto();
    const [configuracaoResposta, materiasResposta, topicosResposta] = await Promise.all([
        supabase.from("exam_settings")
            .select("exam_name, board_name, vacancies, exam_date, updated_at")
            .eq("workspace_id", contexto.workspaceId)
            .eq("user_id", contexto.userId)
            .maybeSingle(),
        supabase.from("exam_subjects")
            .select("id, subject_id, question_count, weight, updated_at")
            .eq("workspace_id", contexto.workspaceId)
            .eq("user_id", contexto.userId)
            .order("created_at", { ascending: true }),
        supabase.from("exam_topics")
            .select("id, exam_subject_id, title, checked, position, updated_at")
            .eq("workspace_id", contexto.workspaceId)
            .eq("user_id", contexto.userId)
            .order("position", { ascending: true })
    ]);
    const configuracao = verificarResposta(configuracaoResposta, "Não foi possível carregar a configuração do edital.");
    const materias = verificarResposta(materiasResposta, "Não foi possível carregar a matriz do edital.") || [];
    const topicos = verificarResposta(topicosResposta, "Não foi possível carregar o checklist do edital.") || [];
    versaoConfiguracaoEdital = configuracao?.updated_at || null;
    versoesMateriasEdital = new Map(materias.map(item => [item.id, item.updated_at]));
    versoesTopicosEdital = new Map(topicos.map(item => [item.id, item.updated_at]));
    const materiasLegadas = idsLocaisPorRemotos.get("subject");
    const itensLegados = idsLocaisPorRemotos.get("exam_subject");
    const topicosPorItem = topicos.reduce((grupos, topico) => {
        if (!grupos.has(topico.exam_subject_id)) grupos.set(topico.exam_subject_id, []);
        grupos.get(topico.exam_subject_id).push(topico);
        return grupos;
    }, new Map());
    return {
        configuracaoExiste: Boolean(configuracao),
        nomeConcurso: configuracao?.exam_name || "",
        banca: configuracao?.board_name || "",
        vagas: configuracao?.vacancies || "",
        dataProva: configuracao?.exam_date || "",
        materias: materias.map(item => ({
            id: itensLegados?.get(item.id) || item.id,
            materiaId: materiasLegadas?.get(item.subject_id) || item.subject_id,
            questoes: Number(item.question_count),
            peso: Number(item.weight),
            topicos: (topicosPorItem.get(item.id) || []).map(topico => ({
                id: topico.id,
                titulo: topico.title,
                concluido: topico.checked === true
            }))
        }))
    };
}

export async function criarMateria(materia, position) {
    const contexto = exigirContexto();
    const id = exigirUuidNovo(materia.id, "Matéria");
    const resposta = await supabase.from("subjects").insert({
        id,
        workspace_id: contexto.workspaceId,
        name: texto(materia.nome, 500, "Nome da matéria", true),
        description: texto(materia.desc, 5000, "Descrição"),
        color: CORES.has(materia.cor) ? materia.cor : "primary",
        priority: PRIORIDADES.has(materia.prioridade) ? materia.prioridade : "media",
        catalog_subject_id: materia.catalogoId ? exigirUuidNovo(materia.catalogoId, "Tipo da matéria") : null,
        position: Math.max(0, Number(position) || 0),
        created_by: contexto.userId
    });
    verificarResposta(resposta, "Não foi possível criar a matéria no Supabase.");
    registrarId("subject", materia.id, id);
    return id;
}

export async function atualizarMateria(idLocal, alteracoes) {
    const contexto = exigirContexto();
    const id = resolverId("subject", idLocal);
    const valores = {};
    if (Object.hasOwn(alteracoes, "nome")) valores.name = texto(alteracoes.nome, 500, "Nome da matéria", true);
    if (Object.hasOwn(alteracoes, "desc")) valores.description = texto(alteracoes.desc, 5000, "Descrição");
    if (Object.hasOwn(alteracoes, "cor")) valores.color = CORES.has(alteracoes.cor) ? alteracoes.cor : "primary";
    if (Object.hasOwn(alteracoes, "prioridade")) valores.priority = PRIORIDADES.has(alteracoes.prioridade) ? alteracoes.prioridade : "media";
    if (Object.hasOwn(alteracoes, "catalogoId")) valores.catalog_subject_id = alteracoes.catalogoId
        ? exigirUuidNovo(alteracoes.catalogoId, "Tipo da matéria")
        : null;
    if (Object.hasOwn(alteracoes, "position")) valores.position = Math.max(0, Number(alteracoes.position) || 0);
    if (!Object.keys(valores).length) return;
    verificarRegistro(await supabase.from("subjects").update(valores)
        .eq("id", id)
        .eq("workspace_id", contexto.workspaceId)
        .select("id")
        .maybeSingle(), "Não foi possível atualizar a matéria no Supabase.");
}

export async function excluirMateria(idLocal) {
    const contexto = exigirContexto();
    const id = resolverId("subject", idLocal);
    verificarRegistro(await supabase.from("subjects").delete()
        .eq("id", id)
        .eq("workspace_id", contexto.workspaceId)
        .select("id")
        .maybeSingle(), "Não foi possível excluir a matéria no Supabase.");
}

export async function atualizarPosicoesMaterias(idsLocais) {
    const contexto = exigirContexto();
    const ids = idsLocais.map(id => resolverId("subject", id));
    if (new Set(ids).size !== ids.length) throw erroRepositorio("A ordem das matérias contém identificadores repetidos.");

    const consulta = await supabase.from("subjects")
        .select("id, position")
        .eq("workspace_id", contexto.workspaceId);
    const materiasDoEspaco = verificarResposta(consulta, "Não foi possível conferir a ordem atual das matérias.") || [];
    const materiasPorId = new Map(materiasDoEspaco.map(materia => [materia.id, materia]));
    const anteriores = ids.map(id => materiasPorId.get(id));
    if (anteriores.some(materia => !materia)) throw erroRepositorio("Nem todas as matérias pertencem ao espaço de estudos aberto.");

    const atualizar = (id, position) => supabase.from("subjects").update({ position })
        .eq("id", id)
        .eq("workspace_id", contexto.workspaceId)
        .select("id")
        .maybeSingle();

    try {
        for (let position = 0; position < ids.length; position += 1) {
            verificarRegistro(await atualizar(ids[position], position), "Não foi possível salvar a nova ordem das matérias.");
        }
    } catch (erro) {
        const restauracoes = await Promise.allSettled(anteriores.map(item => atualizar(item.id, item.position)));
        if (restauracoes.some(resultado => resultado.status === "rejected" || resultado.value?.error)) {
            throw erroRepositorio("A ordem remota ficou pendente de conferência após uma falha de gravação.", erro);
        }
        throw erro;
    }
}

export async function criarTopico(materiaIdLocal, topico, position) {
    const contexto = exigirContexto();
    const id = exigirUuidNovo(topico.id, "Tópico");
    const resposta = await supabase.from("topics").insert({
        id,
        workspace_id: contexto.workspaceId,
        subject_id: resolverId("subject", materiaIdLocal),
        title: texto(topico.titulo, 1000, "Título do tópico", true),
        status: STATUS_TOPICOS.has(topico.status) ? topico.status : "nao",
        review_count: Math.max(0, Number(topico.revisoes) || 0),
        position: Math.max(0, Number(position) || 0),
        created_by: contexto.userId
    });
    verificarResposta(resposta, "Não foi possível criar o tópico no Supabase.");
    registrarId("topic", topico.id, id);
    return id;
}

export async function criarTopicos(materiaIdLocal, topicos, positionInicial) {
    const contexto = exigirContexto();
    const subjectId = resolverId("subject", materiaIdLocal);
    const registros = topicos.map((topico, indice) => ({
        id: exigirUuidNovo(topico.id, "Tópico"),
        workspace_id: contexto.workspaceId,
        subject_id: subjectId,
        title: texto(topico.titulo, 1000, "Título do tópico", true),
        status: STATUS_TOPICOS.has(topico.status) ? topico.status : "nao",
        review_count: Math.max(0, Number(topico.revisoes) || 0),
        position: Math.max(0, Number(positionInicial) || 0) + indice,
        created_by: contexto.userId
    }));
    if (!registros.length) return [];
    verificarResposta(await supabase.from("topics").insert(registros), "Não foi possível criar os tópicos no Supabase.");
    topicos.forEach((topico, indice) => registrarId("topic", topico.id, registros[indice].id));
    return registros.map(registro => registro.id);
}

export async function atualizarTopico(idLocal, alteracoes) {
    const contexto = exigirContexto();
    const valores = {};
    if (Object.hasOwn(alteracoes, "titulo")) valores.title = texto(alteracoes.titulo, 1000, "Título do tópico", true);
    if (Object.hasOwn(alteracoes, "status")) valores.status = STATUS_TOPICOS.has(alteracoes.status) ? alteracoes.status : "nao";
    if (Object.hasOwn(alteracoes, "revisoes")) valores.review_count = Math.max(0, Number(alteracoes.revisoes) || 0);
    if (Object.hasOwn(alteracoes, "position")) valores.position = Math.max(0, Number(alteracoes.position) || 0);
    if (!Object.keys(valores).length) return;
    verificarRegistro(await supabase.from("topics").update(valores)
        .eq("id", resolverId("topic", idLocal))
        .eq("workspace_id", contexto.workspaceId)
        .select("id")
        .maybeSingle(), "Não foi possível atualizar o tópico no Supabase.");
}

export async function excluirTopico(idLocal) {
    const contexto = exigirContexto();
    verificarRegistro(await supabase.from("topics").delete()
        .eq("id", resolverId("topic", idLocal))
        .eq("workspace_id", contexto.workspaceId)
        .select("id")
        .maybeSingle(), "Não foi possível excluir o tópico no Supabase.");
}

export async function atualizarPosicoesTopicos(materiaIdLocal, idsLocais) {
    const contexto = exigirContexto();
    const subjectId = resolverId("subject", materiaIdLocal);
    const ids = idsLocais.map(id => resolverId("topic", id));
    if (new Set(ids).size !== ids.length) throw erroRepositorio("A ordem dos tópicos contém identificadores repetidos.");

    const consulta = await supabase.from("topics")
        .select("id, position")
        .eq("workspace_id", contexto.workspaceId)
        .eq("subject_id", subjectId);
    const topicosDaMateria = verificarResposta(consulta, "Não foi possível conferir a ordem atual dos tópicos.") || [];
    const topicosPorId = new Map(topicosDaMateria.map(topico => [topico.id, topico]));
    const anteriores = ids.map(id => topicosPorId.get(id));
    if (anteriores.some(topico => !topico)) throw erroRepositorio("Nem todos os tópicos pertencem à matéria aberta.");

    const atualizar = (id, position) => supabase.from("topics").update({ position })
        .eq("id", id)
        .eq("workspace_id", contexto.workspaceId)
        .eq("subject_id", subjectId)
        .select("id")
        .maybeSingle();

    try {
        for (let position = 0; position < ids.length; position += 1) {
            verificarRegistro(await atualizar(ids[position], position), "Não foi possível organizar os tópicos no Supabase.");
        }
    } catch (erro) {
        const restauracoes = await Promise.allSettled(anteriores.map(item => atualizar(item.id, item.position)));
        if (restauracoes.some(resultado => resultado.status === "rejected" || resultado.value?.error)) {
            throw erroRepositorio("A ordem dos tópicos ficou pendente de conferência após uma falha.", erro);
        }
        throw erro;
    }
}

export async function criarNota(materiaIdLocal, nota) {
    const contexto = exigirContexto();
    const id = exigirUuidNovo(nota.id, "Nota");
    const resposta = await supabase.from("notes").insert({
        id,
        workspace_id: contexto.workspaceId,
        subject_id: resolverId("subject", materiaIdLocal),
        title: texto(nota.titulo, 500, "Título da nota"),
        content: texto(nota.conteudo, 500000, "Conteúdo da nota"),
        tags: tagsValidas(nota.tags || []),
        pinned: nota.fixada === true,
        created_by: contexto.userId,
        updated_by: contexto.userId
    }).select("version, created_at, updated_at").single();
    const dados = verificarResposta(resposta, "Não foi possível criar a nota no Supabase.");
    registrarId("note", nota.id, id);
    versoesNotas.set(id, Number(dados.version));
    return {
        id,
        criadaEm: String(dados.created_at || "").slice(0, 10),
        atualizadaEm: String(dados.updated_at || "").slice(0, 10)
    };
}

export async function atualizarNota(idLocal, alteracoes) {
    const contexto = exigirContexto();
    const id = resolverId("note", idLocal);
    const versao = versoesNotas.get(id);
    if (!versao) throw erroRepositorio("A versão atual da nota não está disponível.");
    const valores = { updated_by: contexto.userId };
    if (Object.hasOwn(alteracoes, "titulo")) valores.title = texto(alteracoes.titulo, 500, "Título da nota");
    if (Object.hasOwn(alteracoes, "conteudo")) valores.content = texto(alteracoes.conteudo, 500000, "Conteúdo da nota");
    if (Object.hasOwn(alteracoes, "tags")) valores.tags = tagsValidas(alteracoes.tags);
    if (Object.hasOwn(alteracoes, "fixada")) valores.pinned = alteracoes.fixada === true;
    const resposta = await supabase.from("notes").update(valores)
        .eq("id", id)
        .eq("workspace_id", contexto.workspaceId)
        .eq("version", versao)
        .select("version, updated_at")
        .maybeSingle();
    const dados = verificarResposta(resposta, "Não foi possível atualizar a nota no Supabase.");
    if (!dados) throw erroRepositorio("A nota foi modificada em outro lugar. Recarregue antes de salvar novamente.");
    versoesNotas.set(id, Number(dados.version));
    return { atualizadaEm: String(dados.updated_at || "").slice(0, 10) };
}

export async function excluirNota(idLocal) {
    const contexto = exigirContexto();
    const id = resolverId("note", idLocal);
    verificarRegistro(await supabase.from("notes").delete()
        .eq("id", id)
        .eq("workspace_id", contexto.workspaceId)
        .select("id")
        .maybeSingle(), "Não foi possível excluir a nota no Supabase.");
    versoesNotas.delete(id);
}

export async function criarFlashcard(materiaIdLocal, card) {
    const contexto = exigirContexto();
    const id = exigirUuidNovo(card.id, "Flashcard");
    const cardResposta = await supabase.from("flashcards").insert({
        id,
        workspace_id: contexto.workspaceId,
        subject_id: resolverId("subject", materiaIdLocal),
        front: texto(card.frente, 5000, "Frente do flashcard", true),
        back: texto(card.verso, 10000, "Verso do flashcard", true),
        created_by: contexto.userId
    });
    verificarResposta(cardResposta, "Não foi possível criar o flashcard no Supabase.");
    const progressoResposta = await supabase.from("flashcard_progress").insert({
        workspace_id: contexto.workspaceId,
        flashcard_id: id,
        user_id: contexto.userId,
        box: Math.min(5, Math.max(1, Number(card.caixa) || 1)),
        next_review: card.proxima,
        correct_count: Math.max(0, Number(card.acertos) || 0),
        error_count: Math.max(0, Number(card.erros) || 0)
    });
    if (progressoResposta.error) {
        const compensacao = await supabase.from("flashcards").delete()
            .eq("id", id)
            .eq("workspace_id", contexto.workspaceId);
        throw erroRepositorio(compensacao.error
            ? "O flashcard ficou pendente de revisão após uma falha de gravação."
            : "A criação do flashcard foi desfeita porque o progresso não pôde ser salvo.", progressoResposta.error);
    }
    registrarId("flashcard", card.id, id);
    return id;
}

export async function atualizarFlashcard(idLocal, alteracoes) {
    const contexto = exigirContexto();
    const valores = {};
    if (Object.hasOwn(alteracoes, "frente")) valores.front = texto(alteracoes.frente, 5000, "Frente do flashcard", true);
    if (Object.hasOwn(alteracoes, "verso")) valores.back = texto(alteracoes.verso, 10000, "Verso do flashcard", true);
    if (!Object.keys(valores).length) return;
    verificarRegistro(await supabase.from("flashcards").update(valores)
        .eq("id", resolverId("flashcard", idLocal))
        .eq("workspace_id", contexto.workspaceId)
        .select("id")
        .maybeSingle(), "Não foi possível atualizar o flashcard no Supabase.");
}

export async function atualizarProgressoFlashcard(idLocal, progresso) {
    const contexto = exigirContexto();
    verificarRegistro(await supabase.from("flashcard_progress").update({
        box: Math.min(5, Math.max(1, Number(progresso.caixa) || 1)),
        next_review: progresso.proxima,
        correct_count: Math.max(0, Number(progresso.acertos) || 0),
        error_count: Math.max(0, Number(progresso.erros) || 0)
    }).eq("flashcard_id", resolverId("flashcard", idLocal))
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .select("id")
        .maybeSingle(), "Não foi possível atualizar o progresso do flashcard.");
}

export async function excluirFlashcard(idLocal) {
    const contexto = exigirContexto();
    verificarRegistro(await supabase.from("flashcards").delete()
        .eq("id", resolverId("flashcard", idLocal))
        .eq("workspace_id", contexto.workspaceId)
        .select("id")
        .maybeSingle(), "Não foi possível excluir o flashcard no Supabase.");
}

export async function criarLink(materiaIdLocal, link) {
    const contexto = exigirContexto();
    const id = exigirUuidNovo(link.id, "Link");
    const resposta = await supabase.from("study_links").insert({
        id,
        workspace_id: contexto.workspaceId,
        subject_id: resolverId("subject", materiaIdLocal),
        title: texto(link.titulo, 500, "Título do link", true),
        url: urlHttp(link.url),
        created_by: contexto.userId
    });
    verificarResposta(resposta, "Não foi possível criar o link no Supabase.");
    registrarId("study_link", link.id, id);
    return id;
}

export async function atualizarLink(idLocal, alteracoes) {
    const contexto = exigirContexto();
    const valores = {};
    if (Object.hasOwn(alteracoes, "titulo")) valores.title = texto(alteracoes.titulo, 500, "Título do link", true);
    if (Object.hasOwn(alteracoes, "url")) valores.url = urlHttp(alteracoes.url);
    if (!Object.keys(valores).length) return;
    verificarRegistro(await supabase.from("study_links").update(valores)
        .eq("id", resolverId("study_link", idLocal))
        .eq("workspace_id", contexto.workspaceId)
        .select("id")
        .maybeSingle(), "Não foi possível atualizar o link no Supabase.");
}

export async function excluirLink(idLocal) {
    const contexto = exigirContexto();
    verificarRegistro(await supabase.from("study_links").delete()
        .eq("id", resolverId("study_link", idLocal))
        .eq("workspace_id", contexto.workspaceId)
        .select("id")
        .maybeSingle(), "Não foi possível excluir o link no Supabase.");
}

export async function criarTarefa(tarefa) {
    const contexto = exigirContexto();
    const id = exigirUuidNovo(tarefa.id, "Sessão do cronograma");
    const resposta = await supabase.from("study_tasks").insert({
        id,
        workspace_id: contexto.workspaceId,
        subject_id: resolverId("subject", tarefa.materiaId),
        topic: texto(tarefa.topico, 2000, "Conteúdo da sessão", true),
        due_date: dataIso(tarefa.data, "Data da sessão", true),
        status: STATUS_TAREFAS.has(tarefa.status) ? tarefa.status : "pendente",
        assigned_to: contexto.userId,
        created_by: contexto.userId
    });
    verificarResposta(resposta, "Não foi possível criar a sessão no Supabase.");
    registrarId("study_task", tarefa.id, id);
    return id;
}

export async function atualizarTarefa(idLocal, alteracoes) {
    const contexto = exigirContexto();
    const valores = {};
    if (Object.hasOwn(alteracoes, "materiaId")) valores.subject_id = resolverId("subject", alteracoes.materiaId);
    if (Object.hasOwn(alteracoes, "topico")) valores.topic = texto(alteracoes.topico, 2000, "Conteúdo da sessão", true);
    if (Object.hasOwn(alteracoes, "data")) valores.due_date = dataIso(alteracoes.data, "Data da sessão", true);
    if (Object.hasOwn(alteracoes, "status")) {
        if (!STATUS_TAREFAS.has(alteracoes.status)) throw erroRepositorio("Status da sessão inválido.");
        valores.status = alteracoes.status;
    }
    if (!Object.keys(valores).length) return;
    verificarRegistro(await supabase.from("study_tasks").update(valores)
        .eq("id", resolverId("study_task", idLocal))
        .eq("workspace_id", contexto.workspaceId)
        .select("id")
        .maybeSingle(), "Não foi possível atualizar a sessão no Supabase.");
}

export async function excluirTarefa(idLocal) {
    const contexto = exigirContexto();
    verificarRegistro(await supabase.from("study_tasks").delete()
        .eq("id", resolverId("study_task", idLocal))
        .eq("workspace_id", contexto.workspaceId)
        .select("id")
        .maybeSingle(), "Não foi possível excluir a sessão no Supabase.");
}

export async function criarErro(erro) {
    const contexto = exigirContexto();
    const id = exigirUuidNovo(erro.id, "Registro do caderno de erros");
    verificarResposta(await supabase.from("error_entries").insert({
        id,
        workspace_id: contexto.workspaceId,
        subject_id: resolverId("subject", erro.materiaId),
        user_id: contexto.userId,
        theme: texto(erro.tema, 4000, "Tema do erro", true),
        observation: texto(erro.obs, 10000, "Observação do erro"),
        occurred_on: dataIso(erro.data, "Data do erro", true)
    }), "Não foi possível registrar o erro no Supabase.");
    registrarId("error_entry", erro.id, id);
    return id;
}

export async function excluirErro(idLocal) {
    const contexto = exigirContexto();
    verificarRegistro(await supabase.from("error_entries").delete()
        .eq("id", resolverId("error_entry", idLocal))
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .select("id")
        .maybeSingle(), "Não foi possível excluir o registro do caderno de erros.");
}

export async function registrarRespostaDesempenho(materiaIdLocal, acertou) {
    const contexto = exigirContexto();
    const resposta = await supabase.rpc("increment_subject_performance", {
        target_workspace_id: contexto.workspaceId,
        target_subject_id: resolverId("subject", materiaIdLocal),
        was_correct: acertou === true
    });
    const registro = verificarResposta(resposta, "Não foi possível atualizar o histórico de desempenho.");
    const total = Math.max(0, Number(registro?.total) || 0);
    const acertos = Math.min(total, Math.max(0, Number(registro?.acertos) || 0));
    return { acertos, total };
}

export async function salvarConfiguracaoEdital(configuracao) {
    const contexto = exigirContexto();
    const valores = {
        exam_name: texto(configuracao.nomeConcurso, 500, "Nome do concurso"),
        board_name: texto(configuracao.banca, 300, "Banca"),
        vacancies: texto(configuracao.vagas, 100, "Vagas"),
        exam_date: dataIso(configuracao.dataProva, "Data da prova"),
        updated_by: contexto.userId
    };
    let resposta;
    if (versaoConfiguracaoEdital) {
        resposta = await supabase.from("exam_settings").update(valores)
            .eq("workspace_id", contexto.workspaceId)
            .eq("user_id", contexto.userId)
            .eq("updated_at", versaoConfiguracaoEdital)
            .select("updated_at")
            .maybeSingle();
        const registro = verificarRegistro(resposta, "A configuração mudou em outra sessão. Recarregue antes de salvar novamente.");
        versaoConfiguracaoEdital = registro.updated_at;
        return;
    }
    resposta = await supabase.from("exam_settings").insert({ workspace_id: contexto.workspaceId, user_id: contexto.userId, ...valores })
        .select("updated_at")
        .single();
    const registro = verificarResposta(resposta, "Não foi possível criar a configuração do edital.");
    versaoConfiguracaoEdital = registro.updated_at;
}

export async function excluirConfiguracaoEdital() {
    const contexto = exigirContexto();
    if (!versaoConfiguracaoEdital) return;
    verificarRegistro(await supabase.from("exam_settings").delete()
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .eq("updated_at", versaoConfiguracaoEdital)
        .select("workspace_id")
        .maybeSingle(), "A configuração mudou em outra sessão. Recarregue antes de limpar.");
    versaoConfiguracaoEdital = null;
}

export async function criarMateriaEdital(item) {
    const contexto = exigirContexto();
    const id = exigirUuidNovo(item.id, "Matéria do edital");
    const resposta = await supabase.from("exam_subjects").insert({
        id,
        workspace_id: contexto.workspaceId,
        user_id: contexto.userId,
        subject_id: resolverId("subject", item.materiaId),
        question_count: numeroLimitado(item.questoes, "Quantidade de questões", 0, 100000, true),
        weight: numeroLimitado(item.peso, "Peso", 0, 100000)
    }).select("updated_at").single();
    const registro = verificarResposta(resposta, "Não foi possível adicionar a matéria ao edital.");
    registrarId("exam_subject", item.id, id);
    versoesMateriasEdital.set(id, registro.updated_at);
    return id;
}

export async function atualizarMateriaEdital(idLocal, alteracoes) {
    const contexto = exigirContexto();
    const id = resolverId("exam_subject", idLocal);
    const valores = {};
    if (Object.hasOwn(alteracoes, "questoes")) valores.question_count = numeroLimitado(alteracoes.questoes, "Quantidade de questões", 0, 100000, true);
    if (Object.hasOwn(alteracoes, "peso")) valores.weight = numeroLimitado(alteracoes.peso, "Peso", 0, 100000);
    if (!Object.keys(valores).length) return;
    const versao = versoesMateriasEdital.get(id);
    let consulta = supabase.from("exam_subjects").update(valores)
        .eq("id", id)
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId);
    if (versao) consulta = consulta.eq("updated_at", versao);
    const registro = verificarRegistro(await consulta.select("updated_at").maybeSingle(), "A matriz mudou em outra sessão. Recarregue antes de salvar novamente.");
    versoesMateriasEdital.set(id, registro.updated_at);
}

export async function excluirMateriaEdital(idLocal) {
    const contexto = exigirContexto();
    const id = resolverId("exam_subject", idLocal);
    const versao = versoesMateriasEdital.get(id);
    let consulta = supabase.from("exam_subjects").delete()
        .eq("id", id)
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId);
    if (versao) consulta = consulta.eq("updated_at", versao);
    verificarRegistro(await consulta.select("id").maybeSingle(), "A matéria do edital mudou em outra sessão. Recarregue antes de excluir.");
    versoesMateriasEdital.delete(id);
}

export async function criarTopicosEdital(itemIdLocal, topicos) {
    const contexto = exigirContexto();
    if (!Array.isArray(topicos) || topicos.length > 500) throw erroRepositorio("Lista de tópicos do edital inválida.");
    if (!topicos.length) return;
    const itemId = resolverId("exam_subject", itemIdLocal);
    const registros = topicos.map((topico, position) => ({
        id: exigirUuidNovo(topico.id, "Tópico do edital"),
        workspace_id: contexto.workspaceId,
        user_id: contexto.userId,
        exam_subject_id: itemId,
        title: texto(topico.titulo, 1000, "Título do tópico", true),
        checked: topico.concluido === true,
        position
    }));
    const resposta = verificarResposta(await supabase.from("exam_topics").insert(registros).select("id, updated_at"), "Não foi possível criar o checklist do edital.") || [];
    resposta.forEach(registro => versoesTopicosEdital.set(registro.id, registro.updated_at));
}

export async function atualizarTopicoEdital(idLocal, concluido) {
    const contexto = exigirContexto();
    const id = resolverId("exam_topic", idLocal);
    let consulta = supabase.from("exam_topics").update({ checked: concluido === true })
        .eq("id", id)
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId);
    const versao = versoesTopicosEdital.get(id);
    if (versao) consulta = consulta.eq("updated_at", versao);
    const registro = verificarRegistro(await consulta.select("updated_at").maybeSingle(), "O checklist mudou em outra sessão. Recarregue antes de salvar novamente.");
    versoesTopicosEdital.set(id, registro.updated_at);
}

export async function excluirTopicoEdital(idLocal) {
    const contexto = exigirContexto();
    const id = resolverId("exam_topic", idLocal);
    const versao = versoesTopicosEdital.get(id);
    let consulta = supabase.from("exam_topics").delete()
        .eq("id", id)
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId);
    if (versao) consulta = consulta.eq("updated_at", versao);
    verificarRegistro(await consulta.select("id").maybeSingle(), "O checklist mudou em outra sessão. Recarregue antes de excluir.");
    versoesTopicosEdital.delete(id);
}
