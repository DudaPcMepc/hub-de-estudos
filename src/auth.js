import { erroConfiguracaoSupabase, supabase, tipoDoLinkDeAutenticacao } from "./supabase-client.js";
import { encerrarAdministracao, iniciarAdministracao } from "./admin.js";
import { encerrarPreviaMigracao, iniciarPreviaMigracao } from "./migration-preview.js";
import { restaurarBackupRemoto } from "./migration-import.js";
import { criarEditorMapasMentais } from "./mind-map-editor.js";
import {
    atualizarMateria,
    atualizarNota,
    atualizarFlashcard,
    atualizarProgressoFlashcard,
    atualizarTopicoFlashcard,
    atualizarLink,
    atualizarTarefa,
    atualizarRegistroEstudo,
    registrarRevisaoErro,
    marcarReforcoErro,
    atualizarMateriaEdital,
    atualizarTopicoEdital,
    atualizarPosicoesMaterias,
    atualizarPosicoesTopicos,
    atualizarTopico,
    atualizarPdfColecaoVade,
    carregarCatalogoMaterias,
    carregarBibliotecaJuridica,
    carregarDispositivosJuridicosPorVersao,
    carregarColecoesVade,
    carregarAnotacoesColecaoVade,
    carregarPdfsColecaoVade,
    carregarMapaMental,
    carregarMapasMentais,
    carregarMateriasRemotas,
    carregarNotasRemotas,
    carregarFlashcardsRemotos,
    carregarLinksRemotos,
    carregarTarefasRemotas,
    carregarRegistrosEstudo,
    carregarEditalRemoto,
    carregarErrosRemotos,
    carregarDesempenhoRemoto,
    carregarTopicosRemotos,
    carregarWidgetsMaterias,
    carregarGrifosJuridicos,
    carregarEstadoLeituraJuridica,
    criarMateria,
    criarNota,
    criarFlashcard,
    criarLink,
    criarTarefa,
    criarMateriaEdital,
    criarTopicosEdital,
    excluirTopicoEdital,
    renomearTopicoEdital,
    criarErro,
    registrarErroSimulado,
    criarGrifoJuridico,
    criarColecaoVade,
    criarAnotacaoColecaoVade,
    criarUrlPdfColecaoVade,
    criarMapaMental,
    atualizarCorGrifoJuridico,
    atualizarNotaGrifoJuridico,
    criarTopico,
    criarTopicos,
    encerrarRepositorioRemoto,
    excluirMateria,
    excluirNota,
    excluirFlashcard,
    excluirLink,
    excluirTarefa,
    excluirRegistroEstudo,
    excluirMateriaEdital,
    excluirConfiguracaoEdital,
    excluirErro,
    excluirGrifoJuridico,
    excluirColecaoVade,
    excluirAnotacaoColecaoVade,
    excluirPdfColecaoVade,
    excluirSecaoColecaoVade,
    excluirMapaMental,
    enviarPdfColecaoVade,
    registrarLeituraJuridica,
    registrarRevisaoTarefa,
    salvarFavoritoJuridico,
    excluirTopico,
    prepararRepositorioRemoto,
    registrarRespostaDesempenho,
    salvarConfiguracaoEdital,
    atualizarColecaoVade,
    atualizarAnotacaoColecaoVade,
    atualizarMapaMental,
    salvarConteudoMapaMental,
    salvarArtigoColecaoVade,
    criarSecaoColecaoVade,
    moverArtigoParaSecaoColecaoVade,
    moverArtigosParaSecaoColecaoVade,
    removerArtigosColecaoVade,
    renomearSecaoColecaoVade,
    salvarOrdemArtigosColecaoVade,
    salvarOrdemSecoesColecaoVade,
    salvarRevisaoArtigoColecaoVade,
    salvarRevisaoArtigosColecaoVade,
    salvarUltimoArtigoColecaoVade,
    salvarDocumentosColecaoVade,
    salvarLayoutWidgets
} from "./cloud-core-repository.js";

