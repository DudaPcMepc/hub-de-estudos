import { supabase } from "./supabase-client.js";

const tabItem = document.getElementById("abaAdministracaoItem");
const formInvite = document.getElementById("formConviteUsuario");
const inputEmail = document.getElementById("conviteUsuarioEmail");
const inviteButton = document.getElementById("btnConvidarUsuario");
const refreshButton = document.getElementById("btnAtualizarUsuarios");
const message = document.getElementById("mensagemAdministracao");
const tableBody = document.getElementById("corpoUsuariosAdministracao");
const emptyState = document.getElementById("usuariosAdministracaoVazio");
const deleteModalElement = document.getElementById("modalExcluirUsuario");
const deleteTargetEmail = document.getElementById("exclusaoUsuarioEmail");
const deletePreviewList = document.getElementById("resumoExclusaoUsuario");
const deleteWarning = document.getElementById("avisoExclusaoUsuario");
const deleteForm = document.getElementById("formExcluirUsuario");
const deleteConfirmation = document.getElementById("confirmacaoExclusaoUsuario");
const deleteExpectedConfirmation = document.getElementById("textoConfirmacaoExclusaoUsuario");
const deleteButton = document.getElementById("btnConfirmarExclusaoUsuario");

let enabled = false;
let listenersReady = false;
let currentDeletion = null;

const PREVIEW_LABELS = Object.freeze([
    ["subjects", "Matérias"],
    ["topics", "Tópicos"],
    ["notes", "Notas"],
    ["flashcards", "Flashcards"],
    ["study_links", "Materiais e links"],
    ["study_tasks", "Sessões do cronograma"],
    ["personal_exam_subjects", "Matérias do edital pessoal"],
    ["personal_exam_topics", "Tópicos do edital pessoal"],
    ["personal_error_entries", "Registros no caderno de erros"],
    ["personal_quiz_attempts", "Tentativas de simulados"],
    ["personal_subject_performance", "Históricos de desempenho"],
    ["ai_daily_usage_days", "Registros de uso da IA"]
]);

function setMessage(text, type = "danger") {
    message.textContent = text;
    message.className = `alert alert-${type}`;
}

function clearMessage() {
    message.textContent = "";
    message.className = "alert d-none";
}

function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short"
    }).format(date);
}

async function invoke(action, extra = {}) {
    const { data, error } = await supabase.functions.invoke("admin-users", {
        body: { action, ...extra }
    });
    if (error) {
        let detail = "Não foi possível acessar a administração agora.";
        try {
            const response = await error.context?.clone?.().json();
            if (typeof response?.error === "string" && response.error.trim()) detail = response.error.trim();
        } catch (_) {
            // Mantemos a mensagem segura quando o serviço não devolve JSON.
        }
        throw new Error(detail);
    }
    return data || {};
}

function renderUsers(users) {
    tableBody.replaceChildren();
    emptyState.classList.toggle("d-none", users.length > 0);
    for (const user of users) {
        const row = document.createElement("tr");
        const emailCell = document.createElement("td");
        const statusCell = document.createElement("td");
        const createdCell = document.createElement("td");
        const accessCell = document.createElement("td");
        const actionCell = document.createElement("td");
        const badge = document.createElement("span");

        emailCell.textContent = user.email || "Conta sem e-mail";
        badge.className = user.confirmedAt ? "badge text-bg-success" : "badge text-bg-warning";
        badge.textContent = user.confirmedAt ? "Confirmada" : "Convite pendente";
        statusCell.appendChild(badge);
        createdCell.textContent = formatDate(user.createdAt);
        accessCell.textContent = formatDate(user.lastSignInAt);
        if (user.isCurrent) {
            const currentBadge = document.createElement("span");
            currentBadge.className = "badge text-bg-secondary";
            currentBadge.textContent = "Sua conta";
            actionCell.appendChild(currentBadge);
        } else {
            const reviewButton = document.createElement("button");
            reviewButton.type = "button";
            reviewButton.className = "btn btn-sm btn-outline-danger";
            reviewButton.dataset.action = "preview-delete";
            reviewButton.dataset.userId = user.id;
            reviewButton.textContent = "Revisar exclusão";
            actionCell.appendChild(reviewButton);
        }
        row.append(emailCell, statusCell, createdCell, accessCell, actionCell);
        tableBody.appendChild(row);
    }
}

