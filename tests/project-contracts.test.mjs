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
});