window.HUB_CLOUD_SUBJECTS = Object.freeze({
    atualizar: atualizarMateria,
    criar: criarMateria,
    excluir: excluirMateria,
    listar: carregarMateriasRemotas,
    reordenar: atualizarPosicoesMaterias
});

window.HUB_CLOUD_CATALOG = Object.freeze({
    listar: carregarCatalogoMaterias
});

window.HUB_CLOUD_WIDGETS = Object.freeze({
    listar: carregarWidgetsMaterias,
    salvarLayout: salvarLayoutWidgets
});

window.HUB_CLOUD_LEGAL = Object.freeze({
    atualizarCorGrifo: atualizarCorGrifoJuridico,
    atualizarNotaGrifo: atualizarNotaGrifoJuridico,
    carregarEstado: carregarEstadoLeituraJuridica,
    criarGrifo: criarGrifoJuridico,
    excluirGrifo: excluirGrifoJuridico,
    listarDispositivos: carregarDispositivosJuridicosPorVersao,
    listarDocumentos: carregarBibliotecaJuridica,
    listarGrifos: carregarGrifosJuridicos,
    registrarLeitura: registrarLeituraJuridica,
    salvarFavorito: salvarFavoritoJuridico
});

window.HUB_CLOUD_VADE = Object.freeze({
    atualizarAnotacao: atualizarAnotacaoColecaoVade,
    atualizarPdf: atualizarPdfColecaoVade,
    atualizar: atualizarColecaoVade,
    criar: criarColecaoVade,
    criarAnotacao: criarAnotacaoColecaoVade,
    criarUrlPdf: criarUrlPdfColecaoVade,
    criarSecao: criarSecaoColecaoVade,
    excluir: excluirColecaoVade,
    excluirAnotacao: excluirAnotacaoColecaoVade,
    excluirPdf: excluirPdfColecaoVade,
    excluirSecao: excluirSecaoColecaoVade,
    listar: carregarColecoesVade,
    listarAnotacoes: carregarAnotacoesColecaoVade,
    listarPdfs: carregarPdfsColecaoVade,
    enviarPdf: enviarPdfColecaoVade,
    salvarArtigo: salvarArtigoColecaoVade,
    moverArtigoParaSecao: moverArtigoParaSecaoColecaoVade,
    moverArtigosParaSecao: moverArtigosParaSecaoColecaoVade,
    removerArtigos: removerArtigosColecaoVade,
    renomearSecao: renomearSecaoColecaoVade,
    salvarOrdemArtigos: salvarOrdemArtigosColecaoVade,
    salvarOrdemSecoes: salvarOrdemSecoesColecaoVade,
    salvarRevisaoArtigo: salvarRevisaoArtigoColecaoVade,
    salvarRevisaoArtigos: salvarRevisaoArtigosColecaoVade,
    salvarUltimoArtigo: salvarUltimoArtigoColecaoVade,
    salvarDocumentos: salvarDocumentosColecaoVade
});

window.HUB_CLOUD_MIND_MAPS = Object.freeze({
    atualizar: atualizarMapaMental,
    carregar: carregarMapaMental,
    criar: criarMapaMental,
    excluir: excluirMapaMental,
    listar: carregarMapasMentais,
    salvarConteudo: salvarConteudoMapaMental
});

window.HUB_MIND_MAPS_UI = criarEditorMapasMentais(window.HUB_CLOUD_MIND_MAPS);

window.HUB_CLOUD_TOPICS = Object.freeze({
    atualizar: atualizarTopico,
    criar: criarTopico,
    criarLote: criarTopicos,
    excluir: excluirTopico,
    reordenar: atualizarPosicoesTopicos
});

window.HUB_CLOUD_NOTES = Object.freeze({
    atualizar: atualizarNota,
    criar: criarNota,
    excluir: excluirNota,
    listar: carregarNotasRemotas
});

