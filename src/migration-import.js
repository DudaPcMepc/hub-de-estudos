import { supabase } from "./supabase-client.js";

// Habilitado após a migration SQL ser revisada, autorizada e aplicada ao projeto remoto.
export const MIGRACAO_REMOTA_HABILITADA = true;

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

export async function importarDadosLocais(contexto) {
    if (!MIGRACAO_REMOTA_HABILITADA) {
        throw new Error("A importação remota ainda não foi habilitada.");
    }
    if (!supabase || !contexto?.workspaceId || !contexto?.userId) {
        throw new Error("A sessão autenticada não está pronta para a importação.");
    }

    const previaLocal = window.obterDadosParaPreviaMigracao?.();
    if (!previaLocal?.dados) throw new Error("Os dados locais não estão disponíveis.");
    const checksum = await calcularChecksum(previaLocal.dados);
    const { data, error } = await supabase.rpc("import_local_hub", {
        target_workspace_id: contexto.workspaceId,
        payload: previaLocal.dados,
        payload_checksum: checksum
    });
    if (error) throw error;
    if (!data || !["concluido", "ja_importado"].includes(data.status)) {
        throw new Error("A importação foi desfeita com segurança pelo banco.");
    }
    return data;
}

export async function restaurarBackupRemoto(contexto, dados) {
    if (!MIGRACAO_REMOTA_HABILITADA) {
        throw new Error("A restauração remota ainda não foi habilitada.");
    }
    if (!supabase || !contexto?.workspaceId || !contexto?.userId || contexto.workspaceKind !== "personal") {
        throw new Error("A restauração só pode ser realizada no espaço pessoal da conta conectada.");
    }
    if (!dados || typeof dados !== "object") throw new Error("O backup validado não está disponível.");

    const checksum = await calcularChecksum(dados);
    const { data, error } = await supabase.rpc("restore_hub_backup", {
        target_workspace_id: contexto.workspaceId,
        payload: dados,
        payload_checksum: checksum
    });
    if (error) throw error;
    if (!data || data.status !== "concluido" || data.restored !== true) {
        throw new Error("A restauração foi desfeita com segurança pelo banco.");
    }
    return data;
}
