const TIPOS = Object.freeze({ folder: "Pasta", notebook: "Caderno", page: "Página" });
const ICONES = Object.freeze({ folder: "folder2", notebook: "journal-bookmark", page: "file-earmark-text" });
const PAPEIS = Object.freeze({ plain: "Lisa", lined: "Pautada", grid: "Quadriculada", dotted: "Pontilhada" });
const CAPAS = Object.freeze({ solid: "Clássica", gradient: "Degradê", minimal: "Minimalista" });
const uuid = () => crypto.randomUUID();
const esc = (valor) => String(valor ?? "").replace(/[&<>'"]/g, caractere => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[caractere]);

export function criarCadernosMaterias(repositorio) {
    const dom = {
        app: document.getElementById("subjectNotebookApp"),
        status: document.getElementById("subjectNotebookStatus"),
        tree: document.getElementById("subjectNotebookTree"),
        count: document.getElementById("subjectNotebookCount"),
        search: document.getElementById("subjectNotebookSearch"),
        organize: document.getElementById("btnOrganizarCadernoMateria"),
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
        itemTitle: document.getElementById("subjectNotebookItemTitle"),
        itemParent: document.getElementById("subjectNotebookItemParent"),
        itemTopic: document.getElementById("subjectNotebookItemTopic"),
        topicGroup: document.getElementById("subjectNotebookTopicGroup"),
        styleFields: document.getElementById("subjectNotebookStyleFields"),
        itemColor: document.getElementById("subjectNotebookItemColor"),
        itemCover: document.getElementById("subjectNotebookItemCover"),
        itemPaper: document.getElementById("subjectNotebookItemPaper"),
        save: document.getElementById("subjectNotebookDialogSave"),
        toast: document.getElementById("subjectNotebookToast"),
        toastMessage: document.getElementById("subjectNotebookToastMessage"),
        toastClose: document.getElementById("btnFecharToastCaderno")
    };
    if (!dom.app) return Object.freeze({ definirMateria: async () => {}, salvarPendente: async () => true, encerrar: () => {} });

    let materiaId = null;
    let materiaNome = "";
    let topicos = [];
    let itens = [];
    let selecionadoId = "";
    let carregamento = 0;
    let salvamentoPendente = null;
    let timerSalvamento = 0;
    let timerToast = 0;
    let busca = "";
    let organizando = false;
    const pastasFechadas = new Set();

    const itemPorId = id => itens.find(item => item.id === id);
    const filhosDe = id => itens.filter(item => (item.paiId || "") === (id || "")).sort((a, b) => a.posicao - b.posicao || a.titulo.localeCompare(b.titulo));
    const selecionado = () => itemPorId(selecionadoId);
    const fecharToast = () => {
        clearTimeout(timerToast);
        dom.toast.classList.remove("is-visible");
    };
    const exibirToast = mensagem => {
        clearTimeout(timerToast);
        dom.toastMessage.textContent = mensagem;
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
        const linha = (item, nivel = 0) => {
            const filhos = filhosDe(item.id);
            const visiveis = filhos.filter(contemResultado);
            const fechada = item.tipo === "folder" && pastasFechadas.has(item.id) && !termo;
            const irmaos = filhosDe(item.paiId);
            const indice = irmaos.findIndex(valor => valor.id === item.id);
            return `<div class="subject-notebook-tree-row ${item.id === selecionadoId ? "is-active" : ""}" style="padding-left:${.25 + nivel * .78}rem">${item.tipo === "folder" ? `<button class="subject-notebook-tree-disclosure" type="button" data-notebook-toggle="${item.id}" aria-label="${fechada ? "Expandir" : "Recolher"} ${esc(item.titulo)}"><i class="bi-chevron-${fechada ? "right" : "down"}"></i></button>` : '<span class="subject-notebook-tree-spacer"></span>'}<button class="subject-notebook-tree-item" type="button" data-notebook-select="${item.id}"><i class="bi-${ICONES[item.tipo]}"></i><span>${esc(item.titulo)}</span></button>${organizando ? `<span class="subject-notebook-order-actions"><button type="button" data-notebook-order="up" data-notebook-id="${item.id}" ${indice <= 0 ? "disabled" : ""} aria-label="Mover para cima"><i class="bi-chevron-up"></i></button><button type="button" data-notebook-order="down" data-notebook-id="${item.id}" ${indice >= irmaos.length - 1 ? "disabled" : ""} aria-label="Mover para baixo"><i class="bi-chevron-down"></i></button></span>` : ""}</div>${fechada ? "" : visiveis.map(filho => linha(filho, nivel + 1)).join("")}`;
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
        return `<details class="subject-notebook-more"><summary aria-label="Mais opções" title="Mais opções"><i class="bi-three-dots"></i></summary><div><button type="button" data-notebook-edit="${item.id}"><i class="bi-pencil"></i>Renomear ou mover</button><button type="button" data-notebook-duplicate="${item.id}"><i class="bi-copy"></i>Duplicar</button><button class="is-danger" type="button" data-notebook-delete="${item.id}"><i class="bi-trash"></i>Excluir</button></div></details>`;
    }

    function cartoesFilhos(item) {
        const filhos = filhosDe(item?.id || "");
        if (!filhos.length) return '<div class="subject-notebook-empty" style="min-height:230px"><i class="bi-folder2-open"></i><strong>Nada por aqui ainda</strong><small>Use as ações acima para organizar este espaço.</small></div>';
        return `<div class="subject-notebook-child-grid">${filhos.map(filho => `<button class="subject-notebook-child" type="button" data-notebook-select="${filho.id}" style="--child-color:${esc(filho.cor)}"><i class="bi-${ICONES[filho.tipo]}"></i><strong>${esc(filho.titulo)}</strong><small>${TIPOS[filho.tipo]}${filho.tipo === "notebook" ? ` · ${PAPEIS[filho.estiloFolha]}` : ""}</small></button>`).join("")}</div>`;
    }

    function renderizarWorkspace() {
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
            dom.workspace.innerHTML = `${caminhoDoItem(item)}<div class="subject-notebook-view-header"><div><small class="text-muted">${esc(caderno?.titulo || "Caderno")} · ${PAPEIS[item.estiloFolha] || "Página"}</small></div>${botoesAcoes(item)}</div><div class="subject-notebook-page-editor is-paper-${esc(item.estiloFolha)}"><input class="subject-notebook-page-title" id="subjectNotebookPageTitle" maxlength="240" value="${esc(item.titulo)}" aria-label="Título da página"><textarea class="subject-notebook-page-content" id="subjectNotebookPageContent" maxlength="500000" placeholder="Comece a escrever suas anotações…">${esc(item.conteudo)}</textarea></div><div class="subject-notebook-shortcuts"><button class="btn btn-sm btn-light" type="button" data-notebook-shortcut="cards"><i class="bi-card-heading me-1"></i>Criar flashcard</button><button class="btn btn-sm btn-light" type="button" data-notebook-shortcut="maps"><i class="bi-diagram-3 me-1"></i>Mapa mental</button><button class="btn btn-sm btn-light" type="button" data-notebook-shortcut="materials"><i class="bi-paperclip me-1"></i>Anexar material</button><span class="ms-auto small text-muted" id="subjectNotebookPageStatus">Salvo</span></div>`;
            return;
        }
        const topico = topicos.find(valor => String(valor.id) === String(item.topicoId));
        const acoesCriacao = item.tipo === "folder"
            ? '<button class="btn btn-sm btn-outline-secondary" type="button" data-notebook-create="folder"><i class="bi-folder-plus me-1"></i>Subpasta</button><button class="btn btn-sm btn-primary" type="button" data-notebook-create="notebook"><i class="bi-journal-plus me-1"></i>Novo caderno</button>'
            : '<button class="btn btn-sm btn-primary" type="button" data-notebook-create="page"><i class="bi-file-earmark-plus me-1"></i>Nova página</button>';
        const cabecalho = item.tipo === "notebook"
            ? `<div class="subject-notebook-cover is-${esc(item.estiloCapa)}" style="--notebook-color:${esc(item.cor)}"><small>${topico ? esc(topico.titulo) : "Caderno pessoal"}</small><h3 class="h4 mb-0">${esc(item.titulo)}</h3></div>`
            : `<div><small class="text-muted">Pasta de organização</small><h3 class="h5 mb-1">${esc(item.titulo)}</h3><p class="mb-0">${filhosDe(item.id).length} itens nesta pasta</p></div>`;
        dom.workspace.innerHTML = `${caminhoDoItem(item)}<div class="subject-notebook-view-header">${cabecalho}<div class="subject-notebook-view-toolbar">${botoesAcoes(item)}<div class="subject-notebook-view-actions">${acoesCriacao}</div></div></div>${cartoesFilhos(item)}${item.tipo === "notebook" ? '<div class="subject-notebook-shortcuts"><button class="btn btn-sm btn-light" type="button" data-notebook-shortcut="maps"><i class="bi-diagram-3 me-1"></i>Mapas mentais</button><button class="btn btn-sm btn-light" type="button" data-notebook-shortcut="materials"><i class="bi-collection me-1"></i>Materiais da matéria</button></div>' : ""}`;
    }

    function renderizar() {
        dom.headerActions.classList.toggle("d-none", itens.length === 0);
        renderizarArvore();
        renderizarWorkspace();
    }

    function opcoesPais(tipo, itemAtual) {
        const bloqueados = itemAtual ? descendentes(itemAtual.id) : new Set();
        bloqueados.add(itemAtual?.id);
        const permitido = tipo === "page" ? "notebook" : "folder";
        const opcoes = itens.filter(item => item.tipo === permitido && !bloqueados.has(item.id));
        const raiz = tipo === "page" ? "" : '<option value="">Raiz da matéria</option>';
        return raiz + opcoes.map(item => `<option value="${item.id}">${esc(item.titulo)}</option>`).join("");
    }

    function abrirDialogo(tipo, item = null) {
        const paiSugerido = item ? item.paiId : (selecionado()?.tipo === "folder" ? selecionadoId : tipo === "page" && selecionado()?.tipo === "notebook" ? selecionadoId : "");
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
        dom.dialogEyebrow.textContent = item ? "Editar item" : "Novo item";
        dom.dialogTitle.textContent = `${item ? "Editar" : "Criar"} ${TIPOS[tipo].toLowerCase()}`;
        dom.topicGroup.classList.toggle("d-none", tipo === "folder");
        dom.styleFields.classList.toggle("d-none", tipo === "folder");
        dom.dialog.showModal();
        dom.itemTitle.focus();
    }

    async function salvarFormulario(evento) {
        evento.preventDefault();
        const id = dom.itemId.value;
        const tipo = dom.itemType.value;
        const atual = itemPorId(id);
        const dados = {
            tipo,
            titulo: dom.itemTitle.value,
            paiId: dom.itemParent.value,
            topicoId: tipo === "folder" ? "" : dom.itemTopic.value,
            cor: dom.itemColor.value,
            estiloCapa: dom.itemCover.value,
            estiloFolha: dom.itemPaper.value,
            posicao: atual?.posicao ?? filhosDe(dom.itemParent.value).length,
            conteudo: atual?.conteudo || ""
        };
        dom.save.disabled = true;
        try {
            const salvo = atual
                ? await repositorio.atualizar(atual.id, dados, atual.versao)
                : await repositorio.criar(materiaId, { id: uuid(), ...dados });
            if (atual) itens = itens.map(item => item.id === atual.id ? salvo : item);
            else itens.push(salvo);
            selecionadoId = salvo.id;
            dom.dialog.close();
            informar(`${TIPOS[tipo]} ${atual ? "atualizado" : "criado"} com sucesso.`);
            renderizar();
        } catch (erro) {
            informar(erro.message || "Não foi possível salvar o item.", true);
        } finally { dom.save.disabled = false; }
    }

    async function excluirItem(id) {
        const item = itemPorId(id);
        if (!item || !window.confirm(`Excluir “${item.titulo}”${filhosDe(id).length ? " e tudo o que está dentro" : ""}?`)) return;
        try {
            await repositorio.excluir(id);
            const removidos = descendentes(id);
            removidos.add(id);
            itens = itens.filter(valor => !removidos.has(valor.id));
            selecionadoId = item.paiId || "";
            informar(`${TIPOS[item.tipo]} excluído.`);
            renderizar();
        } catch (erro) { informar(erro.message || "Não foi possível excluir o item.", true); }
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
                estiloFolha: item.estiloFolha, posicao: filhosDe(paiId).length
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

    async function moverNaOrdem(id, direcao) {
        const item = itemPorId(id);
        if (!item) return;
        const irmaos = filhosDe(item.paiId);
        const origem = irmaos.findIndex(valor => valor.id === id);
        const destino = direcao === "up" ? origem - 1 : origem + 1;
        if (origem < 0 || destino < 0 || destino >= irmaos.length) return;
        [irmaos[origem], irmaos[destino]] = [irmaos[destino], irmaos[origem]];
        informar("Salvando a nova ordem…");
        try {
            itens = await repositorio.reordenar(materiaId, item.paiId, irmaos.map(valor => valor.id));
            informar("Ordem atualizada.");
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
        if (!titulo.value.trim()) { informar("Dê um título à página antes de sair.", true); titulo.focus(); return false; }
        if (titulo.value === item.titulo && conteudo.value === item.conteudo) return true;
        document.getElementById("subjectNotebookPageStatus").textContent = "Salvando…";
        try {
            const salvo = await repositorio.atualizar(item.id, { titulo: titulo.value, conteudo: conteudo.value }, item.versao);
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

    async function selecionar(id) {
        if (!await salvarPendente()) return;
        selecionadoId = id;
        informar("");
        renderizar();
    }

    async function salvarPendente() {
        if (timerSalvamento) return salvarPagina();
        return salvamentoPendente ? salvamentoPendente : true;
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
        informar("Carregando seus cadernos…");
        renderizar();
        try {
            const carregados = await repositorio.listar(id);
            if (token !== carregamento) return;
            itens = carregados;
            selecionadoId = itens[0]?.id || "";
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
    dom.dialog.querySelectorAll("[data-notebook-dialog-close]").forEach(botao => botao.addEventListener("click", () => dom.dialog.close()));
    dom.dialog.addEventListener("click", evento => { if (evento.target === dom.dialog) dom.dialog.close(); });
    dom.search.addEventListener("input", evento => { busca = evento.target.value; renderizarArvore(); });
    dom.organize.addEventListener("click", () => {
        organizando = !organizando;
        dom.organize.setAttribute("aria-pressed", String(organizando));
        dom.organize.classList.toggle("is-active", organizando);
        dom.organize.querySelector("span").textContent = organizando ? "Concluir organização" : "Organizar itens";
        renderizarArvore();
    });
    dom.mobileTree.addEventListener("click", () => {
        const aberta = dom.treePanel.classList.toggle("is-mobile-open");
        dom.mobileTree.setAttribute("aria-expanded", String(aberta));
    });
    dom.app.addEventListener("click", async evento => {
        const alvo = evento.target.closest("[data-notebook-select],[data-notebook-create],[data-notebook-edit],[data-notebook-delete],[data-notebook-duplicate],[data-notebook-shortcut],[data-notebook-toggle],[data-notebook-order],[data-notebook-home]");
        if (!alvo) return;
        if (alvo.hasAttribute("data-notebook-home")) await selecionar("");
        if (alvo.dataset.notebookSelect) await selecionar(alvo.dataset.notebookSelect);
        if (alvo.dataset.notebookCreate) abrirDialogo(alvo.dataset.notebookCreate);
        if (alvo.dataset.notebookEdit) { const item = itemPorId(alvo.dataset.notebookEdit); if (item) abrirDialogo(item.tipo, item); }
        if (alvo.dataset.notebookDelete) await excluirItem(alvo.dataset.notebookDelete);
        if (alvo.dataset.notebookDuplicate) await duplicarItem(alvo.dataset.notebookDuplicate);
        if (alvo.dataset.notebookToggle) {
            const id = alvo.dataset.notebookToggle;
            if (pastasFechadas.has(id)) pastasFechadas.delete(id); else pastasFechadas.add(id);
            renderizarArvore();
        }
        if (alvo.dataset.notebookOrder) await moverNaOrdem(alvo.dataset.notebookId, alvo.dataset.notebookOrder);
        if (alvo.dataset.notebookShortcut === "cards") document.querySelector('[data-bs-target="#ws-cards"]')?.click();
        if (alvo.dataset.notebookShortcut === "maps") document.querySelector('[data-bs-target="#ws-mapas"]')?.click();
        if (alvo.dataset.notebookShortcut === "materials") document.querySelector('[data-bs-target="#ws-links"]')?.click();
    });
    dom.app.addEventListener("input", evento => {
        if (["subjectNotebookPageTitle", "subjectNotebookPageContent"].includes(evento.target.id)) agendarSalvamento();
    });

    return Object.freeze({ definirMateria, salvarPendente, encerrar: () => { clearTimeout(timerSalvamento); carregamento += 1; } });
}