window.HUB_CLOUD_FLASHCARDS = Object.freeze({
    atualizar: atualizarFlashcard,
    atualizarProgresso: atualizarProgressoFlashcard,
    atualizarTopico: atualizarTopicoFlashcard,
    criar: criarFlashcard,
    excluir: excluirFlashcard,
    listar: carregarFlashcardsRemotos
});

window.HUB_CLOUD_LINKS = Object.freeze({
    atualizar: atualizarLink,
    criar: criarLink,
    excluir: excluirLink,
    listar: carregarLinksRemotos
});

window.HUB_CLOUD_TASKS = Object.freeze({
    atualizar: atualizarTarefa,
    criar: criarTarefa,
    excluir: excluirTarefa,
    registrarRevisao: registrarRevisaoTarefa,
    listar: carregarTarefasRemotas
});

window.HUB_CLOUD_STUDY_DIARY = Object.freeze({
    atualizar: atualizarRegistroEstudo,
    excluir: excluirRegistroEstudo,
    listar: carregarRegistrosEstudo
});

window.HUB_CLOUD_EXAM = Object.freeze({
    adicionarMateria: criarMateriaEdital,
    adicionarTopicos: criarTopicosEdital,
    atualizarMateria: atualizarMateriaEdital,
    atualizarTopico: atualizarTopicoEdital,
    renomearTopico: renomearTopicoEdital,
    excluirTopico: excluirTopicoEdital,
    excluirMateria: excluirMateriaEdital,
    limparConfiguracao: excluirConfiguracaoEdital,
    listar: carregarEditalRemoto,
    salvarConfiguracao: salvarConfiguracaoEdital
});

window.HUB_CLOUD_ERRORS = Object.freeze({
    criar: criarErro,
    registrarSimulado: registrarErroSimulado,
    revisar: registrarRevisaoErro,
    marcarReforco: marcarReforcoErro,
    excluir: excluirErro,
    listar: carregarErrosRemotos
});

window.HUB_CLOUD_PERFORMANCE = Object.freeze({
    listar: carregarDesempenhoRemoto,
    registrarResposta: registrarRespostaDesempenho
});

window.HUB_CLOUD_AI = Object.freeze({
    async gerarSimulado(parametros) {
        if (!supabase) throw new Error("A conexão segura com o Supabase não está configurada.");
        const { data, error } = await supabase.functions.invoke("generate-quiz", {
            body: parametros
        });
        if (error) {
            let mensagem = "A geração segura de simulados ainda não está disponível.";
            try {
                const detalhe = await error.context?.clone?.().json();
                if (typeof detalhe?.error === "string" && detalhe.error.trim()) mensagem = detalhe.error.trim();
            } catch (_) {
                // A resposta pode não conter JSON; mantemos uma mensagem segura e compreensível.
            }
            throw new Error(mensagem);
        }
        if (!data || !Array.isArray(data.questions)) throw new Error("A IA não retornou questões válidas.");
        return {
            questions: data.questions,
            quota: data.quota && Number.isInteger(data.quota.remaining) && Number.isInteger(data.quota.limit)
                ? { remaining: data.quota.remaining, limit: data.quota.limit }
                : null
        };
    }
});

window.HUB_CLOUD_BACKUP = Object.freeze({
    restaurar: restaurarBackupRemoto
});

