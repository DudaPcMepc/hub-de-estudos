import { createClient } from "@supabase/supabase-js";

const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || "").trim();
const publishableKey = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "").trim();

function lerTipoDoLinkDeAutenticacao() {
    const url = new URL(window.location.href);
    const parametrosHash = new URLSearchParams(url.hash.replace(/^#/, ""));
    const tipo = url.searchParams.get("auth") || url.searchParams.get("type") || parametrosHash.get("type");
    return tipo === "invite" || tipo === "recovery" ? tipo : "";
}

export const tipoDoLinkDeAutenticacao = lerTipoDoLinkDeAutenticacao();

function validarConfiguracao() {
    if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/i.test(supabaseUrl)) {
        return "A URL pública do Supabase não está configurada corretamente.";
    }
    if (!/^(sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.test(publishableKey)) {
        return "A chave publicável do Supabase ainda não foi configurada neste computador.";
    }
    return "";
}

export const erroConfiguracaoSupabase = validarConfiguracao();

export const supabase = erroConfiguracaoSupabase
    ? null
    : createClient(supabaseUrl, publishableKey, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            flowType: "pkce"
        }
    });
