import { supabase } from "./supabase-client.js";
import { importarDadosLocais, MIGRACAO_REMOTA_HABILITADA } from "./migration-import.js";
import { conferirConteudoRemoto } from "./cloud-verification.js";

const entidades = [
    ["subjects", "Matérias"],
    ["topics", "Tópicos"],
    ["notes", "Notas"],
    ["flashcards", "Flashcards"],
    ["flashcard_progress", "Progresso dos flashcards"],
    ["study_links", "Materiais e links"],
    ["study_tasks", "Sessões do cronograma"],
    ["exam_settings", "Configuração do concurso"],
    ["exam_subjects", "Itens do edital"],
    ["exam_topics", "Checklist pessoal do edital"],
    ["error_entries", "Registros de erros"],
    ["subject_performance", "Históricos de desempenho"]
];

const botaoAbrir = document.getElementById("btnPreviaMigracao");
const botaoAtualizar = document.getElementById("btnAtualizarPreviaMigracao");
const botaoExecutar = document.getElementById("btnExecutarMigracao");
const spinner = document.getElementById("spinnerPreviaMigracao");
const mensagem = document.getElementById("mensagemPreviaMigracao");
const corpo = document.getElementById("corpoPreviaMigracao");
const identificacao = document.getElementById("identificacaoPreviaMigracao");
const mensagemConferencia = document.getElementById("mensagemConferenciaConteudo");
const modalElemento = document.getElementById("modalPreviaMigracao");

let contextoAtivo = null;
let consultaEmAndamento = false;
let migracaoPronta = false;

function definirMensagem(texto, tipo) {
    mensagem.textContent = texto;
    mensagem.className = `alert alert-${tipo}`;
}

function definirMensagemConferencia(texto = "", tipo = "secondary") {
    mensagemConferencia.textContent = texto;
    mensagemConferencia.className = texto ? `alert alert-${tipo} mt-3 mb-0` : "alert alert-secondary d-none mt-3 mb-0";
}

async function executarConferenciaConteudo(dadosLocais) {
    definirMensagemConferencia("Conferindo o conteúdo completo sem exibir matérias ou notas...", "info");
    const resultado = await conferirConteudoRemoto(contextoAtivo, dadosLocais);
    if (resultado.igual) {
        definirMensagemConferencia("Conteúdo conferido: a cópia no Supabase corresponde aos dados deste navegador.", "success");
    } else {
        const nomes = {
            materias: "matérias e conteúdos",
            tarefas: "cronograma",
            edital: "edital",
            erros: "caderno de erros",
            desempenho: "desempenho"
        };
        definirMensagemConferencia(`A cópia remota diverge em: ${resultado.divergencias.map(item => nomes[item]).join(", ")}. Os dados locais foram preservados.`, "warning");
    }
    return resultado;
}

function definirCarregando(ativo) {
    consultaEmAndamento = ativo;
    botaoAtualizar.disabled = ativo;
    botaoAbrir.disabled = ativo;
    botaoExecutar.disabled = ativo || !migracaoPronta;
    spinner.classList.toggle("d-none", !ativo);
}

function ordenarParaChecksum(valor) {
    if (Array.isArray(valor)) return valor.map(ordenarParaChecksum);
    if (!valor || typeof valor !== "object") return valor;
    return Object.keys(valor).sort().reduce((resultado, chave) => {
        resultado[chave] = ordenarParaChecksum(valor[chave]);
        return resultado;
    }, {});
}

