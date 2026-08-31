import "./mind-map.css";

const SVG_NS = "http://www.w3.org/2000/svg";
const LIMITE_HISTORICO = 60;
const CORES_TEXTO_CLARO = new Set(["#3b2923", "#5b433a", "#64745a", "#92271f", "#b8322a", "#2167d5"]);

const copiar = (valor) => JSON.parse(JSON.stringify(valor));
const limitar = (valor, minimo, maximo) => Math.min(maximo, Math.max(minimo, valor));
const uuid = () => crypto.randomUUID();
const svgEl = (nome, atributos = {}) => {
    const elemento = document.createElementNS(SVG_NS, nome);
    Object.entries(atributos).forEach(([chave, valor]) => elemento.setAttribute(chave, String(valor)));
    return elemento;
};

function corDoTexto(fundo) {
    return CORES_TEXTO_CLARO.has(String(fundo).toLowerCase()) ? "#fffdf9" : "#29211e";
}

function linhasDoTexto(texto, limite = 23) {
    const palavras = String(texto || "Conceito").trim().split(/\s+/).filter(Boolean);
    const linhas = [];
    palavras.forEach(palavra => {
        const ultima = linhas.at(-1);
        if (ultima && `${ultima} ${palavra}`.length <= limite) linhas[linhas.length - 1] += ` ${palavra}`;
        else if (linhas.length < 4) linhas.push(palavra.slice(0, limite + 5));
    });
    if (!linhas.length) linhas.push("Conceito");
    if (palavras.join(" ").length > linhas.join(" ").length) linhas[linhas.length - 1] = `${linhas.at(-1).slice(0, limite - 1)}…`;
    return linhas;
}

