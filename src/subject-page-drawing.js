const SVG_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";
const LIMITE_HISTORICO = 50;
const TAMANHOS_PAGINA = Object.freeze({
    standard: { largura: 1200, altura: 800 },
    portrait: { largura: 1200, altura: 1697 },
    square: { largura: 1200, altura: 1200 },
    wide: { largura: 1600, altura: 900 }
});
const copiar = valor => JSON.parse(JSON.stringify(valor));
let carregamentoPdfJs = null;
export const carregarPdfJs = () => {
    if (!carregamentoPdfJs) carregamentoPdfJs = Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url")
    ]).then(([pdfjs, worker]) => {
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        return pdfjs;
    });
    return carregamentoPdfJs;
};
const limitar = (valor, minimo, maximo) => Math.min(maximo, Math.max(minimo, valor));
const svgEl = (nome, atributos = {}) => {
    const elemento = document.createElementNS(SVG_NS, nome);
    Object.entries(atributos).forEach(([chave, valor]) => elemento.setAttribute(chave, String(valor)));
    return elemento;
};

function distanciaSegmento(ponto, inicio, fim) {
    const dx = fim.x - inicio.x;
    const dy = fim.y - inicio.y;
    if (!dx && !dy) return Math.hypot(ponto.x - inicio.x, ponto.y - inicio.y);
    const t = limitar(((ponto.x - inicio.x) * dx + (ponto.y - inicio.y) * dy) / (dx * dx + dy * dy), 0, 1);
    return Math.hypot(ponto.x - (inicio.x + t * dx), ponto.y - (inicio.y + t * dy));
}

function limitesDosTracos(tracos) {
    const pontos = tracos.flatMap(traco => traco.points || []);
    if (!pontos.length) return null;
    const xs = pontos.map(ponto => ponto.x);
    const ys = pontos.map(ponto => ponto.y);
    const esquerda = Math.min(...xs);
    const direita = Math.max(...xs);
    const topo = Math.min(...ys);
    const base = Math.max(...ys);
    return { esquerda, direita, topo, base, largura: Math.max(1, direita - esquerda), altura: Math.max(1, base - topo) };
}

function retangulosSeTocam(a, b) {
    return a.esquerda <= b.direita && a.direita >= b.esquerda && a.topo <= b.base && a.base >= b.topo;
}

function pontosDaForma(tipo, inicio, fim) {
    if (tipo === "line") return [inicio, fim];
    if (tipo === "rectangle") return [inicio, { x: fim.x, y: inicio.y }, fim, { x: inicio.x, y: fim.y }, inicio];
    if (tipo === "ellipse") {
        const centro = { x: (inicio.x + fim.x) / 2, y: (inicio.y + fim.y) / 2 };
        const raioX = Math.abs(fim.x - inicio.x) / 2;
        const raioY = Math.abs(fim.y - inicio.y) / 2;
        return Array.from({ length: 33 }, (_, indice) => {
            const angulo = (Math.PI * 2 * indice) / 32;
            return { x: centro.x + Math.cos(angulo) * raioX, y: centro.y + Math.sin(angulo) * raioY };
        });
    }
    if (tipo === "arrow") {
        const angulo = Math.atan2(fim.y - inicio.y, fim.x - inicio.x);
        const ponta = Math.min(28, Math.max(10, Math.hypot(fim.x - inicio.x, fim.y - inicio.y) * .28));
        const esquerda = { x: fim.x - ponta * Math.cos(angulo - .55), y: fim.y - ponta * Math.sin(angulo - .55) };
        const direita = { x: fim.x - ponta * Math.cos(angulo + .55), y: fim.y - ponta * Math.sin(angulo + .55) };
        return [inicio, fim, esquerda, fim, direita];
    }
    return [inicio, fim];
}

