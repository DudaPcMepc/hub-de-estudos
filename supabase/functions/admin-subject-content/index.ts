import { withSupabase } from "npm:@supabase/server@^1";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["draft", "published"]);
const KINDS = new Set(["lesson", "summary", "revision", "simulation", "link", "file"]);

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function string(value: unknown, limit: number, required = false): string {
  const result = typeof value === "string" ? value.trim() : "";
  if ((required && !result) || result.length > limit) throw new Error("INVALID_INPUT");
  return result;
}

function uuid(value: unknown): string {
  const result = string(value, 36, true);
  if (!UUID.test(result)) throw new Error("INVALID_INPUT");
  return result;
}

function position(value: unknown, maximum: number): number {
  const result = Number(value ?? 0);
  if (!Number.isInteger(result) || result < 0 || result > maximum) throw new Error("INVALID_INPUT");
  return result;
}

function status(value: unknown): string {
  const result = string(value, 20, true);
  if (!STATUSES.has(result)) throw new Error("INVALID_INPUT");
  return result;
}

function kind(value: unknown): string {
  const result = string(value, 20, true);
  if (!KINDS.has(result)) throw new Error("INVALID_INPUT");
  return result;
}

function httpsUrl(value: unknown): string | null {
  const result = string(value, 4000);
  if (!result) return null;
  try {
    const parsed = new URL(result);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error();
    return parsed.href;
  } catch (_) {
    throw new Error("INVALID_INPUT");
  }
}

export default {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    if (request.method !== "POST") return Response.json({ error: "Método não permitido." }, { status: 405 });
    try {
      const body = object(await request.json());
      const action = string(body.action, 40, true);
      const userId = String(context.userClaims?.id || context.userClaims?.sub || "");
      if (!UUID.test(userId)) return Response.json({ error: "Sessão administrativa inválida." }, { status: 401 });

      const { data: isAdmin, error: adminError } = await context.supabaseAdmin.rpc(
        "is_platform_admin",
        { target_user_id: userId },
      );
      if (adminError) return Response.json({ error: "Não foi possível conferir a administração." }, { status: 503 });
      if (isAdmin !== true) return Response.json({ error: "Acesso administrativo não autorizado." }, { status: 403 });

      if (action === "list") {
        const [subjects, modules, materials] = await Promise.all([
          context.supabaseAdmin.from("catalog_subjects").select("id, slug, name, category, icon, active").order("name"),
          context.supabaseAdmin.from("catalog_subject_modules").select("id, catalog_subject_id, title, description, position, status, published_at, updated_at").order("position").order("created_at"),
          context.supabaseAdmin.from("catalog_subject_materials").select("id, catalog_subject_id, module_id, kind, title, description, body, external_url, position, status, published_at, updated_at").order("position").order("created_at"),
        ]);
        if (subjects.error || modules.error || materials.error) throw subjects.error || modules.error || materials.error;
        return Response.json({ subjects: subjects.data || [], modules: modules.data || [], materials: materials.data || [] });
      }

      if (action === "save-module") {
        const module = object(body.module);
        const id = module.id ? uuid(module.id) : crypto.randomUUID();
        const moduleStatus = status(module.status || "draft");
        const payload = {
          id,
          catalog_subject_id: uuid(module.catalogSubjectId),
          title: string(module.title, 180, true),
          description: string(module.description, 2000),
          position: position(module.position, 1000),
          status: moduleStatus,
          published_at: moduleStatus === "published" ? new Date().toISOString() : null,
          updated_by: userId,
          ...(module.id ? {} : { created_by: userId }),
        };
        const { data, error } = await context.supabaseAdmin.from("catalog_subject_modules")
          .upsert(payload, { onConflict: "id" }).select().single();
        if (error) throw error;
        return Response.json({ module: data });
      }

      if (action === "delete-module") {
        const { error } = await context.supabaseAdmin.from("catalog_subject_modules").delete().eq("id", uuid(body.moduleId));
        if (error) throw error;
        return Response.json({ message: "Módulo removido." });
      }

      if (action === "save-material") {
        const material = object(body.material);
        const id = material.id ? uuid(material.id) : crypto.randomUUID();
        const materialStatus = status(material.status || "draft");
        const payload = {
          id,
          catalog_subject_id: uuid(material.catalogSubjectId),
          module_id: uuid(material.moduleId),
          kind: kind(material.kind || "lesson"),
          title: string(material.title, 240, true),
          description: string(material.description, 3000),
          body: string(material.body, 200000),
          external_url: httpsUrl(material.externalUrl),
          position: position(material.position, 2000),
          status: materialStatus,
          published_at: materialStatus === "published" ? new Date().toISOString() : null,
          updated_by: userId,
          ...(material.id ? {} : { created_by: userId }),
        };
        const { data, error } = await context.supabaseAdmin.from("catalog_subject_materials")
          .upsert(payload, { onConflict: "id" }).select().single();
        if (error) throw error;
        return Response.json({ material: data });
      }

      if (action === "delete-material") {
        const { error } = await context.supabaseAdmin.from("catalog_subject_materials").delete().eq("id", uuid(body.materialId));
        if (error) throw error;
        return Response.json({ message: "Material removido." });
      }

      return Response.json({ error: "Operação administrativa inválida." }, { status: 400 });
    } catch (error) {
      const invalid = error instanceof Error && error.message === "INVALID_INPUT";
      console.error("Administrative subject content operation failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
      return Response.json(
        { error: invalid ? "Os dados informados são inválidos." : "Não foi possível salvar o conteúdo da matéria." },
        { status: invalid ? 400 : 502 },
      );
    }
  }),
};
