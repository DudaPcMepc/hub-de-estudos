import { supabase } from "./supabase-client.js";

const byId = id => document.getElementById(id);
const state = { enabled: false, ready: false, subjects: [], modules: [], materials: [] };

async function invoke(action, extra = {}) {
    const { data, error } = await supabase.functions.invoke("admin-subject-content", { body: { action, ...extra } });
    if (error) {
        let detail = "Não foi possível acessar o conteúdo das matérias.";
        try {
            const response = await error.context?.clone?.().json();
            if (typeof response?.error === "string" && response.error.trim()) detail = response.error.trim();
        } catch (_) {}
        throw new Error(detail);
    }
    return data || {};
}

function message(text = "", type = "danger") {
    const element = byId("mensagemConteudoMaterias");
    element.textContent = text;
    element.className = text ? `alert alert-${type}` : "alert d-none";
}

function selectedSubjectId() { return byId("adminConteudoMateria").value; }
function modulesForSubject() { return state.modules.filter(item => item.catalog_subject_id === selectedSubjectId()); }

function resetModuleForm() {
    byId("formModuloMateria").reset();
    byId("adminModuloId").value = "";
    byId("adminModuloPosicao").value = String(modulesForSubject().length);
    byId("btnCancelarModuloMateria").classList.add("d-none");
}

function resetMaterialForm() {
    byId("formMaterialMateria").reset();
    byId("adminMaterialId").value = "";
    byId("adminMaterialPosicao").value = String(state.materials.filter(item => item.catalog_subject_id === selectedSubjectId()).length);
    byId("btnCancelarMaterialMateria").classList.add("d-none");
}

function render() {
    const modules = modulesForSubject();
    const moduleSelect = byId("adminMaterialModulo");
    moduleSelect.innerHTML = modules.length
        ? modules.map(item => `<option value="${item.id}">${escapeHtml(item.title)}</option>`).join("")
        : '<option value="">Crie um módulo primeiro</option>';
    moduleSelect.disabled = !modules.length;
    byId("formMaterialMateria").querySelector("button[type='submit']").disabled = !modules.length;
    byId("listaModulosMateria").innerHTML = modules.length ? modules.map(item => `
        <article class="admin-editorial-item" data-module-id="${item.id}"><div class="d-flex justify-content-between gap-2"><div><strong>${escapeHtml(item.title)}</strong><small class="d-block text-muted">${item.status === "published" ? "Publicado" : "Rascunho"} · ordem ${item.position}</small></div><div class="d-flex gap-1"><button class="btn btn-sm btn-outline-secondary" data-action="edit-module" title="Editar"><i class="bi-pencil"></i></button><button class="btn btn-sm btn-outline-danger" data-action="delete-module" title="Excluir"><i class="bi-trash"></i></button></div></div></article>`).join("") : '<p class="text-muted small text-center py-3">Nenhum módulo nesta disciplina.</p>';
    const moduleIds = new Set(modules.map(item => item.id));
    const materials = state.materials.filter(item => moduleIds.has(item.module_id));
    byId("listaMateriaisMateria").innerHTML = materials.length ? materials.map(item => `
        <article class="admin-editorial-item" data-material-id="${item.id}"><div class="d-flex justify-content-between gap-2"><div><strong>${escapeHtml(item.title)}</strong><small class="d-block text-muted">${escapeHtml(item.kind)} · ${item.status === "published" ? "Publicado" : "Rascunho"}</small></div><div class="d-flex gap-1"><button class="btn btn-sm btn-outline-secondary" data-action="edit-material" title="Editar"><i class="bi-pencil"></i></button><button class="btn btn-sm btn-outline-danger" data-action="delete-material" title="Excluir"><i class="bi-trash"></i></button></div></div></article>`).join("") : '<p class="text-muted small text-center py-3">Nenhum conteúdo nesta disciplina.</p>';
}

function escapeHtml(value) {
    const span = document.createElement("span");
    span.textContent = String(value || "");
    return span.innerHTML;
}

async function load() {
    if (!state.enabled) return;
    byId("btnAtualizarConteudoMaterias").disabled = true;
    try {
        const data = await invoke("list");
        state.subjects = Array.isArray(data.subjects) ? data.subjects : [];
        state.modules = Array.isArray(data.modules) ? data.modules : [];
        state.materials = Array.isArray(data.materials) ? data.materials : [];
        const select = byId("adminConteudoMateria");
        const previous = select.value;
        select.innerHTML = state.subjects.filter(item => item.active !== false).map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("");
        if (state.subjects.some(item => item.id === previous)) select.value = previous;
        resetModuleForm(); resetMaterialForm(); render(); message();
    } catch (error) { message(error.message); }
    finally { byId("btnAtualizarConteudoMaterias").disabled = false; }
}

