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

function readTargetUserId(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const targetUserId = (value as Record<string, unknown>).targetUserId;
  if (typeof targetUserId !== "string") return "";
  const normalized = targetUserId.trim();
  return /^[0-9a-f-]{36}$/i.test(normalized) ? normalized : "";
}

function readConfirmation(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const confirmation = (value as Record<string, unknown>).confirmation;
  return typeof confirmation === "string" && confirmation.length <= 300 ? confirmation.trim() : "";
}

function publicUser(user: {
  id: string;
  email?: string;
  created_at?: string;
  email_confirmed_at?: string;
  last_sign_in_at?: string;
}, currentUserId = "") {
  return {
    id: user.id,
    email: user.email || "",
    createdAt: user.created_at || null,
    confirmedAt: user.email_confirmed_at || null,
    lastSignInAt: user.last_sign_in_at || null,
    isCurrent: user.id === currentUserId,
  };
}

async function getDeletionTarget(
  supabaseAdmin: {
    auth: { admin: { getUserById: (id: string) => PromiseLike<{ data: { user: { id: string; email?: string } | null }; error: { message?: string } | null }> } };
    rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  },
  targetUserId: string,
) {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(targetUserId);
  if (error || !data.user) return { error: "Conta não encontrada.", status: 404 } as const;

  const { data: targetIsAdmin, error: targetAdminError } = await supabaseAdmin.rpc(
    "is_platform_admin",
    { target_user_id: targetUserId },
  );
  if (targetAdminError) return { error: "Não foi possível conferir a conta selecionada.", status: 503 } as const;
  if (targetIsAdmin === true) {
    return { error: "Contas administradoras não podem ser excluídas por este painel.", status: 409 } as const;
  }

  const email = String(data.user.email || "").trim().toLowerCase();
  if (!email) return { error: "A conta selecionada não possui um e-mail válido.", status: 409 } as const;
  return { user: data.user, email } as const;
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
        return Response.json({ users: data.users.map((user) => publicUser(user, userId)) });
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
        return Response.json({ user: publicUser(data.user, userId), message: "Convite enviado com segurança." });
      }

      if (action === "preview-delete" || action === "delete") {
        const targetUserId = readTargetUserId(body);
        if (!targetUserId) {
          return Response.json({ error: "A conta selecionada é inválida." }, { status: 400 });
        }
        if (targetUserId === userId) {
          return Response.json({ error: "Sua própria conta administradora não pode ser excluída." }, { status: 409 });
        }

        const target = await getDeletionTarget(context.supabaseAdmin, targetUserId);
        if ("error" in target) {
          return Response.json({ error: target.error }, { status: target.status });
        }

        if (action === "preview-delete") {
          const { data: preview, error: previewError } = await context.supabaseAdmin.rpc(
            "preview_user_deletion",
            { target_user_id: targetUserId },
          );
          if (previewError) throw previewError;
          return Response.json({
            target: { id: target.user.id, email: target.email },
            preview,
            confirmation: `EXCLUIR ${target.email}`,
          });
        }

        const expectedConfirmation = `EXCLUIR ${target.email}`;
        if (readConfirmation(body) !== expectedConfirmation) {
          return Response.json({ error: "A confirmação digitada não corresponde à conta selecionada." }, { status: 400 });
        }

        const { error: prepareError } = await context.supabaseAdmin.rpc(
          "prepare_user_deletion",
          { target_user_id: targetUserId, confirmation: `EXCLUIR ${targetUserId}` },
        );
        if (prepareError) {
          const message = String((prepareError as { message?: unknown }).message || "");
          const sharedOwner = message.includes("TRANSFER_SHARED_WORKSPACE_OWNERSHIP_FIRST");
          const changed = message.includes("USER_DATA_CHANGED_REVIEW_DELETION_AGAIN");
          return Response.json(
            { error: sharedOwner
              ? "Transfira primeiro os espaços compartilhados pertencentes a esta conta."
              : changed
              ? "Os dados mudaram desde a prévia. Revise a exclusão novamente."
              : "Não foi possível preparar a exclusão com segurança." },
            { status: sharedOwner || changed ? 409 : 502 },
          );
        }

        const { error: deleteError } = await context.supabaseAdmin.auth.admin.deleteUser(targetUserId, false);
        if (deleteError) {
          console.error("Prepared user deletion failed");
          return Response.json({ error: "A exclusão foi preparada, mas não pôde ser concluída." }, { status: 502 });
        }
        return Response.json({ message: "Conta e espaço pessoal excluídos com segurança." });
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