const authLoadingShell = document.getElementById("authLoadingShell");
const authShell = document.getElementById("authShell");
const appShell = document.getElementById("appShell");
const formLogin = document.getElementById("formLogin");
const formRecuperacao = document.getElementById("formRecuperacao");
const formCodigoRecuperacao = document.getElementById("formCodigoRecuperacao");
const formNovaSenha = document.getElementById("formNovaSenha");
const inputEmail = document.getElementById("loginEmail");
const inputSenha = document.getElementById("loginSenha");
const recuperacaoEmail = document.getElementById("recuperacaoEmail");
const codigoRecuperacaoEmail = document.getElementById("codigoRecuperacaoEmail");
const recuperacaoCodigo = document.getElementById("recuperacaoCodigo");
const novaSenha = document.getElementById("novaSenha");
const confirmarNovaSenha = document.getElementById("confirmarNovaSenha");
const btnEntrar = document.getElementById("btnEntrar");
const btnAbrirRecuperacao = document.getElementById("btnAbrirRecuperacao");
const btnEnviarRecuperacao = document.getElementById("btnEnviarRecuperacao");
const btnJaTenhoCodigo = document.getElementById("btnJaTenhoCodigo");
const btnValidarCodigo = document.getElementById("btnValidarCodigo");
const btnVoltarRecuperacao = document.getElementById("btnVoltarRecuperacao");
const btnVoltarLogin = document.getElementById("btnVoltarLogin");
const btnSalvarNovaSenha = document.getElementById("btnSalvarNovaSenha");
const btnSair = document.getElementById("btnSair");
const loginSpinner = document.getElementById("loginSpinner");
const loginButtonText = document.getElementById("loginButtonText");
const recuperacaoSpinner = document.getElementById("recuperacaoSpinner");
const recuperacaoButtonText = document.getElementById("recuperacaoButtonText");
const codigoRecuperacaoSpinner = document.getElementById("codigoRecuperacaoSpinner");
const codigoRecuperacaoButtonText = document.getElementById("codigoRecuperacaoButtonText");
const novaSenhaSpinner = document.getElementById("novaSenhaSpinner");
const novaSenhaButtonText = document.getElementById("novaSenhaButtonText");
const authMessage = document.getElementById("authMessage");

let usuarioAtivoId = null;
let ativacaoEmAndamento = null;
let modoNovaSenhaAtivo = false;
let sessaoParaNovaSenha = null;
let verificacaoInicialEmAndamento = true;

function mostrarMensagem(texto, tipo = "danger") {
    authMessage.textContent = texto;
    authMessage.className = `alert alert-${tipo}`;
}

function limparMensagem() {
    authMessage.textContent = "";
    authMessage.className = "alert d-none";
}

function ocultarShellFlex(elemento) {
    elemento.classList.add("d-none");
    elemento.classList.remove("d-flex");
}

function mostrarShellFlex(elemento) {
    elemento.classList.remove("d-none");
    elemento.classList.add("d-flex");
}

function mostrarShellAutenticacao() {
    ocultarShellFlex(authLoadingShell);
    mostrarShellFlex(authShell);
}

function mostrarSomenteFormulario(formulario) {
    formLogin.classList.toggle("d-none", formulario !== formLogin);
    formRecuperacao.classList.toggle("d-none", formulario !== formRecuperacao);
    formCodigoRecuperacao.classList.toggle("d-none", formulario !== formCodigoRecuperacao);
    formNovaSenha.classList.toggle("d-none", formulario !== formNovaSenha);
}

function definirCarregandoLogin(ativo) {
    btnEntrar.disabled = ativo;
    inputEmail.disabled = ativo;
    inputSenha.disabled = ativo;
    btnAbrirRecuperacao.disabled = ativo;
    loginSpinner.classList.toggle("d-none", !ativo);
    loginButtonText.textContent = ativo ? "Entrando..." : "Entrar";
}

function definirCarregandoRecuperacao(ativo) {
    recuperacaoEmail.disabled = ativo;
    btnEnviarRecuperacao.disabled = ativo;
    btnJaTenhoCodigo.disabled = ativo;
    btnVoltarLogin.disabled = ativo;
    recuperacaoSpinner.classList.toggle("d-none", !ativo);
    recuperacaoButtonText.textContent = ativo ? "Enviando..." : "Enviar código seguro";
}

