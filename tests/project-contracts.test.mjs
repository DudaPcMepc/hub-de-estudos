import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { extrairDispositivos } from "../scripts/import-legal-sources.mjs";

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

test("as matérias usam hierarquia visual previsível e resumo em formato de painel", () => {
    const html = readProjectFile("index.html");

    assert.match(html, /class="btn btn-sm btn-primary flex-grow-1 btn-abrir-materia"/);
    assert.doesNotMatch(html, /btn-\$\{m\.cor\} flex-grow-1 btn-abrir-materia/);
    assert.match(html, /class="progress-bar materia-progress-bar"/);
    assert.match(html, /class="badge-cor bg-\$\{m\.cor\}/);
    assert.match(html, /class="study-overview mb-4" id="resumoMaterias"/);
    assert.match(html, /class="btn btn-sm navbar-support-btn" id="btnPreviaMigracao"/);
    assert.match(html, /class="btn btn-sm navbar-support-btn" id="btnExportar"/);
});

test("o cronograma usa formulário responsivo, semana em cartões e estados vazios acolhedores", () => {
    const html = readProjectFile("index.html");

    assert.match(html, /id="formTarefa" class="study-session-form"/);
    assert.match(html, /grid-template-columns: minmax\(240px, 1\.15fr\)/);
    assert.match(html, /class="weekly-calendar-grid" id="calendarioSemanal"/);
    assert.match(html, /class="calendar-day \$\{ehHoje\(d\) \? "is-today" : ""\}"/);
    assert.match(html, />Sem sessões</);
    assert.doesNotMatch(html, /table-primary/);
    assert.match(html, /id="contadorPendentes"/);
    assert.match(html, /id="contadorConcluidas"/);
    assert.match(html, /Tudo em dia por aqui! 🚀/);
    assert.match(html, /class="schedule-list-panel is-complete"/);
});

test("o edital destaca as informações essenciais e orienta o primeiro cadastro", () => {
    const html = readProjectFile("index.html");

    assert.match(html, /btn btn-sm btn-outline-primary exam-action[^>]*>[^<]*<i[^>]*><\/i>Configurar Concurso/);
    assert.match(html, /btn btn-sm btn-primary exam-action[^>]*>[^<]*<i[^>]*><\/i>Adicionar Matéria/);
    assert.match(html, /class="exam-summary-card"/);
    assert.match(html, /class="exam-summary-icon"><i class="bi-bank"/);
    assert.match(html, /class="exam-summary-value" id="editalData"/);
    assert.match(html, /class="exam-total-badge"/);
    assert.match(html, /<th class="numeric-column">Questões<\/th>/);
    assert.match(html, /Sua matriz ainda está vazia\./);
    assert.match(html, /Cadastrar primeira matéria/);
    assert.doesNotMatch(html, /Nenhuma matéria na matriz ainda\./);
});

test("o simulado prioriza a geração, usa aviso neutro e orienta o primeiro resultado", () => {
    const html = readProjectFile("index.html");

    assert.match(html, /id="formGerarSimulado" class="simulation-generator-form"/);
    assert.ok(html.indexOf('id="formGerarSimulado"') < html.indexOf("Desempenho por matéria"));
    assert.match(html, /class="ai-callout" role="status"/);
    assert.match(html, /class="ai-quota-badge" id="statusCotaIA"/);
    assert.doesNotMatch(html, /alert alert-success[^>]*role="status"/);
    assert.match(html, /class="performance-donut"/);
    assert.match(html, /class="performance-bars"/);
    assert.match(html, /id="btnIrGeradorSimulado"/);
    assert.match(html, /Gerar primeiro simulado/);
    assert.match(html, /estadoVazio\.classList\.remove\("d-none"\)/);
    assert.match(html, /conteudo\.classList\.add\("d-none"\)/);
    assert.doesNotMatch(html, /Sem dados ainda\. Responda um simulado\./);
});

test("o caderno de erros usa cadastro compacto, explicação multilinha e consulta organizada", () => {
    const html = readProjectFile("index.html");

    assert.match(html, /id="formErro" class="error-entry-form"/);
    assert.match(html, /grid-template-columns: minmax\(220px, \.9fr\) minmax\(300px, 1\.5fr\)/);
    assert.match(html, /<textarea class="form-control" id="erroObs" rows="4"/);
    assert.doesNotMatch(html, /<input[^>]*id="erroObs"/);
    assert.match(html, /<button type="submit" class="btn btn-primary"><i class="bi-journal-plus me-1"><\/i>Adicionar erro<\/button>/);
    assert.match(html, /class="error-list-toolbar"/);
    assert.match(html, /id="resumoErros"/);
    assert.match(html, /class="form-select form-select-sm error-list-filter"/);
    assert.match(html, /class="error-empty"/);
    assert.match(html, /class="bi-journal-x"/);
    assert.match(html, /Seu caderno está pronto para começar\./);
    assert.doesNotMatch(html, /Nenhum erro registrado ainda\./);
});

test("a biblioteca por matéria mantém widgets pessoais e identifica os limites do leitor", () => {
    const html = readProjectFile("index.html");
    const architecture = readProjectFile("docs/arquitetura-biblioteca-juridica.md");

    assert.match(html, /data-bs-target="#ws-biblioteca"[^>]*>[^<]*<i class="bi-bookshelf/);
    assert.match(html, /id="ws-biblioteca"/);
    assert.match(html, /Biblioteca segura/);
    assert.match(html, /todos os seus grifos permanecem privados no seu perfil/);
    assert.match(html, /id="materiaCatalogo"/);
    assert.match(html, /function recursosSugeridosParaMateria\(materia\)/);
    assert.match(html, /HUB_CLOUD_WIDGETS\.salvarLayout/);
    assert.match(html, /Constituição Federal/);
    assert.match(html, /Código Penal/);
    assert.match(html, /Meu Vade Mecum/);
    assert.match(html, /Comunidade da matéria/);
    assert.match(html, /renderizarBibliotecaMateria\(m\)/);
    assert.match(html, /id="wsLeitorPrototipo"/);
    assert.match(html, /id="btnGrifarTrecho"/);
    assert.match(html, /id="btnCopiarArtigo"/);
    assert.match(html, /Criar flashcard<\/button>/);
    assert.match(html, /Abrir Vade Mecum/);
    assert.doesNotMatch(html, /Visualizar protótipo/);
    assert.match(architecture, /O vínculo com o catálogo comum é opcional/);
    assert.match(architecture, /Todas as tabelas pessoais usam RLS/);
    assert.match(architecture, /Fase 2 iniciada/);
    assert.match(architecture, /ativar, ocultar e ordenar widgets por usuário/);
});

test("o leitor usa navegação fixa, modo foco e grifos com função didática", () => {
    const html = readProjectFile("index.html");
    const repository = readProjectFile("src/cloud-core-repository.js");
    const migration = readProjectFile("supabase/migrations/202608300005_legal_highlight_semantics.sql");

    assert.match(html, /\.legal-reader-toolbar \{ position: sticky; top: 0;/);
    assert.match(html, /button\.is-active::before/);
    assert.match(html, /box-decoration-break: clone/);
    assert.match(html, /mark\.highlight-red/);
    assert.match(html, /id="wsFiltroGrifo"/);
    assert.match(html, /Só exceções\/prazos/);
    assert.match(html, /id="btnModoFoco"/);
    assert.match(html, /function definirModoFocoLeitor\(ativo\)/);
    assert.match(html, /legal-focus-mode \.legal-reader-index \{ display: none/);
    assert.match(html, /legal-filter-context/);
    assert.match(repository, /new Set\(\["yellow", "red", "green", "blue", "pink"\]\)/);
    assert.match(migration, /check \(color in \('yellow', 'red', 'green', 'blue', 'pink'\)\)/);
    assert.match(migration, /pink é mantido para compatibilidade/);
});

test("anotações e flashcards do leitor usam os repositórios seguros já existentes", () => {
    const html = readProjectFile("index.html");
    const repository = readProjectFile("src/cloud-core-repository.js");
    const auth = readProjectFile("src/auth.js");

    assert.match(html, /id="btnAnotarTrecho"/);
    assert.match(html, /id="btnCriarCardArtigo"/);
    assert.doesNotMatch(html, /id="btnAnotarTrecho"[^>]*disabled/);
    assert.doesNotMatch(html, /id="btnCriarCardArtigo"[^>]*disabled/);
    assert.match(html, /id="wsPainelAcaoLeitor"/);
    assert.match(html, /function obterSelecaoAtualLeitor\(limite = 2000\)/);
    assert.match(html, /function abrirPainelAnotacaoLeitor\(grifo = null\)/);
    assert.match(html, /criarFlashcardSincronizado\(pergunta, conteudo, \{ preservarLeitor: true \}\)/);
    assert.match(repository, /export async function atualizarNotaGrifoJuridico/);
    assert.match(repository, /user_legal_highlights"\)\.update\([\s\S]*?\.eq\("user_id", contexto\.userId\)/);
    assert.match(auth, /atualizarNotaGrifo: atualizarNotaGrifoJuridico/);
});

test("favoritos, retomada e histórico jurídico permanecem privados por usuário", () => {
    const html = readProjectFile("index.html");
    const repository = readProjectFile("src/cloud-core-repository.js");
    const auth = readProjectFile("src/auth.js");
    const migration = readProjectFile("supabase/migrations/202608300006_legal_reading_state.sql");

    assert.match(html, /id="btnFavoritarArtigo"/);
    assert.match(html, /id="wsAtalhosLeitura"/);
    assert.match(html, /Continuar de onde parei/);
    assert.match(html, /Artigos recentes/);
    assert.match(html, /btn-grifo-erro/);
    assert.match(html, /registrarErro\(materia\.id,/);
    assert.match(repository, /export async function carregarEstadoLeituraJuridica/);
    assert.match(repository, /export async function salvarFavoritoJuridico/);
    assert.match(repository, /export async function registrarLeituraJuridica/);
    assert.match(auth, /salvarFavorito: salvarFavoritoJuridico/);
    assert.match(auth, /registrarLeitura: registrarLeituraJuridica/);
    assert.match(migration, /create table public\.user_legal_bookmarks/i);
    assert.match(migration, /create table public\.user_legal_reading_history/i);
    assert.match(migration, /foreign key \(subject_id, workspace_id\)[\s\S]*?references public\.subjects\(id, workspace_id\) on delete cascade/i);
    assert.match(migration, /alter table public\.user_legal_bookmarks force row level security/i);
    assert.match(migration, /alter table public\.user_legal_reading_history force row level security/i);
    assert.match(migration, /user_legal_bookmarks_insert_self[\s\S]*?user_id = \(select auth\.uid\(\)\)[\s\S]*?private\.is_workspace_member\(workspace_id\)/i);
    assert.match(migration, /user_legal_reading_history_update_self[\s\S]*?with check[\s\S]*?user_id = \(select auth\.uid\(\)\)/i);
    assert.match(migration, /grant select, insert, delete on table public\.user_legal_bookmarks to authenticated/i);
    assert.match(migration, /grant select, insert, update on table public\.user_legal_reading_history to authenticated/i);
});

test("a sessão autenticada não mistura registros locais sem vínculo com outro usuário", () => {
    const html = readProjectFile("index.html");

    assert.match(html, /function obterMaterias\(\) \{ return carregar\(LS\.materias, \[\]\); \}/);
    assert.match(html, /function sincronizarListaDeMaterias\(materiasRemotas\)[\s\S]*?salvarMaterias\(sincronizadas\);/);
    assert.match(html, /function sincronizarListaDeTarefas\(tarefasRemotas\)[\s\S]*?salvar\(LS\.tarefas, sincronizadas\);/);
    assert.match(html, /function sincronizarListaDeErros\(errosRemotos\)[\s\S]*?salvar\(LS\.erros, sincronizados\);/);
    assert.match(html, /function sincronizarDesempenho\(desempenhoRemoto\)[\s\S]*?const desempenho = \{\};/);
    assert.doesNotMatch(html, /const MATERIAS_PADRAO/);
    assert.doesNotMatch(html, /somenteLocais/);
    assert.match(html, /Nenhuma matéria ainda\. Clique em "Nova Matéria"\./);
});

test("o grifo recorta seleções iniciadas no título para manter apenas o texto da lei", () => {
    const html = readProjectFile("index.html");

    assert.match(html, /const rangeOriginal = selecao\.getRangeAt\(0\);/);
    assert.match(html, /rangeOriginal\.intersectsNode\(container\)/);
    assert.match(html, /const range = rangeOriginal\.cloneRange\(\);/);
    assert.match(html, /!container\.contains\(range\.startContainer\)[\s\S]*?range\.setStart\(container, 0\)/);
    assert.match(html, /!container\.contains\(range\.endContainer\)[\s\S]*?range\.setEnd\(container, container\.childNodes\.length\)/);
    assert.match(html, /const textoBruto = range\.toString\(\);/);
});

test("o leitor constitucional separa texto oficial versionado de grifos privados", () => {
    const migration = readProjectFile("supabase/migrations/202608300003_legal_reader_foundation.sql");
    const repository = readProjectFile("src/cloud-core-repository.js");

    assert.match(migration, /create table public\.legal_documents/i);
    assert.match(migration, /create table public\.legal_document_versions/i);
    assert.match(migration, /create table public\.legal_provisions/i);
    assert.match(migration, /create table public\.user_legal_highlights/i);
    assert.match(migration, /foreign key \(subject_id, workspace_id\)\s+references public\.subjects\(id, workspace_id\)/i);
    assert.match(migration, /user_legal_highlights_insert_self[\s\S]*?user_id = \(select auth\.uid\(\)\)[\s\S]*?private\.is_workspace_member\(workspace_id\)/i);
    assert.match(migration, /revoke all on table public\.legal_documents from public, anon, authenticated/i);
    assert.match(migration, /grant select on table public\.legal_documents to authenticated/i);
    assert.doesNotMatch(migration, /grant (?:insert|update|delete|all)[^;]*legal_documents[^;]*authenticated/i);
    assert.match(migration, /Atualizada até a Emenda Constitucional nº 139\/2026/);
    assert.match(migration, /Câmara dos Deputados — texto atualizado/);
    assert.match(repository, /export async function carregarBibliotecaJuridica/);
    assert.match(repository, /export async function criarGrifoJuridico/);
    assert.match(repository, /export async function excluirGrifoJuridico/);
});

test("a Constituição e o ADCT completos são importados com fonte, versão e preservação dos grifos", () => {
    const migration = readProjectFile("supabase/migrations/202608300004_complete_constitution_adct.sql");
    const html = readProjectFile("index.html");
    const chavesImportadas = [...migration.matchAll(/"chave":"art-/g)];

    assert.equal(chavesImportadas.length, 424);
    assert.match(migration, /Texto integral da Constituição Federal — arts\. 1º a 250 e artigos acrescidos/);
    assert.match(migration, /Atualizado até a Emenda Constitucional nº 136\/2025/);
    assert.match(migration, /as ECs 137, 138 e 139 não alteraram este ato/);
    assert.match(migration, /update public\.user_legal_highlights as grifo[\s\S]*?novo\.provision_key = antigo\.provision_key/i);
    assert.match(migration, /ato-disposicoes-constitucionais-transitorias-1988/);
    assert.match(html, /function documentosJuridicosDaMateria\(materia\)/);
    assert.match(html, /data-document-id=/);
    assert.match(html, /class="legal-index-group-title"/);
    assert.match(html, /class="legal-index-subtitle"/);
});

test("o importador jurídico reconhece hierarquia, artigos acrescidos e entidades do HTML oficial", () => {
    const dispositivos = extrairDispositivos(`
        <p>T&Iacute;TULO I</p><p>DOS PRINC&Iacute;PIOS FUNDAMENTAIS</p>
        <p>Art. 1&ordm; Texto inicial.</p><p>Par&aacute;grafo &uacute;nico. Continuação.</p>
        <p>Art. 1-A. Artigo acrescido.</p>
    `);

    assert.equal(dispositivos.length, 2);
    assert.deepEqual(dispositivos.map(item => item.chave), ["art-1", "art-1-a"]);
    assert.deepEqual(dispositivos[0].caminho, ["TÍTULO I — DOS PRINCÍPIOS FUNDAMENTAIS"]);
    assert.match(dispositivos[0].conteudo, /Parágrafo único/);
});

test("a fundação do catálogo mantém vínculos opcionais e widgets isolados por usuário", () => {
    const migration = readProjectFile("supabase/migrations/202608300002_subject_catalog_widgets.sql");

    assert.match(migration, /create table public\.catalog_subjects/i);
    assert.match(migration, /add column catalog_subject_id uuid\s+references public\.catalog_subjects\(id\) on delete set null/i);
    assert.doesNotMatch(migration, /catalog_subject_id uuid\s+not null/i);
    assert.doesNotMatch(migration, /(?:insert into|update) public\.subjects/i);
    assert.match(migration, /create table public\.user_subject_widgets/i);
    assert.match(migration, /foreign key \(subject_id, workspace_id\)\s+references public\.subjects\(id, workspace_id\) on delete cascade/i);
    assert.match(migration, /unique \(subject_id, user_id, widget_type\)/i);
    assert.match(migration, /jsonb_typeof\(config\) = 'object' and octet_length\(config::text\) <= 20000/i);
    assert.match(migration, /alter table public\.catalog_subjects force row level security/i);
    assert.match(migration, /alter table public\.user_subject_widgets force row level security/i);
    assert.match(migration, /user_subject_widgets_select_self[\s\S]*?user_id = \(select auth\.uid\(\)\)[\s\S]*?private\.is_workspace_member\(workspace_id\)/i);
    assert.match(migration, /user_subject_widgets_insert_self[\s\S]*?with check[\s\S]*?user_id = \(select auth\.uid\(\)\)[\s\S]*?private\.is_workspace_member\(workspace_id\)/i);
    assert.match(migration, /user_subject_widgets_update_self[\s\S]*?using[\s\S]*?with check[\s\S]*?user_id = \(select auth\.uid\(\)\)/i);
    assert.match(migration, /revoke all on table public\.catalog_subjects from public, anon, authenticated/i);
    assert.match(migration, /grant select on table public\.catalog_subjects to authenticated/i);
    assert.doesNotMatch(migration, /grant (?:insert|update|delete|all)[^;]*catalog_subjects[^;]*authenticated/i);
    assert.match(migration, /grant select, insert, update, delete on table public\.user_subject_widgets to authenticated/i);
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