function renderDeletePreview(preview) {
    deletePreviewList.replaceChildren();
    for (const [key, label] of PREVIEW_LABELS) {
        const item = document.createElement("li");
        item.className = "list-group-item d-flex justify-content-between align-items-center";
        const text = document.createElement("span");
        const count = document.createElement("strong");
        text.textContent = label;
        count.textContent = String(Number(preview?.[key]) || 0);
        item.append(text, count);
        deletePreviewList.appendChild(item);
    }
}

async function openDeletePreview(targetUserId) {
    clearMessage();
    try {
        const data = await invoke("preview-delete", { targetUserId });
        if (!data.target?.id || !data.target?.email || !data.confirmation) {
            throw new Error("A prévia recebida é inválida.");
        }
        currentDeletion = {
            id: data.target.id,
            email: data.target.email,
            confirmation: data.confirmation
        };
        deleteTargetEmail.textContent = currentDeletion.email;
        deleteExpectedConfirmation.textContent = currentDeletion.confirmation;
        deleteConfirmation.value = "";
        renderDeletePreview(data.preview || {});
        const ownsSharedWorkspace = Number(data.preview?.shared_workspaces_owned) > 0;
        deleteWarning.className = ownsSharedWorkspace ? "alert alert-danger" : "alert alert-warning";
        deleteWarning.textContent = ownsSharedWorkspace
            ? "Esta conta possui um espaço compartilhado. Transfira a propriedade antes de excluí-la."
            : "Esta operação excluirá a conta e o espaço pessoal. Ela não pode ser desfeita.";
        deleteConfirmation.disabled = ownsSharedWorkspace;
        deleteButton.disabled = ownsSharedWorkspace;
        bootstrap.Modal.getOrCreateInstance(deleteModalElement).show();
    } catch (error) {
        setMessage(error.message);
    }
}

async function loadUsers() {
    if (!enabled) return;
    refreshButton.disabled = true;
    try {
        const data = await invoke("list");
        const users = Array.isArray(data.users) ? data.users : [];
        renderUsers(users);
    } catch (error) {
        setMessage(error.message);
    } finally {
        refreshButton.disabled = false;
    }
}

function prepareListeners() {
    if (listenersReady) return;
    listenersReady = true;

    refreshButton.addEventListener("click", loadUsers);
    tableBody.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-action='preview-delete']");
        if (!button) return;
        openDeletePreview(button.dataset.userId || "");
    });
    formInvite.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!formInvite.checkValidity()) {
            formInvite.reportValidity();
            return;
        }
        clearMessage();
        inviteButton.disabled = true;
        inputEmail.disabled = true;
        try {
            const data = await invoke("invite", { email: inputEmail.value.trim() });
            inputEmail.value = "";
            setMessage(data.message || "Convite enviado com segurança.", "success");
            await loadUsers();
        } catch (error) {
            setMessage(error.message);
        } finally {
            inviteButton.disabled = false;
            inputEmail.disabled = false;
        }
    });

    deleteForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!currentDeletion) return;
        const confirmation = deleteConfirmation.value.trim();
        if (confirmation !== currentDeletion.confirmation) {
            deleteConfirmation.setCustomValidity("Digite exatamente a confirmação exibida.");
            deleteConfirmation.reportValidity();
            deleteConfirmation.setCustomValidity("");
            return;
        }
        deleteButton.disabled = true;
        deleteConfirmation.disabled = true;
        try {
            const data = await invoke("delete", {
                targetUserId: currentDeletion.id,
                confirmation
            });
            bootstrap.Modal.getOrCreateInstance(deleteModalElement).hide();
            setMessage(data.message || "Conta excluída com segurança.", "success");
            currentDeletion = null;
            await loadUsers();
        } catch (error) {
            deleteWarning.className = "alert alert-danger";
            deleteWarning.textContent = error.message;
        } finally {
            deleteButton.disabled = false;
            deleteConfirmation.disabled = false;
        }
    });

    deleteModalElement.addEventListener("hidden.bs.modal", () => {
        currentDeletion = null;
        deleteConfirmation.value = "";
        deletePreviewList.replaceChildren();
    });
}

export async function iniciarAdministracao() {
    encerrarAdministracao();
    if (!supabase) return;
    try {
        const data = await invoke("status");
        enabled = data.isAdmin === true;
        if (!enabled) return;
        prepareListeners();
        tabItem.classList.remove("d-none");
        clearMessage();
        await loadUsers();
    } catch (error) {
        console.error("Falha ao preparar a administração", error);
    }
}

export function encerrarAdministracao() {
    enabled = false;
    tabItem.classList.add("d-none");
    tableBody.replaceChildren();
    emptyState.classList.remove("d-none");
    currentDeletion = null;
    clearMessage();
}