function definirCarregandoCodigoRecuperacao(ativo) {
    codigoRecuperacaoEmail.disabled = ativo;
    recuperacaoCodigo.disabled = ativo;
    btnValidarCodigo.disabled = ativo;
    btnVoltarRecuperacao.disabled = ativo;
    codigoRecuperacaoSpinner.classList.toggle("d-none", !ativo);
    codigoRecuperacaoButtonText.textContent = ativo ? "Confirmando..." : "Confirmar código";
}

function definirCarregandoNovaSenha(ativo) {
    novaSenha.disabled = ativo;
    confirmarNovaSenha.disabled = ativo;
    btnSalvarNovaSenha.disabled = ativo;
    novaSenhaSpinner.classList.toggle("d-none", !ativo);
    novaSenhaButtonText.textContent = ativo ? "Salvando..." : "Salvar senha e entrar";
}

function mensagemDeErro(erro) {
    const mensagem = String(erro?.message || "").toLowerCase();
    if (mensagem.includes("invalid login credentials")) return "E-mail ou senha inválidos.";
    if (mensagem.includes("email not confirmed")) return "Confirme seu e-mail antes de entrar.";
    if (mensagem.includes("failed to fetch") || mensagem.includes("network")) return "Não foi possível conectar ao serviço. Verifique sua internet e tente novamente.";
    return "Não foi possível entrar com segurança. Tente novamente.";
}

function mostrarLogin(mensagem = "", tipo = "danger") {
    verificacaoInicialEmAndamento = false;
    usuarioAtivoId = null;
    modoNovaSenhaAtivo = false;
    sessaoParaNovaSenha = null;
    window.encerrarHub?.();
    encerrarRepositorioRemoto();
    encerrarPreviaMigracao();
    encerrarAdministracao();
    appShell.classList.add("d-none");
    mostrarShellAutenticacao();
    mostrarSomenteFormulario(formLogin);
    inputSenha.value = "";
    definirCarregandoLogin(false);
    definirCarregandoRecuperacao(false);
    definirCarregandoCodigoRecuperacao(false);
    definirCarregandoNovaSenha(false);
    if (mensagem) mostrarMensagem(mensagem, tipo);
    else limparMensagem();
}

function mostrarRecuperacao() {
    window.encerrarHub?.();
    appShell.classList.add("d-none");
    mostrarShellAutenticacao();
    mostrarSomenteFormulario(formRecuperacao);
    recuperacaoEmail.value = inputEmail.value.trim();
    limparMensagem();
    definirCarregandoRecuperacao(false);
    recuperacaoEmail.focus();
}

function mostrarCodigoRecuperacao(email = "", mensagem = "") {
    window.encerrarHub?.();
    appShell.classList.add("d-none");
    mostrarShellAutenticacao();
    mostrarSomenteFormulario(formCodigoRecuperacao);
    codigoRecuperacaoEmail.value = email.trim();
    recuperacaoCodigo.value = "";
    definirCarregandoCodigoRecuperacao(false);
    if (mensagem) mostrarMensagem(mensagem, "success");
    else limparMensagem();
    (codigoRecuperacaoEmail.value ? recuperacaoCodigo : codigoRecuperacaoEmail).focus();
}

function mostrarDefinicaoDeSenha(session) {
    verificacaoInicialEmAndamento = false;
    modoNovaSenhaAtivo = true;
    sessaoParaNovaSenha = session;
    window.encerrarHub?.();
    appShell.classList.add("d-none");
    mostrarShellAutenticacao();
    mostrarSomenteFormulario(formNovaSenha);
    novaSenha.value = "";
    confirmarNovaSenha.value = "";
    limparMensagem();
    definirCarregandoNovaSenha(false);
    novaSenha.focus();
}