export function criarDesenhoPagina(container, dadosIniciais, aoAlterar, aoAcaoTexto = () => {}, opcoes = {}) {
    const svg = container.querySelector("[data-page-drawing-canvas]");
    const camadaFundo = container.querySelector("[data-page-drawing-background]");
    const camada = container.querySelector("[data-page-drawing-strokes]");
    const camadaSelecao = container.querySelector("[data-page-drawing-selection]");
    const cursor = container.querySelector("[data-page-drawing-eraser-cursor]");
    const ferramentas = [...container.querySelectorAll("[data-page-drawing-tool]")];
    const cor = container.querySelector("[data-page-drawing-color]");
    const tamanho = container.querySelector("[data-page-drawing-size]");
    const tamanhoSaida = container.querySelector("[data-page-drawing-size-output]");
    const seletorPagina = container.querySelector("[data-page-drawing-page-size]");
    const botoesZoom = [...container.querySelectorAll("[data-page-drawing-zoom]")];
    const zoomSaida = container.querySelector("[data-page-drawing-zoom-output]");
    const controlesVisualizacao = document.createElement("div");
    controlesVisualizacao.className = "subject-page-drawing-viewport-controls";
    controlesVisualizacao.setAttribute("aria-label", "Tamanho e zoom da página");
    const controleTamanhoPagina = seletorPagina?.closest(".subject-page-drawing-page-size");
    const controleZoomPagina = zoomSaida?.closest(".subject-page-drawing-zoom");
    if (controleTamanhoPagina) controlesVisualizacao.append(controleTamanhoPagina);
    if (controleZoomPagina) controlesVisualizacao.append(controleZoomPagina);
    container.append(controlesVisualizacao);
    const menuEstudoTexto = document.createElement("div");
    menuEstudoTexto.className = "subject-page-drawing-text-action-menu";
    menuEstudoTexto.dataset.pageDrawingTextActionMenu = "";
    menuEstudoTexto.hidden = true;
    menuEstudoTexto.setAttribute("role", "toolbar");
    menuEstudoTexto.setAttribute("aria-label", "Ações para o texto selecionado");
    menuEstudoTexto.innerHTML = `<button type="button" data-page-drawing-study-action="flashcard" title="Criar flashcard" aria-label="Criar flashcard com o trecho"><i class="bi-card-heading"></i><span>Flashcard</span></button><button type="button" data-page-drawing-study-action="summary" title="Criar resumo" aria-label="Criar resumo com o trecho"><i class="bi-journal-text"></i><span>Resumo</span></button><button type="button" data-page-drawing-study-action="review" title="Planejar revisão" aria-label="Planejar revisão deste trecho"><i class="bi-arrow-repeat"></i><span>Revisão</span></button><button type="button" data-page-drawing-study-action="quiz" title="Gerar questões" aria-label="Gerar questões com o trecho"><i class="bi-patch-question"></i><span>Questões</span></button>`;
    document.body.append(menuEstudoTexto);
    const formatacaoTexto = document.createElement("div");
    formatacaoTexto.className = "subject-page-drawing-text-format";
    formatacaoTexto.dataset.pageDrawingTextFormat = "";
    formatacaoTexto.hidden = true;
    formatacaoTexto.innerHTML = `<label title="Tamanho da letra"><i class="bi-type"></i><select data-page-drawing-font-size aria-label="Tamanho da letra"><option value="14">14</option><option value="18">18</option><option value="22">22</option><option value="26">26</option><option value="32">32</option><option value="40">40</option><option value="48">48</option><option value="64">64</option></select></label><button type="button" data-page-drawing-text-style="bold" title="Negrito" aria-label="Negrito" aria-pressed="false"><i class="bi-type-bold"></i></button><button type="button" data-page-drawing-text-style="italic" title="Itálico" aria-label="Itálico" aria-pressed="false"><i class="bi-type-italic"></i></button><button type="button" data-page-drawing-text-align="left" title="Alinhar à esquerda" aria-label="Alinhar à esquerda" aria-pressed="false"><i class="bi-text-left"></i></button><button type="button" data-page-drawing-text-align="center" title="Centralizar" aria-label="Centralizar" aria-pressed="false"><i class="bi-text-center"></i></button><button type="button" data-page-drawing-text-align="right" title="Alinhar à direita" aria-label="Alinhar à direita" aria-pressed="false"><i class="bi-text-right"></i></button><button type="button" data-page-drawing-text-list="bullet" title="Lista com marcadores" aria-label="Lista com marcadores"><i class="bi-list-ul"></i></button><button type="button" data-page-drawing-text-list="number" title="Lista numerada" aria-label="Lista numerada"><i class="bi-list-ol"></i></button>`;
    container.querySelector(".subject-notebook-editor-spacer")?.before(formatacaoTexto);
    const tamanhoFonte = formatacaoTexto.querySelector("[data-page-drawing-font-size]");
    const estilosTexto = [...formatacaoTexto.querySelectorAll("[data-page-drawing-text-style]")];
    const alinhamentosTexto = [...formatacaoTexto.querySelectorAll("[data-page-drawing-text-align]")];
    const listasTexto = [...formatacaoTexto.querySelectorAll("[data-page-drawing-text-list]")];
    const grifarTextoBotao = container.querySelector("[data-page-drawing-highlight-text]");
    const editarTextoBotao = container.querySelector("[data-page-drawing-edit-text]");
    const duplicarBotao = container.querySelector("[data-page-drawing-duplicate]");
    const excluirBotao = container.querySelector("[data-page-drawing-delete]");
    const desfazerBotao = container.querySelector("[data-page-drawing-undo]");
    const refazerBotao = container.querySelector("[data-page-drawing-redo]");
    const limparBotao = container.querySelector("[data-page-drawing-clear]");
    const adicionarImagemBotao = container.querySelector("[data-page-drawing-add-image]");
    const imagemInput = container.querySelector("[data-page-drawing-image-input]");
    const adicionarPdfBotao = container.querySelector("[data-page-drawing-add-pdf]");
    const pdfInput = container.querySelector("[data-page-drawing-pdf-input]");
    const controlesPdf = document.createElement("div");
    controlesPdf.className = "subject-page-drawing-pdf-controls";
    controlesPdf.hidden = true;
    controlesPdf.innerHTML = `<span title="PDF usado como fundo"><i class="bi-file-earmark-pdf"></i><strong data-page-drawing-pdf-name>PDF</strong><i class="bi-lock-fill subject-page-drawing-pdf-lock" title="Fundo bloqueado" aria-label="Fundo bloqueado"></i></span><button type="button" data-page-drawing-pdf-step="-1" title="Página anterior" aria-label="Página anterior do PDF"><i class="bi-chevron-left"></i></button><output data-page-drawing-pdf-page aria-live="polite">1 / 1</output><button type="button" data-page-drawing-pdf-step="1" title="Próxima página" aria-label="Próxima página do PDF"><i class="bi-chevron-right"></i></button><button class="is-danger" type="button" data-page-drawing-pdf-remove title="Remover fundo" aria-label="Remover PDF do fundo"><i class="bi-x-lg"></i></button>`;
    container.append(controlesPdf);
    const nomePdf = controlesPdf.querySelector("[data-page-drawing-pdf-name]");
    const paginaPdfSaida = controlesPdf.querySelector("[data-page-drawing-pdf-page]");
    const passosPdf = [...controlesPdf.querySelectorAll("[data-page-drawing-pdf-step]")];
    const removerPdfBotao = controlesPdf.querySelector("[data-page-drawing-pdf-remove]");
    let tracos = Array.isArray(dadosIniciais?.strokes) ? copiar(dadosIniciais.strokes) : [];
    let fundoPdf = dadosIniciais?.background?.type === "pdf" ? copiar(dadosIniciais.background) : null;
    if (fundoPdf) delete fundoPdf.src;
    if (fundoPdf) {
        fundoPdf.annotations = fundoPdf.annotations && typeof fundoPdf.annotations === "object" ? fundoPdf.annotations : {};
        const salvosDaPagina = fundoPdf.annotations[String(Number(fundoPdf.page) || 1)];
        if (Array.isArray(salvosDaPagina)) tracos = copiar(salvosDaPagina);
    }
    let documentoPdf = null;
    let urlRenderizadaPdf = "";
    let geracaoRenderPdf = 0;
    let ferramenta = "pen";
    let gesto = null;
    let selecionados = new Set();
    let historico = [];
    let futuros = [];
    let textoEmEdicaoId = null;
    let textoAntesEdicao = null;
    let ultimoCliqueTexto = { id: null, instante: 0 };
    let selecaoTexto = null;
    let selecaoEstudoPendente = null;
    let tamanhoPagina = TAMANHOS_PAGINA[dadosIniciais?.pageSize] ? dadosIniciais.pageSize : "standard";
    let zoomPagina = fundoPdf ? 75 : 100;

    function aplicarVisualizacaoPagina() {
        const dimensoes = TAMANHOS_PAGINA[tamanhoPagina];
        svg.setAttribute("viewBox", `0 0 ${dimensoes.largura} ${dimensoes.altura}`);
        svg.style.setProperty("--drawing-page-ratio", `${dimensoes.largura} / ${dimensoes.altura}`);
        svg.style.setProperty("--drawing-page-zoom", String(zoomPagina / 100));
        if (seletorPagina) seletorPagina.value = tamanhoPagina;
        if (zoomSaida) zoomSaida.textContent = `${zoomPagina}%`;
        botoesZoom.forEach(botao => {
            if (botao.dataset.pageDrawingZoom === "out") botao.disabled = zoomPagina <= 50;
            if (botao.dataset.pageDrawingZoom === "in") botao.disabled = zoomPagina >= 200;
        });
        renderizarFundoPdf();
    }

    function alterarZoom(direcao) {
        if (direcao === "fit") zoomPagina = fundoPdf ? 75 : 100;
        else zoomPagina = limitar(zoomPagina + (direcao === "in" ? 25 : -25), 50, 200);
        aplicarVisualizacaoPagina();
    }

    function pontoDoEvento(evento) {
        const ponto = svg.createSVGPoint();
        ponto.x = evento.clientX;
        ponto.y = evento.clientY;
        const transformacao = svg.getScreenCTM()?.inverse();
        const convertido = transformacao ? ponto.matrixTransform(transformacao) : ponto;
        return { x: Math.round(convertido.x * 10) / 10, y: Math.round(convertido.y * 10) / 10 };
    }

    function caminhoDosPontos(pontos) {
        if (!pontos.length) return "";
        if (pontos.length === 1) return `M ${pontos[0].x} ${pontos[0].y} l .1 .1`;
        return pontos.map((ponto, indice) => `${indice ? "L" : "M"} ${ponto.x} ${ponto.y}`).join(" ");
    }

    const tracosSelecionados = () => tracos.filter(traco => selecionados.has(traco.id));

    function atualizarBotoes() {
        selecionados = new Set([...selecionados].filter(id => tracos.some(traco => traco.id === id)));
        const unicoSelecionado = selecionados.size === 1 ? tracos.find(traco => selecionados.has(traco.id)) : null;
        const textoSelecionado = unicoSelecionado?.tool === "text" ? unicoSelecionado : null;
        formatacaoTexto.hidden = !textoSelecionado;
        if (textoSelecionado) {
            const tamanhos = [14, 18, 22, 26, 32, 40, 48, 64];
            tamanhoFonte.value = String(tamanhos.reduce((maisProximo, atual) => Math.abs(atual - (Number(textoSelecionado.fontSize) || 26)) < Math.abs(maisProximo - (Number(textoSelecionado.fontSize) || 26)) ? atual : maisProximo, 26));
            estilosTexto.forEach(botao => botao.setAttribute("aria-pressed", String(botao.dataset.pageDrawingTextStyle === "bold" ? textoSelecionado.fontWeight === "bold" : textoSelecionado.fontStyle === "italic")));
            alinhamentosTexto.forEach(botao => botao.setAttribute("aria-pressed", String((textoSelecionado.textAlign || "left") === botao.dataset.pageDrawingTextAlign)));
        }
        editarTextoBotao.disabled = unicoSelecionado?.tool !== "text";
        grifarTextoBotao.disabled = !textoEmEdicaoId || !selecaoTexto || selecaoTexto.inicio === selecaoTexto.fim;
        if (grifarTextoBotao.disabled) menuEstudoTexto.hidden = true;
        duplicarBotao.disabled = !selecionados.size;
        excluirBotao.disabled = !selecionados.size;
        desfazerBotao.disabled = !historico.length;
        refazerBotao.disabled = !futuros.length;
        limparBotao.disabled = !tracos.length;
    }

    function renderizarSelecao() {
        const elementos = [];
        if (ferramenta === "select" && selecionados.size) {
            const limites = limitesDosTracos(tracosSelecionados());
            if (limites) {
                const margem = 9;
                elementos.push(svgEl("rect", { x: limites.esquerda - margem, y: limites.topo - margem, width: limites.largura + margem * 2, height: limites.altura + margem * 2, rx: 5, class: "subject-page-drawing-selection-box" }));
                const textoSelecionado = selecionados.size === 1 ? tracosSelecionados()[0] : null;
                if (textoSelecionado?.tool === "text") {
                    const x1 = limites.esquerda - margem;
                    const x2 = limites.direita + margem;
                    const y1 = limites.topo - margem;
                    const y2 = limites.base + margem;
                    const xm = (x1 + x2) / 2;
                    const ym = (y1 + y2) / 2;
                    [
                        ["nw", x1, y1], ["n", xm, y1], ["ne", x2, y1], ["e", x2, ym],
                        ["se", x2, y2], ["s", xm, y2], ["sw", x1, y2], ["w", x1, ym]
                    ].forEach(([direcao, cx, cy]) => elementos.push(svgEl("circle", {
                        cx, cy, r: 4.5, class: `subject-page-drawing-resize-handle is-${direcao}`,
                        "data-page-drawing-resize": direcao
                    })));
                } else elementos.push(svgEl("circle", { cx: limites.direita + margem, cy: limites.base + margem, r: 6, class: "subject-page-drawing-resize-handle is-se", "data-page-drawing-resize": "se" }));
            }
        }
        if (gesto?.tipo === "text-box") {
            const esquerda = Math.min(gesto.inicio.x, gesto.atual.x);
            const topo = Math.min(gesto.inicio.y, gesto.atual.y);
            elementos.push(svgEl("rect", {
                x: esquerda, y: topo, width: Math.abs(gesto.atual.x - gesto.inicio.x), height: Math.abs(gesto.atual.y - gesto.inicio.y),
                rx: 5, class: "subject-page-drawing-text-box-preview"
            }));
        }
        if (gesto?.tipo === "lasso") {
            elementos.push(svgEl("rect", {
                x: Math.min(gesto.inicio.x, gesto.atual.x), y: Math.min(gesto.inicio.y, gesto.atual.y),
                width: Math.abs(gesto.atual.x - gesto.inicio.x), height: Math.abs(gesto.atual.y - gesto.inicio.y),
                class: "subject-page-drawing-lasso"
            }));
        }
        camadaSelecao.replaceChildren(...elementos);
    }

    function elementoDoTraco(traco) {
        if (traco.tool === "image") {
            const limites = limitesDosTracos([traco]) || { esquerda: 0, topo: 0, largura: 320, altura: 220 };
            if (!traco.src) {
                const grupo = svgEl("g", { class: "subject-page-drawing-image-placeholder", "data-stroke-id": traco.id });
                grupo.append(svgEl("rect", { x: limites.esquerda, y: limites.topo, width: limites.largura, height: limites.altura, rx: 10 }));
                const rotulo = svgEl("text", { x: limites.esquerda + limites.largura / 2, y: limites.topo + limites.altura / 2 });
                rotulo.textContent = traco.imageError ? "Imagem indisponível" : "Carregando imagem…";
                grupo.append(rotulo);
                return grupo;
            }
            return svgEl("image", {
                x: limites.esquerda, y: limites.topo, width: limites.largura, height: limites.altura,
                href: traco.src, preserveAspectRatio: "none",
                class: `subject-page-drawing-image${selecionados.has(traco.id) ? " is-selected" : ""}`,
                "data-stroke-id": traco.id
            });
        }
        if (traco.tool !== "text") return svgEl("path", {
            d: caminhoDosPontos(traco.points || []), fill: "none", stroke: traco.color || "#3b2923",
            "stroke-width": limitar(Number(traco.width) || 3, 1, 40), "stroke-linecap": "round", "stroke-linejoin": "round",
            opacity: traco.tool === "highlighter" ? .28 : 1, class: selecionados.has(traco.id) ? "is-selected" : "", "data-stroke-id": traco.id
        });
        const limites = limitesDosTracos([traco]) || { esquerda: 0, topo: 0, largura: 240, altura: 80 };
        const editando = textoEmEdicaoId === traco.id;
        const elemento = svgEl("foreignObject", {
            x: limites.esquerda, y: limites.topo, width: Math.max(80, limites.largura), height: Math.max(42, limites.altura),
            class: `subject-page-drawing-text${selecionados.has(traco.id) ? " is-selected" : ""}`, "data-stroke-id": traco.id
        });
        const conteudo = document.createElementNS(XHTML_NS, "div");
        conteudo.className = "subject-page-drawing-text-content";
        conteudo.dataset.strokeId = traco.id;
        const texto = traco.text || "Texto";
        const marcas = (Array.isArray(traco.highlights) ? traco.highlights : [])
            .map(marca => ({ inicio: limitar(Number(marca.inicio) || 0, 0, texto.length), fim: limitar(Number(marca.fim) || 0, 0, texto.length), color: /^#[0-9a-f]{6}$/i.test(marca.color || "") ? marca.color : "#ffe58f" }))
            .filter(marca => marca.fim > marca.inicio)
            .sort((a, b) => a.inicio - b.inicio);
        const limitesMarcas = [...new Set([0, texto.length, ...marcas.flatMap(marca => [marca.inicio, marca.fim])])].sort((a, b) => a - b);
        limitesMarcas.slice(0, -1).forEach((inicio, indice) => {
            const fim = limitesMarcas[indice + 1];
            const trecho = texto.slice(inicio, fim);
            if (!trecho) return;
            const marcada = [...marcas].reverse().find(marca => marca.inicio <= inicio && marca.fim >= fim);
            if (!marcada) { conteudo.append(document.createTextNode(trecho)); return; }
            const marca = document.createElementNS(XHTML_NS, "mark");
            marca.className = "subject-page-drawing-text-highlight";
            marca.style.backgroundColor = marcada.color;
            marca.textContent = trecho;
            conteudo.append(marca);
        });
        conteudo.style.setProperty("--drawing-text-color", traco.color || "#3b2923");
        conteudo.style.setProperty("--drawing-text-size", `${limitar(Number(traco.fontSize) || 26, 12, 120)}px`);
        conteudo.style.setProperty("--drawing-text-weight", traco.fontWeight === "bold" ? "800" : "600");
        conteudo.style.setProperty("--drawing-text-style", traco.fontStyle === "italic" ? "italic" : "normal");
        conteudo.style.setProperty("--drawing-text-align", ["left", "center", "right"].includes(traco.textAlign) ? traco.textAlign : "left");
        if (editando) {
            conteudo.setAttribute("contenteditable", "true");
            conteudo.setAttribute("role", "textbox");
            conteudo.setAttribute("aria-label", "Editar caixa de texto");
            conteudo.addEventListener("pointerdown", evento => evento.stopPropagation());
            conteudo.addEventListener("input", () => {
                const anterior = String(traco.text || "");
                const novo = conteudo.innerText.slice(0, 4000);
                if (novo !== anterior) traco.highlights = ajustarGrifosAposEdicao(anterior, novo, traco.highlights);
                traco.text = novo;
                selecaoTexto = null;
                selecaoEstudoPendente = null;
                menuEstudoTexto.hidden = true;
                ajustarCaixaTextoAoConteudo(traco, conteudo, elemento);
                atualizarBotoes();
            });
            conteudo.addEventListener("keyup", () => guardarSelecaoTexto(conteudo));
            conteudo.addEventListener("pointerup", () => guardarSelecaoTexto(conteudo));
            conteudo.addEventListener("blur", () => { menuEstudoTexto.hidden = true; finalizarEdicaoTexto(false); }, { once: true });
            conteudo.addEventListener("keydown", evento => {
                if (evento.key === "Escape") { evento.preventDefault(); finalizarEdicaoTexto(true); }
                if (evento.key === "Enter" && (evento.ctrlKey || evento.metaKey)) { evento.preventDefault(); conteudo.blur(); }
            });
            queueMicrotask(() => {
                conteudo.focus();
                const selecao = window.getSelection();
                const intervalo = document.createRange();
                intervalo.selectNodeContents(conteudo); intervalo.collapse(false);
                selecao?.removeAllRanges(); selecao?.addRange(intervalo);
            });
        }
        elemento.append(conteudo);
        return elemento;
    }

    function atualizarControlesPdf() {
        controlesPdf.hidden = !fundoPdf;
        if (!fundoPdf) return;
        const atual = limitar(Number(fundoPdf.page) || 1, 1, Math.max(1, Number(fundoPdf.totalPages) || 1));
        const total = Math.max(atual, Number(fundoPdf.totalPages) || 1);
        nomePdf.textContent = fundoPdf.name || "Documento PDF";
        paginaPdfSaida.textContent = fundoPdf.loading ? "Carregando…" : `${atual} / ${total}`;
        passosPdf.forEach(botao => {
            botao.hidden = Boolean(fundoPdf.fixedPage);
            const direcao = Number(botao.dataset.pageDrawingPdfStep);
            botao.disabled = fundoPdf.loading || (direcao < 0 ? atual <= 1 : atual >= total);
        });
    }

    function renderizarFundoPdf() {
        if (!camadaFundo) return;
        if (!fundoPdf) {
            camadaFundo.replaceChildren();
            atualizarControlesPdf();
            return;
        }
        const dimensoes = TAMANHOS_PAGINA[tamanhoPagina];
        if (urlRenderizadaPdf) {
            camadaFundo.replaceChildren(svgEl("image", {
                x: 0, y: 0, width: dimensoes.largura, height: dimensoes.altura,
                href: urlRenderizadaPdf, preserveAspectRatio: "xMidYMid meet",
                class: "subject-page-drawing-pdf-background"
            }));
        } else {
            const grupo = svgEl("g", { class: "subject-page-drawing-pdf-placeholder" });
            grupo.append(svgEl("rect", { x: 0, y: 0, width: dimensoes.largura, height: dimensoes.altura }));
            const texto = svgEl("text", { x: dimensoes.largura / 2, y: dimensoes.altura / 2 });
            texto.textContent = fundoPdf.loading ? "Preparando página do PDF…" : "PDF indisponível";
            grupo.append(texto);
            camadaFundo.replaceChildren(grupo);
        }
        atualizarControlesPdf();
    }

    function canvasParaUrl(canvas) {
        return new Promise((resolver, rejeitar) => canvas.toBlob(blob => {
            if (!blob) { rejeitar(new Error("Não foi possível preparar a página do PDF.")); return; }
            resolver(URL.createObjectURL(blob));
        }, "image/png"));
    }

    async function renderizarPaginaPdf() {
        if (!fundoPdf || !documentoPdf) return;
        const geracao = ++geracaoRenderPdf;
        fundoPdf.loading = true;
        renderizarFundoPdf();
        try {
            const pagina = await documentoPdf.getPage(limitar(Number(fundoPdf.page) || 1, 1, documentoPdf.numPages));
            const base = pagina.getViewport({ scale: 1 });
            const escala = limitar(1800 / Math.max(1, base.width), 1, 3);
            const viewport = pagina.getViewport({ scale: escala });
            const canvas = document.createElement("canvas");
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            await pagina.render({ canvasContext: canvas.getContext("2d", { alpha: false }), viewport }).promise;
            const novaUrl = await canvasParaUrl(canvas);
            if (geracao !== geracaoRenderPdf || !container.isConnected) { URL.revokeObjectURL(novaUrl); return; }
            if (urlRenderizadaPdf) URL.revokeObjectURL(urlRenderizadaPdf);
            urlRenderizadaPdf = novaUrl;
            fundoPdf.loading = false;
            fundoPdf.error = false;
            renderizarFundoPdf();
        } catch (erro) {
            if (geracao !== geracaoRenderPdf) return;
            fundoPdf.loading = false;
            fundoPdf.error = true;
            renderizarFundoPdf();
            opcoes.aoErro?.(erro.message || "Não foi possível mostrar esta página do PDF.");
        }
    }

    async function abrirDocumentoPdf(url, ajustarPagina = false) {
        documentoPdf?.destroy?.();
        const pdfjs = await carregarPdfJs();
        documentoPdf = await pdfjs.getDocument({ url }).promise;
        if (!fundoPdf) return;
        fundoPdf.totalPages = documentoPdf.numPages;
        fundoPdf.page = limitar(Number(fundoPdf.page) || 1, 1, documentoPdf.numPages);
        if (ajustarPagina) {
            const primeiraPagina = await documentoPdf.getPage(fundoPdf.page);
            const viewport = primeiraPagina.getViewport({ scale: 1 });
            tamanhoPagina = viewport.height >= viewport.width ? "portrait" : "wide";
            aplicarVisualizacaoPagina();
        }
        await renderizarPaginaPdf();
    }

    async function inserirPdf(arquivo) {
        if (!arquivo || typeof opcoes.enviarPdf !== "function") return;
        adicionarPdfBotao.disabled = true;
        adicionarPdfBotao.classList.add("is-loading");
        adicionarPdfBotao.querySelector("i")?.classList.replace("bi-file-earmark-pdf", "bi-arrow-repeat");
        try {
            const enviado = await opcoes.enviarPdf(arquivo);
            fundoPdf = { type: "pdf", storagePath: enviado.storagePath, name: enviado.nome || arquivo.name || "Documento PDF", page: 1, totalPages: 1, annotations: { 1: tracosParaPersistir() }, loading: true };
            renderizarFundoPdf();
            await abrirDocumentoPdf(enviado.url, true);
            fundoPdf.fixedPage = true;
            notificar();
            if (typeof opcoes.aoImportarPdf === "function" && fundoPdf.totalPages > 1) {
                await opcoes.aoImportarPdf({
                    storagePath: fundoPdf.storagePath,
                    name: fundoPdf.name,
                    totalPages: fundoPdf.totalPages,
                    pageSize: tamanhoPagina,
                    annotations: copiar(fundoPdf.annotations)
                });
            }
        } catch (erro) {
            fundoPdf = null;
            renderizarFundoPdf();
            opcoes.aoErro?.(erro.message || "Não foi possível usar o PDF como fundo.");
        } finally {
            adicionarPdfBotao.disabled = false;
            adicionarPdfBotao.classList.remove("is-loading");
            adicionarPdfBotao.querySelector("i")?.classList.replace("bi-arrow-repeat", "bi-file-earmark-pdf");
            pdfInput.value = "";
        }
    }

    async function carregarFundoPdfPrivado() {
        if (!fundoPdf || typeof opcoes.resolverPdf !== "function") return;
        fundoPdf.loading = true;
        renderizarFundoPdf();
        try {
            const url = await opcoes.resolverPdf(fundoPdf.storagePath);
            if (!container.isConnected) return;
            await abrirDocumentoPdf(url, false);
            if (!fundoPdf.fixedPage && fundoPdf.totalPages > 1 && typeof opcoes.aoImportarPdf === "function") {
                fundoPdf.fixedPage = true;
                notificar();
                await opcoes.aoImportarPdf({
                    storagePath: fundoPdf.storagePath,
                    name: fundoPdf.name,
                    totalPages: fundoPdf.totalPages,
                    pageSize: tamanhoPagina,
                    annotations: copiar(fundoPdf.annotations)
                });
            }
        } catch (erro) {
            if (!fundoPdf || !container.isConnected) return;
            fundoPdf.loading = false;
            fundoPdf.error = true;
            renderizarFundoPdf();
            opcoes.aoErro?.(erro.message || "Não foi possível reabrir o PDF privado.");
        }
    }

    function ajustarCaixaTextoAoConteudo(traco, conteudo, elemento) {
        if (traco.tool !== "text" || !Array.isArray(traco.points) || traco.points.length < 2 || !conteudo.isConnected) return;
        const inicio = traco.points[0];
        const fim = traco.points[1];
        const alturaAtual = Math.max(42, Math.abs(fim.y - inicio.y));
        const alturaNecessaria = Math.max(42, Math.ceil(conteudo.scrollHeight + 8));
        if (alturaNecessaria <= alturaAtual + 1) return;
        fim.y = inicio.y + alturaNecessaria;
        elemento.setAttribute("height", String(alturaNecessaria));
        renderizarSelecao();
    }

    function renderizar() {
        renderizarFundoPdf();
        camada.replaceChildren(...tracos.map(elementoDoTraco));
        renderizarSelecao();
        atualizarBotoes();
    }

    function registrarHistorico() {
        historico.push(copiar(tracos));
        if (historico.length > LIMITE_HISTORICO) historico.shift();
        futuros = [];
    }

    function tracosParaPersistir() {
        return tracos.map(traco => {
            const salvo = copiar(traco);
            delete salvo.src;
            delete salvo.imageError;
            return salvo;
        });
    }

    function notificar() {
        const persistentes = tracosParaPersistir();
        if (fundoPdf) fundoPdf.annotations[String(Number(fundoPdf.page) || 1)] = persistentes;
        const background = fundoPdf ? copiar(fundoPdf) : null;
        if (background) {
            delete background.src;
            delete background.loading;
            delete background.error;
        }
        aoAlterar({ strokes: persistentes, pageSize: tamanhoPagina, background });
        atualizarBotoes();
    }

    function dimensoesImagem(arquivo) {
        return new Promise((resolver, rejeitar) => {
            const url = URL.createObjectURL(arquivo);
            const imagem = new Image();
            imagem.onload = () => {
                URL.revokeObjectURL(url);
                resolver({ largura: imagem.naturalWidth || 1, altura: imagem.naturalHeight || 1 });
            };
            imagem.onerror = () => {
                URL.revokeObjectURL(url);
                rejeitar(new Error("Não foi possível ler essa imagem."));
            };
            imagem.src = url;
        });
    }

    async function inserirImagem(arquivo) {
        if (!arquivo || typeof opcoes.enviarImagem !== "function") return;
        adicionarImagemBotao.disabled = true;
        adicionarImagemBotao.classList.add("is-loading");
        adicionarImagemBotao.querySelector("i")?.classList.replace("bi-image", "bi-arrow-repeat");
        try {
            const dimensoes = await dimensoesImagem(arquivo);
            const enviada = await opcoes.enviarImagem(arquivo);
            const pagina = TAMANHOS_PAGINA[tamanhoPagina];
            const escala = Math.min(460 / dimensoes.largura, 340 / dimensoes.altura, 1);
            const largura = Math.max(120, Math.round(dimensoes.largura * escala));
            const altura = Math.max(80, Math.round(dimensoes.altura * escala));
            const esquerda = Math.round((pagina.largura - largura) / 2);
            const topo = Math.max(40, Math.round((pagina.altura - altura) / 3));
            const traco = {
                id: crypto.randomUUID(), tool: "image", storagePath: enviada.storagePath,
                name: enviada.nome || arquivo.name || "Imagem", mimeType: enviada.mimeType || arquivo.type,
                src: enviada.url, points: [{ x: esquerda, y: topo }, { x: esquerda + largura, y: topo + altura }]
            };
            registrarHistorico();
            tracos.unshift(traco);
            selecionados = new Set([traco.id]);
            selecionarFerramenta("select");
            notificar();
        } catch (erro) {
            opcoes.aoErro?.(erro.message || "Não foi possível inserir a imagem.");
        } finally {
            adicionarImagemBotao.disabled = false;
            adicionarImagemBotao.classList.remove("is-loading");
            adicionarImagemBotao.querySelector("i")?.classList.replace("bi-arrow-repeat", "bi-image");
            imagemInput.value = "";
        }
    }

    function carregarImagensPrivadas() {
        if (typeof opcoes.resolverImagem !== "function") return;
        tracos.filter(traco => traco.tool === "image" && traco.storagePath && !traco.src).forEach(traco => {
            Promise.resolve(opcoes.resolverImagem(traco.storagePath)).then(url => {
                const atual = tracos.find(item => item.id === traco.id);
                if (!atual || !container.isConnected) return;
                atual.src = url;
                atual.imageError = false;
                renderizar();
            }).catch(() => {
                const atual = tracos.find(item => item.id === traco.id);
                if (!atual || !container.isConnected) return;
                atual.imageError = true;
                renderizar();
            });
        });
    }

    function ajustarGrifosAposEdicao(anterior, novo, marcas) {
        const atuais = Array.isArray(marcas) ? marcas : [];
        let prefixo = 0;
        while (prefixo < anterior.length && prefixo < novo.length && anterior[prefixo] === novo[prefixo]) prefixo++;
        let sufixo = 0;
        while (sufixo < anterior.length - prefixo && sufixo < novo.length - prefixo && anterior[anterior.length - 1 - sufixo] === novo[novo.length - 1 - sufixo]) sufixo++;
        const fimAntigo = anterior.length - sufixo;
        const deslocamento = novo.length - anterior.length;
        return atuais.flatMap(marca => {
            if (marca.fim <= prefixo) return [marca];
            if (marca.inicio >= fimAntigo) return [{ ...marca, inicio: marca.inicio + deslocamento, fim: marca.fim + deslocamento }];
            const preservadas = [];
            if (marca.inicio < prefixo) preservadas.push({ ...marca, inicio: marca.inicio, fim: prefixo });
            if (marca.fim > fimAntigo) preservadas.push({ ...marca, inicio: prefixo + Math.max(0, novo.length - prefixo - sufixo), fim: marca.fim + deslocamento });
            return preservadas;
        }).filter(marca => marca.fim > marca.inicio);
    }

    function guardarSelecaoTexto(editor) {
        const selecao = window.getSelection();
        if (!selecao?.rangeCount || selecao.isCollapsed || !editor.contains(selecao.anchorNode) || !editor.contains(selecao.focusNode)) {
            selecaoTexto = null;
            menuEstudoTexto.hidden = true;
            atualizarBotoes();
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
        const texto = intervalo.toString().trim();
        selecaoTexto = { inicio, fim, texto };
        selecaoEstudoPendente = { strokeId: editor.dataset.strokeId || textoEmEdicaoId, inicio, fim, texto };
        atualizarBotoes();
        if (!texto) return;
        const caixaSelecao = intervalo.getBoundingClientRect();
        menuEstudoTexto.hidden = false;
        const meiaLargura = Math.max(110, menuEstudoTexto.offsetWidth / 2 + 8);
        menuEstudoTexto.style.left = `${limitar(caixaSelecao.left + caixaSelecao.width / 2, meiaLargura, window.innerWidth - meiaLargura)}px`;
        menuEstudoTexto.style.top = `${Math.max(8, caixaSelecao.top - menuEstudoTexto.offsetHeight - 10)}px`;
    }

    function aoMudarSelecaoTexto() {
        if (!textoEmEdicaoId || !container.isConnected) return;
        const editor = camada.querySelector(`.subject-page-drawing-text-content[data-stroke-id="${CSS.escape(textoEmEdicaoId)}"]`);
        if (editor?.isContentEditable) guardarSelecaoTexto(editor);
    }

    function acionarEstudoComTexto(acao) {
        const pendente = selecaoEstudoPendente;
        if (!pendente || !["flashcard", "summary", "review", "quiz"].includes(acao)) return;
        const inicio = Math.min(pendente.inicio, pendente.fim);
        const fim = Math.max(pendente.inicio, pendente.fim);
        const texto = String(pendente.texto || "").trim();
        if (!texto) return;
        menuEstudoTexto.hidden = true;
        selecaoEstudoPendente = null;
        aoAcaoTexto(acao, texto, { strokeId: pendente.strokeId, inicio, fim });
    }

    function alternarGrifoTexto() {
        const traco = tracos.find(item => item.id === textoEmEdicaoId);
        if (!traco || !selecaoTexto || selecaoTexto.inicio === selecaoTexto.fim) return;
        registrarHistorico();
        const inicio = Math.min(selecaoTexto.inicio, selecaoTexto.fim);
        const fim = Math.max(selecaoTexto.inicio, selecaoTexto.fim);
        const marcas = Array.isArray(traco.highlights) ? traco.highlights : [];
        const jaMarcado = marcas.some(marca => marca.inicio <= inicio && marca.fim >= fim);
        traco.highlights = jaMarcado
            ? marcas.flatMap(marca => {
                if (marca.fim <= inicio || marca.inicio >= fim) return [marca];
                return [{ inicio: marca.inicio, fim: Math.min(marca.fim, inicio) }, { inicio: Math.max(marca.inicio, fim), fim: marca.fim }].filter(parte => parte.fim > parte.inicio);
            })
            : [...marcas, { inicio, fim, color: cor.value }];
        selecaoTexto = null;
        notificar();
        renderizar();
    }

    function textoUnicoSelecionado() {
        return selecionados.size === 1 ? tracos.find(traco => selecionados.has(traco.id) && traco.tool === "text") : null;
    }

    function aplicarFormatoTexto(chave, valor) {
        const traco = textoUnicoSelecionado();
        if (!traco) return;
        registrarHistorico();
        traco[chave] = valor;
        renderizar();
        notificar();
    }

    function alternarListaTexto(tipo) {
        const traco = textoUnicoSelecionado();
        if (!traco) return;
        registrarHistorico();
        const anterior = String(traco.text || "Texto");
        const linhas = anterior.split("\n");
        const padrao = /^\s*(?:[•-]\s+|\d+[.)]\s+)/;
        const linhasPreenchidas = linhas.filter(linha => linha.trim());
        const todasFormatadas = linhasPreenchidas.length > 0 && linhasPreenchidas.every(linha => padrao.test(linha));
        let contador = 0;
        const novo = linhas.map(linha => {
            const limpa = linha.replace(padrao, "");
            if (todasFormatadas || !linha.trim()) return limpa;
            contador += 1;
            return tipo === "number" ? `${contador}. ${limpa}` : `• ${limpa}`;
        }).join("\n");
        traco.highlights = ajustarGrifosAposEdicao(anterior, novo, traco.highlights);
        traco.text = novo;
        renderizar();
        notificar();
    }

    function finalizarEdicaoTexto(reverter) {
        if (!textoEmEdicaoId) return;
        const traco = tracos.find(item => item.id === textoEmEdicaoId);
        if (traco) traco.text = reverter ? textoAntesEdicao : (String(traco.text || "").trim() || "Texto");
        textoEmEdicaoId = null;
        textoAntesEdicao = null;
        selecaoTexto = null;
        notificar();
        renderizar();
    }

    function iniciarEdicaoTexto(traco, registrar = true) {
        if (!traco || traco.tool !== "text") return;
        if (textoEmEdicaoId && textoEmEdicaoId !== traco.id) finalizarEdicaoTexto(false);
        if (registrar) registrarHistorico();
        selecionados = new Set([traco.id]);
        textoEmEdicaoId = traco.id;
        textoAntesEdicao = traco.text || "";
        selecaoTexto = null;
        selecaoEstudoPendente = null;
        selecionarFerramenta("select");
    }

    function selecionarFerramenta(nova) {
        ferramenta = nova;
        container.dataset.tool = nova;
        if (nova !== "select") selecionados.clear();
        ferramentas.forEach(botao => {
            const ativa = botao.dataset.pageDrawingTool === nova;
            botao.classList.toggle("is-active", ativa);
            botao.setAttribute("aria-pressed", String(ativa));
        });
        cursor.setAttribute("visibility", nova === "eraser" ? "visible" : "hidden");
        renderizar();
    }

    function apagarNoPonto(ponto) {
        const raio = Math.max(8, Number(tamanho.value));
        const restantes = tracos.filter(traco => {
            if (traco.tool === "image") return true;
            if (traco.tool === "text") {
                const limites = limitesDosTracos([traco]);
                return !limites || ponto.x < limites.esquerda - raio || ponto.x > limites.direita + raio || ponto.y < limites.topo - raio || ponto.y > limites.base + raio;
            }
            return !(traco.points || []).some((atual, indice, pontos) => distanciaSegmento(ponto, pontos[Math.max(0, indice - 1)], atual) <= raio);
        });
        if (restantes.length === tracos.length) return false;
        tracos = restantes;
        renderizar();
        return true;
    }

    function encontrarTraco(ponto) {
        return [...tracos].reverse().find(traco => {
            if (["text", "image"].includes(traco.tool)) {
                const limites = limitesDosTracos([traco]);
                return limites && ponto.x >= limites.esquerda && ponto.x <= limites.direita && ponto.y >= limites.topo && ponto.y <= limites.base;
            }
            const pontos = traco.points || [];
            const tolerancia = Math.max(7, (Number(traco.width) || 3) / 2 + 4);
            return pontos.some((atual, indice) => distanciaSegmento(ponto, pontos[Math.max(0, indice - 1)], atual) <= tolerancia);
        });
    }

    function iniciarSelecao(evento, ponto) {
        const alcaRedimensionamento = evento.target.closest?.("[data-page-drawing-resize]");
        if (alcaRedimensionamento && selecionados.size) {
            registrarHistorico();
            gesto = { tipo: "resize", pointerId: evento.pointerId, inicio: ponto, direcao: alcaRedimensionamento.dataset.pageDrawingResize || "se", limites: limitesDosTracos(tracosSelecionados()), originais: copiar(tracosSelecionados()), alterou: false };
            return;
        }
        const idDoAlvo = evento.target.closest?.("[data-stroke-id]")?.dataset.strokeId;
        const atingido = tracos.find(traco => traco.id === idDoAlvo) || encontrarTraco(ponto);
        if (evento.shiftKey && atingido) {
            if (selecionados.has(atingido.id)) selecionados.delete(atingido.id); else selecionados.add(atingido.id);
            if (svg.hasPointerCapture(evento.pointerId)) svg.releasePointerCapture(evento.pointerId);
            renderizar();
            return;
        }
        if (atingido) {
            const agora = performance.now();
            const editarAoSoltar = atingido.tool === "text"
                && ultimoCliqueTexto.id === atingido.id
                && agora - ultimoCliqueTexto.instante <= 420;
            ultimoCliqueTexto = atingido.tool === "text"
                ? { id: atingido.id, instante: agora }
                : { id: null, instante: 0 };
            if (!selecionados.has(atingido.id)) selecionados = new Set([atingido.id]);
            registrarHistorico();
            gesto = { tipo: "move", id: atingido.id, pointerId: evento.pointerId, inicio: ponto, originais: copiar(tracosSelecionados()), alterou: false, editarAoSoltar };
            renderizar();
            return;
        }
        ultimoCliqueTexto = { id: null, instante: 0 };
        selecionados.clear();
        gesto = { tipo: "lasso", pointerId: evento.pointerId, inicio: ponto, atual: ponto };
        renderizar();
    }

    function aoPointerDown(evento) {
        if (evento.button !== 0) return;
        evento.preventDefault();
        svg.setPointerCapture(evento.pointerId);
        const ponto = pontoDoEvento(evento);
        if (ferramenta === "select") { iniciarSelecao(evento, ponto); return; }
        registrarHistorico();
        if (ferramenta === "text") {
            const traco = { id: crypto.randomUUID(), tool: "text", color: cor.value, width: 2, fontSize: 26, text: "Digite seu texto", highlights: [], points: [ponto, { ...ponto }] };
            tracos.push(traco);
            gesto = { tipo: "text-box", pointerId: evento.pointerId, traco, inicio: ponto, atual: ponto };
            renderizar();
            return;
        }
        if (ferramenta === "eraser") {
            gesto = { tipo: "erase", pointerId: evento.pointerId, apagou: apagarNoPonto(ponto) };
            return;
        }
        if (["line", "arrow", "rectangle", "ellipse"].includes(ferramenta)) {
            const traco = { id: crypto.randomUUID(), tool: ferramenta, color: cor.value, width: Number(tamanho.value), points: pontosDaForma(ferramenta, ponto, ponto) };
            tracos.push(traco);
            gesto = { tipo: "shape", pointerId: evento.pointerId, traco, inicio: ponto };
            renderizar();
            return;
        }
        const traco = { id: crypto.randomUUID(), tool: ferramenta, color: cor.value, width: ferramenta === "highlighter" ? Math.max(10, Number(tamanho.value) * 2.4) : Number(tamanho.value), points: [ponto] };
        tracos.push(traco);
        gesto = { tipo: "draw", pointerId: evento.pointerId, traco };
        renderizar();
    }

    function atualizarTransformacaoSelecao(ponto) {
        if (gesto.tipo === "move") {
            const dx = ponto.x - gesto.inicio.x;
            const dy = ponto.y - gesto.inicio.y;
            gesto.alterou = gesto.alterou || Math.hypot(dx, dy) > .8;
            gesto.originais.forEach(original => {
                const atual = tracos.find(traco => traco.id === original.id);
                if (atual) atual.points = original.points.map(valor => ({ x: valor.x + dx, y: valor.y + dy }));
            });
        }
        if (gesto.tipo === "resize") {
            const somenteTexto = gesto.originais.length === 1 && gesto.originais[0].tool === "text";
            if (somenteTexto) {
                const original = gesto.originais[0];
                const atual = tracos.find(traco => traco.id === original.id);
                const direcao = gesto.direcao || "se";
                const redimensionaProporcionalmente = direcao.length === 2;
                let esquerda = gesto.limites.esquerda;
                let direita = gesto.limites.direita;
                let topo = gesto.limites.topo;
                let base = gesto.limites.base;
                if (redimensionaProporcionalmente) {
                    const larguraDesejada = direcao.includes("w") ? direita - ponto.x : ponto.x - esquerda;
                    const alturaDesejada = direcao.includes("n") ? base - ponto.y : ponto.y - topo;
                    const escala = Math.max(
                        80 / Math.max(1, gesto.limites.largura),
                        42 / Math.max(1, gesto.limites.altura),
                        Math.min(larguraDesejada / Math.max(1, gesto.limites.largura), alturaDesejada / Math.max(1, gesto.limites.altura))
                    );
                    const larguraProporcional = gesto.limites.largura * escala;
                    const alturaProporcional = gesto.limites.altura * escala;
                    if (direcao.includes("w")) esquerda = direita - larguraProporcional; else direita = esquerda + larguraProporcional;
                    if (direcao.includes("n")) topo = base - alturaProporcional; else base = topo + alturaProporcional;
                } else {
                    if (direcao.includes("w")) esquerda = Math.min(ponto.x, direita - 80);
                    if (direcao.includes("e")) direita = Math.max(ponto.x, esquerda + 80);
                    if (direcao.includes("n")) topo = Math.min(ponto.y, base - 42);
                    if (direcao.includes("s")) base = Math.max(ponto.y, topo + 42);
                }
                const largura = direita - esquerda;
                const altura = base - topo;
                const escalaX = largura / Math.max(1, gesto.limites.largura);
                const escalaY = altura / Math.max(1, gesto.limites.altura);
                gesto.alterou = gesto.alterou || Math.abs(escalaX - 1) > .01 || Math.abs(escalaY - 1) > .01;
                if (atual) {
                    atual.points = [{ x: esquerda, y: topo }, { x: direita, y: base }];
                    atual.fontSize = redimensionaProporcionalmente
                        ? limitar((Number(original.fontSize) || 26) * Math.min(escalaX, escalaY), 12, 120)
                        : Number(original.fontSize) || 26;
                }
                renderizar();
                return;
            }
            const distanciaInicial = Math.hypot(gesto.inicio.x - gesto.limites.esquerda, gesto.inicio.y - gesto.limites.topo) || 1;
            const escala = limitar(Math.hypot(ponto.x - gesto.limites.esquerda, ponto.y - gesto.limites.topo) / distanciaInicial, .15, 8);
            gesto.alterou = gesto.alterou || Math.abs(escala - 1) > .01;
            gesto.originais.forEach(original => {
                const atual = tracos.find(traco => traco.id === original.id);
                if (!atual) return;
                atual.points = original.points.map(valor => ({ x: gesto.limites.esquerda + (valor.x - gesto.limites.esquerda) * escala, y: gesto.limites.topo + (valor.y - gesto.limites.topo) * escala }));
                atual.width = limitar((Number(original.width) || 3) * escala, 1, 40);
                if (atual.tool === "text") atual.fontSize = limitar((Number(original.fontSize) || 26) * escala, 12, 120);
            });
        }
        renderizar();
    }

    function aoPointerMove(evento) {
        const ponto = pontoDoEvento(evento);
        if (ferramenta === "eraser") {
            cursor.setAttribute("cx", String(ponto.x)); cursor.setAttribute("cy", String(ponto.y)); cursor.setAttribute("r", String(Math.max(8, Number(tamanho.value))));
        }
        if (!gesto || gesto.pointerId !== evento.pointerId) return;
        evento.preventDefault();
        if (["move", "resize"].includes(gesto.tipo)) atualizarTransformacaoSelecao(ponto);
        else if (gesto.tipo === "text-box") {
            gesto.atual = ponto;
            gesto.traco.points = [
                { x: Math.min(gesto.inicio.x, ponto.x), y: Math.min(gesto.inicio.y, ponto.y) },
                { x: Math.max(gesto.inicio.x, ponto.x), y: Math.max(gesto.inicio.y, ponto.y) }
            ];
            renderizar();
        }
        else if (gesto.tipo === "lasso") { gesto.atual = ponto; renderizarSelecao(); }
        else if (gesto.tipo === "erase") gesto.apagou = apagarNoPonto(ponto) || gesto.apagou;
        else if (gesto.tipo === "shape") { gesto.traco.points = pontosDaForma(gesto.traco.tool, gesto.inicio, ponto); renderizar(); }
        else {
            const ultimo = gesto.traco.points.at(-1);
            if (Math.hypot(ponto.x - ultimo.x, ponto.y - ultimo.y) < 1.5) return;
            gesto.traco.points.push(ponto);
            renderizar();
        }
    }

    function concluirLaco(atual) {
        const area = { esquerda: Math.min(atual.inicio.x, atual.atual.x), direita: Math.max(atual.inicio.x, atual.atual.x), topo: Math.min(atual.inicio.y, atual.atual.y), base: Math.max(atual.inicio.y, atual.atual.y) };
        if (area.direita - area.esquerda < 4 && area.base - area.topo < 4) selecionados.clear();
        else selecionados = new Set(tracos.filter(traco => { const limites = limitesDosTracos([traco]); return limites && retangulosSeTocam(area, limites); }).map(traco => traco.id));
    }

    function aoPointerUp(evento) {
        if (!gesto || gesto.pointerId !== evento.pointerId) return;
        const atual = gesto;
        gesto = null;
        if (svg.hasPointerCapture(evento.pointerId)) svg.releasePointerCapture(evento.pointerId);
        if (atual.tipo === "lasso") concluirLaco(atual);
        else if (atual.tipo === "text-box") {
            const largura = Math.abs(atual.atual.x - atual.inicio.x);
            const altura = Math.abs(atual.atual.y - atual.inicio.y);
            if (largura < 20 && altura < 20) atual.traco.points = [atual.inicio, { x: atual.inicio.x + 260, y: atual.inicio.y + 90 }];
            else {
                const limites = limitesDosTracos([atual.traco]);
                atual.traco.points = [
                    { x: limites.esquerda, y: limites.topo },
                    { x: limites.esquerda + Math.max(80, limites.largura), y: limites.topo + Math.max(42, limites.altura) }
                ];
            }
            notificar();
            iniciarEdicaoTexto(atual.traco, false);
            return;
        }
        else if (atual.tipo === "move" && atual.editarAoSoltar && !atual.alterou) {
            historico.pop();
            ultimoCliqueTexto = { id: null, instante: 0 };
            const texto = tracos.find(traco => traco.id === atual.id && traco.tool === "text");
            if (texto) iniciarEdicaoTexto(texto);
            return;
        }
        else if (["move", "resize"].includes(atual.tipo)) { if (atual.alterou) notificar(); else historico.pop(); }
        else if (atual.tipo === "erase") { if (atual.apagou) notificar(); else historico.pop(); }
        else notificar();
        renderizar();
    }

    ferramentas.forEach(botao => botao.addEventListener("click", () => selecionarFerramenta(botao.dataset.pageDrawingTool)));
    adicionarImagemBotao?.addEventListener("click", () => imagemInput?.click());
    imagemInput?.addEventListener("change", () => inserirImagem(imagemInput.files?.[0]));
    adicionarPdfBotao?.addEventListener("click", () => {
        if (fundoPdf && !window.confirm("Substituir o PDF usado como fundo? As anotações visíveis serão mantidas na primeira página do novo documento.")) return;
        pdfInput?.click();
    });
    pdfInput?.addEventListener("change", () => inserirPdf(pdfInput.files?.[0]));
    passosPdf.forEach(botao => botao.addEventListener("click", async () => {
        if (!fundoPdf || fundoPdf.loading) return;
        fundoPdf.annotations[String(Number(fundoPdf.page) || 1)] = tracosParaPersistir();
        fundoPdf.page = limitar((Number(fundoPdf.page) || 1) + Number(botao.dataset.pageDrawingPdfStep), 1, Number(fundoPdf.totalPages) || 1);
        tracos = copiar(fundoPdf.annotations[String(fundoPdf.page)] || []);
        selecionados.clear();
        historico = [];
        futuros = [];
        carregarImagensPrivadas();
        notificar();
        renderizar();
        await renderizarPaginaPdf();
    }));
    removerPdfBotao.addEventListener("click", () => {
        if (!fundoPdf || !window.confirm("Remover o PDF do fundo desta página? Suas anotações serão mantidas.")) return;
        geracaoRenderPdf += 1;
        documentoPdf?.destroy?.();
        documentoPdf = null;
        if (urlRenderizadaPdf) URL.revokeObjectURL(urlRenderizadaPdf);
        urlRenderizadaPdf = "";
        fundoPdf = null;
        renderizarFundoPdf();
        notificar();
    });
    grifarTextoBotao.addEventListener("pointerdown", evento => evento.preventDefault());
    grifarTextoBotao.addEventListener("click", alternarGrifoTexto);
    menuEstudoTexto.addEventListener("pointerdown", evento => {
        evento.preventDefault();
        evento.stopPropagation();
        const botao = evento.target.closest("[data-page-drawing-study-action]");
        if (botao) acionarEstudoComTexto(botao.dataset.pageDrawingStudyAction);
    });
    document.addEventListener("selectionchange", aoMudarSelecaoTexto);
    editarTextoBotao.addEventListener("click", () => iniciarEdicaoTexto(tracosSelecionados()[0]));
    cor.addEventListener("input", () => {
        if (ferramenta !== "select" || !selecionados.size) return;
        registrarHistorico();
        tracos.forEach(traco => { if (selecionados.has(traco.id) && traco.tool !== "image") traco.color = cor.value; });
        renderizar(); notificar();
    });
    tamanho.addEventListener("input", () => { tamanhoSaida.textContent = tamanho.value; if (ferramenta === "eraser") cursor.setAttribute("r", String(Math.max(8, Number(tamanho.value)))); });
    seletorPagina?.addEventListener("change", () => {
        tamanhoPagina = TAMANHOS_PAGINA[seletorPagina.value] ? seletorPagina.value : "standard";
        aplicarVisualizacaoPagina();
        notificar();
    });
    botoesZoom.forEach(botao => botao.addEventListener("click", () => alterarZoom(botao.dataset.pageDrawingZoom)));
    formatacaoTexto.addEventListener("pointerdown", evento => evento.preventDefault());
    tamanhoFonte.addEventListener("change", () => aplicarFormatoTexto("fontSize", limitar(Number(tamanhoFonte.value) || 26, 12, 120)));
    estilosTexto.forEach(botao => botao.addEventListener("click", () => {
        const traco = textoUnicoSelecionado();
        if (!traco) return;
        const negrito = botao.dataset.pageDrawingTextStyle === "bold";
        aplicarFormatoTexto(negrito ? "fontWeight" : "fontStyle", negrito ? (traco.fontWeight === "bold" ? "normal" : "bold") : (traco.fontStyle === "italic" ? "normal" : "italic"));
    }));
    alinhamentosTexto.forEach(botao => botao.addEventListener("click", () => aplicarFormatoTexto("textAlign", botao.dataset.pageDrawingTextAlign)));
    listasTexto.forEach(botao => botao.addEventListener("click", () => alternarListaTexto(botao.dataset.pageDrawingTextList)));
    duplicarBotao.addEventListener("click", () => {
        if (!selecionados.size) return;
        registrarHistorico();
        const copias = tracosSelecionados().map(traco => ({ ...copiar(traco), id: crypto.randomUUID(), points: traco.points.map(ponto => ({ x: ponto.x + 18, y: ponto.y + 18 })) }));
        tracos.push(...copias); selecionados = new Set(copias.map(traco => traco.id)); renderizar(); notificar();
    });
    excluirBotao.addEventListener("click", () => {
        if (!selecionados.size) return;
        registrarHistorico(); tracos = tracos.filter(traco => !selecionados.has(traco.id)); selecionados.clear(); renderizar(); notificar();
    });
    desfazerBotao.addEventListener("click", () => {
        if (!historico.length) return;
        futuros.push(copiar(tracos)); tracos = historico.pop(); selecionados.clear(); renderizar(); notificar();
    });
    refazerBotao.addEventListener("click", () => {
        if (!futuros.length) return;
        historico.push(copiar(tracos)); tracos = futuros.pop(); selecionados.clear(); renderizar(); notificar();
    });
    limparBotao.addEventListener("click", () => {
        if (!tracos.length || !window.confirm("Limpar todos os desenhos desta página?")) return;
        registrarHistorico(); tracos = []; selecionados.clear(); renderizar(); notificar();
    });
    svg.addEventListener("pointerdown", aoPointerDown);
    svg.addEventListener("pointermove", aoPointerMove);
    svg.addEventListener("pointerup", aoPointerUp);
    svg.addEventListener("pointercancel", aoPointerUp);
    svg.addEventListener("pointerleave", () => { if (!gesto && ferramenta === "eraser") cursor.setAttribute("visibility", "hidden"); });
    svg.addEventListener("pointerenter", () => { if (ferramenta === "eraser") cursor.setAttribute("visibility", "visible"); });

    aplicarVisualizacaoPagina();
    selecionarFerramenta("pen");
    carregarImagensPrivadas();
    carregarFundoPdfPrivado();
    return Object.freeze({ destruir: () => {
        gesto = null;
        textoEmEdicaoId = null;
        document.removeEventListener("selectionchange", aoMudarSelecaoTexto);
        controlesVisualizacao.remove();
        controlesPdf.remove();
        geracaoRenderPdf += 1;
        documentoPdf?.destroy?.();
        if (urlRenderizadaPdf) URL.revokeObjectURL(urlRenderizadaPdf);
        menuEstudoTexto.remove();
    } });
}
