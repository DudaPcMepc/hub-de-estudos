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

export async function carregarBibliotecaJuridica() {
    obterContexto();
    const [documentosResposta, versoesResposta, dispositivosResposta, vinculosResposta] = await Promise.all([
        supabase.from("legal_documents")
            .select("id, slug, title, short_title, issuing_body, current_version_id")
            .eq("active", true)
            .order("title", { ascending: true }),
        supabase.from("legal_document_versions")
            .select("id, document_id, version_label, content_scope, official_source_url, official_source_label, source_checked_on"),
        supabase.from("legal_provisions")
            .select("id, version_id, provision_key, sequence, heading_path, heading, label, content")
            .order("sequence", { ascending: true }),
        supabase.from("catalog_subject_documents")
            .select("catalog_subject_id, document_id, position")
            .order("position", { ascending: true })
    ]);
    const documentos = verificarResposta(documentosResposta, "Não foi possível carregar os documentos jurídicos.") || [];
    const versoes = verificarResposta(versoesResposta, "Não foi possível carregar as versões dos documentos jurídicos.") || [];
    const dispositivos = verificarResposta(dispositivosResposta, "Não foi possível carregar os artigos dos documentos jurídicos.") || [];
    const vinculos = verificarResposta(vinculosResposta, "Não foi possível carregar as sugestões jurídicas das matérias.") || [];
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
                dispositivos: dispositivos.filter(item => item.version_id === versao.id).map(item => ({
                    id: item.id,
                    chave: item.provision_key,
                    sequencia: Number(item.sequence),
                    caminho: Array.isArray(item.heading_path) ? item.heading_path : [],
                    titulo: item.heading || "",
                    rotulo: item.label,
                    conteudo: item.content
                }))
            } : null
        };
    }).filter(documento => documento.versao);
}

export async function carregarGrifosJuridicos() {
    const contexto = obterContexto();
    const resposta = await supabase.from("user_legal_highlights")
        .select("id, subject_id, provision_id, selected_text, prefix_text, suffix_text, color, note, created_at")
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
        criadoEm: item.created_at
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
    const materiasLegadas = idsLocaisPorRemotos.get("subject");
    const materiaLocal = id => materiasLegadas?.get(id) || id;
    return {
        favoritos: favoritos.map(item => ({
            materiaId: materiaLocal(item.subject_id),
            dispositivoId: item.provision_id,
            criadoEm: item.created_at
        })),
        historico: historico.map(item => ({
            materiaId: materiaLocal(item.subject_id),
            dispositivoId: item.provision_id,
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

export async function registrarLeituraJuridica(idMateriaLocal, provisionId, visitasAtuais = 0) {
    const contexto = exigirContexto();
    const subjectId = resolverId("subject", idMateriaLocal);
    const dispositivoId = exigirUuidNovo(provisionId, "Artigo selecionado");
    const agora = new Date().toISOString();
    const resposta = await supabase.from("user_legal_reading_history").upsert({
        workspace_id: contexto.workspaceId,
        subject_id: subjectId,
        user_id: contexto.userId,
        provision_id: dispositivoId,
        visit_count: Math.min(1000000, Math.max(1, Number(visitasAtuais) + 1)),
        last_read_at: agora
    }, { onConflict: "user_id,subject_id,provision_id" })
        .select("provision_id, visit_count, first_read_at, last_read_at")
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
    }).select("id, created_at").single();
    const salvo = verificarRegistro(resposta, "Não foi possível salvar o grifo.");
    return { ...grifo, id: salvo.id, materiaId: idMateriaLocal, criadoEm: salvo.created_at };
}

export async function atualizarNotaGrifoJuridico(id, nota) {
    const contexto = exigirContexto();
    const grifoId = exigirUuidNovo(id, "Grifo");
    const resposta = await supabase.from("user_legal_highlights").update({
        note: texto(nota, 5000, "Nota do grifo")
    })
        .eq("id", grifoId)
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .select("id, note, updated_at")
        .maybeSingle();
    const salvo = verificarRegistro(resposta, "Não foi possível salvar a anotação do grifo.");
    return { id: salvo.id, nota: salvo.note || "", atualizadoEm: salvo.updated_at };
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