async function carregarContexto(user) {
    const [perfilResposta, workspaceResposta] = await Promise.all([
        supabase.from("profiles").select("display_name").eq("id", user.id).single(),
        supabase.from("workspaces").select("id, name, kind").eq("owner_id", user.id).eq("kind", "personal").single()
    ]);

    if (perfilResposta.error) throw perfilResposta.error;
    if (workspaceResposta.error) throw workspaceResposta.error;

    return {
        userId: user.id,
        email: user.email || "",
        displayName: perfilResposta.data.display_name || user.email || "Usuário",
        workspaceId: workspaceResposta.data.id,
        workspaceName: workspaceResposta.data.name,
        workspaceKind: workspaceResposta.data.kind,
        role: "owner"
    };
}

async function ativarSessao(session) {
    if (!session?.user) {
        mostrarLogin();
        return;
    }
    if (usuarioAtivoId === session.user.id) return;
    if (ativacaoEmAndamento) return ativacaoEmAndamento;

    ativacaoEmAndamento = (async () => {
        if (!verificacaoInicialEmAndamento) mostrarShellAutenticacao();
        appShell.classList.add("d-none");
        definirCarregandoLogin(true);
        mostrarMensagem("Validando sua sessão e seu espaço de estudos...", "info");
        try {
            const contexto = await carregarContexto(session.user);
            await prepararRepositorioRemoto(contexto);
            const materiasRemotas = await carregarMateriasRemotas();
            if (materiasRemotas.some((materia, indice) => materia.position !== indice)) {
                await atualizarPosicoesMaterias(materiasRemotas.map(materia => materia.id));
                materiasRemotas.forEach((materia, indice) => { materia.position = indice; });
            }
            const topicosRemotos = await carregarTopicosRemotos();
            const notasRemotas = await carregarNotasRemotas();
            const flashcardsRemotos = await carregarFlashcardsRemotos();
            const linksRemotos = await carregarLinksRemotos();
            const tarefasRemotas = await carregarTarefasRemotas();
            const registrosEstudoRemotos = await carregarRegistrosEstudo();
            const editalRemoto = await carregarEditalRemoto();
            const errosRemotos = await carregarErrosRemotos();
            const desempenhoRemoto = await carregarDesempenhoRemoto();
            const [catalogoRemoto, widgetsRemotos, bibliotecaJuridicaRemota, colecoesVadeRemotas, grifosJuridicosRemotos, estadoLeituraJuridicaRemoto] = await Promise.all([
                carregarCatalogoMaterias(),
                carregarWidgetsMaterias(),
                carregarBibliotecaJuridica(),
                carregarColecoesVade(),
                carregarGrifosJuridicos(),
                carregarEstadoLeituraJuridica()
            ]);
            await window.iniciarHub(contexto, materiasRemotas, topicosRemotos, notasRemotas, flashcardsRemotos, linksRemotos, tarefasRemotas, editalRemoto, errosRemotos, desempenhoRemoto, catalogoRemoto, widgetsRemotos, bibliotecaJuridicaRemota, colecoesVadeRemotas, grifosJuridicosRemotos, estadoLeituraJuridicaRemoto, registrosEstudoRemotos);
            iniciarPreviaMigracao(contexto);
            await iniciarAdministracao();
            usuarioAtivoId = session.user.id;
            verificacaoInicialEmAndamento = false;
            limparMensagem();
            ocultarShellFlex(authLoadingShell);
            ocultarShellFlex(authShell);
            appShell.classList.remove("d-none");
        } catch (erro) {
            console.error("Falha ao preparar a sessão autenticada", erro);
            mostrarLogin("Sua conta entrou, mas o espaço de estudos não pôde ser carregado. Tente novamente em instantes.");
        } finally {
            definirCarregandoLogin(false);
            ativacaoEmAndamento = null;
        }
    })();

    return ativacaoEmAndamento;
}

