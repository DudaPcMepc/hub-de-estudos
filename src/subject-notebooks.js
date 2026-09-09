import { criarDesenhoPagina } from "./subject-page-drawing.js";

const TIPOS = Object.freeze({ folder: "Pasta", notebook: "Caderno", page: "Página" });
const ICONES = Object.freeze({ folder: "folder2", notebook: "journal-bookmark", page: "file-earmark-text" });
const PAPEIS = Object.freeze({ plain: "Lisa", lined: "Pautada", grid: "Quadriculada", dotted: "Pontilhada" });
const CAPAS = Object.freeze({ solid: "Clássica", gradient: "Degradê", minimal: "Minimalista" });
const CORES_GRIFO = Object.freeze(["#ffe58f", "#bdecc8", "#b9ddff", "#ffc6d9", "#ffd0a8"]);
const uuid = () => crypto.randomUUID();
const esc = (valor) => String(valor ?? "").replace(/[&<>'"]/g, caractere => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[caractere]);
const formatarDataCurta = valor => {
    const data = new Date(valor || "");
    return Number.isNaN(data.getTime()) ? "" : new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(data).replace(".", "");
};
const posicaoAindaNaoDisponivel = erro => ["PGRST205", "42P01"].includes(String(erro?.cause?.code || ""));

export function criarCadernosMaterias(repositorio) {
    const dom = {
        app: document.getElementById("subjectNotebookApp"),
        status: document.getElementById("subjectNotebookStatus"),
        tree: document.getElementById("subjectNotebookTree"),
        count: document.getElementById("subjectNotebookCount"),
        search: document.getElementById("subjectNotebookSearch"),
        organize: document.getElementById("btnOrganizarCadernoMateria"),
        notebooks: document.getElementById("btnCadernosMateria"),
        trash: document.getElementById("btnLixeiraCadernoMateria"),
        trashCount: document.getElementById("subjectNotebookTrashCount"),
        treePanel: document.getElementById("subjectNotebookTreePanel"),
        mobileTree: document.getElementById("btnAlternarArvoreCaderno"),
        workspace: document.getElementById("subjectNotebookWorkspace"),
        novaPasta: document.getElementById("btnNovaPastaMateria"),
        novoCaderno: document.getElementById("btnNovoCadernoMateria"),
        headerActions: document.getElementById("subjectNotebookHeaderActions"),
        dialog: document.getElementById("subjectNotebookDialog"),
        form: document.getElementById("subjectNotebookForm"),
        dialogEyebrow: document.getElementById("subjectNotebookDialogEyebrow"),
        dialogTitle: document.getElementById("subjectNotebookDialogTitle"),
        itemId: document.getElementById("subjectNotebookItemId"),
        itemType: document.getElementById("subjectNotebookItemType"),
        nameGroup: document.getElementById("subjectNotebookNameGroup"),
        itemTitle: document.getElementById("subjectNotebookItemTitle"),
        parentGroup: document.getElementById("subjectNotebookParentGroup"),
        itemParent: document.getElementById("subjectNotebookItemParent"),
        itemTopic: document.getElementById("subjectNotebookItemTopic"),
        topicGroup: document.getElementById("subjectNotebookTopicGroup"),
        styleFields: document.getElementById("subjectNotebookStyleFields"),
        itemColor: document.getElementById("subjectNotebookItemColor"),
        itemCover: document.getElementById("subjectNotebookItemCover"),
        itemPaper: document.getElementById("subjectNotebookItemPaper"),
        save: document.getElementById("subjectNotebookDialogSave"),
        pageActions: document.getElementById("subjectNotebookPageActionsDialog"),
        pageActionsTitle: document.getElementById("subjectNotebookPageActionsTitle"),
        pageActionsId: document.getElementById("subjectNotebookPageActionsId"),
        materialDialog: document.getElementById("subjectNotebookMaterialDialog"),
        materialTitle: document.getElementById("subjectNotebookMaterialTitle"),
        materialPageId: document.getElementById("subjectNotebookMaterialPageId"),
        materialList: document.getElementById("subjectNotebookMaterialList"),
        newMaterial: document.getElementById("btnNovoMaterialDaPagina"),
        toast: document.getElementById("subjectNotebookToast"),
        toastIcon: document.getElementById("subjectNotebookToastIcon"),
        toastTitle: document.getElementById("subjectNotebookToastTitle"),
        toastMessage: document.getElementById("subjectNotebookToastMessage"),
        toastUndo: document.getElementById("btnDesfazerMovimentoCaderno"),
        toastClose: document.getElementById("btnFecharToastCaderno")
    };
    if (!dom.app) return Object.freeze({ definirMateria: async () => {}, salvarPendente: async () => true, encerrar: () => {} });

    let materiaId = null;
    let materiaNome = "";
    let topicos = [];
    let itens = [];
    let lixeira = [];
    let selecionadoId = "";
    let carregamento = 0;
    let salvamentoPendente = null;
    let salvamentoPosicaoPendente = null;
    let timerSalvamento = 0;
    let timerSalvamentoDesenho = 0;
    let salvamentoDesenhoPendente = null;
    let editorDesenho = null;
    let leitorMaterial = null;
    let timerToast = 0;
    let busca = "";
    let organizando = false;
    let lixeiraAberta = false;
    let paginasRecolhidas = false;
    let modoDialogo = "full";
    let corGrifoTexto = CORES_GRIFO[0];
    let ultimaPaginaMateriaId = "";
    let arraste = null;
    let desfazerMovimento = null;
    let quadroRolagemArraste = 0;
    const pastasFechadas = new Set();
    const paginasIniciaisEmCriacao = new Map();
    const ultimaPaginaPorCaderno = new Map();
    const modoPaginaPorId = new Map();
    const materiaisPorPagina = new Map();
    const materiaisCarregando = new Set();

    function registrarPaginaAtual(pagina) {
        if (!pagina || pagina.tipo !== "page") return;
        ultimaPaginaMateriaId = pagina.id;
        ultimaPaginaPorCaderno.set(pagina.paiId, pagina.id);
        if (typeof repositorio.salvarPosicao !== "function") return;
        const materiaAoSalvar = materiaId;
        const anterior = salvamentoPosicaoPendente || Promise.resolve(true);
        const tarefa = anterior.catch(() => true).then(async () => {
            await repositorio.salvarPosicao(materiaAoSalvar, pagina.id);
            return true;
        }).catch(erro => {
            if (String(materiaId) === String(materiaAoSalvar) && !posicaoAindaNaoDisponivel(erro)) {
                informar(erro.message || "Não foi possível guardar a última página aberta.", true);
            }
            return true;
        });
        salvamentoPosicaoPendente = tarefa;
        tarefa.finally(() => {
            if (salvamentoPosicaoPendente === tarefa) salvamentoPosicaoPendente = null;
        });
    }

    const itemPorId = id => itens.find(item => item.id === id);
    const filhosDe = id => itens.filter(item => (item.paiId || "") === (id || "")).sort((a, b) => a.posicao - b.posicao || a.titulo.localeCompare(b.titulo));
    const selecionado = () => itemPorId(selecionadoId);
    const fecharToast = () => {
        clearTimeout(timerToast);
        dom.toast.classList.remove("is-visible");
        desfazerMovimento = null;
    };
    const exibirToast = (mensagem, opcoes = {}) => {
        clearTimeout(timerToast);
        const sucesso = opcoes.tipo === "success";
        desfazerMovimento = typeof opcoes.desfazer === "function" ? opcoes.desfazer : null;
        dom.toast.classList.toggle("is-success", sucesso);
        dom.toast.setAttribute("role", sucesso ? "status" : "alert");
        dom.toastIcon.className = sucesso ? "bi-check-circle-fill" : "bi-exclamation-circle-fill";
        dom.toastTitle.textContent = opcoes.titulo || (sucesso ? "Organização atualizada" : "Não foi possível concluir");
        dom.toastMessage.textContent = mensagem;
        dom.toastUndo.hidden = !desfazerMovimento;
        dom.toast.classList.add("is-visible");
        timerToast = window.setTimeout(fecharToast, 8000);
    };
    const informar = (mensagem, erro = false) => {
        if (erro) {
            dom.status.textContent = "";
            exibirToast(mensagem || "Não foi possível concluir esta ação.");
            return;
        }
        dom.status.textContent = mensagem || "";
        dom.status.style.color = "";
    };

    function descendentes(id, acumulado = new Set()) {
        filhosDe(id).forEach(filho => { acumulado.add(filho.id); descendentes(filho.id, acumulado); });
        return acumulado;
    }

    function renderizarArvore() {
        dom.count.textContent = `${itens.length} ${itens.length === 1 ? "item" : "itens"}`;
        if (!itens.length) {
            dom.tree.innerHTML = '<div class="subject-notebook-tree-empty"><i class="bi-folder2-open d-block mb-2 fs-4"></i>Crie uma pasta ou um caderno para começar.</div>';
            return;
        }
        const termo = busca.trim().toLocaleLowerCase("pt-BR");
        const corresponde = item => !termo || item.titulo.toLocaleLowerCase("pt-BR").includes(termo);
        const contemResultado = item => corresponde(item) || filhosDe(item.id).some(contemResultado);
        const paginaAtual = selecionado()?.tipo === "page" ? selecionado() : null;
        const cadernoAbertoId = paginaAtual?.paiId || (selecionado()?.tipo === "notebook" ? selecionadoId : "");
        const linha = (item, nivel = 0) => {
            const filhos = filhosDe(item.id);
            const visiveis = filhos.filter(contemResultado);
            const recolhivel = item.tipo === "folder" || item.tipo === "notebook";
            const fechada = recolhivel && pastasFechadas.has(item.id) && !termo;
            const classeAtiva = item.id === selecionadoId ? "is-active" : item.id === cadernoAbertoId ? "is-context-active" : "";
            return `<div class="subject-notebook-tree-row ${classeAtiva}" data-notebook-row-id="${item.id}" style="padding-left:${.25 + nivel * .78}rem">${recolhivel ? `<button class="subject-notebook-tree-disclosure" type="button" data-notebook-toggle="${item.id}" aria-label="${fechada ? "Expandir" : "Recolher"} ${esc(item.titulo)}"><i class="bi-chevron-${fechada ? "right" : "down"}"></i></button>` : '<span class="subject-notebook-tree-spacer"></span>'}<button class="subject-notebook-tree-item" type="button" data-notebook-select="${item.id}"><i class="bi-${ICONES[item.tipo]}"></i><span>${esc(item.titulo)}</span></button>${organizando ? `<button class="subject-notebook-drag-handle" type="button" data-notebook-drag="${item.id}" aria-label="Arrastar ${esc(item.titulo)}" title="Segure e arraste"><i class="bi-grip-vertical"></i></button>` : ""}</div>${fechada ? "" : visiveis.map(filho => linha(filho, nivel + 1)).join("")}`;
        };
        const raizes = filhosDe("").filter(contemResultado);
        dom.tree.innerHTML = raizes.length ? raizes.map(item => linha(item)).join("") : '<div class="subject-notebook-tree-empty"><i class="bi-search d-block mb-2 fs-4"></i>Nenhum item encontrado.</div>';
    }

    function caminhoDoItem(item) {
        const caminho = [];
        let atual = item;
        while (atual) { caminho.unshift(atual); atual = itemPorId(atual.paiId); }
        return `<nav class="subject-notebook-breadcrumb" aria-label="Caminho do caderno"><button type="button" data-notebook-home>${esc(materiaNome)}</button>${caminho.map(parte => `<i class="bi-chevron-right"></i><button type="button" data-notebook-select="${parte.id}" ${parte.id === item.id ? 'aria-current="page"' : ""}>${esc(parte.titulo)}</button>`).join("")}</nav>`;
    }

    function botoesAcoes(item) {
        const personalizar = item.tipo === "notebook" ? `<button type="button" data-notebook-edit="${item.id}"><i class="bi-palette"></i>Aparência e vínculo</button>` : "";
        return `<details class="subject-notebook-more"><summary aria-label="Opções de ${esc(item.titulo)}" title="Opções de ${esc(item.titulo)}"><i class="bi-three-dots"></i></summary><div><button type="button" data-notebook-rename="${item.id}"><i class="bi-pencil"></i>Renomear</button><button type="button" data-notebook-move="${item.id}"><i class="bi-folder-symlink"></i>Mover para…</button>${personalizar}<button type="button" data-notebook-duplicate="${item.id}"><i class="bi-copy"></i>Duplicar</button><button class="is-danger" type="button" data-notebook-delete="${item.id}"><i class="bi-trash"></i>Excluir</button></div></details>`;
    }

    function cartoesFilhos(item) {
        const filhos = filhosDe(item?.id || "");
        if (!filhos.length) return '<div class="subject-notebook-empty is-contained"><i class="bi-folder2-open"></i><strong>Nada por aqui ainda</strong><small>Use as ações ao lado do título para organizar este espaço.</small></div>';
        return `<div class="subject-notebook-child-grid">${filhos.map(filho => {
            const paginas = filho.tipo === "notebook" ? filhosDe(filho.id).filter(valor => valor.tipo === "page") : [];
            const topico = topicos.find(valor => String(valor.id) === String(filho.topicoId));
            const ultimaAtualizacao = [filho, ...paginas].map(valor => valor.atualizadoEm).filter(Boolean).sort().at(-1);
            const foiUltimoAcessado = filho.tipo === "notebook" && paginas.some(pagina => pagina.id === ultimaPaginaMateriaId);
            const metadados = filho.tipo === "notebook"
                ? `<span><i class="bi-file-earmark-text"></i>${paginas.length} ${paginas.length === 1 ? "página" : "páginas"}</span>${topico ? `<span><i class="bi-bookmark"></i>${esc(topico.titulo)}</span>` : ""}${ultimaAtualizacao ? `<span><i class="bi-clock"></i>${esc(formatarDataCurta(ultimaAtualizacao))}</span>` : ""}`
                : `<span><i class="bi-folder2"></i>${filhosDe(filho.id).length} itens</span>`;
            return `<article class="subject-notebook-child-card" style="--child-color:${esc(filho.cor)}"><button class="subject-notebook-child" type="button" data-notebook-select="${filho.id}" aria-label="Abrir ${TIPOS[filho.tipo].toLowerCase()} ${esc(filho.titulo)}"><i class="bi-${ICONES[filho.tipo]}"></i><strong>${esc(filho.titulo)}</strong><small>${TIPOS[filho.tipo]}${filho.tipo === "notebook" ? ` · ${PAPEIS[filho.estiloFolha]}` : ""}</small><span class="subject-notebook-child-meta">${metadados}</span>${foiUltimoAcessado ? '<span class="subject-notebook-last-opened"><i class="bi-bookmark-check"></i>Último acessado</span>' : ""}<span class="subject-notebook-child-open">Abrir <i class="bi-chevron-right"></i></span></button><div class="subject-notebook-child-menu">${botoesAcoes(filho)}</div></article>`;
        }).join("")}</div>`;
    }

    function miniaturasPaginas(caderno, paginaAtual) {
        const paginas = filhosDe(caderno.id).filter(item => item.tipo === "page");
        return `<aside class="subject-notebook-page-rail" aria-label="Páginas de ${esc(caderno.titulo)}"><div class="subject-notebook-page-rail-header"><div><strong>Páginas</strong><small>${paginas.length}</small></div><button type="button" data-notebook-create="page" aria-label="Criar nova página" title="Nova página"><i class="bi-plus-lg"></i></button></div><div class="subject-notebook-page-thumbnails">${paginas.map((pagina, indice) => `<article class="subject-notebook-page-thumbnail-card"><button class="subject-notebook-page-thumbnail ${pagina.id === paginaAtual.id ? "is-active" : ""}" type="button" data-notebook-select="${pagina.id}" aria-current="${pagina.id === paginaAtual.id ? "page" : "false"}"><span>${indice + 1}</span><strong>${esc(pagina.titulo)}</strong><small>${esc(pagina.conteudo.trim().slice(0, 68) || "Página em branco")}</small></button><button class="subject-notebook-page-options" type="button" data-notebook-page-options="${pagina.id}" aria-label="Opções de ${esc(pagina.titulo)}" title="Opções da página"><i class="bi-three-dots"></i></button></article>`).join("")}</div></aside>`;
    }

    function abrirAcoesPagina(id) {
        const pagina = itemPorId(id);
        if (!pagina || pagina.tipo !== "page") return;
        dom.pageActionsId.value = pagina.id;
        dom.pageActionsTitle.textContent = pagina.titulo;
        dom.pageActions.showModal();
    }

    function htmlEditorDesenho(item) {
        return `<section class="subject-page-drawing" data-page-drawing-root data-tool="pen"><div class="subject-page-drawing-toolbar" role="toolbar" aria-label="Ferramentas de escrita livre"><div class="subject-page-drawing-tools"><button type="button" data-page-drawing-tool="select" aria-pressed="false" title="Selecionar e mover"><i class="bi-bounding-box-circles"></i><span>Selecionar</span></button><button class="is-active" type="button" data-page-drawing-tool="pen" aria-pressed="true" title="Caneta"><i class="bi-pen"></i><span>Caneta</span></button><button type="button" data-page-drawing-tool="highlighter" aria-pressed="false" title="Marca-texto livre"><i class="bi-highlighter"></i><span>Marca-texto</span></button><button type="button" data-page-drawing-tool="eraser" aria-pressed="false" title="Borracha"><i class="bi-eraser"></i><span>Borracha</span></button><button type="button" data-page-drawing-tool="text" aria-pressed="false" title="Caixa de texto"><i class="bi-fonts"></i><span>Texto</span></button><button type="button" data-page-drawing-tool="line" aria-pressed="false" title="Linha"><i class="bi-slash-lg"></i><span>Linha</span></button><button type="button" data-page-drawing-tool="arrow" aria-pressed="false" title="Seta"><i class="bi-arrow-up-right"></i><span>Seta</span></button><button type="button" data-page-drawing-tool="rectangle" aria-pressed="false" title="Retângulo"><i class="bi-square"></i><span>Retângulo</span></button><button type="button" data-page-drawing-tool="ellipse" aria-pressed="false" title="Círculo ou elipse"><i class="bi-circle"></i><span>Círculo</span></button></div><span class="subject-notebook-editor-divider"></span><label class="subject-page-drawing-color" title="Cor"><i class="bi-palette"></i><input type="color" value="${esc(item.cor || "#3b2923")}" data-page-drawing-color aria-label="Cor da caneta, forma, texto ou seleção"></label><label class="subject-page-drawing-size" title="Espessura"><i class="bi-circle"></i><input type="range" min="2" max="28" step="1" value="4" data-page-drawing-size aria-label="Espessura da ferramenta"><output data-page-drawing-size-output>4</output></label><span class="subject-notebook-editor-spacer"></span><button type="button" data-page-drawing-highlight-text title="Grifar ou desmarcar trecho selecionado" aria-label="Grifar ou desmarcar trecho selecionado" disabled><i class="bi-highlighter"></i></button><button type="button" data-page-drawing-edit-text title="Editar texto selecionado" aria-label="Editar texto selecionado" disabled><i class="bi-pencil-square"></i></button><button type="button" data-page-drawing-duplicate title="Duplicar seleção" aria-label="Duplicar seleção" disabled><i class="bi-copy"></i></button><button class="is-danger" type="button" data-page-drawing-delete title="Excluir seleção" aria-label="Excluir seleção" disabled><i class="bi-trash3"></i></button><span class="subject-notebook-editor-divider"></span><button type="button" data-page-drawing-undo title="Desfazer" aria-label="Desfazer" disabled><i class="bi-arrow-counterclockwise"></i></button><button type="button" data-page-drawing-redo title="Refazer" aria-label="Refazer" disabled><i class="bi-arrow-clockwise"></i></button><button class="is-danger" type="button" data-page-drawing-clear title="Limpar toda a página" aria-label="Limpar toda a página" disabled><i class="bi-file-earmark-x"></i></button></div><div class="subject-page-drawing-stage is-paper-${esc(item.estiloFolha)}"><svg data-page-drawing-canvas viewBox="0 0 1200 800" preserveAspectRatio="xMidYMin meet" aria-label="Folha de escrita livre"><g data-page-drawing-strokes></g><g data-page-drawing-selection></g><circle class="subject-page-drawing-eraser-cursor" data-page-drawing-eraser-cursor cx="0" cy="0" r="10" visibility="hidden"></circle></svg><div class="subject-page-drawing-hint"><i class="bi-hand-index-thumb me-1"></i>Selecione para mover. Ao editar um texto, selecione palavras e use o marcador para grifar.</div></div></section>`;
    }

    function htmlTextoComGrifos(texto, marcas) {
        const valor = String(texto || "");
        const intervalos = (Array.isArray(marcas) ? marcas : [])
            .map(marca => ({ inicio: Math.max(0, Math.min(valor.length, Number(marca.inicio) || 0)), fim: Math.max(0, Math.min(valor.length, Number(marca.fim) || 0)), cor: CORES_GRIFO.includes(marca.cor) ? marca.cor : CORES_GRIFO[0] }))
            .filter(marca => marca.fim > marca.inicio)
            .sort((a, b) => a.inicio - b.inicio);
        const cortes = [...new Set([0, valor.length, ...intervalos.flatMap(marca => [marca.inicio, marca.fim])])].sort((a, b) => a - b);
        return cortes.slice(0, -1).map((inicio, indice) => {
            const fim = cortes[indice + 1];
            const trecho = esc(valor.slice(inicio, fim));
            const marca = [...intervalos].reverse().find(item => item.inicio <= inicio && item.fim >= fim);
            return marca ? `<mark class="subject-notebook-text-highlight" style="--text-highlight:${marca.cor}">${trecho}</mark>` : trecho;
        }).join("");
    }

    function ajustarGrifosTexto(anterior, novo, marcas) {
        const atuais = Array.isArray(marcas) ? marcas : [];
        let prefixo = 0;
        while (prefixo < anterior.length && prefixo < novo.length && anterior[prefixo] === novo[prefixo]) prefixo++;
        let sufixo = 0;
        while (sufixo < anterior.length - prefixo && sufixo < novo.length - prefixo && anterior[anterior.length - 1 - sufixo] === novo[novo.length - 1 - sufixo]) sufixo++;
        const fimAntigo = anterior.length - sufixo;
        const deslocamento = novo.length - anterior.length;
        return atuais.flatMap(marca => {
            if (marca.fim <= prefixo) return [marca];
            if (marca.inicio >= fimAntigo) return [{ inicio: marca.inicio + deslocamento, fim: marca.fim + deslocamento }];
            const preservadas = [];
            if (marca.inicio < prefixo) preservadas.push({ inicio: marca.inicio, fim: prefixo });
            if (marca.fim > fimAntigo) preservadas.push({ inicio: prefixo + Math.max(0, novo.length - prefixo - sufixo), fim: marca.fim + deslocamento });
            return preservadas;
        }).filter(marca => marca.fim > marca.inicio);
    }

    function urlMaterialSegura(valor) {
        try {
            const url = new URL(String(valor || ""));
            return ["http:", "https:"].includes(url.protocol) ? url.href : "";
        } catch { return ""; }
    }

    function materialEhPdf(item) {
        try {
            const url = new URL(String(item?.url || ""));
            return /\.pdf$/i.test(url.pathname) || /\.pdf(?:\s|$)/i.test(String(item?.titulo || "")) || url.searchParams.get("format") === "pdf";
        } catch { return false; }
    }

    function urlPaginaPdf(item) {
        const url = new URL(urlMaterialSegura(item.url));
        url.hash = `page=${Math.max(1, Number(item.paginaAtual) || 1)}&view=FitH`;
        return url.href;
    }

    function htmlLeitorMaterial(item) {
        const pagina = Math.max(1, Number(item.paginaAtual) || 1);
        const total = Math.max(0, Number(item.totalPaginas) || 0);
        const percentual = total ? Math.min(100, Math.round((pagina / total) * 100)) : 0;
        return `<section class="subject-notebook-pdf-reader" data-notebook-pdf-reader data-material-id="${esc(item.id)}"><header><button type="button" data-notebook-pdf-close aria-label="Voltar para a página" title="Voltar para a página"><i class="bi-arrow-left"></i></button><div><small>LEITOR DO CADERNO</small><strong>${esc(item.titulo)}</strong></div><span class="subject-notebook-pdf-progress-label">${total ? `${percentual}% lido` : `Página ${pagina}`}</span><a href="${esc(urlMaterialSegura(item.url))}" target="_blank" rel="noopener noreferrer" aria-label="Abrir PDF em nova aba" title="Abrir em nova aba"><i class="bi-box-arrow-up-right"></i></a></header><form class="subject-notebook-pdf-controls" data-notebook-pdf-progress><button type="button" data-notebook-pdf-step="-1" ${pagina <= 1 ? "disabled" : ""} aria-label="Página anterior"><i class="bi-chevron-left"></i></button><label>Página<input type="number" min="1" max="${total || 100000}" value="${pagina}" data-notebook-pdf-current required></label><span>de</span><label><span class="visually-hidden">Total de páginas</span><input type="number" min="1" max="100000" value="${total || ""}" data-notebook-pdf-total placeholder="total"></label><button type="button" data-notebook-pdf-step="1" ${total && pagina >= total ? "disabled" : ""} aria-label="Próxima página"><i class="bi-chevron-right"></i></button><button class="subject-notebook-pdf-save" type="submit"><i class="bi-bookmark-check"></i>Salvar progresso</button></form><div class="subject-notebook-pdf-frame"><iframe src="${esc(urlPaginaPdf(item))}" title="${esc(item.titulo)}" referrerpolicy="no-referrer" sandbox="allow-downloads allow-same-origin"></iframe><div class="subject-notebook-pdf-fallback"><i class="bi-file-earmark-pdf"></i><span>Se o documento não aparecer, use “abrir em nova aba”.</span></div></div></section>`;
    }

    function htmlMateriaisPagina(paginaId) {
        const materiais = materiaisPorPagina.get(paginaId);
        const anexados = materiais?.filter(item => item.anexado) || [];
        const corpo = materiaisCarregando.has(paginaId)
            ? '<span class="subject-notebook-attachment-empty"><span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>Carregando materiais…</span>'
            : anexados.length
                ? `<div class="subject-notebook-attachment-list">${anexados.map(item => `<div class="subject-notebook-attachment"><i class="bi-${materialEhPdf(item) ? "file-earmark-pdf" : "paperclip"}"></i>${materialEhPdf(item) ? `<button class="subject-notebook-attachment-open" type="button" data-notebook-material-open="${esc(item.id)}" data-notebook-material-page="${paginaId}" title="Ler ${esc(item.titulo)}"><span>${esc(item.titulo)}</span><small>${item.totalPaginas ? `Página ${item.paginaAtual} de ${item.totalPaginas}` : "Ler no caderno"}</small></button>` : `<a href="${esc(urlMaterialSegura(item.url))}" target="_blank" rel="noopener noreferrer" title="Abrir ${esc(item.titulo)}">${esc(item.titulo)}</a>`}<button type="button" data-notebook-material-remove="${esc(item.id)}" data-notebook-material-page="${paginaId}" aria-label="Remover ${esc(item.titulo)} desta página" title="Remover vínculo"><i class="bi-x-lg"></i></button></div>`).join("")}</div>`
                : '<span class="subject-notebook-attachment-empty">Nenhum material anexado a esta página.</span>';
        return `<section class="subject-notebook-attachments" data-notebook-material-block="${paginaId}"><div class="subject-notebook-attachments-header"><strong><i class="bi-paperclip me-1"></i>Materiais desta página${anexados.length ? ` · ${anexados.length}` : ""}</strong><button type="button" data-notebook-material-manage="${paginaId}">${anexados.length ? "Gerenciar" : "Anexar"}</button></div>${corpo}</section>`;
    }

    function atualizarBlocoMateriais(paginaId) {
        if (selecionadoId !== paginaId) return;
        const bloco = dom.workspace.querySelector(`[data-notebook-material-block="${paginaId}"]`);
        if (bloco) bloco.outerHTML = htmlMateriaisPagina(paginaId);
    }

    function renderizarDialogoMateriais(paginaId) {
        const materiais = materiaisPorPagina.get(paginaId) || [];
        if (materiaisCarregando.has(paginaId)) {
            dom.materialList.innerHTML = '<div class="subject-notebook-material-dialog-empty"><span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>Carregando materiais da matéria…</div>';
            return;
        }
        if (!materiais.length) {
            dom.materialList.innerHTML = '<div class="subject-notebook-material-dialog-empty"><i class="bi-folder2-open d-block fs-4 mb-2"></i>Você ainda não salvou materiais nesta matéria.<br>Use “Novo material” para adicionar o primeiro.</div>';
            return;
        }
        dom.materialList.innerHTML = materiais.map(item => `<article class="subject-notebook-material-option"><i class="bi-${item.anexado ? "paperclip" : "link-45deg"}"></i><div class="subject-notebook-material-option-copy"><strong>${esc(item.titulo)}</strong><small>${esc(item.url)}</small></div><button class="btn btn-sm ${item.anexado ? "btn-outline-secondary" : "btn-outline-primary"}" type="button" data-notebook-material-toggle="${esc(item.id)}" data-notebook-material-page="${paginaId}" aria-pressed="${item.anexado}">${item.anexado ? "Remover" : "Anexar"}</button></article>`).join("");
    }

    async function carregarMateriaisPagina(paginaId, forcar = false) {
        if (!paginaId || materiaisCarregando.has(paginaId) || (!forcar && materiaisPorPagina.has(paginaId))) return;
        materiaisCarregando.add(paginaId);
        atualizarBlocoMateriais(paginaId);
        if (dom.materialDialog.open && dom.materialPageId.value === paginaId) renderizarDialogoMateriais(paginaId);
        try {
            materiaisPorPagina.set(paginaId, await repositorio.carregarMateriais(materiaId, paginaId));
        } catch (erro) {
            materiaisPorPagina.delete(paginaId);
            informar(erro.message || "Não foi possível carregar os materiais da página.", true);
        } finally {
            materiaisCarregando.delete(paginaId);
            atualizarBlocoMateriais(paginaId);
            if (dom.materialDialog.open && dom.materialPageId.value === paginaId) renderizarDialogoMateriais(paginaId);
        }
    }

    async function abrirMateriaisPagina(paginaId) {
        if (!await salvarPendente()) return;
        const pagina = itemPorId(paginaId);
        if (!pagina || pagina.tipo !== "page") return;
        dom.materialPageId.value = pagina.id;
        dom.materialTitle.textContent = `Materiais de ${pagina.titulo}`;
        dom.materialDialog.showModal();
        renderizarDialogoMateriais(pagina.id);
        await carregarMateriaisPagina(pagina.id, true);
    }

    async function alternarMaterialPagina(paginaId, materialId, anexar) {
        try {
            if (anexar) await repositorio.anexarMaterial(materiaId, paginaId, materialId);
            else await repositorio.removerMaterial(materiaId, paginaId, materialId);
            if (!anexar && leitorMaterial?.paginaId === paginaId && String(leitorMaterial.materialId) === String(materialId)) leitorMaterial = null;
            const materiais = materiaisPorPagina.get(paginaId) || [];
            materiaisPorPagina.set(paginaId, materiais.map(item => String(item.id) === String(materialId) ? { ...item, anexado: anexar } : item));
            atualizarBlocoMateriais(paginaId);
            if (dom.materialDialog.open && dom.materialPageId.value === paginaId) renderizarDialogoMateriais(paginaId);
            exibirToast(anexar ? "Material anexado à página." : "Material removido da página.", { tipo: "success" });
        } catch (erro) { informar(erro.message || "Não foi possível atualizar os materiais da página.", true); }
    }

    async function abrirLeitorMaterial(paginaId, materialId) {
        if (!await salvarPendente()) return;
        const material = (materiaisPorPagina.get(paginaId) || []).find(item => String(item.id) === String(materialId) && item.anexado);
        if (!material || !materialEhPdf(material)) return;
        leitorMaterial = { paginaId, materialId };
        renderizarWorkspace();
    }

    async function salvarProgressoLeitor(paginaId, materialId, paginaAtual, totalPaginas) {
        try {
            const salvo = await repositorio.salvarProgressoMaterial(materiaId, paginaId, materialId, { paginaAtual, totalPaginas });
            const materiais = materiaisPorPagina.get(paginaId) || [];
            materiaisPorPagina.set(paginaId, materiais.map(item => String(item.id) === String(materialId) ? { ...item, ...salvo } : item));
            renderizarWorkspace();
            exibirToast("Ponto de leitura salvo.", { tipo: "success" });
        } catch (erro) { informar(erro.message || "Não foi possível salvar o ponto de leitura.", true); }
    }

    function renderizarModoOrganizacao() {
        dom.workspace.insertAdjacentHTML("afterbegin", '<div class="subject-notebook-organize-banner"><i class="bi-grip-vertical"></i><span>Segure a alça para ordenar ou solte sobre uma pasta para mover o item.</span><button class="btn btn-sm btn-outline-secondary" type="button" data-notebook-organize-finish>Concluir</button></div>');
    }

    function renderizarLixeira() {
        const raizes = lixeira.filter(item => item.id === item.lixeiraRaizId);
        const lista = raizes.length ? `<div class="subject-notebook-trash-list">${raizes.map(item => {
            const quantidade = lixeira.filter(valor => valor.lixeiraRaizId === item.id).length;
            const data = item.deletadoEm ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(item.deletadoEm)).replace(".", "") : "";
            return `<article class="subject-notebook-trash-card"><i class="bi-${ICONES[item.tipo]}"></i><div class="subject-notebook-trash-card-copy"><strong>${esc(item.titulo)}</strong><small>${TIPOS[item.tipo]} · ${quantidade} ${quantidade === 1 ? "item" : "itens"}${data ? ` · removido em ${esc(data)}` : ""}</small></div><div class="subject-notebook-trash-card-actions"><button class="btn btn-sm btn-outline-secondary" type="button" data-notebook-trash-restore="${item.id}"><i class="bi-arrow-counterclockwise me-1"></i>Restaurar</button><button class="btn btn-sm btn-outline-danger" type="button" data-notebook-trash-delete="${item.id}"><i class="bi-trash3 me-1"></i>Excluir definitivamente</button></div></article>`;
        }).join("")}</div>` : '<div class="subject-notebook-empty is-contained"><i class="bi-trash3"></i><strong>A lixeira está vazia</strong><small>Os itens removidos ficam disponíveis por até 30 dias.</small></div>';
        dom.workspace.innerHTML = `<div class="subject-notebook-trash-header"><div><small class="text-muted">PROTEÇÃO DO SEU CONTEÚDO</small><h3 class="h5 mb-0">Lixeira</h3><p>Restaure pastas completas com seus cadernos e páginas.</p></div><div class="subject-notebook-view-actions"><button class="btn btn-sm btn-light" type="button" data-notebook-trash-close><i class="bi-arrow-left me-1"></i>Voltar</button>${raizes.length ? '<button class="btn btn-sm btn-outline-danger" type="button" data-notebook-trash-empty><i class="bi-trash3 me-1"></i>Esvaziar</button>' : ""}</div></div>${lista}`;
    }

    function renderizarWorkspace() {
        editorDesenho?.destruir();
        editorDesenho = null;
        if (lixeiraAberta) { renderizarLixeira(); return; }
        const item = selecionado();
        if (!item) {
            if (!itens.length) {
                dom.workspace.innerHTML = `<div class="subject-notebook-empty"><i class="bi-journal-richtext"></i><h3 class="h5 mb-0">Seu espaço de estudo em ${esc(materiaNome)}</h3><p class="mb-0">Crie cadernos por tópico e agrupe tudo em pastas do seu jeito.</p><div class="subject-notebook-empty-actions"><button class="btn btn-sm btn-outline-secondary" type="button" data-notebook-create="folder"><i class="bi-folder-plus me-1"></i>Criar pasta</button><button class="btn btn-sm btn-primary" type="button" data-notebook-create="notebook"><i class="bi-journal-plus me-1"></i>Criar caderno</button></div></div>`;
                return;
            }
            dom.workspace.innerHTML = `<div class="subject-notebook-view-header"><div><small class="text-muted">Visão geral</small><h3 class="h5 mb-1">Cadernos de ${esc(materiaNome)}</h3><p class="mb-0">Escolha um item para continuar estudando.</p></div></div>${cartoesFilhos(null)}`;
            return;
        }
        if (item.tipo === "page") {
            const caderno = itemPorId(item.paiId);
            const paginas = filhosDe(caderno?.id).filter(valor => valor.tipo === "page");
            const indice = paginas.findIndex(valor => valor.id === item.id);
            const anterior = paginas[indice - 1];
            const proxima = paginas[indice + 1];
            const opcoesPapel = Object.entries(PAPEIS).map(([valor, rotulo]) => `<option value="${valor}" ${item.estiloFolha === valor ? "selected" : ""}>${rotulo}</option>`).join("");
            const modo = modoPaginaPorId.get(item.id) || "text";
            const materialAberto = leitorMaterial?.paginaId === item.id
                ? (materiaisPorPagina.get(item.id) || []).find(material => String(material.id) === String(leitorMaterial.materialId) && material.anexado)
                : null;
            const alternador = `<div class="subject-notebook-page-mode" role="group" aria-label="Modo da página"><button type="button" class="${modo === "text" ? "is-active" : ""}" data-notebook-page-mode="text" aria-pressed="${modo === "text"}"><i class="bi-text-paragraph"></i>Texto</button><button type="button" class="${modo === "drawing" ? "is-active" : ""}" data-notebook-page-mode="drawing" aria-pressed="${modo === "drawing"}"><i class="bi-pen"></i>Escrita livre</button></div>`;
            const topbar = `<div class="subject-notebook-editor-topbar"><button class="subject-notebook-tool" type="button" data-notebook-back title="Voltar para ${caderno?.paiId ? "a pasta" : "os cadernos"}" aria-label="Voltar para ${caderno?.paiId ? "a pasta" : "os cadernos"}"><i class="bi-arrow-left"></i></button><span class="subject-notebook-editor-divider"></span><button class="subject-notebook-tool" type="button" data-notebook-pages-toggle aria-pressed="${!paginasRecolhidas}" title="${paginasRecolhidas ? "Mostrar páginas" : "Recolher páginas"}" aria-label="${paginasRecolhidas ? "Mostrar páginas" : "Recolher páginas"}"><i class="bi-layout-sidebar-inset"></i></button><span class="subject-notebook-editor-divider"></span><button class="subject-notebook-tool" type="button" ${anterior ? `data-notebook-select="${anterior.id}"` : "disabled"} title="Página anterior" aria-label="Página anterior"><i class="bi-chevron-left"></i></button><span class="subject-notebook-page-position">${indice + 1} / ${paginas.length}</span><button class="subject-notebook-tool" type="button" ${proxima ? `data-notebook-select="${proxima.id}"` : "disabled"} title="Próxima página" aria-label="Próxima página"><i class="bi-chevron-right"></i></button><label class="subject-notebook-paper-picker" title="Estilo da folha"><i class="bi-grid-3x3"></i><select id="subjectNotebookPagePaper" aria-label="Estilo da folha">${opcoesPapel}</select></label><span class="subject-notebook-editor-spacer"></span><button class="subject-notebook-tool is-primary" type="button" data-notebook-create="page" title="Nova página" aria-label="Nova página"><i class="bi-file-earmark-plus"></i></button>${botoesAcoes(item)}</div>`;
            const grifosTexto = item.desenho?.textHighlights || [];
            const paletaGrifo = CORES_GRIFO.map((cor, indice) => `<button class="subject-notebook-highlight-swatch" type="button" data-notebook-text-highlight-color="${cor}" style="--swatch:${cor}" aria-label="Grifar em ${["amarelo", "verde", "azul", "rosa", "laranja"][indice]}"></button>`).join("");
            const editorTexto = `<div class="subject-notebook-page-editor is-paper-${esc(item.estiloFolha)}"><input class="subject-notebook-page-title" id="subjectNotebookPageTitle" maxlength="240" value="${esc(item.titulo)}" aria-label="Título da página"><div class="subject-notebook-page-content" id="subjectNotebookPageContent" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="Comece a escrever suas anotações…" data-last-text="${esc(item.conteudo)}">${htmlTextoComGrifos(item.conteudo, grifosTexto)}</div><div class="subject-notebook-text-selection-menu" data-notebook-text-selection-menu role="toolbar" aria-label="Cores do grifo" hidden><span>Grifar</span>${paletaGrifo}<button class="subject-notebook-highlight-remove" type="button" data-notebook-text-highlight-remove title="Remover grifo" aria-label="Remover grifo"><i class="bi-eraser"></i></button></div></div>`;
            const conteudo = materialAberto ? htmlLeitorMaterial(materialAberto) : modo === "drawing" ? htmlEditorDesenho(item) : editorTexto;
            dom.workspace.innerHTML = `<div class="subject-notebook-open ${paginasRecolhidas ? "is-pages-collapsed" : ""}">${miniaturasPaginas(caderno, item)}<section class="subject-notebook-page-stage">${topbar}<div class="subject-notebook-page-context">${caminhoDoItem(item)}${materialAberto ? "" : alternador}</div>${conteudo}${materialAberto ? "" : htmlMateriaisPagina(item.id)}<div class="subject-notebook-shortcuts"><button class="btn btn-sm btn-light" type="button" data-notebook-shortcut="cards"><i class="bi-card-heading me-1"></i>Criar flashcard</button><button class="btn btn-sm btn-light" type="button" data-notebook-shortcut="maps"><i class="bi-diagram-3 me-1"></i>Mapa mental</button><button class="btn btn-sm btn-light" type="button" data-notebook-shortcut="materials"><i class="bi-paperclip me-1"></i>Anexar material</button><span class="ms-auto small text-muted" id="subjectNotebookPageStatus">Salvo</span></div></section></div>`;
            if (!materialAberto && modo === "drawing") queueMicrotask(() => {
                const raiz = dom.workspace.querySelector("[data-page-drawing-root]");
                if (raiz && selecionadoId === item.id) editorDesenho = criarDesenhoPagina(raiz, item.desenho, desenho => agendarSalvamentoDesenho(item.id, desenho));
            });
            queueMicrotask(() => carregarMateriaisPagina(item.id));
            return;
        }
        const topico = topicos.find(valor => String(valor.id) === String(item.topicoId));
        const acoesCriacao = item.tipo === "folder"
            ? '<button class="btn btn-sm btn-outline-secondary" type="button" data-notebook-create="folder"><i class="bi-folder-plus me-1"></i>Subpasta</button><button class="btn btn-sm btn-primary" type="button" data-notebook-create="notebook"><i class="bi-journal-plus me-1"></i>Novo caderno</button>'
            : '<button class="btn btn-sm btn-primary" type="button" data-notebook-create="page"><i class="bi-file-earmark-plus me-1"></i>Nova página</button>';
        const cabecalho = item.tipo === "notebook"
            ? `<div class="subject-notebook-cover is-${esc(item.estiloCapa)}" style="--notebook-color:${esc(item.cor)}"><small>${topico ? esc(topico.titulo) : "Caderno livre"}</small><h3 class="h4 mb-0">${esc(item.titulo)}</h3></div>`
            : `<div class="subject-notebook-detail-heading"><small>Pasta de organização</small><div class="subject-notebook-detail-title-row"><h3>${esc(item.titulo)}</h3><div class="subject-notebook-context-actions">${acoesCriacao}${botoesAcoes(item)}</div></div><p>${filhosDe(item.id).length} itens nesta pasta</p></div>`;
        const toolbarCaderno = item.tipo === "notebook" ? `<div class="subject-notebook-view-toolbar"><div class="subject-notebook-context-actions">${acoesCriacao}${botoesAcoes(item)}</div></div>` : "";
        dom.workspace.innerHTML = `${caminhoDoItem(item)}<div class="subject-notebook-view-header">${cabecalho}${toolbarCaderno}</div>${cartoesFilhos(item)}${item.tipo === "notebook" ? '<div class="subject-notebook-shortcuts"><button class="btn btn-sm btn-light" type="button" data-notebook-shortcut="maps"><i class="bi-diagram-3 me-1"></i>Mapas mentais</button><button class="btn btn-sm btn-light" type="button" data-notebook-shortcut="materials"><i class="bi-collection me-1"></i>Materiais da matéria</button></div>' : ""}`;
    }

    function renderizar() {
        dom.headerActions.classList.toggle("d-none", itens.length === 0 || lixeiraAberta);
        const raizesLixeira = lixeira.filter(item => item.id === item.lixeiraRaizId).length;
        dom.trashCount.textContent = String(raizesLixeira);
        dom.trashCount.hidden = raizesLixeira === 0;
        dom.trash.classList.toggle("is-active", lixeiraAberta);
        dom.trash.setAttribute("aria-pressed", String(lixeiraAberta));
        dom.notebooks.classList.toggle("is-active", !lixeiraAberta);
        dom.notebooks.setAttribute("aria-pressed", String(!lixeiraAberta));
        dom.organize.classList.toggle("d-none", lixeiraAberta);
        renderizarArvore();
        renderizarWorkspace();
        if (organizando) renderizarModoOrganizacao();
    }

    function opcoesPais(tipo, itemAtual) {
        const bloqueados = itemAtual ? descendentes(itemAtual.id) : new Set();
        bloqueados.add(itemAtual?.id);
        const permitido = tipo === "page" ? "notebook" : "folder";
        const opcoes = itens.filter(item => item.tipo === permitido && !bloqueados.has(item.id));
        const raiz = tipo === "page" ? "" : '<option value="">Raiz da matéria</option>';
        return raiz + opcoes.map(item => `<option value="${item.id}">${esc(item.titulo)}</option>`).join("");
    }

    function abrirDialogo(tipo, item = null, modo = "full") {
        modoDialogo = item ? modo : "full";
        const paiSugerido = item
            ? item.paiId
            : selecionado()?.tipo === "folder"
                ? selecionadoId
                : tipo === "page" && selecionado()?.tipo === "notebook"
                    ? selecionadoId
                    : tipo === "page" && selecionado()?.tipo === "page"
                        ? selecionado().paiId
                        : "";
        dom.itemId.value = item?.id || "";
        dom.itemType.value = tipo;
        dom.itemTitle.value = item?.titulo || "";
        dom.itemParent.innerHTML = opcoesPais(tipo, item);
        dom.itemParent.value = paiSugerido;
        dom.itemTopic.innerHTML = '<option value="">Sem tópico específico</option>' + topicos.map(topico => `<option value="${topico.id}">${esc(topico.titulo)}</option>`).join("");
        dom.itemTopic.value = item?.topicoId || "";
        dom.itemColor.value = item?.cor || "#b8322a";
        dom.itemCover.value = item?.estiloCapa || "solid";
        dom.itemPaper.value = item?.estiloFolha || "lined";
        const somenteNome = modoDialogo === "rename";
        const somenteLocal = modoDialogo === "move";
        dom.nameGroup.classList.toggle("d-none", somenteLocal);
        dom.parentGroup.classList.toggle("d-none", somenteNome);
        dom.itemTitle.disabled = somenteLocal;
        dom.itemParent.disabled = somenteNome;
        dom.dialogEyebrow.textContent = item ? (somenteNome ? "Alterar nome" : somenteLocal ? "Alterar local" : "Personalizar item") : "Novo item";
        dom.dialogTitle.textContent = item ? (somenteNome ? `Renomear ${TIPOS[tipo].toLowerCase()}` : somenteLocal ? `Mover ${TIPOS[tipo].toLowerCase()}` : `Personalizar ${TIPOS[tipo].toLowerCase()}`) : `Criar ${TIPOS[tipo].toLowerCase()}`;
        dom.topicGroup.classList.toggle("d-none", tipo === "folder" || somenteNome || somenteLocal);
        dom.styleFields.classList.toggle("d-none", tipo === "folder" || somenteNome || somenteLocal);
        dom.save.textContent = somenteNome ? "Renomear" : somenteLocal ? "Mover" : "Salvar";
        dom.dialog.showModal();
        (somenteLocal ? dom.itemParent : dom.itemTitle).focus();
    }

    async function salvarFormulario(evento) {
        evento.preventDefault();
        const id = dom.itemId.value;
        const tipo = dom.itemType.value;
        const atual = itemPorId(id);
        const dadosCompletos = {
            tipo,
            titulo: dom.itemTitle.value,
            paiId: dom.itemParent.value,
            topicoId: tipo === "folder" ? "" : dom.itemTopic.value,
            cor: dom.itemColor.value,
            estiloCapa: dom.itemCover.value,
            estiloFolha: dom.itemPaper.value,
            posicao: atual?.posicao ?? filhosDe(dom.itemParent.value).length,
            conteudo: atual?.conteudo || "",
            desenho: atual?.desenho || { strokes: [] }
        };
        const dados = modoDialogo === "rename" ? { titulo: dadosCompletos.titulo }
            : modoDialogo === "move" ? { paiId: dadosCompletos.paiId }
                : dadosCompletos;
        dom.save.disabled = true;
        try {
            const salvo = atual
                ? await repositorio.atualizar(atual.id, dados, atual.versao)
                : await repositorio.criar(materiaId, { id: uuid(), ...dados });
            if (atual) itens = itens.map(item => item.id === atual.id ? salvo : item);
            else itens.push(salvo);
            dom.dialog.close();
            informar(`${TIPOS[tipo]} ${atual ? "atualizado" : "criado"} com sucesso.`);
            if (!atual && tipo === "notebook") await selecionar(salvo.id);
            else {
                selecionadoId = salvo.id;
                renderizar();
            }
        } catch (erro) {
            informar(erro.message || "Não foi possível salvar o item.", true);
        } finally { dom.save.disabled = false; }
    }

    async function excluirItem(id) {
        const item = itemPorId(id);
        if (!item || !window.confirm(`Mover “${item.titulo}”${filhosDe(id).length ? " e tudo o que está dentro" : ""} para a lixeira?`)) return;
        const irmaos = item.tipo === "page" ? filhosDe(item.paiId).filter(valor => valor.tipo === "page") : [];
        const indice = irmaos.findIndex(valor => valor.id === item.id);
        const paginaAlternativa = irmaos[indice + 1] || irmaos[indice - 1] || null;
        try {
            await repositorio.excluir(id);
            const removidos = descendentes(id);
            removidos.add(id);
            itens = itens.filter(valor => !removidos.has(valor.id));
            removidos.forEach(removidoId => materiaisPorPagina.delete(removidoId));
            lixeira = typeof repositorio.listarLixeira === "function" ? await repositorio.listarLixeira(materiaId) : lixeira;
            if (removidos.has(selecionadoId)) {
                selecionadoId = paginaAlternativa?.id || item.paiId || "";
                if (paginaAlternativa) registrarPaginaAtual(paginaAlternativa);
            }
            informar("");
            exibirToast(`${TIPOS[item.tipo]} enviado para a lixeira.`, {
                tipo: "success",
                desfazer: async () => {
                    itens = await repositorio.restaurar(id, materiaId);
                    lixeira = typeof repositorio.listarLixeira === "function" ? await repositorio.listarLixeira(materiaId) : [];
                    selecionadoId = id;
                    informar("Item restaurado.");
                    renderizar();
                }
            });
            renderizar();
        } catch (erro) { informar(erro.message || "Não foi possível enviar o item para a lixeira.", true); }
    }

    async function abrirLixeira() {
        if (!await salvarPendente() || typeof repositorio.listarLixeira !== "function") return;
        organizando = false;
        dom.organize.setAttribute("aria-pressed", "false");
        dom.organize.classList.remove("is-active");
        dom.organize.querySelector("span").textContent = "Organizar itens";
        const materiaAoAbrir = materiaId;
        lixeiraAberta = true;
        informar("");
        renderizar();
        try {
            const itensAtualizados = await repositorio.listarLixeira(materiaAoAbrir);
            if (materiaAoAbrir !== materiaId) return;
            lixeira = itensAtualizados;
            if (lixeiraAberta) renderizar();
        } catch (erro) { informar(erro.message || "Não foi possível atualizar a lixeira.", true); }
    }

    async function restaurarItem(id) {
        const item = lixeira.find(valor => valor.id === id && valor.id === valor.lixeiraRaizId);
        if (!item) return;
        informar("Restaurando o item…");
        try {
            itens = await repositorio.restaurar(id, materiaId);
            lixeira = await repositorio.listarLixeira(materiaId);
            selecionadoId = id;
            informar(`${TIPOS[item.tipo]} restaurado com todo o seu conteúdo.`);
            renderizar();
        } catch (erro) { informar(erro.message || "Não foi possível restaurar o item.", true); }
    }

    async function excluirDefinitivamente(id) {
        const item = lixeira.find(valor => valor.id === id && valor.id === valor.lixeiraRaizId);
        if (!item || !window.confirm(`Excluir “${item.titulo}” definitivamente? Esta ação não poderá ser desfeita.`)) return;
        try {
            await repositorio.excluirDefinitivamente(id);
            lixeira = await repositorio.listarLixeira(materiaId);
            informar("Item excluído definitivamente.");
            renderizar();
        } catch (erro) { informar(erro.message || "Não foi possível excluir o item definitivamente.", true); }
    }

    async function esvaziarLixeira() {
        if (!lixeira.length || !window.confirm("Esvaziar a lixeira? Todo o conteúdo será excluído definitivamente.")) return;
        try {
            await repositorio.esvaziarLixeira(materiaId);
            lixeira = [];
            informar("Lixeira esvaziada.");
            renderizar();
        } catch (erro) { informar(erro.message || "Não foi possível esvaziar a lixeira.", true); }
    }

    async function duplicarItem(id) {
        const original = itemPorId(id);
        if (!original) return;
        let raizCriada = null;
        const clonar = async (item, paiId, raiz = false) => {
            const salvo = await repositorio.criar(materiaId, {
                id: uuid(), tipo: item.tipo, paiId, topicoId: item.topicoId,
                titulo: raiz ? `${item.titulo} — cópia` : item.titulo,
                conteudo: item.conteudo, cor: item.cor, estiloCapa: item.estiloCapa,
                estiloFolha: item.estiloFolha, desenho: item.desenho || { strokes: [] },
                posicao: filhosDe(paiId).length
            });
            itens.push(salvo);
            if (raiz) raizCriada = salvo;
            for (const filho of filhosDe(item.id)) await clonar(filho, salvo.id, false);
            return salvo;
        };
        informar("Duplicando o item…");
        try {
            const copia = await clonar(original, original.paiId, true);
            selecionadoId = copia.id;
            informar(`${TIPOS[original.tipo]} duplicado com seu conteúdo.`);
            renderizar();
        } catch (erro) {
            if (raizCriada) {
                try { await repositorio.excluir(raizCriada.id); } catch { /* A mensagem principal orienta a conferência. */ }
                const removidos = descendentes(raizCriada.id); removidos.add(raizCriada.id);
                itens = itens.filter(item => !removidos.has(item.id));
            }
            informar(erro.message || "Não foi possível duplicar o item.", true);
            renderizar();
        }
    }

    function limparDestinoArraste() {
        dom.tree.querySelectorAll(".is-drop-before,.is-drop-after,.is-drop-inside,.is-dragging").forEach(elemento => elemento.classList.remove("is-drop-before", "is-drop-after", "is-drop-inside", "is-dragging"));
    }

    function pararRolagemArraste() {
        cancelAnimationFrame(quadroRolagemArraste);
        quadroRolagemArraste = 0;
    }

    function atualizarRolagemArraste(clientY) {
        if (!arraste?.ativo) return;
        const margem = 64;
        const limiteSuperior = margem;
        const limiteInferior = window.innerHeight - margem;
        arraste.velocidadeRolagem = clientY < limiteSuperior ? -10 : clientY > limiteInferior ? 10 : 0;
        if (!arraste.velocidadeRolagem || quadroRolagemArraste) return;
        const rolar = () => {
            quadroRolagemArraste = 0;
            if (!arraste?.ativo || !arraste.velocidadeRolagem) return;
            const painelRolavel = dom.treePanel.scrollHeight > dom.treePanel.clientHeight;
            if (painelRolavel) dom.treePanel.scrollBy({ top: arraste.velocidadeRolagem, behavior: "auto" });
            else window.scrollBy({ top: arraste.velocidadeRolagem, behavior: "auto" });
            quadroRolagemArraste = requestAnimationFrame(rolar);
        };
        quadroRolagemArraste = requestAnimationFrame(rolar);
    }

    function podeConter(destino, item) {
        if (!destino || !item || destino.id === item.id || descendentes(item.id).has(destino.id)) return false;
        return destino.tipo === "folder" ? ["folder", "notebook"].includes(item.tipo) : destino.tipo === "notebook" && item.tipo === "page";
    }

    async function moverPorArraste(id, destinoId, modo) {
        const item = itemPorId(id);
        const destino = itemPorId(destinoId);
        if (!item || !destino || item.id === destino.id) return;
        const paiAnterior = item.paiId || "";
        const ordemAnterior = filhosDe(paiAnterior).map(valor => valor.id);
        const novoPaiId = modo === "inside" ? destino.id : destino.paiId || "";
        if (modo === "inside" && !podeConter(destino, item)) return;
        if (modo !== "inside" && paiAnterior !== novoPaiId) return;
        const ordemDestino = filhosDe(novoPaiId).filter(valor => valor.id !== item.id);
        const indiceDestino = modo === "inside" ? ordemDestino.length : ordemDestino.findIndex(valor => valor.id === destino.id) + (modo === "after" ? 1 : 0);
        ordemDestino.splice(Math.max(0, indiceDestino), 0, item);
        if (paiAnterior === novoPaiId && ordemDestino.every((valor, indice) => valor.id === ordemAnterior[indice])) return;
        informar(modo === "inside" ? "Movendo o item…" : "Salvando a nova ordem…");
        try {
            if (paiAnterior !== novoPaiId) {
                const salvo = await repositorio.atualizar(item.id, { paiId: novoPaiId, posicao: ordemDestino.length - 1 }, item.versao);
                itens = itens.map(valor => valor.id === item.id ? salvo : valor);
            }
            itens = await repositorio.reordenar(materiaId, novoPaiId, ordemDestino.map(valor => valor.id));
            const tituloDestino = modo === "inside" ? destino.titulo : itemPorId(novoPaiId)?.titulo;
            informar("");
            exibirToast(modo === "inside" ? `${item.titulo} foi movido para ${tituloDestino}.` : `${item.titulo} mudou de posição.`, {
                tipo: "success",
                desfazer: async () => {
                    const atual = itemPorId(item.id);
                    if (!atual) return;
                    if ((atual.paiId || "") !== paiAnterior) {
                        const restaurado = await repositorio.atualizar(atual.id, { paiId: paiAnterior, posicao: ordemAnterior.indexOf(item.id) }, atual.versao);
                        itens = itens.map(valor => valor.id === atual.id ? restaurado : valor);
                    }
                    itens = await repositorio.reordenar(materiaId, paiAnterior, ordemAnterior);
                    informar("Movimento desfeito.");
                    renderizar();
                }
            });
            renderizar();
        } catch (erro) { informar(erro.message || "Não foi possível reorganizar os itens.", true); }
    }

    async function salvarPagina() {
        clearTimeout(timerSalvamento);
        timerSalvamento = 0;
        const item = selecionado();
        const titulo = document.getElementById("subjectNotebookPageTitle");
        const conteudo = document.getElementById("subjectNotebookPageContent");
        if (!item || item.tipo !== "page" || !titulo || !conteudo) return true;
        const textoConteudo = "value" in conteudo ? conteudo.value : conteudo.innerText.slice(0, 500000);
        if (!titulo.value.trim()) { informar("Dê um título à página antes de sair.", true); titulo.focus(); return false; }
        if (titulo.value === item.titulo && textoConteudo === item.conteudo) return true;
        document.getElementById("subjectNotebookPageStatus").textContent = "Salvando…";
        try {
            const salvo = await repositorio.atualizar(item.id, { titulo: titulo.value, conteudo: textoConteudo, desenho: item.desenho || { strokes: [] } }, item.versao);
            itens = itens.map(valor => valor.id === item.id ? salvo : valor);
            document.getElementById("subjectNotebookPageStatus").textContent = "Salvo";
            renderizarArvore();
            return true;
        } catch (erro) {
            document.getElementById("subjectNotebookPageStatus").textContent = "Não salvo";
            informar(erro.message || "Não foi possível salvar a página.", true);
            return false;
        } finally { salvamentoPendente = null; }
    }

    function agendarSalvamento() {
        const status = document.getElementById("subjectNotebookPageStatus");
        if (status) status.textContent = "Alterações pendentes";
        clearTimeout(timerSalvamento);
        timerSalvamento = window.setTimeout(() => { salvamentoPendente = salvarPagina(); }, 800);
    }

    function atualizarMenuGrifoTexto() {
        const editor = document.getElementById("subjectNotebookPageContent");
        const menu = dom.workspace.querySelector("[data-notebook-text-selection-menu]");
        const selecao = window.getSelection();
        if (!editor || !menu || !selecao?.rangeCount || selecao.isCollapsed || !editor.contains(selecao.anchorNode) || !editor.contains(selecao.focusNode)) {
            if (menu) menu.hidden = true;
            return;
        }
        const caixaSelecao = selecao.getRangeAt(0).getBoundingClientRect();
        const caixaEditor = editor.closest(".subject-notebook-page-editor").getBoundingClientRect();
        menu.hidden = false;
        menu.style.left = `${Math.max(112, Math.min(caixaEditor.width - 112, caixaSelecao.left - caixaEditor.left + caixaSelecao.width / 2))}px`;
        menu.style.top = `${Math.max(54, caixaSelecao.top - caixaEditor.top - 45)}px`;
    }

    async function alternarGrifoTextoPagina(corEscolhida = null, remover = false) {
        const pagina = selecionado();
        const editor = document.getElementById("subjectNotebookPageContent");
        const selecao = window.getSelection();
        if (!pagina || pagina.tipo !== "page" || !editor || !selecao?.rangeCount || selecao.isCollapsed || !editor.contains(selecao.anchorNode) || !editor.contains(selecao.focusNode)) {
            informar("Selecione primeiro as palavras que deseja grifar.", true);
            return;
        }
        const intervalo = selecao.getRangeAt(0);
        const antes = document.createRange();
        antes.selectNodeContents(editor);
        antes.setEnd(intervalo.startContainer, intervalo.startOffset);
        const ateFim = document.createRange();
        ateFim.selectNodeContents(editor);
        ateFim.setEnd(intervalo.endContainer, intervalo.endOffset);
        const inicio = antes.toString().length;
        const fim = ateFim.toString().length;
        if (fim <= inicio) return;
        const desenho = pagina.desenho || { strokes: [] };
        const marcas = Array.isArray(desenho.textHighlights) ? desenho.textHighlights : [];
        const semTrechoAtual = marcas.flatMap(marca => {
                if (marca.fim <= inicio || marca.inicio >= fim) return [marca];
                return [{ inicio: marca.inicio, fim: Math.min(marca.fim, inicio) }, { inicio: Math.max(marca.inicio, fim), fim: marca.fim }].filter(parte => parte.fim > parte.inicio);
            });
        const atualizadas = remover ? semTrechoAtual : [...semTrechoAtual, { inicio, fim, cor: CORES_GRIFO.includes(corEscolhida) ? corEscolhida : corGrifoTexto }];
        pagina.desenho = { ...desenho, textHighlights: atualizadas };
        editor.innerHTML = htmlTextoComGrifos(editor.innerText, atualizadas);
        editor.dataset.lastText = editor.innerText;
        dom.workspace.querySelector("[data-notebook-text-selection-menu]").hidden = true;
        await enfileirarSalvamentoDesenho(pagina.id);
        informar(remover ? "Grifo removido." : "Trecho grifado.");
    }

    async function salvarDesenhoPagina(paginaId) {
        clearTimeout(timerSalvamentoDesenho);
        timerSalvamentoDesenho = 0;
        const pagina = itemPorId(paginaId);
        if (!pagina || pagina.tipo !== "page") return true;
        const desenhoEnviado = pagina.desenho || { strokes: [] };
        const assinaturaEnviada = JSON.stringify(desenhoEnviado);
        const status = document.getElementById("subjectNotebookPageStatus");
        if (status && selecionadoId === paginaId) status.textContent = "Salvando…";
        try {
            const salvo = await repositorio.atualizar(pagina.id, { desenho: desenhoEnviado }, pagina.versao);
            itens = itens.map(item => {
                if (item.id !== pagina.id) return item;
                const recebeuNovoTraco = JSON.stringify(item.desenho || { strokes: [] }) !== assinaturaEnviada;
                return recebeuNovoTraco ? { ...salvo, desenho: item.desenho } : salvo;
            });
            if (status && selecionadoId === paginaId) status.textContent = "Salvo";
            return true;
        } catch (erro) {
            if (status && selecionadoId === paginaId) status.textContent = "Não salvo";
            informar(erro.message || "Não foi possível salvar a escrita livre.", true);
            return false;
        }
    }

    function enfileirarSalvamentoDesenho(paginaId) {
        const anterior = salvamentoDesenhoPendente || Promise.resolve(true);
        const tarefa = anterior.catch(() => true).then(() => salvarDesenhoPagina(paginaId));
        salvamentoDesenhoPendente = tarefa;
        tarefa.finally(() => { if (salvamentoDesenhoPendente === tarefa) salvamentoDesenhoPendente = null; });
        return tarefa;
    }

    function agendarSalvamentoDesenho(paginaId, desenho) {
        itens = itens.map(item => item.id === paginaId ? { ...item, desenho } : item);
        const status = document.getElementById("subjectNotebookPageStatus");
        if (status) status.textContent = "Alterações pendentes";
        clearTimeout(timerSalvamentoDesenho);
        timerSalvamentoDesenho = window.setTimeout(() => {
            enfileirarSalvamentoDesenho(paginaId);
        }, 700);
    }

    async function alterarPapelPagina(estiloFolha) {
        if (!Object.hasOwn(PAPEIS, estiloFolha) || !await salvarPendente()) return;
        const pagina = selecionado();
        if (!pagina || pagina.tipo !== "page" || pagina.estiloFolha === estiloFolha) return;
        const status = document.getElementById("subjectNotebookPageStatus");
        if (status) status.textContent = "Salvando…";
        try {
            const salva = await repositorio.atualizar(pagina.id, { estiloFolha }, pagina.versao);
            itens = itens.map(item => item.id === pagina.id ? salva : item);
            renderizar();
        } catch (erro) {
            informar(erro.message || "Não foi possível alterar o estilo da folha.", true);
            renderizar();
        }
    }

    async function criarPaginaInicial(caderno) {
        if (paginasIniciaisEmCriacao.has(caderno.id)) return paginasIniciaisEmCriacao.get(caderno.id);
        const criacao = repositorio.criar(materiaId, {
            id: uuid(),
            tipo: "page",
            titulo: "Página inicial",
            paiId: caderno.id,
            topicoId: caderno.topicoId,
            cor: caderno.cor,
            estiloCapa: caderno.estiloCapa,
            estiloFolha: caderno.estiloFolha,
            posicao: 0,
            conteudo: "",
            desenho: { strokes: [] }
        });
        paginasIniciaisEmCriacao.set(caderno.id, criacao);
        try {
            return await criacao;
        } finally {
            paginasIniciaisEmCriacao.delete(caderno.id);
        }
    }

    async function selecionar(id) {
        if (!await salvarPendente()) return;
        leitorMaterial = null;
        lixeiraAberta = false;
        const item = itemPorId(id);
        if (organizando) {
            selecionadoId = id;
            informar("");
            renderizar();
            return;
        }
        if (item?.tipo === "notebook" && filhosDe(item.id).length > 0) {
            const paginas = filhosDe(item.id).filter(valor => valor.tipo === "page");
            const ultimaId = ultimaPaginaPorCaderno.get(item.id);
            selecionadoId = paginas.some(pagina => pagina.id === ultimaId) ? ultimaId : paginas[0].id;
            registrarPaginaAtual(itemPorId(selecionadoId));
            informar("");
            renderizar();
            return;
        }
        if (item?.tipo === "notebook" && filhosDe(item.id).length === 0) {
            selecionadoId = item.id;
            informar("Preparando a página inicial…");
            renderizar();
            try {
                const pagina = await criarPaginaInicial(item);
                if (!itemPorId(pagina.id)) itens.push(pagina);
                if (selecionadoId === item.id) {
                    selecionadoId = pagina.id;
                    registrarPaginaAtual(pagina);
                }
                informar("");
                renderizar();
            } catch (erro) {
                informar(erro.message || "Não foi possível preparar a página inicial do caderno.", true);
            }
            return;
        }
        selecionadoId = id;
        if (item?.tipo === "page") registrarPaginaAtual(item);
        informar("");
        renderizar();
    }

    async function voltarDaPagina() {
        if (!await salvarPendente()) return;
        if (leitorMaterial) {
            leitorMaterial = null;
            renderizarWorkspace();
            return;
        }
        const pagina = selecionado();
        const caderno = pagina?.tipo === "page" ? itemPorId(pagina.paiId) : null;
        selecionadoId = caderno?.paiId || "";
        informar("");
        renderizar();
    }

    async function alternarOrganizacao(forcar) {
        if (!await salvarPendente()) return;
        organizando = typeof forcar === "boolean" ? forcar : !organizando;
        if (organizando) lixeiraAberta = false;
        dom.organize.setAttribute("aria-pressed", String(organizando));
        dom.organize.classList.toggle("is-active", organizando);
        dom.organize.querySelector("span").textContent = organizando ? "Concluir organização" : "Organizar itens";
        renderizar();
    }

    async function salvarPendente() {
        const paginaSalva = timerSalvamento ? await salvarPagina() : salvamentoPendente ? await salvamentoPendente : true;
        if (timerSalvamentoDesenho) {
            clearTimeout(timerSalvamentoDesenho);
            timerSalvamentoDesenho = 0;
            enfileirarSalvamentoDesenho(selecionadoId);
        }
        const desenhoSalvo = salvamentoDesenhoPendente ? await salvamentoDesenhoPendente : true;
        const posicaoSalva = salvamentoPosicaoPendente ? await salvamentoPosicaoPendente : true;
        return paginaSalva !== false && desenhoSalvo !== false && posicaoSalva !== false;
    }

    async function definirMateria(id, nome, listaTopicos = []) {
        if (String(id) === String(materiaId)) {
            materiaNome = nome;
            topicos = Array.isArray(listaTopicos) ? listaTopicos : [];
            return;
        }
        await salvarPendente();
        materiaId = id;
        materiaNome = nome;
        topicos = Array.isArray(listaTopicos) ? listaTopicos : [];
        busca = "";
        organizando = false;
        lixeiraAberta = false;
        paginasRecolhidas = false;
        ultimaPaginaMateriaId = "";
        modoPaginaPorId.clear();
        clearTimeout(timerSalvamentoDesenho);
        timerSalvamentoDesenho = 0;
        editorDesenho?.destruir();
        editorDesenho = null;
        materiaisPorPagina.clear();
        materiaisCarregando.clear();
        leitorMaterial = null;
        pastasFechadas.clear();
        dom.search.value = "";
        dom.organize.classList.remove("is-active");
        dom.organize.setAttribute("aria-pressed", "false");
        dom.organize.querySelector("span").textContent = "Organizar itens";
        dom.treePanel.classList.remove("is-mobile-open");
        dom.mobileTree.setAttribute("aria-expanded", "false");
        const token = ++carregamento;
        selecionadoId = "";
        itens = [];
        lixeira = [];
        informar("Carregando seus cadernos…");
        renderizar();
        try {
            const [carregados, ultimaPaginaId, itensLixeira] = await Promise.all([
                repositorio.listar(id),
                typeof repositorio.carregarPosicao === "function" ? repositorio.carregarPosicao(id).catch(() => "") : Promise.resolve(""),
                typeof repositorio.listarLixeira === "function" ? repositorio.listarLixeira(id).catch(() => []) : Promise.resolve([])
            ]);
            if (token !== carregamento) return;
            itens = carregados;
            lixeira = itensLixeira;
            const ultimaPagina = itens.find(item => item.id === ultimaPaginaId && item.tipo === "page");
            if (ultimaPagina) {
                ultimaPaginaMateriaId = ultimaPagina.id;
                ultimaPaginaPorCaderno.set(ultimaPagina.paiId, ultimaPagina.id);
                selecionadoId = ultimaPagina.id;
            } else {
                selecionadoId = itens[0]?.id || "";
            }
            informar("");
            renderizar();
        } catch (erro) {
            if (token === carregamento) informar(erro.message || "Não foi possível carregar os cadernos.", true);
        }
    }

    dom.novaPasta.addEventListener("click", () => abrirDialogo("folder"));
    dom.novoCaderno.addEventListener("click", () => abrirDialogo("notebook"));
    dom.form.addEventListener("submit", salvarFormulario);
    dom.toastClose.addEventListener("click", fecharToast);
    dom.toastUndo.addEventListener("click", async () => {
        const desfazer = desfazerMovimento;
        if (!desfazer) return;
        fecharToast();
        informar("Desfazendo o movimento…");
        try { await desfazer(); }
        catch (erro) { informar(erro.message || "Não foi possível desfazer o movimento.", true); }
    });
    dom.dialog.querySelectorAll("[data-notebook-dialog-close]").forEach(botao => botao.addEventListener("click", () => dom.dialog.close()));
    dom.dialog.addEventListener("click", evento => { if (evento.target === dom.dialog) dom.dialog.close(); });
    dom.pageActions.querySelectorAll("[data-notebook-page-actions-close]").forEach(botao => botao.addEventListener("click", () => dom.pageActions.close()));
    dom.pageActions.addEventListener("click", async evento => {
        if (evento.target === dom.pageActions) { dom.pageActions.close(); return; }
        const botao = evento.target.closest("[data-notebook-page-action]");
        if (!botao) return;
        const id = dom.pageActionsId.value;
        const pagina = itemPorId(id);
        dom.pageActions.close();
        if (!pagina) return;
        if (botao.dataset.notebookPageAction === "rename") abrirDialogo("page", pagina, "rename");
        if (botao.dataset.notebookPageAction === "move") abrirDialogo("page", pagina, "move");
        if (botao.dataset.notebookPageAction === "duplicate") await duplicarItem(id);
        if (botao.dataset.notebookPageAction === "delete") await excluirItem(id);
    });
    dom.materialDialog.querySelectorAll("[data-notebook-material-close]").forEach(botao => botao.addEventListener("click", () => dom.materialDialog.close()));
    dom.materialDialog.addEventListener("click", evento => { if (evento.target === dom.materialDialog) dom.materialDialog.close(); });
    dom.newMaterial.addEventListener("click", () => {
        dom.materialDialog.close();
        document.querySelector('[data-bs-target="#ws-links"]')?.click();
        window.setTimeout(() => document.getElementById("linkTitulo")?.focus(), 100);
    });
    dom.search.addEventListener("input", evento => { busca = evento.target.value; renderizarArvore(); });
    dom.organize.addEventListener("click", async () => { await alternarOrganizacao(); });
    dom.notebooks.addEventListener("click", () => { if (lixeiraAberta) { lixeiraAberta = false; renderizar(); } });
    dom.trash.addEventListener("click", async () => { if (!lixeiraAberta) await abrirLixeira(); });
    dom.mobileTree.addEventListener("click", () => {
        const aberta = dom.treePanel.classList.toggle("is-mobile-open");
        dom.mobileTree.setAttribute("aria-expanded", String(aberta));
    });
    dom.tree.addEventListener("pointerdown", evento => {
        const alca = evento.target.closest("[data-notebook-drag]");
        if (!organizando || !alca) return;
        evento.preventDefault();
        arraste = { id: alca.dataset.notebookDrag, pointerId: evento.pointerId, x: evento.clientX, y: evento.clientY, ativo: false, destinoId: "", modo: "", velocidadeRolagem: 0 };
        alca.setPointerCapture?.(evento.pointerId);
    });
    dom.tree.addEventListener("pointermove", evento => {
        if (!arraste || arraste.pointerId !== evento.pointerId) return;
        if (!arraste.ativo && Math.hypot(evento.clientX - arraste.x, evento.clientY - arraste.y) < 6) return;
        arraste.ativo = true;
        evento.preventDefault();
        atualizarRolagemArraste(evento.clientY);
        limparDestinoArraste();
        dom.tree.querySelector(`[data-notebook-row-id="${arraste.id}"]`)?.classList.add("is-dragging");
        const linhaDestino = document.elementFromPoint(evento.clientX, evento.clientY)?.closest("[data-notebook-row-id]");
        const destino = linhaDestino ? itemPorId(linhaDestino.dataset.notebookRowId) : null;
        const origem = itemPorId(arraste.id);
        if (!origem || !destino || origem.id === destino.id || descendentes(origem.id).has(destino.id)) {
            arraste.destinoId = "";
            arraste.modo = "";
            return;
        }
        const caixa = linhaDestino.getBoundingClientRect();
        const proporcaoVertical = (evento.clientY - caixa.top) / Math.max(caixa.height, 1);
        const dentro = podeConter(destino, origem) && proporcaoVertical >= .25 && proporcaoVertical <= .75;
        const mesmoPai = (origem.paiId || "") === (destino.paiId || "");
        if (!dentro && !mesmoPai) {
            arraste.destinoId = "";
            arraste.modo = "";
            return;
        }
        arraste.destinoId = destino.id;
        arraste.modo = dentro ? "inside" : proporcaoVertical > .5 ? "after" : "before";
        linhaDestino.classList.add(`is-drop-${arraste.modo}`);
    });
    const concluirArraste = async evento => {
        if (!arraste || arraste.pointerId !== evento.pointerId) return;
        const atual = arraste;
        arraste = null;
        pararRolagemArraste();
        limparDestinoArraste();
        if (atual.ativo && atual.destinoId) await moverPorArraste(atual.id, atual.destinoId, atual.modo);
    };
    dom.tree.addEventListener("pointerup", concluirArraste);
    dom.tree.addEventListener("pointercancel", evento => {
        if (!arraste || arraste.pointerId !== evento.pointerId) return;
        arraste = null;
        pararRolagemArraste();
        limparDestinoArraste();
    });
    dom.app.addEventListener("click", async evento => {
        const alvo = evento.target.closest("[data-notebook-select],[data-notebook-create],[data-notebook-edit],[data-notebook-rename],[data-notebook-move],[data-notebook-delete],[data-notebook-duplicate],[data-notebook-page-options],[data-notebook-shortcut],[data-notebook-toggle],[data-notebook-home],[data-notebook-pages-toggle],[data-notebook-page-mode],[data-notebook-back],[data-notebook-organize-finish],[data-notebook-trash-close],[data-notebook-trash-restore],[data-notebook-trash-delete],[data-notebook-trash-empty],[data-notebook-material-manage],[data-notebook-material-toggle],[data-notebook-material-remove],[data-notebook-material-open],[data-notebook-pdf-close],[data-notebook-pdf-step],[data-notebook-text-highlight-color],[data-notebook-text-highlight-remove]");
        if (!alvo) return;
        if (alvo.hasAttribute("data-notebook-home")) await selecionar("");
        if (alvo.dataset.notebookSelect) await selecionar(alvo.dataset.notebookSelect);
        if (alvo.dataset.notebookCreate) abrirDialogo(alvo.dataset.notebookCreate);
        if (alvo.dataset.notebookEdit) { const item = itemPorId(alvo.dataset.notebookEdit); if (item) abrirDialogo(item.tipo, item); }
        if (alvo.dataset.notebookRename) { const item = itemPorId(alvo.dataset.notebookRename); if (item) abrirDialogo(item.tipo, item, "rename"); }
        if (alvo.dataset.notebookMove) { const item = itemPorId(alvo.dataset.notebookMove); if (item) abrirDialogo(item.tipo, item, "move"); }
        if (alvo.dataset.notebookDelete) await excluirItem(alvo.dataset.notebookDelete);
        if (alvo.dataset.notebookDuplicate) await duplicarItem(alvo.dataset.notebookDuplicate);
        if (alvo.dataset.notebookPageOptions) abrirAcoesPagina(alvo.dataset.notebookPageOptions);
        if (alvo.dataset.notebookToggle) {
            const id = alvo.dataset.notebookToggle;
            if (pastasFechadas.has(id)) pastasFechadas.delete(id); else pastasFechadas.add(id);
            renderizarArvore();
        }
        if (alvo.hasAttribute("data-notebook-pages-toggle")) {
            paginasRecolhidas = !paginasRecolhidas;
            renderizarWorkspace();
        }
        if (alvo.dataset.notebookPageMode) {
            const pagina = selecionado();
            const novoModo = alvo.dataset.notebookPageMode;
            if (pagina?.tipo === "page" && ["text", "drawing"].includes(novoModo) && (modoPaginaPorId.get(pagina.id) || "text") !== novoModo) {
                if (!await salvarPendente()) return;
                modoPaginaPorId.set(pagina.id, novoModo);
                renderizarWorkspace();
            }
        }
        if (alvo.hasAttribute("data-notebook-back")) await voltarDaPagina();
        if (alvo.dataset.notebookTextHighlightColor) {
            corGrifoTexto = CORES_GRIFO.includes(alvo.dataset.notebookTextHighlightColor) ? alvo.dataset.notebookTextHighlightColor : CORES_GRIFO[0];
            await alternarGrifoTextoPagina(corGrifoTexto, false);
        }
        if (alvo.hasAttribute("data-notebook-text-highlight-remove")) await alternarGrifoTextoPagina(null, true);
        if (alvo.hasAttribute("data-notebook-organize-finish")) await alternarOrganizacao(false);
        if (alvo.hasAttribute("data-notebook-trash-close")) { lixeiraAberta = false; renderizar(); }
        if (alvo.dataset.notebookTrashRestore) await restaurarItem(alvo.dataset.notebookTrashRestore);
        if (alvo.dataset.notebookTrashDelete) await excluirDefinitivamente(alvo.dataset.notebookTrashDelete);
        if (alvo.hasAttribute("data-notebook-trash-empty")) await esvaziarLixeira();
        if (alvo.dataset.notebookShortcut === "cards") document.querySelector('[data-bs-target="#ws-cards"]')?.click();
        if (alvo.dataset.notebookShortcut === "maps") document.querySelector('[data-bs-target="#ws-mapas"]')?.click();
        if (alvo.dataset.notebookMaterialManage) await abrirMateriaisPagina(alvo.dataset.notebookMaterialManage);
        if (alvo.dataset.notebookMaterialToggle) await alternarMaterialPagina(alvo.dataset.notebookMaterialPage, alvo.dataset.notebookMaterialToggle, alvo.getAttribute("aria-pressed") !== "true");
        if (alvo.dataset.notebookMaterialRemove) await alternarMaterialPagina(alvo.dataset.notebookMaterialPage, alvo.dataset.notebookMaterialRemove, false);
        if (alvo.dataset.notebookMaterialOpen) await abrirLeitorMaterial(alvo.dataset.notebookMaterialPage, alvo.dataset.notebookMaterialOpen);
        if (alvo.hasAttribute("data-notebook-pdf-close")) { leitorMaterial = null; renderizarWorkspace(); }
        if (alvo.dataset.notebookPdfStep) {
            const pagina = selecionado();
            const material = pagina?.tipo === "page" ? (materiaisPorPagina.get(pagina.id) || []).find(item => String(item.id) === String(leitorMaterial?.materialId)) : null;
            if (material) {
                const passo = Number(alvo.dataset.notebookPdfStep) || 0;
                const novaPagina = Math.max(1, Math.min(material.totalPaginas || 100000, (Number(material.paginaAtual) || 1) + passo));
                await salvarProgressoLeitor(pagina.id, material.id, novaPagina, material.totalPaginas);
            }
        }
        if (alvo.dataset.notebookShortcut === "materials") {
            const pagina = selecionado();
            if (pagina?.tipo === "page") await abrirMateriaisPagina(pagina.id);
            else document.querySelector('[data-bs-target="#ws-links"]')?.click();
        }
    });
    dom.app.addEventListener("input", evento => {
        if (evento.target.id === "subjectNotebookPageContent" && !("value" in evento.target)) {
            const pagina = selecionado();
            const anterior = evento.target.dataset.lastText ?? pagina?.conteudo ?? "";
            const novo = evento.target.innerText.slice(0, 500000);
            if (pagina?.tipo === "page" && anterior !== novo) {
                pagina.desenho = { ...(pagina.desenho || { strokes: [] }), textHighlights: ajustarGrifosTexto(anterior, novo, pagina.desenho?.textHighlights) };
                evento.target.dataset.lastText = novo;
            }
        }
        if (["subjectNotebookPageTitle", "subjectNotebookPageContent"].includes(evento.target.id)) agendarSalvamento();
    });
    dom.app.addEventListener("pointerdown", evento => {
        if (evento.target.closest("[data-notebook-text-highlight-color],[data-notebook-text-highlight-remove]")) evento.preventDefault();
    });
    document.addEventListener("selectionchange", () => queueMicrotask(atualizarMenuGrifoTexto));
    dom.app.addEventListener("submit", async evento => {
        const form = evento.target.closest("[data-notebook-pdf-progress]");
        if (!form) return;
        evento.preventDefault();
        const pagina = selecionado();
        const materialId = leitorMaterial?.materialId;
        if (pagina?.tipo !== "page" || !materialId) return;
        await salvarProgressoLeitor(pagina.id, materialId, form.querySelector("[data-notebook-pdf-current]")?.value, form.querySelector("[data-notebook-pdf-total]")?.value);
    });
    dom.app.addEventListener("change", evento => {
        if (evento.target.id === "subjectNotebookPagePaper") alterarPapelPagina(evento.target.value);
    });

    return Object.freeze({ definirMateria, salvarPendente, encerrar: () => { clearTimeout(timerSalvamento); clearTimeout(timerSalvamentoDesenho); editorDesenho?.destruir(); pararRolagemArraste(); carregamento += 1; } });
}
