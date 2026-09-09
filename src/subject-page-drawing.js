const SVG_NS = "http://www.w3.org/2000/svg";
const LIMITE_HISTORICO = 50;
const copiar = valor => JSON.parse(JSON.stringify(valor));
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

export function criarDesenhoPagina(container, dadosIniciais, aoAlterar) {
    const svg = container.querySelector("[data-page-drawing-canvas]");
    const camada = container.querySelector("[data-page-drawing-strokes]");
    const camadaSelecao = container.querySelector("[data-page-drawing-selection]");
    const cursor = container.querySelector("[data-page-drawing-eraser-cursor]");
    const ferramentas = [...container.querySelectorAll("[data-page-drawing-tool]")];
    const cor = container.querySelector("[data-page-drawing-color]");
    const tamanho = container.querySelector("[data-page-drawing-size]");
    const tamanhoSaida = container.querySelector("[data-page-drawing-size-output]");
    const duplicarBotao = container.querySelector("[data-page-drawing-duplicate]");
    const excluirBotao = container.querySelector("[data-page-drawing-delete]");
    const desfazerBotao = container.querySelector("[data-page-drawing-undo]");
    const refazerBotao = container.querySelector("[data-page-drawing-redo]");
    const limparBotao = container.querySelector("[data-page-drawing-clear]");
    let tracos = Array.isArray(dadosIniciais?.strokes) ? copiar(dadosIniciais.strokes) : [];
    let ferramenta = "pen";
    let gesto = null;
    let selecionados = new Set();
    let historico = [];
    let futuros = [];

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
                elementos.push(svgEl("circle", { cx: limites.direita + margem, cy: limites.base + margem, r: 8, class: "subject-page-drawing-resize-handle", "data-page-drawing-resize": "true" }));
            }
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

    function renderizar() {
        camada.replaceChildren(...tracos.map(traco => svgEl("path", {
            d: caminhoDosPontos(traco.points || []), fill: "none", stroke: traco.color || "#3b2923",
            "stroke-width": limitar(Number(traco.width) || 3, 1, 40), "stroke-linecap": "round", "stroke-linejoin": "round",
            opacity: traco.tool === "highlighter" ? .28 : 1, class: selecionados.has(traco.id) ? "is-selected" : "", "data-stroke-id": traco.id
        })));
        renderizarSelecao();
        atualizarBotoes();
    }

    function registrarHistorico() {
        historico.push(copiar(tracos));
        if (historico.length > LIMITE_HISTORICO) historico.shift();
        futuros = [];
    }

    function notificar() {
        aoAlterar({ strokes: copiar(tracos) });
        atualizarBotoes();
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
        const restantes = tracos.filter(traco => !(traco.points || []).some((atual, indice, pontos) => distanciaSegmento(ponto, pontos[Math.max(0, indice - 1)], atual) <= raio));
        if (restantes.length === tracos.length) return false;
        tracos = restantes;
        renderizar();
        return true;
    }

    function encontrarTraco(ponto) {
        return [...tracos].reverse().find(traco => {
            const pontos = traco.points || [];
            const tolerancia = Math.max(7, (Number(traco.width) || 3) / 2 + 4);
            return pontos.some((atual, indice) => distanciaSegmento(ponto, pontos[Math.max(0, indice - 1)], atual) <= tolerancia);
        });
    }

    function iniciarSelecao(evento, ponto) {
        if (evento.target.closest?.("[data-page-drawing-resize]") && selecionados.size) {
            registrarHistorico();
            gesto = { tipo: "resize", pointerId: evento.pointerId, inicio: ponto, limites: limitesDosTracos(tracosSelecionados()), originais: copiar(tracosSelecionados()), alterou: false };
            return;
        }
        const atingido = encontrarTraco(ponto);
        if (evento.shiftKey && atingido) {
            if (selecionados.has(atingido.id)) selecionados.delete(atingido.id); else selecionados.add(atingido.id);
            if (svg.hasPointerCapture(evento.pointerId)) svg.releasePointerCapture(evento.pointerId);
            renderizar();
            return;
        }
        if (atingido) {
            if (!selecionados.has(atingido.id)) selecionados = new Set([atingido.id]);
            registrarHistorico();
            gesto = { tipo: "move", pointerId: evento.pointerId, inicio: ponto, originais: copiar(tracosSelecionados()), alterou: false };
            renderizar();
            return;
        }
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
            const distanciaInicial = Math.hypot(gesto.inicio.x - gesto.limites.esquerda, gesto.inicio.y - gesto.limites.topo) || 1;
            const escala = limitar(Math.hypot(ponto.x - gesto.limites.esquerda, ponto.y - gesto.limites.topo) / distanciaInicial, .15, 8);
            gesto.alterou = gesto.alterou || Math.abs(escala - 1) > .01;
            gesto.originais.forEach(original => {
                const atual = tracos.find(traco => traco.id === original.id);
                if (!atual) return;
                atual.points = original.points.map(valor => ({ x: gesto.limites.esquerda + (valor.x - gesto.limites.esquerda) * escala, y: gesto.limites.topo + (valor.y - gesto.limites.topo) * escala }));
                atual.width = limitar((Number(original.width) || 3) * escala, 1, 40);
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
        else if (["move", "resize"].includes(atual.tipo)) { if (atual.alterou) notificar(); else historico.pop(); }
        else if (atual.tipo === "erase") { if (atual.apagou) notificar(); else historico.pop(); }
        else notificar();
        renderizar();
    }

    ferramentas.forEach(botao => botao.addEventListener("click", () => selecionarFerramenta(botao.dataset.pageDrawingTool)));
    cor.addEventListener("input", () => {
        if (ferramenta !== "select" || !selecionados.size) return;
        registrarHistorico();
        tracos.forEach(traco => { if (selecionados.has(traco.id)) traco.color = cor.value; });
        renderizar(); notificar();
    });
    tamanho.addEventListener("input", () => { tamanhoSaida.textContent = tamanho.value; if (ferramenta === "eraser") cursor.setAttribute("r", String(Math.max(8, Number(tamanho.value)))); });
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

    selecionarFerramenta("pen");
    return Object.freeze({ destruir: () => { gesto = null; } });
}