formLogin.addEventListener("submit", async evento => {
    evento.preventDefault();
    if (!supabase) return;
    if (!formLogin.checkValidity()) {
        formLogin.reportValidity();
        return;
    }

    limparMensagem();
    definirCarregandoLogin(true);
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: inputEmail.value.trim(),
            password: inputSenha.value
        });
        if (error) throw error;
        await ativarSessao(data.session);
    } catch (erro) {
        console.error("Falha de autenticação", erro);
        mostrarMensagem(mensagemDeErro(erro));
        definirCarregandoLogin(false);
    }
});

btnAbrirRecuperacao.addEventListener("click", mostrarRecuperacao);
btnVoltarLogin.addEventListener("click", () => mostrarLogin());

formRecuperacao.addEventListener("submit", async evento => {
    evento.preventDefault();
    if (!supabase) return;
    if (!formRecuperacao.checkValidity()) {
        formRecuperacao.reportValidity();
        return;
    }

    limparMensagem();
    definirCarregandoRecuperacao(true);
    try {
        const email = recuperacaoEmail.value.trim();
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
        inputEmail.value = email;
        mostrarCodigoRecuperacao(email, "Se esse e-mail estiver autorizado, o código chegará em instantes. Verifique também o spam.");
    } catch (erro) {
        console.error("Falha ao solicitar recuperação de senha", erro);
        const mensagem = String(erro?.message || "").toLowerCase();
        if (mensagem.includes("failed to fetch") || mensagem.includes("network")) {
            mostrarMensagem("Não foi possível conectar ao serviço. Verifique sua internet e tente novamente.");
        } else {
            mostrarMensagem("Não foi possível enviar o link agora. Aguarde um momento e tente novamente.");
        }
        definirCarregandoRecuperacao(false);
    }
});

btnJaTenhoCodigo.addEventListener("click", () => mostrarCodigoRecuperacao(recuperacaoEmail.value));
btnVoltarRecuperacao.addEventListener("click", () => {
    recuperacaoEmail.value = codigoRecuperacaoEmail.value.trim();
    mostrarRecuperacao();
});

formCodigoRecuperacao.addEventListener("submit", async evento => {
    evento.preventDefault();
    if (!supabase) return;
    const codigo = recuperacaoCodigo.value.replace(/\s/g, "");
    recuperacaoCodigo.value = codigo;
    if (!formCodigoRecuperacao.checkValidity()) {
        formCodigoRecuperacao.reportValidity();
        return;
    }

    limparMensagem();
    definirCarregandoCodigoRecuperacao(true);
    modoNovaSenhaAtivo = true;
    try {
        const { data, error } = await supabase.auth.verifyOtp({
            email: codigoRecuperacaoEmail.value.trim(),
            token: codigo,
            type: "recovery"
        });
        if (error || !data.session) throw error || new Error("RECOVERY_SESSION_MISSING");
        inputEmail.value = codigoRecuperacaoEmail.value.trim();
        mostrarDefinicaoDeSenha(data.session);
        mostrarMensagem("Código confirmado. Agora crie sua nova senha.", "success");
    } catch (erro) {
        console.error("Falha ao confirmar código de recuperação", erro);
        modoNovaSenhaAtivo = false;
        mostrarMensagem("Código inválido ou expirado. Confira o código mais recente ou solicite outro.");
        definirCarregandoCodigoRecuperacao(false);
    }
});

