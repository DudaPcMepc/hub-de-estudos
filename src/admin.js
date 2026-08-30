import { supabase } from "./supabase-client.js";

const tabItem = document.getElementById("abaAdministracaoItem");
const formInvite = document.getElementById("formConviteUsuario");
const inputEmail = document.getElementById("conviteUsuarioEmail");
const inviteButton = document.getElementById("btnConvidarUsuario");
const refreshButton = document.getElementById("btnAtualizarUsuarios");
const message = document.getElementById("mensagemAdministracao");
const tableBody = document.getElementById("corpoUsuariosAdministracao");
const emptyState = document.getElementById("usuariosAdministracaoVazio");

let enabled = false;
let listenersReady = false;

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
        const badge = document.createElement("span");

        emailCell.textContent = user.email || "Conta sem e-mail";
        badge.className = user.confirmedAt ? "badge text-bg-success" : "badge text-bg-warning";
        badge.textContent = user.confirmedAt ? "Confirmada" : "Convite pendente";
        statusCell.appendChild(badge);
        createdCell.textContent = formatDate(user.createdAt);
        accessCell.textContent = formatDate(user.lastSignInAt);
        row.append(emailCell, statusCell, createdCell, accessCell);
        tableBody.appendChild(row);
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
    clearMessage();
}
