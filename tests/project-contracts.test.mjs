import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const readProjectFile = (relativePath) => readFileSync(join(projectRoot, relativePath), "utf8");

test("arquivos versionados não contêm formatos conhecidos de chaves secretas", () => {
    const trackedFiles = execFileSync("git", ["ls-files"], { cwd: projectRoot, encoding: "utf8" })
        .split(/\r?\n/)
        .filter(Boolean)
        .filter((file) => [".html", ".js", ".mjs", ".json", ".md", ".sql", ".toml", ".ts", ".yml", ".yaml"].includes(extname(file)));
    const secretPatterns = [
        { name: "Google API key", value: /AIza[0-9A-Za-z_-]{30,}/g },
        { name: "Supabase secret key", value: /sb_secret_[0-9A-Za-z_-]{20,}/g },
        { name: "private key", value: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g }
    ];
    const findings = [];

    for (const file of trackedFiles) {
        const content = readProjectFile(file);
        for (const pattern of secretPatterns) {
            if (pattern.value.test(content)) findings.push(`${file}: ${pattern.name}`);
            pattern.value.lastIndex = 0;
        }
    }

    assert.deepEqual(findings, []);
});

test("o frontend não armazena nem envia diretamente a chave Gemini", () => {
    const html = readProjectFile("index.html");
    const auth = readProjectFile("src/auth.js");

    assert.doesNotMatch(html, /generativelanguage\.googleapis\.com/i);
    assert.doesNotMatch(html, /id=["']inputApiKey["']/i);
    assert.doesNotMatch(auth, /x-goog-api-key/i);
    assert.match(auth, /supabase\.functions\.invoke\(["']generate-quiz["']/);
});

test("a identidade visual usa Esquema de Estudos e a assinatura de pimenta com café", () => {
    const html = readProjectFile("index.html");

    assert.match(html, /<title>Esquema de Estudos \| Concursos<\/title>/);
    assert.match(html, /class="brand-code-logo/);
    assert.match(html, /class="brand-pepper"[^>]*>🌶️<\/span>/);
    assert.match(html, /class="brand-coffee"[^>]*>☕️<\/span>/);
    assert.match(html, /\.brand-code-logo \.brand-coffee::before/);
    assert.match(html, /\.brand-code-logo \.brand-coffee::after/);
    assert.match(html, /<span class="brand-title">Esquema de Estudos<\/span>/);
    assert.doesNotMatch(html, />Hub Pimentel</);
});

test("a Edge Function exige usuário autenticado e segredo no servidor", () => {
    const edgeFunction = readProjectFile("supabase/functions/generate-quiz/index.ts");
    const config = readProjectFile("supabase/config.toml");

    assert.match(edgeFunction, /withSupabase\(\{ auth: ["']user["'] \}/);
    assert.match(edgeFunction, /Deno\.env\.get\(["']GEMINI_API_KEY["']\)/);
    assert.match(edgeFunction, /quantity > 10/);
    assert.match(config, /\[functions\.generate-quiz\][\s\S]*?verify_jwt\s*=\s*true/);
});

test("a cota de IA só pode ser alterada pelo service_role", () => {
    const migration = readProjectFile("supabase/migrations/202608290004_ai_daily_quota.sql");

    assert.match(migration, /revoke all on function public\.reserve_ai_daily_quota[\s\S]*?from public, anon, authenticated/i);
    assert.match(migration, /grant execute on function public\.reserve_ai_daily_quota[\s\S]*?to service_role/i);
    assert.match(migration, /grant execute on function public\.refund_ai_daily_quota[\s\S]*?to service_role/i);
});

test("a restauração exige o espaço pessoal do proprietário", () => {
    const migration = readProjectFile("supabase/migrations/202608290005_safe_backup_restore.sql");

    assert.match(migration, /workspace\.owner_id\s*=\s*current_user_id/);
    assert.match(migration, /workspace\.kind\s*=\s*'personal'/);
    assert.match(migration, /for update/);
    assert.match(migration, /result\s*:=\s*public\.import_local_hub/);
});

test("as migrations têm identificadores únicos e permanecem em ordem", () => {
    const files = readdirSync(join(projectRoot, "supabase", "migrations"))
        .filter((file) => file.endsWith(".sql"))
        .sort();
    const identifiers = files.map((file) => file.split("_")[0]);

    assert.equal(new Set(identifiers).size, identifiers.length);
    assert.deepEqual(files, [...files].sort());
});

test("o workflow possui permissões mínimas e valida antes de compilar", () => {
    const workflow = readProjectFile(".github/workflows/ci.yml");

    assert.match(workflow, /permissions:\s*\n\s+contents: read/);
    assert.match(workflow, /persist-credentials: false/);
    assert.match(workflow, /npm ci --ignore-scripts/);
    assert.ok(workflow.indexOf("run: npm test") < workflow.indexOf("run: npm run build"));
    assert.match(workflow, /DEPLOY_BASE_PATH:\s*\/hub-de-estudos\//);
});

test("a publicação preserva o caminho do GitHub Pages e depende dos testes", () => {
    const config = readProjectFile("vite.config.mjs");
    const workflow = readProjectFile(".github/workflows/deploy-pages.yml");

    assert.match(config, /process\.env\.DEPLOY_BASE_PATH\s*\|\|\s*["']\/["']/);
    assert.match(workflow, /DEPLOY_BASE_PATH:\s*\/hub-de-estudos\//);
    assert.ok(workflow.indexOf("run: npm test") < workflow.indexOf("run: npm run build"));
    assert.match(workflow, /needs:\s*validate-and-build/);
    assert.match(workflow, /pages:\s*write/);
    assert.match(workflow, /id-token:\s*write/);
});

test("a recuperação por código funciona sem depender do navegador de origem", () => {
    const html = readProjectFile("index.html");
    const auth = readProjectFile("src/auth.js");
    const client = readProjectFile("src/supabase-client.js");
    const config = readProjectFile("supabase/config.toml");
    const template = readProjectFile("supabase/templates/recovery.html");

    assert.match(html, /id=["']formCodigoRecuperacao["']/);
    assert.match(html, /autocomplete=["']one-time-code["']/);
    assert.match(html, /id=["']authLoadingShell["'][^>]*class=["'][^"']*d-flex/);
    assert.match(html, /id=["']authShell["'][^>]*class=["'][^"']*d-none/);
    assert.match(auth, /supabase\.auth\.verifyOtp\(\{/);
    assert.match(auth, /type:\s*["']recovery["']/);
    assert.match(auth, /supabase\.auth\.resetPasswordForEmail\(email\)/);
    assert.match(
        auth,
        /catch \(erro\) \{[\s\S]*?Falha ao definir nova senha[\s\S]*?definirCarregandoNovaSenha\(false\);[\s\S]*?different from the old password/
    );
    assert.match(
        auth,
        /updateUser\(\{ password: senha \}\)[\s\S]*?refreshSession\(\)[\s\S]*?ativarSessao\(sessaoAtualizada\.session\)/
    );
    assert.doesNotMatch(client, /flowType:\s*["']implicit["']/);
    assert.match(config, /\[auth\.email\.template\.recovery\][\s\S]*?content_path\s*=\s*["']\.\/supabase\/templates\/recovery\.html["']/);
    assert.match(template, /\{\{ \.Token \}\}/);
    assert.doesNotMatch(template, /ConfirmationURL|TokenHash/);
});

test("a exclusão de usuários exige prévia recente e protege espaços compartilhados", () => {
    const migration = readProjectFile("supabase/migrations/202608290006_safe_user_deletion.sql");

    assert.match(migration, /before delete on auth\.users/i);
    assert.match(migration, /USER_DELETION_REQUIRES_FRESH_PREVIEW/);
    assert.match(migration, /USER_DATA_CHANGED_REVIEW_DELETION_AGAIN/);
    assert.match(migration, /TRANSFER_SHARED_WORKSPACE_OWNERSHIP_FIRST/);
    assert.match(migration, /interval '15 minutes'/);
    assert.match(migration, /where item\.user_id = target_user_id/g);
    assert.match(migration, /where workspace\.owner_id = old\.id\s+for update/i);
    assert.match(migration, /references auth\.users\(id\) on delete cascade/i);
    assert.match(migration, /revoke all on function public\.preview_user_deletion\(uuid\) from public, anon, authenticated/i);
    assert.match(migration, /revoke all on function public\.prepare_user_deletion\(uuid, text\) from public, anon, authenticated/i);
    assert.match(migration, /grant execute on function public\.preview_user_deletion\(uuid\) to service_role/i);
    assert.match(migration, /grant execute on function public\.prepare_user_deletion\(uuid, text\) to service_role/i);
    assert.doesNotMatch(migration, /target_email|email_address/i);
});

test("a preparação da exclusão não confunde o usuário solicitado com a coluna da aprovação", () => {
    const migration = readProjectFile("supabase/migrations/202608300001_fix_prepare_user_deletion.sql");

    assert.match(migration, /prepare_user_deletion\.target_user_id/g);
    assert.match(migration, /on conflict on constraint user_deletion_approvals_pkey/i);
    assert.doesNotMatch(migration, /on conflict\s*\(\s*target_user_id\s*\)/i);
    assert.match(migration, /revoke all on function public\.prepare_user_deletion\(uuid, text\)[\s\S]*?from public, anon, authenticated/i);
    assert.match(migration, /grant execute on function public\.prepare_user_deletion\(uuid, text\) to service_role/i);
});

test("a administração de usuários mantém privilégios fora do navegador", () => {
    const migration = readProjectFile("supabase/migrations/202608290007_admin_foundation.sql");
    const edgeFunction = readProjectFile("supabase/functions/admin-users/index.ts");
    const frontend = readProjectFile("src/admin.js");
    const config = readProjectFile("supabase/config.toml");

    assert.match(migration, /create table private\.platform_admins/i);
    assert.match(migration, /revoke all on table private\.platform_admins from public, anon, authenticated/i);
    assert.match(migration, /grant execute on function public\.is_platform_admin\(uuid\) to service_role/i);
    assert.match(edgeFunction, /withSupabase\(\{ auth: ["']user["'] \}/);
    assert.match(edgeFunction, /is_platform_admin/);
    assert.match(edgeFunction, /auth\.admin\.inviteUserByEmail/);
    assert.match(edgeFunction, /auth\.admin\.listUsers/);
    assert.doesNotMatch(frontend, /service_role|sb_secret_/i);
    assert.match(config, /\[functions\.admin-users\][\s\S]*?verify_jwt\s*=\s*true/);
});

test("a exclusão administrativa exige prévia, confirmação e protege administradores", () => {
    const edgeFunction = readProjectFile("supabase/functions/admin-users/index.ts");
    const frontend = readProjectFile("src/admin.js");
    const html = readProjectFile("index.html");

    assert.match(edgeFunction, /action === ["']preview-delete["']/);
    assert.match(edgeFunction, /targetUserId === userId/);
    assert.match(edgeFunction, /targetIsAdmin === true/);
    assert.match(edgeFunction, /preview_user_deletion/);
    assert.match(edgeFunction, /prepare_user_deletion/);
    assert.match(edgeFunction, /auth\.admin\.deleteUser/);
    assert.ok(edgeFunction.indexOf("prepare_user_deletion") < edgeFunction.indexOf("auth.admin.deleteUser"));
    assert.match(edgeFunction, /expectedConfirmation\s*=\s*`EXCLUIR \$\{target\.email\}`/);
    assert.match(frontend, /confirmation !== currentDeletion\.confirmation/);
    assert.match(frontend, /preview-delete/);
    assert.match(html, /id=["']modalExcluirUsuario["']/);
    assert.match(html, /id=["']confirmacaoExclusaoUsuario["']/);
});