formNovaSenha.addEventListener("submit", async evento => {
    evento.preventDefault();
    if (!supabase || !sessaoParaNovaSenha) return;

    confirmarNovaSenha.setCustomValidity("");
    const senha = novaSenha.value;
    const senhaForte = senha.length >= 8
        && /[a-z]/.test(senha)
        && /[A-Z]/.test(senha)
        && /\d/.test(senha)
        && /[^A-Za-z0-9]/.test(senha);

    if (!senhaForte) {
        mostrarMensagem("A senha precisa ter 8 ou mais caracteres, com maiúscula, minúscula, número e símbolo.");
        novaSenha.focus();
        return;
    }
    if (senha !== confirmarNovaSenha.value) {
        confirmarNovaSenha.setCustomValidity("As senhas não coincidem.");
        confirmarNovaSenha.reportValidity();
        return;
    }
    if (!formNovaSenha.checkValidity()) {
        formNovaSenha.reportValidity();
        return;
    }

    limparMensagem();
    definirCarregandoNovaSenha(true);
    try {
        const { error } = await supabase.auth.updateUser({ password: senha });
        if (error) throw error;
        const { data: sessaoAtualizada, error: erroSessao } = await supabase.auth.refreshSession();
        if (erroSessao || !sessaoAtualizada.session) throw erroSessao || new Error("RECOVERY_SESSION_REFRESH_FAILED");
        novaSenha.value = "";
        confirmarNovaSenha.value = "";
        window.history.replaceState({}, document.title, window.location.pathname);
        modoNovaSenhaAtivo = false;
        sessaoParaNovaSenha = null;
        await ativarSessao(sessaoAtualizada.session);
    } catch (erro) {
        console.error("Falha ao definir nova senha", erro);
        definirCarregandoNovaSenha(false);
        const mensagem = String(erro?.message || "").toLowerCase();
        if (mensagem.includes("different from the old password")) {
            mostrarMensagem("Escolha uma senha diferente da anterior.");
        } else if (mensagem.includes("session") || mensagem.includes("expired")) {
            mostrarLogin("Este link expirou ou já foi usado. Solicite um novo link.");
        } else {
            mostrarMensagem("Não foi possível salvar a senha. Confira os requisitos e tente novamente.");
        }
    }
});

confirmarNovaSenha.addEventListener("input", () => confirmarNovaSenha.setCustomValidity(""));

btnSair.addEventListener("click", async () => {
    if (!supabase) return;
    if (await window.prepararSaidaHub?.() === false) {
        alert("Há uma nota que não pôde ser salva. Corrija o problema ou faça um backup antes de sair.");
        return;
    }
    btnSair.disabled = true;
    try {
        const { error } = await supabase.auth.signOut({ scope: "local" });
        if (error) throw error;
        mostrarLogin();
    } catch (erro) {
        console.error("Falha ao encerrar sessão", erro);
        alert("Não foi possível sair com segurança. Verifique sua conexão e tente novamente.");
    } finally {
        btnSair.disabled = false;
    }
});

async function iniciarAutenticacao() {
    if (erroConfiguracaoSupabase || !supabase) {
        mostrarLogin(erroConfiguracaoSupabase || "Supabase indisponível.");
        btnEntrar.disabled = true;
        inputEmail.disabled = true;
        inputSenha.disabled = true;
        btnAbrirRecuperacao.disabled = true;
        return;
    }

    supabase.auth.onAuthStateChange((evento, session) => {
        setTimeout(() => {
            if (evento === "INITIAL_SESSION") {
                return;
            } else if (evento === "PASSWORD_RECOVERY") {
                mostrarDefinicaoDeSenha(session);
            } else if (evento === "SIGNED_OUT" || !session) {
                mostrarLogin();
            } else if (!modoNovaSenhaAtivo) {
                ativarSessao(session);
            }
        }, 0);
    });

    definirCarregandoLogin(true);
    mostrarMensagem("Verificando sua sessão...", "info");
    const { data, error } = await supabase.auth.getSession();
    if (error) {
        console.error("Falha ao restaurar sessão", error);
        mostrarLogin("Não foi possível restaurar sua sessão. Entre novamente.");
        return;
    }
    if (data.session && tipoDoLinkDeAutenticacao) mostrarDefinicaoDeSenha(data.session);
    else if (data.session) await ativarSessao(data.session);
    else if (tipoDoLinkDeAutenticacao) mostrarLogin("Este link expirou ou já foi usado. Solicite um novo link.");
    else mostrarLogin();
}

iniciarAutenticacao();