export function criarEditorMapasMentais(repositorio) {
    const dom = {
        tab: document.getElementById("wsTabMapas"),
        biblioteca: document.getElementById("mindMapLibrary"),
        lista: document.getElementById("mindMapList"),
        statusBiblioteca: document.getElementById("mindMapLibraryStatus"),
        novo: document.getElementById("btnNovoMapaMental"),
        editor: document.getElementById("mindMapEditor"),
        voltar: document.getElementById("btnVoltarMapas"),
        excluirMapa: document.getElementById("btnExcluirMapaMental"),
        titulo: document.getElementById("mindMapTitleInput"),
        status: document.getElementById("mindMapSaveStatus"),
        ferramentas: [...document.querySelectorAll("[data-mind-tool]")],
        cor: document.getElementById("mindMapColor"),
        estiloLinha: document.getElementById("mindMapLineStyle"),
        undo: document.getElementById("btnMindUndo"),
        redo: document.getElementById("btnMindRedo"),
        duplicar: document.getElementById("btnMindDuplicate"),
        frente: document.getElementById("btnMindFront"),
        fixar: document.getElementById("btnMindLock"),
        fixarLabel: document.getElementById("mindMapLockLabel"),
        excluir: document.getElementById("btnMindDelete"),
        zoomMenos: document.getElementById("btnMindZoomOut"),
        zoomMais: document.getElementById("btnMindZoomIn"),
        zoomLabel: document.getElementById("mindMapZoomLabel"),
        enquadrar: document.getElementById("btnMindFit"),
        dica: document.getElementById("mindMapHint"),
        stage: document.getElementById("mindMapStage"),
        canvas: document.getElementById("mindMapCanvas"),
        viewport: document.getElementById("mindMapViewport"),
        edges: document.getElementById("mindMapEdges"),
        elementos: document.getElementById("mindMapElements"),
        vazio: document.getElementById("mindMapEmpty"),
        minimapa: document.getElementById("mindMapMiniSvg")
        ,textoDialog: document.getElementById("mindMapTextDialog")
        ,textoForm: document.getElementById("mindMapTextForm")
        ,textoTitulo: document.getElementById("mindMapTextDialogTitle")
        ,textoAjuda: document.getElementById("mindMapTextDialogHelp")
        ,textoInput: document.getElementById("mindMapTextInput")
        ,textoConfirmar: document.getElementById("btnMindMapTextConfirm")
        ,textoCancelar: document.getElementById("btnMindMapTextCancel")
        ,confirmDialog: document.getElementById("mindMapConfirmDialog")
        ,confirmMessage: document.getElementById("mindMapConfirmMessage")
        ,confirmDelete: document.getElementById("btnMindMapConfirmDelete")
        ,confirmCancel: document.getElementById("btnMindMapConfirmCancel")
        ,borrachaControle: document.getElementById("mindMapEraserControl")
        ,borrachaTamanho: document.getElementById("mindMapEraserSize")
        ,borrachaLabel: document.getElementById("mindMapEraserSizeLabel")
        ,borrachaCursor: document.getElementById("mindMapEraserCursor")
    };

    let materiaId = null;
    let materiaNome = "";
    let mapas = [];
    let mapa = null;
    let elementos = [];
    let viewport = { x: 0, y: 0, zoom: 1 };
    let ferramenta = "select";
    let selecionadoId = null;
    let origemConexaoId = null;
    let gesto = null;
    let historico = [];
    let futuros = [];
    let timerSalvar = null;
    let salvamento = null;
    let alteradoDuranteSalvamento = false;
    let sujo = false;
    let carregamentoToken = 0;
    let resolverTexto = null;
    let resolverConfirmacao = null;

    const elementoPorId = (id) => elementos.find(item => item.id === id) || null;
    const maxZ = () => Math.max(0, ...elementos.map(item => Number(item.zIndex) || 0));

    function definirStatus(texto, classe = "") {
        dom.status.textContent = texto;
        dom.status.className = `mind-map-save-status ${classe}`.trim();
    }

    function definirStatusBiblioteca(texto, erro = false) {
        dom.statusBiblioteca.textContent = texto;
        dom.statusBiblioteca.className = `mind-map-status ${erro ? "is-error" : ""}`.trim();
    }

    function fecharEditorTexto(valor = null) {
        if (!resolverTexto) return;
        const resolver = resolverTexto;
        resolverTexto = null;
        dom.textoDialog.classList.add("d-none");
        dom.textoForm.reset();
        resolver(valor);
        dom.stage.focus({ preventScroll: true });
    }

    function solicitarTexto({ titulo, ajuda, valor = "", confirmar = "Salvar" }) {
        if (resolverTexto) fecharEditorTexto(null);
        dom.textoTitulo.textContent = titulo;
        dom.textoAjuda.textContent = ajuda;
        dom.textoInput.value = valor;
        dom.textoConfirmar.textContent = confirmar;
        dom.textoDialog.classList.remove("d-none");
        requestAnimationFrame(() => {
            dom.textoInput.focus();
            dom.textoInput.select();
        });
        return new Promise(resolve => { resolverTexto = resolve; });
    }

    function fecharConfirmacao(valor = false) {
        if (!resolverConfirmacao) return;
        const resolver = resolverConfirmacao;
        resolverConfirmacao = null;
        dom.confirmDialog.classList.add("d-none");
        resolver(valor);
        dom.stage.focus({ preventScroll: true });
    }

    function solicitarConfirmacao(mensagem) {
        if (resolverConfirmacao) fecharConfirmacao(false);
        dom.confirmMessage.textContent = mensagem;
        dom.confirmDialog.classList.remove("d-none");
        requestAnimationFrame(() => dom.confirmCancel.focus());
        return new Promise(resolve => { resolverConfirmacao = resolve; });
    }

    function snapshot() {
        return { elementos: copiar(elementos), viewport: copiar(viewport) };
    }

    function registrarHistorico() {
        historico.push(snapshot());
        if (historico.length > LIMITE_HISTORICO) historico.shift();
        futuros = [];
        atualizarBotoes();
    }

    function restaurarSnapshot(estado) {
        elementos = copiar(estado.elementos);
        viewport = copiar(estado.viewport);
        selecionadoId = null;
        origemConexaoId = null;
        renderizar();
        marcarAlterado();
    }

    function desfazer() {
        if (!historico.length) return;
        futuros.push(snapshot());
        restaurarSnapshot(historico.pop());
    }

    function refazer() {
        if (!futuros.length) return;
        historico.push(snapshot());
        restaurarSnapshot(futuros.pop());
    }

    function atualizarBotoes() {
        const item = elementoPorId(selecionadoId);
        dom.undo.disabled = !historico.length;
        dom.redo.disabled = !futuros.length;
        dom.excluir.disabled = !item;
        dom.frente.disabled = !item || item.type === "edge";
        dom.duplicar.disabled = !item || item.type === "edge";
        const podeFixar = item && ["node", "shape"].includes(item.type);
        const fixado = Boolean(podeFixar && item.payload.locked);
        dom.fixar.disabled = !podeFixar;
        dom.fixar.classList.toggle("active", fixado);
        dom.fixar.setAttribute("aria-pressed", String(fixado));
        dom.fixar.title = fixado ? "Desfixar posição" : "Fixar posição";
        dom.fixar.querySelector("i").className = fixado ? "bi-lock" : "bi-unlock";
        dom.fixarLabel.textContent = fixado ? "Desfixar" : "Fixar";
        dom.zoomLabel.textContent = `${Math.round(viewport.zoom * 100)}%`;
    }

    function selecionarFerramenta(nova) {
        ferramenta = nova;
        origemConexaoId = null;
        dom.stage.dataset.tool = nova;
        dom.ferramentas.forEach(botao => {
            const ativo = botao.dataset.mindTool === nova;
            botao.classList.toggle("active", ativo);
            botao.setAttribute("aria-pressed", String(ativo));
        });
        dom.borrachaControle.classList.toggle("d-none", nova !== "eraser");
        if (nova !== "eraser") dom.borrachaCursor.setAttribute("visibility", "hidden");
        const dicas = {
            select: "Clique para selecionar. Segure e arraste para mover elementos que não estejam fixados.",
            pan: "Arraste qualquer área vazia para mover a tela.",
            node: "Clique na tela para criar um novo conceito.",
            rect: "Clique na tela para criar um retângulo livre.",
            ellipse: "Clique na tela para criar uma forma circular.",
            edge: "Clique em um elemento e depois em outro para criar uma ligação.",
            draw: "Pressione e arraste na tela para desenhar livremente.",
            eraser: "Passe a borracha sobre desenhos livres. Ajuste o tamanho na barra."
        };
        dom.dica.textContent = dicas[nova] || dicas.select;
        renderizar();
    }

    function coordenada(evento) {
        const caixa = dom.canvas.getBoundingClientRect();
        return {
            x: (evento.clientX - caixa.left - viewport.x) / viewport.zoom,
            y: (evento.clientY - caixa.top - viewport.y) / viewport.zoom
        };
    }

    function centro(item) {
        const p = item.payload;
        return { x: Number(p.x) + Number(p.width || 170) / 2, y: Number(p.y) + Number(p.height || 80) / 2 };
    }

    function criarTextoSvg(item, grupo) {
        const p = item.payload;
        const linhas = linhasDoTexto(p.text, Math.max(14, Math.floor(Number(p.width || 170) / 8)));
        const texto = svgEl("text", {
            x: Number(p.width || 170) / 2,
            y: Number(p.height || 80) / 2 - ((linhas.length - 1) * 9),
            fill: p.textColor || corDoTexto(p.fill),
            "text-anchor": "middle"
        });
        linhas.forEach((linha, indice) => {
            const tspan = svgEl("tspan", { x: Number(p.width || 170) / 2, dy: indice ? 19 : 0 });
            tspan.textContent = linha;
            texto.appendChild(tspan);
        });
        grupo.appendChild(texto);
    }

    function renderizarElemento(item) {
        if (!["node", "shape"].includes(item.type)) return;
        const p = item.payload;
        const grupo = svgEl("g", {
            class: `mind-map-element ${item.id === selecionadoId ? "selected" : ""} ${item.id === origemConexaoId ? "mind-map-connection-source" : ""} ${p.locked ? "is-locked" : ""}`,
            transform: `translate(${Number(p.x) || 0} ${Number(p.y) || 0})`,
            "data-mind-id": item.id
        });
        const comum = {
            class: "mind-map-node-surface",
            fill: p.fill || "#fff3cd",
            stroke: p.stroke || "#b58b27",
            "stroke-width": 2
        };
        if (p.shape === "ellipse") {
            grupo.appendChild(svgEl("ellipse", {
                ...comum,
                cx: Number(p.width || 170) / 2,
                cy: Number(p.height || 90) / 2,
                rx: Number(p.width || 170) / 2,
                ry: Number(p.height || 90) / 2
            }));
        } else {
            grupo.appendChild(svgEl("rect", {
                ...comum,
                width: Number(p.width || 170),
                height: Number(p.height || 80),
                rx: p.shape === "rect" ? 10 : 22
            }));
        }
        criarTextoSvg(item, grupo);
        if (p.locked) {
            const badge = svgEl("g", { class: "mind-map-lock-badge", transform: `translate(${Number(p.width || 170) - 9} 9)` });
            badge.appendChild(svgEl("circle", { cx: 0, cy: 0, r: 11 }));
            const cadeado = svgEl("text", { x: 0, y: 4, "text-anchor": "middle", "aria-label": "Elemento fixado" });
            cadeado.textContent = "🔒";
            badge.appendChild(cadeado);
            grupo.appendChild(badge);
        }
        dom.elementos.appendChild(grupo);
    }

    function renderizarAresta(item) {
        if (item.type !== "edge") return;
        const origem = elementoPorId(item.payload.sourceId);
        const destino = elementoPorId(item.payload.targetId);
        if (!origem || !destino) return;
        const a = centro(origem);
        const b = centro(destino);
        const curva = Math.max(45, Math.abs(b.x - a.x) * .35);
        const caminho = svgEl("path", {
            class: `mind-map-edge ${item.id === selecionadoId ? "selected" : ""}`,
            d: `M ${a.x} ${a.y} C ${a.x + curva} ${a.y}, ${b.x - curva} ${b.y}, ${b.x} ${b.y}`,
            stroke: item.payload.color || "#60463b",
            "stroke-dasharray": item.payload.style === "dashed" ? "9 7" : "none",
            "data-mind-id": item.id
        });
        dom.edges.appendChild(caminho);
    }

    function renderizarTraco(item) {
        if (item.type !== "stroke") return;
        const pontos = Array.isArray(item.payload.points) ? item.payload.points : [];
        if (pontos.length < 2) return;
        const linha = svgEl("polyline", {
            class: `mind-map-stroke ${item.id === selecionadoId ? "selected" : ""}`,
            points: pontos.map(ponto => `${Number(ponto.x) || 0},${Number(ponto.y) || 0}`).join(" "),
            stroke: item.payload.color || "#b8322a",
            "stroke-width": limitar(Number(item.payload.width) || 4, 1, 20),
            "data-mind-id": item.id
        });
        dom.elementos.appendChild(linha);
    }

    function renderizarMinimapa() {
        dom.minimapa.replaceChildren();
        const visuais = elementos.filter(item => ["node", "shape", "stroke"].includes(item.type));
        if (!visuais.length) return;
        const pontos = [];
        visuais.forEach(item => {
            if (item.type === "stroke") (item.payload.points || []).forEach(p => pontos.push({ x: Number(p.x), y: Number(p.y) }));
            else {
                pontos.push({ x: Number(item.payload.x), y: Number(item.payload.y) });
                pontos.push({ x: Number(item.payload.x) + Number(item.payload.width || 170), y: Number(item.payload.y) + Number(item.payload.height || 80) });
            }
        });
        const xs = pontos.map(p => p.x).filter(Number.isFinite);
        const ys = pontos.map(p => p.y).filter(Number.isFinite);
        if (!xs.length || !ys.length) return;
        const minX = Math.min(...xs) - 40;
        const minY = Math.min(...ys) - 40;
        const largura = Math.max(200, Math.max(...xs) - minX + 40);
        const altura = Math.max(120, Math.max(...ys) - minY + 40);
        dom.minimapa.setAttribute("viewBox", `${minX} ${minY} ${largura} ${altura}`);
        elementos.filter(item => ["node", "shape"].includes(item.type)).forEach(item => {
            const p = item.payload;
            dom.minimapa.appendChild(svgEl("rect", { x: p.x, y: p.y, width: p.width || 170, height: p.height || 80, rx: 10, fill: p.fill || "#fff3cd", stroke: p.stroke || "#b58b27", "stroke-width": 3 }));
        });
    }

    function renderizar() {
        dom.viewport.setAttribute("transform", `translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`);
        dom.edges.replaceChildren();
        dom.elementos.replaceChildren();
        elementos.slice().sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0)).forEach(renderizarAresta);
        elementos.slice().sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0)).forEach(item => {
            renderizarElemento(item);
            renderizarTraco(item);
        });
        dom.vazio.classList.toggle("d-none", elementos.length > 0);
        atualizarBotoes();
        renderizarMinimapa();
    }

    function marcarAlterado() {
        sujo = true;
        definirStatus("Alterações pendentes", "is-saving");
        clearTimeout(timerSalvar);
        timerSalvar = setTimeout(() => { void salvarAgora(); }, 900);
        if (salvamento) alteradoDuranteSalvamento = true;
    }

    async function salvarAgora() {
        clearTimeout(timerSalvar);
        timerSalvar = null;
        if (!mapa || !sujo) return true;
        if (salvamento) {
            alteradoDuranteSalvamento = true;
            await salvamento;
            return salvarAgora();
        }
        const elementosSalvos = copiar(elementos);
        const viewportSalvo = copiar(viewport);
        const versaoEsperada = mapa.versao;
        sujo = false;
        alteradoDuranteSalvamento = false;
        definirStatus("Salvando…", "is-saving");
        salvamento = repositorio.salvarConteudo(mapa.id, elementosSalvos, viewportSalvo, versaoEsperada);
        try {
            const resultado = await salvamento;
            mapa.versao = resultado.versao;
            mapa.atualizadoEm = resultado.atualizadoEm;
            definirStatus("Salvo no Supabase");
            if (alteradoDuranteSalvamento) {
                sujo = true;
                timerSalvar = setTimeout(() => { void salvarAgora(); }, 500);
            }
            return true;
        } catch (erro) {
            console.error("Falha ao salvar mapa mental", erro);
            sujo = true;
            definirStatus("Não foi possível salvar", "is-error");
            return false;
        } finally {
            salvamento = null;
        }
    }

    async function novoElemento(tipo, ponto) {
        const cor = dom.cor.value || "#b8322a";
        const forma = tipo === "ellipse" ? "ellipse" : tipo === "rect" ? "rect" : "node";
        const resposta = await solicitarTexto({
            titulo: tipo === "node" ? "Novo conceito" : "Nova forma",
            ajuda: tipo === "node" ? "Escreva a ideia que deseja conectar no mapa." : "Dê um nome à forma para facilitar a organização.",
            valor: tipo === "node" ? "Ideia central" : "",
            confirmar: "Criar"
        });
        if (resposta == null) return;
        const texto = resposta.trim();
        if (tipo === "node" && !texto) return;
        registrarHistorico();
        const item = {
            id: uuid(),
            type: tipo === "node" ? "node" : "shape",
            zIndex: maxZ() + 1,
            payload: {
                x: Math.round(ponto.x - 85),
                y: Math.round(ponto.y - 42),
                width: forma === "ellipse" ? 180 : 170,
                height: forma === "ellipse" ? 100 : 84,
                text: texto || (forma === "ellipse" ? "Círculo" : "Forma"),
                shape: forma,
                fill: cor,
                stroke: cor,
                textColor: corDoTexto(cor)
            }
        };
        elementos.push(item);
        selecionadoId = item.id;
        selecionarFerramenta("select");
        marcarAlterado();
        renderizar();
    }

    function ligar(itemId) {
        const item = elementoPorId(itemId);
        if (!item || !["node", "shape"].includes(item.type)) return;
        if (!origemConexaoId) {
            origemConexaoId = itemId;
            dom.dica.textContent = "Agora clique no elemento de destino.";
            renderizar();
            return;
        }
        if (origemConexaoId === itemId) return;
        if (elementos.some(elemento => elemento.type === "edge" && elemento.payload.sourceId === origemConexaoId && elemento.payload.targetId === itemId)) {
            origemConexaoId = null;
            selecionarFerramenta("select");
            return;
        }
        registrarHistorico();
        elementos.push({
            id: uuid(),
            type: "edge",
            zIndex: 0,
            payload: { sourceId: origemConexaoId, targetId: itemId, color: dom.cor.value || "#60463b", style: dom.estiloLinha.value }
        });
        origemConexaoId = null;
        selecionarFerramenta("select");
        marcarAlterado();
        renderizar();
    }

    function excluirSelecionado() {
        const item = elementoPorId(selecionadoId);
        if (!item) return;
        registrarHistorico();
        const removidos = new Set([item.id]);
        if (["node", "shape"].includes(item.type)) {
            elementos.filter(elemento => elemento.type === "edge" && [elemento.payload.sourceId, elemento.payload.targetId].includes(item.id)).forEach(elemento => removidos.add(elemento.id));
        }
        elementos = elementos.filter(elemento => !removidos.has(elemento.id));
        selecionadoId = null;
        marcarAlterado();
        renderizar();
    }

    function duplicarSelecionado() {
        const original = elementoPorId(selecionadoId);
        if (!original || original.type === "edge") return;
        registrarHistorico();
        const duplicado = copiar(original);
        duplicado.id = uuid();
        duplicado.zIndex = maxZ() + 1;
        if (duplicado.type === "stroke") duplicado.payload.points = duplicado.payload.points.map(p => ({ x: p.x + 28, y: p.y + 28 }));
        else { duplicado.payload.x += 28; duplicado.payload.y += 28; }
        elementos.push(duplicado);
        selecionadoId = duplicado.id;
        marcarAlterado();
        renderizar();
    }

    function trazerParaFrente() {
        const item = elementoPorId(selecionadoId);
        if (!item || item.type === "edge") return;
        registrarHistorico();
        item.zIndex = maxZ() + 1;
        marcarAlterado();
        renderizar();
    }

    function alternarFixacao() {
        const item = elementoPorId(selecionadoId);
        if (!item || !["node", "shape"].includes(item.type)) return;
        registrarHistorico();
        item.payload.locked = !item.payload.locked;
        marcarAlterado();
        renderizar();
    }

    function registrarEstado(estado) {
        historico.push(estado);
        if (historico.length > LIMITE_HISTORICO) historico.shift();
        futuros = [];
        atualizarBotoes();
    }

    function apagarTracos(ponto, raio) {
        let mudou = false;
        const resultado = [];
        elementos.forEach(item => {
            if (item.type !== "stroke") { resultado.push(item); return; }
            const partes = [];
            let parte = [];
            let atingiu = false;
            (item.payload.points || []).forEach(p => {
                if (Math.hypot(Number(p.x) - ponto.x, Number(p.y) - ponto.y) <= raio) {
                    atingiu = true;
                    if (parte.length >= 2) partes.push(parte);
                    parte = [];
                } else parte.push(p);
            });
            if (parte.length >= 2) partes.push(parte);
            if (!atingiu) { resultado.push(item); return; }
            mudou = true;
            partes.forEach((pontos, indice) => resultado.push({
                ...copiar(item),
                id: indice === 0 ? item.id : uuid(),
                payload: { ...copiar(item.payload), points: pontos }
            }));
        });
        if (mudou) {
            elementos = resultado;
            if (!elementoPorId(selecionadoId)) selecionadoId = null;
        }
        return mudou;
    }

    function atualizarCursorBorracha(ponto, visivel = true) {
        dom.borrachaCursor.setAttribute("cx", String(ponto.x));
        dom.borrachaCursor.setAttribute("cy", String(ponto.y));
        dom.borrachaCursor.setAttribute("r", String(Number(dom.borrachaTamanho.value) / 2));
        dom.borrachaCursor.setAttribute("visibility", visivel ? "visible" : "hidden");
    }

    function apagarComHistorico(ponto) {
        const antes = gesto?.alterou ? null : snapshot();
        const apagou = apagarTracos(ponto, Number(dom.borrachaTamanho.value) / 2);
        if (apagou && !gesto.alterou) registrarEstado(antes);
        if (apagou) {
            gesto.alterou = true;
            renderizar();
            atualizarCursorBorracha(ponto);
        }
    }

    function aplicarCor() {
        const item = elementoPorId(selecionadoId);
        if (!item) return;
        registrarHistorico();
        if (["node", "shape"].includes(item.type)) {
            item.payload.fill = dom.cor.value;
            item.payload.stroke = dom.cor.value;
            item.payload.textColor = corDoTexto(dom.cor.value);
        } else item.payload.color = dom.cor.value;
        marcarAlterado();
        renderizar();
    }

    function aplicarEstiloLinha() {
        const item = elementoPorId(selecionadoId);
        if (!item || item.type !== "edge") return;
        registrarHistorico();
        item.payload.style = dom.estiloLinha.value;
        marcarAlterado();
        renderizar();
    }

    function zoom(novoZoom, centroTela = null) {
        const anterior = viewport.zoom;
        const proximo = limitar(novoZoom, .25, 2.5);
        const caixa = dom.stage.getBoundingClientRect();
        const centro = centroTela || { x: caixa.width / 2, y: caixa.height / 2 };
        viewport.x = centro.x - ((centro.x - viewport.x) / anterior) * proximo;
        viewport.y = centro.y - ((centro.y - viewport.y) / anterior) * proximo;
        viewport.zoom = proximo;
        renderizar();
        marcarAlterado();
    }

    function enquadrar() {
        const visuais = elementos.filter(item => ["node", "shape", "stroke"].includes(item.type));
        if (!visuais.length) { viewport = { x: 0, y: 0, zoom: 1 }; renderizar(); marcarAlterado(); return; }
        const pontos = [];
        visuais.forEach(item => {
            if (item.type === "stroke") (item.payload.points || []).forEach(p => pontos.push({ x: Number(p.x), y: Number(p.y) }));
            else {
                pontos.push({ x: Number(item.payload.x), y: Number(item.payload.y) });
                pontos.push({ x: Number(item.payload.x) + Number(item.payload.width || 170), y: Number(item.payload.y) + Number(item.payload.height || 80) });
            }
        });
        const xs = pontos.map(p => p.x).filter(Number.isFinite);
        const ys = pontos.map(p => p.y).filter(Number.isFinite);
        const largura = Math.max(1, Math.max(...xs) - Math.min(...xs));
        const altura = Math.max(1, Math.max(...ys) - Math.min(...ys));
        const caixa = dom.stage.getBoundingClientRect();
        viewport.zoom = limitar(Math.min((caixa.width - 100) / largura, (caixa.height - 100) / altura), .25, 1.5);
        viewport.x = caixa.width / 2 - (Math.min(...xs) + largura / 2) * viewport.zoom;
        viewport.y = caixa.height / 2 - (Math.min(...ys) + altura / 2) * viewport.zoom;
        renderizar();
        marcarAlterado();
    }

    function aoPointerDown(evento) {
        if (!mapa || evento.button !== 0) return;
        const alvo = evento.target.closest?.("[data-mind-id]");
        const item = alvo ? elementoPorId(alvo.dataset.mindId) : null;
        const ponto = coordenada(evento);
        dom.stage.focus({ preventScroll: true });
        if (ferramenta === "eraser") {
            evento.preventDefault();
            gesto = { tipo: "erase", alterou: false };
            dom.stage.setPointerCapture(evento.pointerId);
            atualizarCursorBorracha(ponto);
            apagarComHistorico(ponto);
            return;
        }
        if (ferramenta === "edge" && item) { evento.preventDefault(); ligar(item.id); return; }
        if (["node", "rect", "ellipse"].includes(ferramenta) && !item) { evento.preventDefault(); void novoElemento(ferramenta, ponto); return; }
        if (ferramenta === "draw" && !item) {
            evento.preventDefault();
            registrarHistorico();
            const traco = { id: uuid(), type: "stroke", zIndex: maxZ() + 1, payload: { points: [ponto], color: dom.cor.value, width: 4 } };
            elementos.push(traco);
            selecionadoId = traco.id;
            gesto = { tipo: "draw", id: traco.id };
            dom.stage.setPointerCapture(evento.pointerId);
            return;
        }
        if (ferramenta === "pan" && !item) {
            evento.preventDefault();
            gesto = { tipo: "pan", inicioX: evento.clientX, inicioY: evento.clientY, x: viewport.x, y: viewport.y };
            dom.stage.classList.add("is-dragging");
            dom.stage.setPointerCapture(evento.pointerId);
            selecionadoId = null;
            renderizar();
            return;
        }
        if (!item && ferramenta === "select") {
            selecionadoId = null;
            renderizar();
            return;
        }
        if (item && ferramenta === "select") {
            evento.preventDefault();
            selecionadoId = item.id;
            if (["node", "shape"].includes(item.type) && !item.payload.locked) {
                gesto = {
                    tipo: "pending-move",
                    id: item.id,
                    inicioX: ponto.x,
                    inicioY: ponto.y,
                    inicioClienteX: evento.clientX,
                    inicioClienteY: evento.clientY,
                    x: Number(item.payload.x),
                    y: Number(item.payload.y),
                    alterou: false
                };
                dom.stage.setPointerCapture(evento.pointerId);
            }
            renderizar();
        }
    }

    function aoPointerMove(evento) {
        const pontoAtual = coordenada(evento);
        if (!gesto) {
            if (ferramenta === "eraser") atualizarCursorBorracha(pontoAtual);
            return;
        }
        if (gesto.tipo === "pan") {
            viewport.x = gesto.x + evento.clientX - gesto.inicioX;
            viewport.y = gesto.y + evento.clientY - gesto.inicioY;
            renderizar();
        } else if (gesto.tipo === "pending-move") {
            const distancia = Math.hypot(evento.clientX - gesto.inicioClienteX, evento.clientY - gesto.inicioClienteY);
            if (distancia < 5) return;
            registrarHistorico();
            gesto.tipo = "move";
            const item = elementoPorId(gesto.id);
            if (!item || item.payload.locked) return;
            item.payload.x = Math.round(gesto.x + pontoAtual.x - gesto.inicioX);
            item.payload.y = Math.round(gesto.y + pontoAtual.y - gesto.inicioY);
            gesto.alterou = true;
            renderizar();
        } else if (gesto.tipo === "move") {
            const item = elementoPorId(gesto.id);
            if (!item || item.payload.locked) return;
            item.payload.x = Math.round(gesto.x + pontoAtual.x - gesto.inicioX);
            item.payload.y = Math.round(gesto.y + pontoAtual.y - gesto.inicioY);
            gesto.alterou = true;
            renderizar();
        } else if (gesto.tipo === "draw") {
            const item = elementoPorId(gesto.id);
            const ponto = coordenada(evento);
            const ultimo = item?.payload.points?.at(-1);
            if (item && (!ultimo || Math.hypot(ponto.x - ultimo.x, ponto.y - ultimo.y) > 3)) {
                item.payload.points.push({ x: Math.round(ponto.x), y: Math.round(ponto.y) });
                renderizar();
            }
        } else if (gesto.tipo === "erase") {
            atualizarCursorBorracha(pontoAtual);
            apagarComHistorico(pontoAtual);
        }
    }

    function aoPointerUp(evento) {
        if (!gesto) return;
        const terminou = gesto;
        gesto = null;
        dom.stage.classList.remove("is-dragging");
        if (dom.stage.hasPointerCapture(evento.pointerId)) dom.stage.releasePointerCapture(evento.pointerId);
        if (terminou.tipo === "pan") marcarAlterado();
        if (terminou.tipo === "move" && terminou.alterou) marcarAlterado();
        if (terminou.tipo === "erase" && terminou.alterou) marcarAlterado();
        if (terminou.tipo === "draw") {
            const traco = elementoPorId(terminou.id);
            if (!traco || traco.payload.points.length < 2) elementos = elementos.filter(item => item.id !== terminou.id);
            else marcarAlterado();
            selecionarFerramenta("select");
        }
        renderizar();
    }

    async function editarTexto(evento) {
        const alvo = evento.target.closest?.(".mind-map-element");
        const item = alvo ? elementoPorId(alvo.dataset.mindId) : null;
        if (!item || !["node", "shape"].includes(item.type)) return;
        const novo = await solicitarTexto({ titulo: "Editar texto", ajuda: "Atualize o conteúdo deste elemento.", valor: item.payload.text || "", confirmar: "Salvar" });
        if (novo == null || novo.trim() === item.payload.text) return;
        registrarHistorico();
        item.payload.text = novo.trim() || "Sem título";
        marcarAlterado();
        renderizar();
    }

    function criarCardMapa(item) {
        const card = document.createElement("article");
        card.className = "mind-map-card";
        const icone = document.createElement("span");
        icone.className = "mind-map-card-icon";
        icone.innerHTML = '<i class="bi-diagram-3"></i>';
        const titulo = document.createElement("h3");
        titulo.className = "h6 fw-bold";
        titulo.textContent = item.nome;
        const descricao = document.createElement("p");
        descricao.textContent = item.descricao || "Um espaço visual livre para organizar esta matéria.";
        const meta = document.createElement("span");
        meta.className = "mind-map-card-meta";
        meta.textContent = `Atualizado em ${new Date(item.atualizadoEm).toLocaleDateString("pt-BR")}`;
        const acoes = document.createElement("div");
        acoes.className = "mind-map-card-actions";
        const abrir = document.createElement("button");
        abrir.type = "button";
        abrir.className = "btn btn-sm btn-primary flex-grow-1";
        abrir.innerHTML = '<i class="bi-arrow-up-right me-1"></i>Abrir mapa';
        abrir.addEventListener("click", () => { void abrirMapa(item.id); });
        acoes.appendChild(abrir);
        card.append(icone, titulo, descricao, meta, acoes);
        return card;
    }

    function renderizarBiblioteca() {
        dom.lista.replaceChildren();
        if (!mapas.length) {
            const vazio = document.createElement("div");
            vazio.className = "mind-map-empty-library";
            vazio.innerHTML = '<i class="bi-diagram-3"></i><strong>Nenhum mapa nesta matéria</strong><span>Crie uma tela livre para conectar conceitos, origens e consequências.</span>';
            dom.lista.appendChild(vazio);
            return;
        }
        mapas.forEach(item => dom.lista.appendChild(criarCardMapa(item)));
    }

    async function carregarBiblioteca() {
        if (!materiaId) return;
        const token = ++carregamentoToken;
        definirStatusBiblioteca("Carregando seus mapas…");
        dom.novo.disabled = true;
        try {
            const recebidos = await repositorio.listar(materiaId);
            if (token !== carregamentoToken) return;
            mapas = recebidos;
            renderizarBiblioteca();
            definirStatusBiblioteca(mapas.length ? `${mapas.length} mapa(s) privado(s) nesta matéria.` : "Seus mapas serão privados e salvos no Supabase.");
        } catch (erro) {
            console.error("Falha ao carregar mapas mentais", erro);
            if (token === carregamentoToken) definirStatusBiblioteca("Os mapas mentais ainda não puderam ser carregados. Confirme a atualização do banco.", true);
        } finally {
            if (token === carregamentoToken) dom.novo.disabled = false;
        }
    }

    async function novoMapa() {
        if (!materiaId) return;
        dom.novo.disabled = true;
        definirStatusBiblioteca("Criando seu espaço visual…");
        try {
            const criado = await repositorio.criar(materiaId, { id: uuid(), nome: `Mapa de ${materiaNome || "estudos"}`, descricao: "" });
            mapas.unshift(criado);
            await abrirMapa(criado.id, criado);
        } catch (erro) {
            console.error("Falha ao criar mapa mental", erro);
            definirStatusBiblioteca("Não foi possível criar o mapa. Confirme a conexão e tente novamente.", true);
        } finally {
            dom.novo.disabled = false;
        }
    }

    async function abrirMapa(id, jaCarregado = null) {
        definirStatus("Abrindo…", "is-saving");
        dom.biblioteca.classList.add("d-none");
        dom.editor.classList.remove("d-none");
        try {
            mapa = jaCarregado?.elementos ? jaCarregado : await repositorio.carregar(id);
            elementos = copiar(mapa.elementos || []);
            viewport = { x: Number(mapa.viewport?.x) || 0, y: Number(mapa.viewport?.y) || 0, zoom: limitar(Number(mapa.viewport?.zoom) || 1, .25, 2.5) };
            dom.titulo.value = mapa.nome;
            historico = [];
            futuros = [];
            selecionadoId = null;
            origemConexaoId = null;
            sujo = false;
            definirStatus("Salvo no Supabase");
            selecionarFerramenta("select");
            renderizar();
        } catch (erro) {
            console.error("Falha ao abrir mapa mental", erro);
            mapa = null;
            dom.editor.classList.add("d-none");
            dom.biblioteca.classList.remove("d-none");
            definirStatusBiblioteca("Não foi possível abrir este mapa.", true);
        }
    }

    async function voltarBiblioteca() {
        if (!await salvarAgora()) return;
        mapa = null;
        elementos = [];
        clearTimeout(timerSalvar);
        dom.editor.classList.add("d-none");
        dom.biblioteca.classList.remove("d-none");
        await carregarBiblioteca();
    }

    async function atualizarTitulo() {
        if (!mapa) return;
        const nome = dom.titulo.value.trim();
        if (!nome) { dom.titulo.value = mapa.nome; return; }
        if (nome === mapa.nome) return;
        if (!await salvarAgora()) { dom.titulo.value = mapa.nome; return; }
        definirStatus("Salvando nome…", "is-saving");
        try {
            const atualizado = await repositorio.atualizar(mapa.id, { nome }, mapa.versao);
            Object.assign(mapa, atualizado);
            definirStatus("Salvo no Supabase");
        } catch (erro) {
            console.error("Falha ao renomear mapa mental", erro);
            dom.titulo.value = mapa.nome;
            definirStatus("Nome não foi salvo", "is-error");
        }
    }

    async function excluirMapaAtual() {
        if (!mapa || !await solicitarConfirmacao(`Excluir o mapa “${mapa.nome}”? Esta ação removerá também todos os seus elementos.`)) return;
        dom.excluirMapa.disabled = true;
        try {
            await repositorio.excluir(mapa.id);
            mapa = null;
            elementos = [];
            dom.editor.classList.add("d-none");
            dom.biblioteca.classList.remove("d-none");
            await carregarBiblioteca();
        } catch (erro) {
            console.error("Falha ao excluir mapa mental", erro);
            definirStatus("Não foi possível excluir", "is-error");
        } finally {
            dom.excluirMapa.disabled = false;
        }
    }

    function aoTeclado(evento) {
        if (!mapa || !dom.editor.contains(document.activeElement)) return;
        const digitando = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
        if (digitando) return;
        if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === "z") { evento.preventDefault(); evento.shiftKey ? refazer() : desfazer(); }
        else if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === "y") { evento.preventDefault(); refazer(); }
        else if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === "d") { evento.preventDefault(); duplicarSelecionado(); }
        else if (evento.key.toLowerCase() === "l") { evento.preventDefault(); alternarFixacao(); }
        else if (evento.key === "Escape") { selecionadoId = null; origemConexaoId = null; renderizar(); }
        else if (["Delete", "Backspace"].includes(evento.key)) { evento.preventDefault(); excluirSelecionado(); }
    }

    dom.ferramentas.forEach(botao => botao.addEventListener("click", () => selecionarFerramenta(botao.dataset.mindTool)));
    dom.novo.addEventListener("click", () => { void novoMapa(); });
    dom.voltar.addEventListener("click", () => { void voltarBiblioteca(); });
    dom.excluirMapa.addEventListener("click", () => { void excluirMapaAtual(); });
    dom.titulo.addEventListener("change", () => { void atualizarTitulo(); });
    dom.undo.addEventListener("click", desfazer);
    dom.redo.addEventListener("click", refazer);
    dom.duplicar.addEventListener("click", duplicarSelecionado);
    dom.frente.addEventListener("click", trazerParaFrente);
    dom.fixar.addEventListener("click", alternarFixacao);
    dom.excluir.addEventListener("click", excluirSelecionado);
    dom.cor.addEventListener("change", aplicarCor);
    dom.estiloLinha.addEventListener("change", aplicarEstiloLinha);
    dom.borrachaTamanho.addEventListener("input", () => {
        dom.borrachaLabel.textContent = dom.borrachaTamanho.value;
        dom.borrachaCursor.setAttribute("r", String(Number(dom.borrachaTamanho.value) / 2));
    });
    dom.zoomMenos.addEventListener("click", () => zoom(viewport.zoom - .15));
    dom.zoomMais.addEventListener("click", () => zoom(viewport.zoom + .15));
    dom.enquadrar.addEventListener("click", enquadrar);
    dom.textoForm.addEventListener("submit", evento => {
        evento.preventDefault();
        const texto = dom.textoInput.value.trim();
        if (!texto) { dom.textoInput.focus(); return; }
        fecharEditorTexto(texto);
    });
    dom.textoCancelar.addEventListener("click", () => fecharEditorTexto(null));
    dom.textoDialog.addEventListener("click", evento => { if (evento.target === dom.textoDialog) fecharEditorTexto(null); });
    dom.textoDialog.addEventListener("keydown", evento => { if (evento.key === "Escape") { evento.preventDefault(); fecharEditorTexto(null); } });
    dom.confirmDelete.addEventListener("click", () => fecharConfirmacao(true));
    dom.confirmCancel.addEventListener("click", () => fecharConfirmacao(false));
    dom.confirmDialog.addEventListener("click", evento => { if (evento.target === dom.confirmDialog) fecharConfirmacao(false); });
    dom.confirmDialog.addEventListener("keydown", evento => { if (evento.key === "Escape") { evento.preventDefault(); fecharConfirmacao(false); } });
    dom.canvas.addEventListener("pointerdown", aoPointerDown);
    dom.canvas.addEventListener("pointermove", aoPointerMove);
    dom.canvas.addEventListener("pointerup", aoPointerUp);
    dom.canvas.addEventListener("pointercancel", aoPointerUp);
    dom.canvas.addEventListener("pointerleave", () => { if (!gesto && ferramenta === "eraser") dom.borrachaCursor.setAttribute("visibility", "hidden"); });
    dom.canvas.addEventListener("dblclick", editarTexto);
    dom.stage.addEventListener("wheel", evento => {
        if (!mapa) return;
        evento.preventDefault();
        const caixa = dom.stage.getBoundingClientRect();
        zoom(viewport.zoom + (evento.deltaY < 0 ? .1 : -.1), { x: evento.clientX - caixa.left, y: evento.clientY - caixa.top });
    }, { passive: false });
    dom.tab.addEventListener("shown.bs.tab", () => { void carregarBiblioteca(); });
    document.addEventListener("keydown", aoTeclado);

    return Object.freeze({
        definirMateria(id, nome) {
            const mudou = String(materiaId || "") !== String(id || "");
            materiaId = id || null;
            materiaNome = String(nome || "");
            if (mudou) {
                carregamentoToken += 1;
                mapa = null;
                mapas = [];
                elementos = [];
                dom.editor.classList.add("d-none");
                dom.biblioteca.classList.remove("d-none");
                renderizarBiblioteca();
            }
            if (dom.tab.classList.contains("active")) void carregarBiblioteca();
        },
        async salvarPendente() { return salvarAgora(); },
        temPendente() { return sujo || Boolean(salvamento); },
        encerrar() {
            carregamentoToken += 1;
            clearTimeout(timerSalvar);
            materiaId = null;
            materiaNome = "";
            mapas = [];
            mapa = null;
            elementos = [];
            sujo = false;
            dom.editor.classList.add("d-none");
            dom.biblioteca.classList.remove("d-none");
            renderizarBiblioteca();
        }
    });
}