async function calcularChecksum(dados) {
    const serializado = JSON.stringify(ordenarParaChecksum(dados));
    const bytes = new TextEncoder().encode(serializado);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function contarTabela(tabela, workspaceId, userId) {
    let consulta = supabase
        .from(tabela)
        .select("*", { count: "exact", head: true })
        .eq("workspace_id", workspaceId);
    if (["exam_settings", "exam_subjects", "exam_topics", "flashcard_progress", "error_entries", "subject_performance"].includes(tabela)) {
        consulta = consulta.eq("user_id", userId);
    }
    const { count, error } = await consulta;
    if (error) throw new Error(`Não foi possível consultar ${tabela}.`, { cause: error });
    return count || 0;
}

async function consultarNuvem(workspaceId, userId) {
    const resultados = await Promise.all(entidades.map(async ([tabela]) => [tabela, await contarTabela(tabela, workspaceId, userId)]));
    return Object.fromEntries(resultados);
}

function renderizarContagens(locais, remotas) {
    corpo.replaceChildren();
    entidades.forEach(([chave, rotulo]) => {
        const linha = document.createElement("tr");
        const titulo = document.createElement("td");
        const local = document.createElement("td");
        const remoto = document.createElement("td");
        titulo.textContent = rotulo;
        local.textContent = String(locais[chave] || 0);
        remoto.textContent = String(remotas[chave] || 0);
        local.className = "text-end fw-semibold";
        remoto.className = "text-end fw-semibold";
        linha.append(titulo, local, remoto);
        corpo.appendChild(linha);
    });
}

async function atualizarPrevia() {
    if (consultaEmAndamento || !contextoAtivo || !supabase) return;
    definirCarregando(true);
    definirMensagem("Comparando os dados locais com o espaço pessoal no Supabase...", "info");
    identificacao.textContent = "";
    definirMensagemConferencia();

    try {
        const previaLocal = window.obterDadosParaPreviaMigracao?.();
        if (!previaLocal?.dados || !previaLocal?.contagens) throw new Error("Os dados locais não estão disponíveis.");
        const [contagensRemotas, checksum] = await Promise.all([
            consultarNuvem(contextoAtivo.workspaceId, contextoAtivo.userId),
            calcularChecksum(previaLocal.dados)
        ]);
        renderizarContagens(previaLocal.contagens, contagensRemotas);

        const totalRemoto = Object.values(contagensRemotas).reduce((total, valor) => total + valor, 0);
        if (totalRemoto === 0) {
            migracaoPronta = MIGRACAO_REMOTA_HABILITADA && (previaLocal.contagens.subjects || 0) > 0;
            definirMensagem("O espaço no Supabase está vazio. Os dados locais podem ser preparados para a primeira migração, sem risco de duplicar conteúdo existente.", "success");
        } else {
            migracaoPronta = false;
            definirMensagem("Já existem dados neste espaço do Supabase. Antes de migrar, precisaremos comparar o conteúdo para evitar duplicidades.", "warning");
            const conferencia = await executarConferenciaConteudo(previaLocal.dados);
            if (conferencia.igual) {
                definirMensagem("O Supabase já contém o lote migrado e a cópia completa corresponde aos dados locais.", "success");
            }
        }
        identificacao.textContent = `Identificação do conjunto local: ${checksum.slice(0, 16)}… · Espaço: ${contextoAtivo.workspaceName}`;
    } catch (erro) {
        console.error("Falha ao gerar prévia da migração", erro);
        corpo.replaceChildren();
        migracaoPronta = false;
        definirMensagemConferencia();
        definirMensagem("Não foi possível consultar a prévia. A sessão pode ter expirado ou a conexão está indisponível.", "danger");
    } finally {
        definirCarregando(false);
    }
}

botaoAbrir.addEventListener("click", () => {
    bootstrap.Modal.getOrCreateInstance(modalElemento).show();
    atualizarPrevia();
});
botaoAtualizar.addEventListener("click", atualizarPrevia);
botaoExecutar.addEventListener("click", async () => {
    if (!migracaoPronta || consultaEmAndamento || !contextoAtivo) return;
    const previaLocal = window.obterDadosParaPreviaMigracao?.();
    const quantidadeMaterias = previaLocal?.contagens?.subjects || 0;
    if (!confirm(`Migrar ${quantidadeMaterias} matéria(s) e seus conteúdos para o Supabase?\n\nOs dados locais e o backup continuarão preservados.`)) return;

    definirCarregando(true);
    definirMensagem("Enviando o lote protegido para o Supabase. Não feche esta página...", "info");
    try {
        const resultado = await importarDadosLocais(contextoAtivo);
        const contagensRemotas = await consultarNuvem(contextoAtivo.workspaceId, contextoAtivo.userId);
        renderizarContagens(previaLocal.contagens, contagensRemotas);
        migracaoPronta = false;
        identificacao.textContent = `Lote concluído e auditado: ${String(resultado.batch_id).slice(0, 8)}…`;
        const conferencia = await executarConferenciaConteudo(previaLocal.dados);
        if (conferencia.igual) {
            definirMensagem(
                resultado.status === "ja_importado"
                    ? "Esse mesmo conjunto já havia sido importado. Nenhum conteúdo foi duplicado."
                    : "Migração concluída. As contagens e o conteúdo foram conferidos no Supabase.",
                "success"
            );
        } else {
            definirMensagem("O lote foi concluído, mas a conferência encontrou diferenças. Continue usando os dados locais até a revisão.", "warning");
        }
    } catch (erro) {
        console.error("Falha na migração para o Supabase", erro);
        migracaoPronta = false;
        definirMensagem("A migração não foi concluída. O banco desfez o lote para evitar dados parciais. Atualize a prévia antes de tentar novamente.", "danger");
    } finally {
        definirCarregando(false);
    }
});

export function iniciarPreviaMigracao(contexto) {
    contextoAtivo = Object.freeze({
        userId: contexto.userId,
        workspaceId: contexto.workspaceId,
        workspaceName: contexto.workspaceName
    });
    botaoAbrir.disabled = false;
}

export function encerrarPreviaMigracao() {
    contextoAtivo = null;
    migracaoPronta = false;
    botaoAbrir.disabled = true;
    corpo.replaceChildren();
    identificacao.textContent = "";
    definirMensagemConferencia();
    definirMensagem("Clique em “Atualizar prévia” para comparar os dados.", "info");
    bootstrap.Modal.getInstance(modalElemento)?.hide();
}