function prepare() {
    if (state.ready) return;
    state.ready = true;
    byId("btnAtualizarConteudoMaterias").addEventListener("click", load);
    byId("adminConteudoMateria").addEventListener("change", () => { resetModuleForm(); resetMaterialForm(); render(); });
    byId("btnCancelarModuloMateria").addEventListener("click", resetModuleForm);
    byId("btnCancelarMaterialMateria").addEventListener("click", resetMaterialForm);
    byId("formModuloMateria").addEventListener("submit", async event => {
        event.preventDefault();
        const button = event.currentTarget.querySelector("button[type='submit']"); button.disabled = true;
        try {
            await invoke("save-module", { module: { id: byId("adminModuloId").value || undefined, catalogSubjectId: selectedSubjectId(), title: byId("adminModuloTitulo").value, description: byId("adminModuloDescricao").value, position: Number(byId("adminModuloPosicao").value), status: byId("adminModuloStatus").value } });
            await load(); message("Módulo salvo. O conteúdo publicado já pode aparecer para os estudantes.", "success");
        } catch (error) { message(error.message); } finally { button.disabled = false; }
    });
    byId("formMaterialMateria").addEventListener("submit", async event => {
        event.preventDefault();
        const button = event.currentTarget.querySelector("button[type='submit']"); button.disabled = true;
        try {
            await invoke("save-material", { material: { id: byId("adminMaterialId").value || undefined, catalogSubjectId: selectedSubjectId(), moduleId: byId("adminMaterialModulo").value, kind: byId("adminMaterialTipo").value, title: byId("adminMaterialTitulo").value, description: byId("adminMaterialDescricao").value, body: byId("adminMaterialConteudo").value, externalUrl: byId("adminMaterialUrl").value, position: Number(byId("adminMaterialPosicao").value), status: byId("adminMaterialStatus").value } });
            await load(); message("Conteúdo salvo com segurança.", "success");
        } catch (error) { message(error.message); } finally { button.disabled = false; }
    });
    byId("listaModulosMateria").addEventListener("click", async event => {
        const button = event.target.closest("button[data-action]"); if (!button) return;
        const item = state.modules.find(value => value.id === button.closest("[data-module-id]").dataset.moduleId); if (!item) return;
        if (button.dataset.action === "edit-module") {
            byId("adminModuloId").value = item.id; byId("adminModuloTitulo").value = item.title; byId("adminModuloDescricao").value = item.description || ""; byId("adminModuloPosicao").value = item.position; byId("adminModuloStatus").value = item.status; byId("btnCancelarModuloMateria").classList.remove("d-none"); return;
        }
        if (!confirm(`Excluir o módulo “${item.title}” e todo o conteúdo dele?`)) return;
        try { await invoke("delete-module", { moduleId: item.id }); await load(); message("Módulo removido.", "success"); } catch (error) { message(error.message); }
    });
    byId("listaMateriaisMateria").addEventListener("click", async event => {
        const button = event.target.closest("button[data-action]"); if (!button) return;
        const item = state.materials.find(value => value.id === button.closest("[data-material-id]").dataset.materialId); if (!item) return;
        if (button.dataset.action === "edit-material") {
            byId("adminMaterialId").value = item.id; byId("adminMaterialModulo").value = item.module_id; byId("adminMaterialTipo").value = item.kind; byId("adminMaterialTitulo").value = item.title; byId("adminMaterialDescricao").value = item.description || ""; byId("adminMaterialConteudo").value = item.body || ""; byId("adminMaterialUrl").value = item.external_url || ""; byId("adminMaterialPosicao").value = item.position; byId("adminMaterialStatus").value = item.status; byId("btnCancelarMaterialMateria").classList.remove("d-none"); return;
        }
        if (!confirm(`Excluir o conteúdo “${item.title}”?`)) return;
        try { await invoke("delete-material", { materialId: item.id }); await load(); message("Conteúdo removido.", "success"); } catch (error) { message(error.message); }
    });
}

export async function iniciarConteudoAdministrativo() { state.enabled = true; prepare(); await load(); }
export function encerrarConteudoAdministrativo() { state.enabled = false; state.subjects = []; state.modules = []; state.materials = []; byId("listaModulosMateria")?.replaceChildren(); byId("listaMateriaisMateria")?.replaceChildren(); }
