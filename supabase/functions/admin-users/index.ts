import { withSupabase } from "npm:@supabase/server@^1";

const PRODUCTION_URL = "https://dudapcmepc.github.io/hub-de-estudos/";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readAction(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const action = (value as Record<string, unknown>).action;
  return typeof action === "string" ? action.trim() : "";
}

function readEmail(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const email = (value as Record<string, unknown>).email;
  if (typeof email !== "string") return "";
  const normalized = email.trim().toLowerCase();
  return normalized.length <= 254 && EMAIL_PATTERN.test(normalized) ? normalized : "";
}

function publicUser(user: {
  id: string;
  email?: string;
  created_at?: string;
  email_confirmed_at?: string;
  last_sign_in_at?: string;
}) {
  return {
    id: user.id,
    email: user.email || "",
    createdAt: user.created_at || null,
    confirmedAt: user.email_confirmed_at || null,
    lastSignInAt: user.last_sign_in_at || null,
  };
}

export default {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    if (request.method !== "POST") {
      return Response.json({ error: "Método não permitido." }, { status: 405 });
    }

    try {
      const body = await request.json();
      const action = readAction(body);
      const userId = String(context.userClaims?.id || context.userClaims?.sub || "");
      if (!/^[0-9a-f-]{36}$/i.test(userId)) {
        return Response.json({ error: "Não foi possível identificar sua conta." }, { status: 401 });
      }

      const { data: isAdmin, error: adminError } = await context.supabaseAdmin.rpc(
        "is_platform_admin",
        { target_user_id: userId },
      );
      if (adminError) {
        console.error("Failed to verify platform administrator");
        return Response.json({ error: "Não foi possível conferir a administração agora." }, { status: 503 });
      }

      if (action === "status") {
        return Response.json({ isAdmin: isAdmin === true });
      }
      if (isAdmin !== true) {
        return Response.json({ error: "Acesso administrativo não autorizado." }, { status: 403 });
      }

      if (action === "list") {
        const { data, error } = await context.supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 100,
        });
        if (error) throw error;
        return Response.json({ users: data.users.map(publicUser) });
      }

      if (action === "invite") {
        const email = readEmail(body);
        if (!email) {
          return Response.json({ error: "Informe um endereço de e-mail válido." }, { status: 400 });
        }
        const { data, error } = await context.supabaseAdmin.auth.admin.inviteUserByEmail(email, {
          redirectTo: PRODUCTION_URL,
        });
        if (error) {
          const duplicate = /already|registered|exists/i.test(error.message || "");
          return Response.json(
            { error: duplicate ? "Este e-mail já possui uma conta ou convite." : "Não foi possível enviar o convite agora." },
            { status: duplicate ? 409 : 502 },
          );
        }
        return Response.json({ user: publicUser(data.user), message: "Convite enviado com segurança." });
      }

      return Response.json({ error: "Operação administrativa inválida." }, { status: 400 });
    } catch (error) {
      console.error("Administrative user operation failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
      return Response.json({ error: "Não foi possível concluir a operação administrativa." }, { status: 502 });
    }
  }),
};
