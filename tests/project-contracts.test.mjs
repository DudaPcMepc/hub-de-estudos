import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { extrairDispositivos } from "../scripts/import-legal-sources.mjs";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const readProjectFile = (relativePath) => readFileSync(join(projectRoot, relativePath), "utf8");

const carregarRenderizadorDeGrifos = () => {
    const html = readProjectFile("index.html");
    const inicio = html.indexOf("function textoJuridicoComGrifos");
    const fim = html.indexOf("\nfunction renderizarIndiceLeitor", inicio);
    assert.ok(inicio >= 0 && fim > inicio, "A função de renderização dos grifos deve continuar isolável para teste.");
    return runInNewContext(`${html.slice(inicio, fim)}\ntextoJuridicoComGrifos;`, {
        esc: (valor) => String(valor ?? "")
    });
};

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
    assert.match(html, /class="badge-cor materia-drag-handle bg-\$\{m\.cor\}/);
    assert.match(html, /class="study-overview mb-4" id="resumoMaterias"/);
    assert.match(html, /class="btn btn-sm navbar-support-btn" id="btnPreviaMigracao"/);
    assert.match(html, /class="btn btn-sm navbar-support-btn" id="btnExportar"/);
});

test("a ordem manual das matérias só aceita arraste durante o modo de organização", () => {
    const html = readProjectFile("index.html");

    assert.match(html, /id="btnOrganizarMaterias"[^>]*aria-pressed="false"/);
    assert.match(html, /id="avisoOrganizacaoMaterias"/);
    assert.match(html, /let modoOrganizarMaterias = false/);
    assert.match(html, /if \(modoOrganizarMaterias && ordemMaterias === "manual" && !q\)/);
    assert.match(html, /handle: "\.materia-drag-handle"/);
    assert.match(html, /delayOnTouchOnly: true/);
    assert.match(html, /touchStartThreshold: 5/);
    assert.match(html, /modoOrganizarMaterias = false; renderizarMaterias\(\)/);
    assert.match(html, /Concluir organização/);
    assert.match(html, /#gridMaterias\.is-organizing \.materia-drag-handle[\s\S]*?touch-action: none/);
    assert.doesNotMatch(html, /\.card-materia \{ cursor: grab/);
});

test("cada matéria abre em uma página ampla com caderno expansível", () => {
    const html = readProjectFile("index.html");

    assert.match(html, /class="subject-workspace-page d-none" id="modalMateria"/);
    assert.doesNotMatch(html, /class="modal fade" id="modalMateria"/);
    assert.match(html, /id="btnVoltarMaterias"/);
    assert.match(html, /class="subject-workspace-layout"/);
    assert.match(html, /class="subject-workspace-sidebar"/);
    assert.match(html, /class="subject-workspace-content"/);
    assert.match(html, />Caderno<\/button>/);
    assert.match(html, /\.editor-nota \{ min-height: calc\(100dvh - 300px\); max-height: none;/);
    assert.match(html, /function mostrarWorkspaceMateria\(\)/);
    assert.match(html, /async function fecharMateria\(\)/);
    assert.doesNotMatch(html, /bootstrap\.Modal\.getOrCreateInstance\(document\.getElementById\("modalMateria"\)\)/);
});

test("os mapas mentais possuem editor livre e salvamento privado por usuário", () => {
    const html = readProjectFile("index.html");
    const auth = readProjectFile("src/auth.js");
    const editor = readProjectFile("src/mind-map-editor.js");
    const mindMapCss = readProjectFile("src/mind-map.css");
    const repository = readProjectFile("src/cloud-core-repository.js");
    const migration = readProjectFile("supabase/migrations/202608310001_personal_mind_maps.sql");

    assert.match(html, /id="wsTabMapas"[^>]*data-bs-target="#ws-mapas"/);
    assert.match(html, /id="mindMapStage"/);
    assert.match(html, /data-mind-tool="node"/);
    assert.match(html, /data-mind-tool="edge"/);
    assert.match(html, /data-mind-tool="draw"/);
    assert.match(html, /data-mind-tool="eraser"/);
    assert.doesNotMatch(html, /data-mind-tool="select"/);
    assert.doesNotMatch(html, /data-mind-tool="pan"/);
    assert.match(html, /ao soltar, a posição é salva/);
    assert.match(html, /id="mindMapEraserSize"[^>]*min="10"[^>]*max="72"/);
    assert.doesNotMatch(html, /id="btnMindLock"/);
    assert.doesNotMatch(html, /id="btnMindEditText"/);
    assert.match(html, /id="btnMindMobileTools"[^>]*aria-controls="mindMapMobileExtra"/);
    assert.match(html, /id="mindMapMobileExtra"/);
    assert.match(editor, /export function criarEditorMapasMentais/);
    assert.match(editor, /function registrarHistorico\(\)/);
    assert.match(editor, /tipo: "pending-move"/);
    assert.match(editor, /tipo: "pending-pan"/);
    assert.match(editor, /const jaSelecionado = selecionadoId === item\.id/);
    assert.match(editor, /if \(jaSelecionado && \["node", "shape"\]\.includes\(item\.type\)/);
    assert.match(editor, /const distancia = Math\.hypot/);
    assert.match(editor, /if \(distancia < 8\) return/);
    assert.match(editor, /function aplicarRedimensionamento\(estado, ponto\)/);
    assert.match(editor, /function renderizarAlcas\(item, grupo\)/);
    assert.match(editor, /tipo: "pending-resize"/);
    assert.match(editor, /const LARGURA_MINIMA = 120/);
    assert.match(editor, /const ALTURA_MAXIMA = 360/);
    assert.match(editor, /if \(ferramenta !== "select" \|\| item\.id !== selecionadoId\) return/);
    assert.doesNotMatch(editor, /item\.payload\.locked/);
    assert.match(editor, /\["n", largura \/ 2, 0/);
    assert.match(editor, /\["e", largura, altura \/ 2/);
    assert.match(editor, /ferramenta === botao\.dataset\.mindTool \? "select"/);
    assert.match(editor, /const salvarPosicaoAgora = \["move", "resize"\]\.includes\(terminou\.tipo\) && terminou\.alterou/);
    assert.match(editor, /if \(salvarPosicaoAgora\) await salvarAgora\(\)/);
    assert.match(editor, /dom\.canvas\.setPointerCapture\(evento\.pointerId\)/);
    assert.match(editor, /dom\.canvas\.hasPointerCapture\(evento\.pointerId\)/);
    assert.match(editor, /dom\.canvas\.releasePointerCapture\(evento\.pointerId\)/);
    assert.doesNotMatch(editor, /dom\.stage\.setPointerCapture/);
    assert.match(editor, /async function editarTextoSelecionado\(\)/);
    assert.match(editor, /\["Enter", "F2"\]\.includes\(evento\.key\)/);
    assert.match(editor, /"data-mind-action": "toggle-menu"/);
    assert.match(editor, /"data-mind-action": "edit"/);
    assert.match(editor, /"data-mind-action": "delete"/);
    assert.match(editor, /"data-mind-action": "custom-color"/);
    assert.match(editor, /const controleAcao = evento\.target\.closest/);
    assert.match(editor, /document\.activeElement\?\.closest\?\.\("\[data-mind-action\], \[data-mind-color\]"\)/);
    assert.match(editor, /controleFocado && \["Enter", " "\]\.includes\(evento\.key\)/);
    assert.match(editor, /function acionarControleElemento\(controle, item\)/);
    assert.match(editor, /aplicarCorAoItem\(item, controle\.dataset\.mindColor, true\)/);
    assert.match(mindMapCss, /\.mind-map-actions-menu/);
    assert.match(mindMapCss, /\.mind-map-color-control input \{ width: 1\.25rem; height: 1\.25rem/);
    assert.match(mindMapCss, /\.mind-map-tool > span \{ display: none; \}/);
    assert.match(html, /aria-label="Adicionar conceito"/);
    assert.match(html, /<option value="solid">━<\/option>/);
    assert.match(html, /<option value="dashed">┄<\/option>/);
    assert.match(editor, /function apagarTracos\(ponto, raio\)/);
    assert.match(editor, /function definirPainelMobile\(aberto\)/);
    assert.match(editor, /dom\.mobileMore\.setAttribute\("aria-expanded"/);
    assert.match(mindMapCss, /\.mind-map-mobile-extra\.is-open \{ display: flex/);
    assert.match(mindMapCss, /\.mind-map-primary-tools \{ flex: 1/);
    assert.match(mindMapCss, /\.mind-map-resize-handle/);
    assert.match(mindMapCss, /\.mind-map-selection-frame/);
    assert.match(mindMapCss, /cursor: nwse-resize/);
    assert.match(mindMapCss, /cursor: ew-resize/);
    assert.match(editor, /setTimeout\(\(\) => \{ void salvarAgora\(\); \}, 900\)/);
    assert.match(editor, /repositorio\.salvarConteudo\(mapa\.id/);
    assert.match(repository, /export async function carregarMapasMentais/);
    assert.match(repository, /export async function salvarConteudoMapaMental/);
    assert.match(repository, /\.rpc\("replace_user_mind_map_elements"/);
    assert.match(auth, /window\.HUB_CLOUD_MIND_MAPS = Object\.freeze/);
    assert.match(auth, /window\.HUB_MIND_MAPS_UI = criarEditorMapasMentais/);

    assert.match(migration, /create table public\.user_mind_maps/i);
    assert.match(migration, /create table public\.user_mind_map_elements/i);
    assert.match(migration, /foreign key \(subject_id, workspace_id\)[\s\S]*?references public\.subjects\(id, workspace_id\) on delete cascade/i);
    assert.match(migration, /foreign key \(map_id, workspace_id, user_id\)[\s\S]*?references public\.user_mind_maps\(id, workspace_id, user_id\) on delete cascade/i);
    assert.match(migration, /alter table public\.user_mind_maps force row level security/i);
    assert.match(migration, /alter table public\.user_mind_map_elements force row level security/i);
    assert.match(migration, /user_mind_maps_select_self[\s\S]*?user_id = \(select auth\.uid\(\)\)/i);
    assert.match(migration, /user_mind_map_elements_select_self[\s\S]*?user_id = \(select auth\.uid\(\)\)/i);
    assert.match(migration, /create or replace function public\.replace_user_mind_map_elements/i);
    assert.match(migration, /element_count > 500/i);
    assert.match(migration, /limite seguro de 2 MB/i);
    assert.match(migration, /p_expected_version/i);
    assert.match(migration, /revoke all on table public\.user_mind_map_elements from public, anon, authenticated/i);
    assert.match(migration, /grant select on table public\.user_mind_map_elements to authenticated/i);
    assert.doesNotMatch(migration, /grant (?:insert|update|delete|all)[^;]*user_mind_map_elements[^;]*authenticated/i);
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
    assert.match(html, /Cadernos jurídicos/);
    assert.match(html, /Comunidade da matéria/);
    assert.match(html, /renderizarBibliotecaMateria\(m\)/);
    assert.match(html, /id="wsLeitorPrototipo"/);
    assert.match(html, /id="btnGrifarTrecho"/);
    assert.match(html, /id="btnCopiarArtigo"/);
    assert.match(html, /id="wsMenuSelecaoLeitor"[^>]*role="toolbar"/);
    assert.match(html, /id="btnCriarCardArtigo"[^>]*>[\s\S]*?<span>Flashcard<\/span>/);
    assert.match(html, /Abrir cadernos/);
    assert.doesNotMatch(html, /Visualizar protótipo/);
    assert.match(html, /id="wsCatalogoVade"/);
    assert.match(html, /id="wsInicioBiblioteca"/);
    assert.match(html, /id="btnVoltarCatalogoBiblioteca"/);
    assert.doesNotMatch(html, /id="btnAbrirInicioBiblioteca"/);
    assert.doesNotMatch(html, /id="btnAbrirCatalogoVade"/);
    assert.match(html, /const CATALOGO_VADE_DIGITAL = Object\.freeze/);
    assert.equal((html.match(/categoriaNome:/g) || []).length, 12);
    assert.match(html, /Estatuto Geral das Guardas Municipais/);
    assert.match(html, /Uma norma só é liberada para leitura depois da conferência do texto integral e da versão oficial/);
    assert.match(html, /function documentoDoCatalogoVade\(item\)/);
    assert.match(html, /documentosJuridicos\.find\(documento => item\.slugs\.includes\(documento\.slug\)\)/);
    assert.match(html, /Importação oficial pendente/);
    assert.match(html, /id="wsCatalogoVade" aria-labelledby="wsBibliotecaTitulo"/);
    assert.match(html, /\.vade-catalog-panel \{ margin: \.25rem 0 1rem; padding: 0;/);
    assert.match(html, /\.vade-catalog-toolbar \{[^}]*gap: 12px;/);
    assert.match(html, /class="badge rounded-pill vade-law-source"/);
    assert.match(html, /class="btn btn-sm vade-law-pending-action" disabled/);
    assert.doesNotMatch(html, /id="btnAbrirVadeDireto"/);
    assert.match(html, /id="btnMostrarRecursosBiblioteca"/);
    assert.match(html, /Configurar recursos da biblioteca/);
    assert.match(html, /\["materia", "Para esta matéria"\]/);
    assert.match(html, /\["disponiveis", "Disponíveis agora"\]/);
    assert.match(html, /function itemCatalogoRelacionadoMateria\(item, materia\)/);
    assert.match(html, /class="vade-pending-group"/);
    assert.match(html, /function renderizarInicioBiblioteca\(materia\)/);
    assert.match(html, /id="wsRecomendadosBiblioteca"/);
    assert.match(html, /id="wsResumoCadernos"/);
    assert.match(html, /<i class="bi-play-fill me-1"><\/i>Retomar/);
    assert.match(html, /Favorite artigos para encontrá-los aqui/);
    assert.match(architecture, /O vínculo com o catálogo comum é opcional/);
    assert.match(architecture, /Todas as tabelas pessoais usam RLS/);
    assert.match(architecture, /Fase 4 concluída e fundação da Fase 5 preparada localmente/);
    assert.match(architecture, /ativar, ocultar e ordenar widgets por usuário/);
});

test("o leitor usa navegação fixa, modo foco e grifos com função didática", () => {
    const html = readProjectFile("index.html");
    const repository = readProjectFile("src/cloud-core-repository.js");
    const migration = readProjectFile("supabase/migrations/202608300005_legal_highlight_semantics.sql");

    assert.match(html, /\.legal-reader-prototype \{[\s\S]*?height: clamp\(440px, 78vh, 820px\);[\s\S]*?display: flex;[\s\S]*?flex-direction: column;/);
    assert.match(html, /\.legal-reader-header \{ position: relative;[\s\S]*?display: flex;[\s\S]*?backdrop-filter: blur\(10px\)/);
    assert.match(html, /\.legal-reader-toolbar \{ min-width: 0; display: flex; flex: 1;/);
    assert.match(html, /\.legal-icon-button[\s\S]*?background: transparent; border: 0;/);
    assert.match(html, /\.legal-reader-layout \{ min-height: 0;[\s\S]*?flex: 1;[\s\S]*?overflow: hidden;/);
    assert.match(html, /\.legal-reader-paper \{[\s\S]*?overflow-y: auto;[\s\S]*?overscroll-behavior: contain/);
    assert.match(html, /\.legal-reader-index \{[\s\S]*?overflow-y: auto;[\s\S]*?overscroll-behavior: contain/);
    assert.match(html, /class="legal-toolbar-popover legal-version-popover"/);
    assert.match(html, /<strong id="wsLeitorVersao"><\/strong>/);
    assert.match(html, /\.legal-reader-sidebar \{[\s\S]*?background: #faf7f3/);
    assert.match(html, /\.legal-reader-sidebar \{ position: absolute;[\s\S]*?width: min\(82%, 280px\)/);
    assert.match(html, /if \(artigoMudou\) textoLeitor\.closest\("\.legal-reader-paper"\)\?\.scrollTo\(\{ top: 0, behavior: "auto" \}\)/);
    assert.match(html, /button\.is-active::before/);
    assert.match(html, /box-decoration-break: clone/);
    assert.match(html, /mark\.highlight-red/);
    assert.match(html, /id="wsFiltroGrifo"/);
    assert.match(html, /Só exceções\/prazos/);
    assert.match(html, /id="btnModoFoco"/);
    assert.match(html, /function definirModoFocoLeitor\(ativo\)/);
    assert.match(html, /legal-focus-mode \.legal-reader-sidebar \{ display: none/);
    assert.match(html, /id="btnAlternarIndice" aria-expanded="true"/);
    assert.match(html, /\.legal-reader-layout\.is-index-collapsed/);
    assert.match(html, /function atualizarMenuSelecaoLeitor\(\)/);
    assert.match(html, /function agendarAtualizacaoMenuSelecaoLeitor\(fecharSeVazio = false\)/);
    assert.match(html, /document\.addEventListener\("selectionchange", agendarAtualizacaoMenuSelecaoLeitor\)/);
    assert.match(html, /evento\.pointerType === "mouse" && evento\.button !== 0/);
    assert.match(html, /if \(fecharSeVazio\) fecharMenuSelecaoLeitor\(\)/);
    assert.match(html, /function selecaoParaAcaoLeitor\(limite = 2000\)/);
    assert.match(html, /\.legal-reader-paper-content \{ width: min\(100%, 720px\); margin-inline: auto; \}/);
    assert.match(html, /class="legal-reader-back" id="btnFecharLeitorPrototipo"/);
    assert.match(html, /class="legal-reader-sidebar" aria-label="Sumário do documento"/);
    assert.match(html, /Cores de marcação/);
    assert.match(html, /legal-filter-context/);
    assert.match(repository, /new Set\(\["yellow", "red", "green", "blue", "pink"\]\)/);
    assert.match(migration, /check \(color in \('yellow', 'red', 'green', 'blue', 'pink'\)\)/);
    assert.match(migration, /pink é mantido para compatibilidade/);
});

test("grifos sobrepostos permanecem visíveis, combinam cores e respeitam o filtro", () => {
    const renderizar = carregarRenderizadorDeGrifos();
    const texto = "abcdefghij";
    const amarelo = { texto: "cdef", prefixo: "ab", sufixo: "ghij", cor: "yellow" };
    const vermelho = { texto: "efgh", prefixo: "abcd", sufixo: "ij", cor: "red" };
    const sobreposto = renderizar(texto, [amarelo, vermelho]);

    assert.match(sobreposto, /<mark class="highlight-yellow">cd<\/mark>/);
    assert.match(sobreposto, /<mark class="highlight-overlap"[^>]*title="Grifos sobrepostos: regra ou conceito \+ exceção ou prazo"[^>]*>ef<\/mark>/);
    assert.match(sobreposto, /<mark class="highlight-red">gh<\/mark>/);

    const total = renderizar(texto, [
        { texto: "bcdefghi", prefixo: "a", sufixo: "j", cor: "yellow" },
        { texto: "def", prefixo: "abc", sufixo: "ghij", cor: "blue" }
    ]);
    assert.match(total, /<mark class="highlight-yellow">bc<\/mark>/);
    assert.match(total, /<mark class="highlight-overlap"[^>]*>def<\/mark>/);
    assert.match(total, /<mark class="highlight-yellow">ghi<\/mark>/);

    const mesmaCor = renderizar(texto, [amarelo, { ...vermelho, cor: "yellow" }]);
    assert.match(mesmaCor, /<mark class="highlight-yellow">cdefgh<\/mark>/);
    assert.doesNotMatch(mesmaCor, /highlight-overlap/);

    const filtrado = renderizar(texto, [amarelo, vermelho], "red");
    assert.match(filtrado, /^<span class="legal-filter-context">abcd<\/span><mark class="highlight-red">efgh<\/mark><span class="legal-filter-context">ij<\/span>$/);

    const repetido = renderizar("regra x regra", [{ texto: "regra", prefixo: "regra x ", sufixo: "", cor: "green" }]);
    assert.equal(repetido, 'regra x <mark class="highlight-green">regra</mark>');
});

test("a paleta escolhe a cor e cada grifo pode ser alterado ou removido no próprio texto", () => {
    const html = readProjectFile("index.html");
    const repository = readProjectFile("src/cloud-core-repository.js");
    const auth = readProjectFile("src/auth.js");
    const renderizar = carregarRenderizadorDeGrifos();

    assert.match(html, /data-highlight-color="yellow"[^>]*aria-pressed="true"/);
    assert.match(html, /function selecionarCorGrifoLeitor\(cor/);
    assert.match(html, /id="wsMenuGrifoExistente"/);
    assert.match(html, /id="btnExcluirGrifoExistente"/);
    assert.match(html, /mark\[data-highlight-id\]/);
    assert.match(renderizar("uma regra", [{ id: "grifo-1", texto: "regra", prefixo: "uma ", sufixo: "", cor: "yellow" }]), /data-highlight-id="grifo-1" tabindex="0"/);
    const sobreposto = renderizar("abcdefghij", [
        { id: "grifo-1", texto: "cdef", prefixo: "ab", sufixo: "ghij", cor: "yellow" },
        { id: "grifo-2", texto: "efgh", prefixo: "abcd", sufixo: "ij", cor: "red" }
    ]);
    assert.match(sobreposto, /data-highlight-ids="grifo-1\|grifo-2" tabindex="0"/);
    assert.match(html, /id="wsEscolherGrifoSobreposto"/);
    assert.match(html, /espacoAbaixo < menu\.offsetHeight \+ 12/);
    assert.match(html, /menu\.classList\.toggle\("is-above", abrirAcima\)/);
    assert.match(html, /const geracaoOperacao = \+\+geracaoAlteracaoCorGrifo/);
    assert.match(html, /const operacaoContinuaVisivel = \(\) => sessaoHubPermaneceAtual\(sessao\)[\s\S]*?materiaIdOperacao[\s\S]*?dispositivoIdOperacao[\s\S]*?grifoContextualLeitorId === grifoIdOperacao[\s\S]*?geracaoAlteracaoCorGrifo === geracaoOperacao/);
    assert.match(html, /if \(!operacaoContinuaVisivel\(\)\) return;\s*selecionarCorGrifoLeitor\(salvo\.cor\)/);
    assert.match(html, /catch \(erro\) \{\s*console\.error\("Falha ao alterar a cor do grifo", erro\);\s*if \(!operacaoContinuaVisivel\(\)\) return;/);
    assert.match(html, /async function excluirGrifoLeitor\(grifoId\)[\s\S]*?const materiaIdOperacao = materiaAbertaId;[\s\S]*?const dispositivoIdOperacao = dispositivoLeitorAtual\?\.id;[\s\S]*?const grifoContextualOperacao = grifoContextualLeitorId;[\s\S]*?grifoContextualLeitorId === grifoContextualOperacao[\s\S]*?if \(!contextoVisualPermaneceAtual\) return false;/);
    assert.match(html, /btnExcluirGrifoExistente[\s\S]*?const grifoIdOperacao = grifo\.id;[\s\S]*?grifoContextualLeitorId !== grifoIdOperacao\) return;/);
    assert.match(repository, /export async function atualizarCorGrifoJuridico/);
    assert.match(repository, /user_legal_highlights"\)\.update\(\{ color: cor \}\)[\s\S]*?\.eq\("workspace_id", contexto\.workspaceId\)[\s\S]*?\.eq\("user_id", contexto\.userId\)[\s\S]*?\.eq\("updated_at", versaoEsperada\)/);
    assert.match(auth, /atualizarCorGrifo: atualizarCorGrifoJuridico/);
});

test("o histórico de leitura informa sincronização sem repetir automaticamente a contagem", () => {
    const html = readProjectFile("index.html");

    assert.match(html, /id="wsStatusHistoricoLeitura"[^>]*role="status"[^>]*aria-live="polite"/);
    assert.match(html, /mostrarStatusHistoricoLeitura\("pending", "Salvando leitura\.\.\."/);
    assert.match(html, /mostrarStatusHistoricoLeitura\("success", "Histórico sincronizado"/);
    assert.match(html, /mostrarStatusHistoricoLeitura\("error", "Leitura aberta · histórico não sincronizado"/);
    assert.match(html, /const geracao = \+\+geracaoRegistroLeitura;/);
    assert.match(html, /geracao !== geracaoRegistroLeitura/);
    assert.doesNotMatch(html, /registrarLeituraAtual\([^)]*\)[\s\S]*?setTimeout\([^)]*registrarLeituraAtual/);
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
    assert.match(html, /id="wsMateriaCardLeitor"/);
    assert.match(html, /id="wsReferenciaCardLeitor"[^>]*aria-label="Referência que será incluída no flashcard"/);
    assert.match(html, /class="legal-reader-answer-field"/);
    assert.match(html, /class="legal-reader-action-footer"/);
    assert.match(html, /id="btnCancelarAcaoLeitorRodape"/);
    assert.match(html, /id="textoBtnSalvarAcaoLeitor"/);
    assert.match(html, /prepararMateriasDestinoFlashcard[\s\S]*?materiasNormalizadas\(\)\.map/);
    assert.match(html, /function obterSelecaoAtualLeitor\(limite = 2000\)/);
    assert.match(html, /function abrirPainelAnotacaoLeitor\(grifo = null\)/);
    assert.match(html, /const rodape = `Referência: \$\{referencia\}/);
    assert.match(html, /Fonte oficial: \$\{fonte\}/);
    assert.match(html, /const limiteBase = Math\.max\(1, 10000 - rodape\.length - 2\)/);
    assert.match(html, /conteudoDigitado[\s\S]*?acaoLeitorAtual\.referencia[\s\S]*?`\$\{conteudoDigitado\}\\n\\n\$\{acaoLeitorAtual\.referencia\}`/);
    assert.match(html, /materiaDestino\.cards\.some/);
    assert.match(html, /criarFlashcardSincronizado\(pergunta, conteudo, \{ preservarLeitor: true, materiaId: materiaDestinoId, propagarErro: true \}\)/);
    assert.match(html, /if \(propagarErro\) throw erro;/);
    assert.match(repository, /export async function atualizarNotaGrifoJuridico/);
    assert.match(repository, /user_legal_highlights"\)\.update\([\s\S]*?\.eq\("user_id", contexto\.userId\)/);
    assert.match(auth, /atualizarNotaGrifo: atualizarNotaGrifoJuridico/);
});

test("respostas atrasadas do leitor não atravessam sessões nem trocam a matéria do flashcard", () => {
    const html = readProjectFile("index.html");

    assert.match(html, /let geracaoSessaoHub = 0;/);
    assert.match(html, /function capturarSessaoHubAtual\(\)[\s\S]*?geracao: geracaoSessaoHub[\s\S]*?usuarioId:[\s\S]*?workspaceId:/);
    assert.match(html, /function sessaoHubPermaneceAtual\(sessao\)[\s\S]*?sessao\.geracao === geracaoSessaoHub[\s\S]*?sessao\.usuarioId ===[\s\S]*?sessao\.workspaceId ===/);
    assert.match(html, /window\.iniciarHub = async[\s\S]*?geracaoSessaoHub \+= 1;/);
    assert.match(html, /window\.encerrarHub = \(\) => \{[\s\S]*?geracaoSessaoHub \+= 1;/);
    assert.match(html, /async function criarGrifoLeitor[\s\S]*?const sessao = capturarSessaoHubAtual\(\)[\s\S]*?if \(!sessaoHubPermaneceAtual\(sessao\)\) return null;/);
    assert.match(html, /const dispositivoIdOperacao = dispositivoLeitorAtual\.id;[\s\S]*?salvarFavorito\(materiaIdOperacao, dispositivoIdOperacao, adicionar\)/);
    assert.match(html, /async function criarFlashcardSincronizado[\s\S]*?const materiaIdOperacao = materiaId \|\| materiaAbertaId;[\s\S]*?\.criar\(materiaIdOperacao, card\)[\s\S]*?atualizarMateria\(materiaIdOperacao,/);
    assert.match(html, /const materiaContinuaAberta = String\(materiaAbertaId\) === String\(materiaIdOperacao\);/);
});

test("favoritos, retomada e histórico jurídico permanecem privados por usuário", () => {
    const html = readProjectFile("index.html");
    const repository = readProjectFile("src/cloud-core-repository.js");
    const auth = readProjectFile("src/auth.js");
    const migration = readProjectFile("supabase/migrations/202608300006_legal_reading_state.sql");

    assert.match(html, /id="btnFavoritarArtigo"/);
    assert.match(html, /id="wsAtalhosLeitura"/);
    assert.match(html, /Continuar de onde parei/);
    assert.match(html, />Recentes</);
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

test("anotações concorrentes são recusadas e o histórico incrementa no banco", () => {
    const html = readProjectFile("index.html");
    const repository = readProjectFile("src/cloud-core-repository.js");
    const migration = readProjectFile("supabase/migrations/202608300009_legal_reader_concurrency.sql");

    assert.match(repository, /user_legal_highlights"\)\s*\.select\("[^"]*updated_at"\)/);
    assert.match(repository, /export async function atualizarNotaGrifoJuridico\(id, nota, atualizadoEm\)/);
    assert.match(repository, /\.eq\("updated_at", versaoEsperada\)/);
    assert.match(repository, /Esta anotação foi alterada em outra aba/);
    assert.match(html, /atualizarNotaGrifo\(grifo\.id, conteudo, grifo\.atualizadoEm\)/);
    assert.match(html, /grifo\.atualizadoEm = salvo\.atualizadoEm/);
    assert.match(repository, /supabase\.rpc\("increment_legal_reading_history"/);
    assert.doesNotMatch(repository, /visit_count: Math\.min\(1000000, Math\.max\(1, Number\(visitasAtuais\) \+ 1\)\)/);
    assert.match(migration, /security invoker/i);
    assert.match(migration, /\(select auth\.uid\(\)\)/i);
    assert.match(migration, /visit_count = least\(1000000, history\.visit_count \+ 1\)/i);
    assert.match(migration, /revoke all on function public\.increment_legal_reading_history\(uuid, uuid, uuid\)[\s\S]*?from public, anon, authenticated/i);
    assert.match(migration, /grant execute on function public\.increment_legal_reading_history\(uuid, uuid, uuid\)[\s\S]*?to authenticated/i);
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
        <p>Art. 1-A. Pena \u0096 artigo acrescido.</p>
    `);

    assert.equal(dispositivos.length, 2);
    assert.deepEqual(dispositivos.map(item => item.chave), ["art-1", "art-1-a"]);
    assert.deepEqual(dispositivos[0].caminho, ["TÍTULO I — DOS PRINCÍPIOS FUNDAMENTAIS"]);
    assert.match(dispositivos[0].conteudo, /Parágrafo único/);
    assert.match(dispositivos[1].conteudo, /Pena – artigo acrescido/);
});

test("o importador jurídico reconhece a hierarquia penal e artigos com sufixos compostos", () => {
    const dispositivos = extrairDispositivos(`
        <p>PARTE ESPECIAL</p>
        <p>TÍTULO I</p><p>(Incluído pela Lei nº 14.197, de 2021)</p><p>DOS CRIMES</p>
        <p>Art. 359-M-A. Regra de concurso.</p>
        <p>Art. 359-M-B. Regra de redução.</p>
    `, { raiz: "CÓDIGO PENAL" });

    assert.deepEqual(dispositivos.map(item => item.chave), ["art-359-m-a", "art-359-m-b"]);
    assert.deepEqual(dispositivos[0].caminho, ["CÓDIGO PENAL", "PARTE ESPECIAL", "TÍTULO I — DOS CRIMES"]);
});

test("o importador preserva artigos processuais acrescidos após o ordinal", () => {
    const dispositivos = extrairDispositivos(`
        <p>TÍTULO I</p><p>DISPOSIÇÕES PRELIMINARES</p>
        <p>Art. 3º A regra geral.</p>
        <p>Art. 3º-A. A estrutura acusatória.</p>
        <p>Art. 3º-B. O juiz das garantias.</p>
    `, { raiz: "CÓDIGO DE PROCESSO PENAL" });

    assert.deepEqual(dispositivos.map(item => item.chave), ["art-3", "art-3-a", "art-3-b"]);
    assert.equal(dispositivos[1].conteudo, "A estrutura acusatória.");
    assert.equal(dispositivos[1].rotulo, "Art. 3º-A");
});

test("o importador jurídico remove redações riscadas e normaliza entidades e ordinais", () => {
    const dispositivos = extrairDispositivos(`
        <p>Art. 1° Regra &quot;vigente&quot;.</p>
        <p><strike>§ 1° Redação revogada.</strike></p>
        <p>§ 1º Redação atual.</p>
        <p>Art. 2°-A. Artigo acrescido.</p>
    `);

    assert.equal(dispositivos.length, 2);
    assert.equal(dispositivos[0].rotulo, "Art. 1º");
    assert.match(dispositivos[0].conteudo, /Regra "vigente"/);
    assert.doesNotMatch(dispositivos[0].conteudo, /revogada/);
    assert.equal(dispositivos[1].rotulo, "Art. 2º-A");
    assert.equal(dispositivos[1].conteudo, "Artigo acrescido.");
});

test("o importador jurídico não incorpora o rodapé oficial ao último artigo", () => {
    const dispositivos = extrairDispositivos(`
        <p>Art. 7º Revogam-se as disposições em contrário.</p>
        <p>Brasília, 21 de dezembro de 1989; 168º da Independência.</p>
        <p>JOSÉ SARNEY</p>
        <p>Este texto não substitui o publicado no DOU.</p>
        <p>Download para anexo</p><p>*</p>
    `);

    assert.equal(dispositivos.length, 1);
    assert.equal(dispositivos[0].conteudo, "Revogam-se as disposições em contrário.");
});

test("o importador associa a epígrafe ao artigo correto sem contaminar o artigo anterior", () => {
    const dispositivos = extrairDispositivos(`
        <p>PARTE GERAL</p><p>TÍTULO I</p><p>DA APLICAÇÃO DA LEI PENAL</p>
        <p>Anterioridade da Lei</p><p>Art. 1º Texto do primeiro artigo.</p>
        <p>Lei penal no tempo</p><p>Art. 2º Texto do segundo artigo.</p>
    `, { raiz: "CÓDIGO PENAL" });

    assert.equal(dispositivos[0].titulo, "Anterioridade da Lei");
    assert.equal(dispositivos[1].titulo, "Lei penal no tempo");
    assert.doesNotMatch(dispositivos[0].conteudo, /Lei penal no tempo/);
    assert.equal(dispositivos[1].conteudo, "Texto do segundo artigo.");
});

test("o Código Penal integral usa fonte oficial e é vinculado somente ao catálogo de Direito Penal", () => {
    const migration = readProjectFile("supabase/migrations/202608300007_complete_penal_code.sql");
    const chavesImportadas = [...migration.matchAll(/"chave":"art-/g)];

    assert.equal(chavesImportadas.length, 429);
    assert.match(migration, /https:\/\/www\.planalto\.gov\.br\/ccivil_03\/decreto-lei\/del2848compilado\.htm/);
    assert.match(migration, /Texto compilado consultado em 30\/08\/2026/);
    assert.match(migration, /"chave":"art-121-b"/);
    assert.match(migration, /"chave":"art-359-m-a"/);
    assert.match(migration, /"chave":"art-359-m-b"/);
    assert.match(migration, /"chave":"art-361"/);
    assert.match(migration, /10000000-0000-4000-8000-000000000002/);
    assert.match(migration, /update public\.legal_documents[\s\S]*?current_version_id/);
    assert.doesNotMatch(migration, /user_legal_highlights/);
});

test("a correção do Código Penal cria nova versão e preserva todos os dados pessoais de leitura", () => {
    const migration = readProjectFile("supabase/migrations/202608300008_correct_penal_article_headings.sql");
    const html = readProjectFile("index.html");

    assert.equal([...migration.matchAll(/"chave":"art-/g)].length, 429);
    assert.match(migration, /epígrafes revisadas/);
    assert.match(migration, /"titulo":"Anterioridade da Lei"/);
    assert.match(migration, /"titulo":"Lei penal no tempo"/);
    assert.doesNotMatch(migration.match(/"chave":"art-1"[\s\S]*?"chave":"art-2"/)?.[0] || "", /Lei penal no tempo/);
    assert.match(migration, /update public\.user_legal_highlights as registro/);
    assert.match(migration, /update public\.user_legal_bookmarks as registro/);
    assert.match(migration, /update public\.user_legal_reading_history as registro/);
    assert.match(migration, /novo\.provision_key = antigo\.provision_key/g);
    assert.match(migration, /set current_version_id = '21000000-0000-4000-8000-000000000005'/);
    assert.match(html, /epigrafe \? `\$\{dispositivo\.rotulo\} — \$\{epigrafe\}` : dispositivo\.rotulo/);
});

test("o núcleo processual mantém CPP e Prisão Temporária completos e separados", () => {
    const html = readProjectFile("index.html");
    const migration = readProjectFile("supabase/migrations/202608310002_complete_criminal_procedure_core.sql");
    const chavesImportadas = [...migration.matchAll(/"chave":"art-/g)];

    assert.ok(chavesImportadas.length >= 852, `esperados ao menos 852 dispositivos, encontrados ${chavesImportadas.length}`);
    assert.match(migration, /codigo-processo-penal-decreto-lei-3689-1941/);
    assert.match(migration, /prisao-temporaria-lei-7960-1989/);
    assert.match(migration, /del3689compilado\.htm/);
    assert.match(migration, /leis\/l7960\.htm/);
    assert.match(migration, /"chave":"art-3-a"/);
    assert.match(migration, /"chave":"art-811"/);
    assert.match(migration, /Texto integral da Lei nº 7\.960\/1989 — arts\. 1º a 7º/);
    assert.doesNotMatch(migration, /&quot;/);
    assert.doesNotMatch(migration, /"conteudo":"°/);
    assert.doesNotMatch(migration, /Decorrido o prazo de cinco dias de detenção/);
    assert.doesNotMatch(migration, /Download para anexo/);
    assert.doesNotMatch(migration, /"conteudo":"[^"\\]*(?:\\.[^"\\]*)*\\n\\n\*"/);
    assert.match(migration, /"rotulo":"Art\. 3º-A"/);
    assert.equal((migration.match(/10000000-0000-4000-8000-000000000003/g) || []).length, 2);
    assert.doesNotMatch(migration, /10000000-0000-4000-8000-000000000002/);
    assert.doesNotMatch(migration, /10000000-0000-4000-8000-000000000005/);
    assert.match(html, /\["cpp", "prisao-temporaria"\]\.includes\(item\.id\)/);
    assert.match(html, /if \(chave\.includes\("penal"\)\) return item\.id === "cp"/);
});

test("a biblioteca carrega metadados no login e busca os artigos somente ao abrir uma lei", () => {
    const repository = readProjectFile("src/cloud-core-repository.js");
    const auth = readProjectFile("src/auth.js");
    const html = readProjectFile("index.html");

    assert.match(repository, /const TAMANHO_PAGINA_DISPOSITIVOS_JURIDICOS = 1000/);
    assert.match(repository, /export async function carregarDispositivosJuridicosPorVersao\(versaoId\)/);
    assert.match(repository, /\.eq\("version_id", versaoId\)/);
    assert.match(repository, /\.range\(inicio, inicio \+ TAMANHO_PAGINA_DISPOSITIVOS_JURIDICOS - 1\)/);
    assert.match(repository, /\.in\("id", versoesAtuaisIds\)/);
    assert.doesNotMatch(repository, /Promise\.all\(versoesAtuaisIds\.map\(carregarDispositivosJuridicosPorVersao\)\)/);
    assert.match(repository, /carregada: false,[\s\S]*?dispositivos: \[\]/);
    assert.match(auth, /listarDispositivos: carregarDispositivosJuridicosPorVersao/);
    assert.match(html, /async function garantirDocumentoJuridicoCarregado\(documento\)/);
    assert.match(html, /await garantirDocumentoJuridicoCarregado\(documento\)/);
    assert.match(html, /const carregamentosDaSessao = carregamentosDocumentosJuridicos;/);
    assert.match(html, /carregamentosDocumentosJuridicos === carregamentosDaSessao[\s\S]*?carregamentosDaSessao\.get\(versaoId\) === carregamentoAtual/);
    assert.match(html, /const sessao = capturarSessaoHubAtual\(\);[\s\S]*?await garantirDocumentoJuridicoCarregado\(documento\);[\s\S]*?if \(!sessaoHubPermaneceAtual\(sessao\) \|\| String\(materiaAbertaId \|\| ""\) !== materiaIdOrigem\) return;/);
    assert.match(html, /catch \(erro\) \{\s*if \(!sessaoHubPermaneceAtual\(sessao\) \|\| String\(materiaAbertaId \|\| ""\) !== materiaIdOrigem\) return;[\s\S]*?window\.alert/);
    assert.doesNotMatch(repository, /supabase\.from\("legal_provisions"\)[\s\S]{0,220}\.order\("sequence"[^\n]+\)(?![\s\S]{0,120}\.range)/);
});

test("a correção processual preserva os IDs associados aos dados pessoais", () => {
    const migration = readProjectFile("supabase/migrations/202608310003_correct_criminal_procedure_content.sql");
    const footerFix = readProjectFile("supabase/migrations/202608310004_remove_legal_source_footers.sql");

    assert.match(migration, /update public\.legal_provisions as dispositivo/i);
    assert.match(migration, /where dispositivo\.version_id = '21000000-0000-4000-8000-000000000006'/);
    assert.match(migration, /where dispositivo\.version_id = '21000000-0000-4000-8000-000000000007'/);
    assert.doesNotMatch(migration, /delete from public\.legal_provisions/i);
    assert.doesNotMatch(migration, /&quot;/);
    assert.doesNotMatch(migration, /Decorrido o prazo de cinco dias de detenção/);
    assert.match(footerFix, /version_id = '21000000-0000-4000-8000-000000000006'[\s\S]*?provision_key = 'art-811'/);
    assert.match(footerFix, /version_id = '21000000-0000-4000-8000-000000000007'[\s\S]*?provision_key = 'art-7'/);
    assert.doesNotMatch(footerFix, /delete from public\.legal_provisions/i);
});

test("o Meu Vade Mecum é pessoal e substitui sua lista de normas de forma atômica", () => {
    const migration = readProjectFile("supabase/migrations/202608300010_personal_vade_collections.sql");
    const repository = readProjectFile("src/cloud-core-repository.js");
    const auth = readProjectFile("src/auth.js");

    assert.match(migration, /create table public\.user_vade_collections/i);
    assert.match(migration, /create table public\.user_vade_collection_documents/i);
    assert.match(migration, /foreign key \(collection_id, workspace_id, user_id\)[\s\S]*?references public\.user_vade_collections\(id, workspace_id, user_id\) on delete cascade/i);
    assert.match(migration, /alter table public\.user_vade_collections force row level security/i);
    assert.match(migration, /alter table public\.user_vade_collection_documents force row level security/i);
    assert.match(migration, /user_vade_collections_select_self[\s\S]*?user_id = \(select auth\.uid\(\)\)[\s\S]*?private\.is_workspace_member\(workspace_id\)/i);
    assert.match(migration, /user_vade_collections_insert_self[\s\S]*?with check[\s\S]*?user_id = \(select auth\.uid\(\)\)/i);
    assert.match(migration, /create or replace function public\.replace_user_vade_documents/i);
    assert.match(migration, /security definer[\s\S]*?set search_path = ''/i);
    assert.match(migration, /current_user_id uuid := \(select auth\.uid\(\)\)/i);
    assert.match(migration, /private\.is_workspace_member\(collection\.workspace_id\)[\s\S]*?for update/i);
    assert.match(migration, /requested_count > 100/i);
    assert.match(migration, /count\(distinct requested_document_id\)/i);
    assert.match(migration, /document\.active = true/i);
    assert.match(migration, /delete from public\.user_vade_collection_documents[\s\S]*?insert into public\.user_vade_collection_documents/i);
    assert.match(migration, /grant select on table public\.user_vade_collection_documents to authenticated/i);
    assert.doesNotMatch(migration, /grant (?:insert|update|delete|all)[^;]*user_vade_collection_documents[^;]*authenticated/i);
    assert.match(migration, /grant execute on function public\.replace_user_vade_documents\(uuid, uuid\[\]\) to authenticated/i);

    assert.match(repository, /export async function carregarColecoesVade/);
    assert.match(repository, /export async function criarColecaoVade/);
    assert.match(repository, /export async function atualizarColecaoVade/);
    assert.match(repository, /export async function salvarDocumentosColecaoVade/);
    assert.match(repository, /export async function excluirColecaoVade/);
    assert.match(repository, /\.rpc\("replace_user_vade_documents"/);
    assert.match(repository, /user_vade_collections"\)\.update\([\s\S]*?\.eq\("workspace_id", contexto\.workspaceId\)[\s\S]*?\.eq\("user_id", contexto\.userId\)[\s\S]*?\.eq\("updated_at", versaoEsperada\)/);
    assert.match(repository, /user_vade_collections"\)\.delete\(\)[\s\S]*?\.eq\("workspace_id", contexto\.workspaceId\)[\s\S]*?\.eq\("user_id", contexto\.userId\)/);
    assert.match(auth, /window\.HUB_CLOUD_VADE = Object\.freeze/);
});

test("a interface do Meu Vade Mecum carrega coleções pessoais e confirma operações remotas", () => {
    const html = readProjectFile("index.html");
    const auth = readProjectFile("src/auth.js");
    const docs = readProjectFile("docs/arquitetura-biblioteca-juridica.md");

    assert.match(auth, /carregarColecoesVade\(\)/);
    assert.match(auth, /colecoesVadeRemotas/);
    assert.match(html, /id="wsVadePanel"/);
    assert.match(html, /function renderizarVade\(\)/);
    assert.match(html, /exigirNuvemVade\(\)\.salvarDocumentos/);
    assert.match(html, /exigirNuvemVade\(\)\.atualizar/);
    assert.match(html, /exigirNuvemVade\(\)\.excluir/);
    assert.match(html, /Organização confirmada no Supabase/);
    assert.match(html, /Seus grifos e anotações nos artigos não serão apagados/);
    assert.match(html, /if \(!sessaoHubPermaneceAtual\(sessao\)\) return/);
    assert.match(docs, /foi aplicada e validada no Supabase/);
    assert.match(docs, /Documentos privados e comunidade permanecem reservados/);
});

test("os Cadernos jurídicos salvam artigos privados e permitem reabri-los ou removê-los", () => {
    const html = readProjectFile("index.html");
    const migration = readProjectFile("supabase/migrations/202608310005_legal_notebook_articles.sql");
    const repository = readProjectFile("src/cloud-core-repository.js");
    const auth = readProjectFile("src/auth.js");

    assert.match(migration, /create table public\.user_vade_collection_provisions/i);
    assert.match(migration, /foreign key \(collection_id, workspace_id, user_id\)[\s\S]*?references public\.user_vade_collections\(id, workspace_id, user_id\) on delete cascade/i);
    assert.match(migration, /alter table public\.user_vade_collection_provisions force row level security/i);
    assert.match(migration, /user_vade_collection_provisions_select_self[\s\S]*?user_id = \(select auth\.uid\(\)\)[\s\S]*?private\.is_workspace_member\(workspace_id\)/i);
    assert.match(migration, /create or replace function public\.set_user_vade_provision/i);
    assert.match(migration, /document\.current_version_id = version\.id[\s\S]*?document\.active = true/i);
    assert.match(migration, /grant select on table public\.user_vade_collection_provisions to authenticated/i);
    assert.doesNotMatch(migration, /grant (?:insert|update|delete|all)[^;]*user_vade_collection_provisions[^;]*authenticated/i);
    assert.match(migration, /grant execute on function public\.set_user_vade_provision\(uuid, uuid, boolean\) to authenticated/i);

    assert.match(repository, /user_vade_collection_provisions/);
    assert.match(repository, /export async function salvarArtigoColecaoVade/);
    assert.match(repository, /\.rpc\("set_user_vade_provision"/);
    assert.match(auth, /salvarArtigo: salvarArtigoColecaoVade/);

    assert.match(html, />Cadernos jurídicos</);
    assert.match(html, /id="wsCadernoArtigoPopover"/);
    assert.match(html, /function renderizarSeletorCadernosArtigo/);
    assert.match(html, /async function alternarArtigoNoCaderno/);
    assert.match(html, /async function removerArtigoDoCaderno/);
    assert.match(html, /class="[^"]*btn-abrir-artigo-vade/);
    assert.match(html, /class="[^"]*btn-remover-artigo-vade/);
    assert.match(html, /exigirNuvemVade\(\)\.salvarArtigo/);
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

test("as anotações dos Cadernos jurídicos são privadas, versionadas e independentes da lista de artigos", () => {
    const migration = readProjectFile("supabase/migrations/202609010001_private_legal_notebook_notes.sql");
    const repository = readProjectFile("src/cloud-core-repository.js");
    const auth = readProjectFile("src/auth.js");

    assert.match(migration, /create table public\.user_vade_notes/i);
    assert.match(migration, /foreign key \(collection_id, workspace_id, user_id\)[\s\S]*?references public\.user_vade_collections\(id, workspace_id, user_id\) on delete cascade/i);
    assert.match(migration, /provision_id uuid references public\.legal_provisions\(id\) on delete set null/i);
    assert.doesNotMatch(migration, /references public\.user_vade_collection_provisions/i);
    assert.match(migration, /kind in \('note', 'summary'\)/i);
    assert.match(migration, /before update on public\.user_vade_notes[\s\S]*?private\.bump_note_version\(\)/i);
    assert.match(migration, /alter table public\.user_vade_notes force row level security/i);
    assert.match(migration, /user_vade_notes_select_self[\s\S]*?user_id = \(select auth\.uid\(\)\)[\s\S]*?private\.is_workspace_member\(workspace_id\)/i);
    assert.match(migration, /user_vade_notes_insert_self[\s\S]*?with check[\s\S]*?user_id = \(select auth\.uid\(\)\)/i);
    assert.match(migration, /revoke all on table public\.user_vade_notes from public, anon, authenticated/i);
    assert.match(migration, /grant select, insert, update, delete on table public\.user_vade_notes to authenticated/i);

    assert.match(repository, /export async function carregarAnotacoesColecaoVade/);
    assert.match(repository, /export async function criarAnotacaoColecaoVade/);
    assert.match(repository, /export async function atualizarAnotacaoColecaoVade/);
    assert.match(repository, /export async function excluirAnotacaoColecaoVade/);
    assert.match(repository, /user_vade_notes"\)\.update\([\s\S]*?\.eq\("workspace_id", contexto\.workspaceId\)[\s\S]*?\.eq\("user_id", contexto\.userId\)[\s\S]*?\.eq\("version", versao\)/);
    assert.match(repository, /user_vade_notes"\)\.delete\(\)[\s\S]*?\.eq\("version", versao\)/);
    assert.match(auth, /listarAnotacoes: carregarAnotacoesColecaoVade/);
    assert.match(auth, /criarAnotacao: criarAnotacaoColecaoVade/);
    assert.match(auth, /atualizarAnotacao: atualizarAnotacaoColecaoVade/);
    assert.match(auth, /excluirAnotacao: excluirAnotacaoColecaoVade/);
});

test("cada Caderno jurídico possui editor amplo de anotações com vínculo opcional ao artigo", () => {
    const html = readProjectFile("index.html");

    assert.match(html, /class="legal-notebook-tab btn-aba-artigos-caderno/);
    assert.match(html, /class="legal-notebook-tab btn-aba-anotacoes-caderno/);
    assert.match(html, /function htmlPainelAnotacoesCaderno/);
    assert.match(html, /class="legal-notebook-notes-layout"/);
    assert.match(html, /class="form-control legal-notebook-note-title"/);
    assert.match(html, /class="form-control legal-notebook-note-content"/);
    assert.match(html, /Anotação geral do caderno/);
    assert.match(html, /Criar anotação deste artigo/);
    assert.match(html, /listarAnotacoes\(colecao\.id\)/);
    assert.match(html, /criarAnotacao\(colecao\.id, dados\)/);
    assert.match(html, /atualizarAnotacao\(rascunho\.id, dados, rascunho\.versao\)/);
    assert.match(html, /excluirAnotacao\(rascunho\.id, rascunho\.versao\)/);
    assert.match(html, /Há alterações não salvas nesta anotação/);
    assert.match(html, /window\.prepararSaidaHub = async \(\) => \{[\s\S]*?confirmarDescarteAnotacaoCaderno\(\)/);
});

test("os PDFs dos Cadernos jurídicos usam bucket privado, limite e caminho isolado por usuário", () => {
    const migration = readProjectFile("supabase/migrations/202609010002_private_legal_notebook_pdfs.sql");
    const repository = readProjectFile("src/cloud-core-repository.js");
    const auth = readProjectFile("src/auth.js");

    assert.match(migration, /insert into storage\.buckets[\s\S]*?'private-legal-notebook-pdfs'[\s\S]*?false[\s\S]*?26214400[\s\S]*?'application\/pdf'/i);
    assert.match(migration, /create table public\.user_vade_files/i);
    assert.match(migration, /upload_status text not null default 'pending' check \(upload_status in \('pending', 'ready'\)\)/i);
    assert.match(migration, /references public\.user_vade_collections\(id, workspace_id, user_id\) on delete restrict/i);
    assert.match(migration, /storage_path = concat\([\s\S]*?user_id::text[\s\S]*?workspace_id::text[\s\S]*?collection_id::text[\s\S]*?id::text/i);
    assert.match(migration, /alter table public\.user_vade_files force row level security/i);
    assert.match(migration, /private_legal_notebook_pdfs_select_self[\s\S]*?bucket_id = 'private-legal-notebook-pdfs'[\s\S]*?file\.user_id = \(select auth\.uid\(\)\)/i);
    assert.match(migration, /private_legal_notebook_pdfs_insert_self[\s\S]*?exists \([\s\S]*?public\.user_vade_files/i);
    assert.match(migration, /private_legal_notebook_pdfs_delete_self[\s\S]*?exists \([\s\S]*?public\.user_vade_files/i);
    assert.match(migration, /Cada caderno pode conter no máximo 20 PDFs privados/i);
    assert.match(migration, /new\.user_id is distinct from \(select auth\.uid\(\)\)[\s\S]*?private\.is_workspace_member\(new\.workspace_id\)/i);
    assert.match(migration, /create or replace function private\.protect_user_vade_file_identity/i);
    assert.match(migration, /new\.storage_path is distinct from old\.storage_path[\s\S]*?A identidade do PDF é imutável/i);
    assert.match(migration, /create or replace function public\.remove_user_vade_file_metadata/i);
    assert.match(migration, /create or replace function public\.finalize_user_vade_file/i);
    assert.match(migration, /create or replace function public\.reconcile_user_vade_files/i);
    assert.match(migration, /file\.created_at < now\(\) - interval '15 minutes'/i);
    assert.match(migration, /set upload_status = 'ready'[\s\S]*?storage\.objects/i);
    assert.match(migration, /if exists \([\s\S]*?from storage\.objects[\s\S]*?Remova o arquivo do armazenamento antes de apagar seu cadastro/i);
    assert.match(migration, /grant select, insert on table public\.user_vade_files to authenticated/i);
    assert.match(migration, /grant update \(display_name, description\) on table public\.user_vade_files to authenticated/i);
    assert.doesNotMatch(migration, /grant select, insert, update, delete on table public\.user_vade_files/i);

    assert.match(repository, /const BUCKET_PDFS_VADE = "private-legal-notebook-pdfs"/);
    assert.match(repository, /String\.fromCharCode\(\.\.\.cabecalho\) !== "%PDF-"/);
    assert.match(repository, /export async function enviarPdfColecaoVade/);
    assert.match(repository, /supabase\.rpc\("reconcile_user_vade_files", \{ p_collection_id: colecaoId \}\)/);
    assert.match(repository, /supabase\.storage\.from\(BUCKET_PDFS_VADE\)\.upload\(caminho, arquivo/);
    assert.match(repository, /supabase\.rpc\("finalize_user_vade_file", \{ p_file_id: arquivoId \}\)/);
    assert.match(repository, /\.eq\("upload_status", "ready"\)/);
    assert.match(repository, /createSignedUrl\(arquivo\.storage_path, 300\)/);
    assert.match(repository, /supabase\.storage\.from\(BUCKET_PDFS_VADE\)\.remove\(\[arquivo\.storage_path\]\)/);
    assert.match(repository, /supabase\.rpc\("remove_user_vade_file_metadata", \{ p_file_id: arquivoId \}\)/);
    assert.match(auth, /listarPdfs: carregarPdfsColecaoVade/);
    assert.match(auth, /enviarPdf: enviarPdfColecaoVade/);
    assert.match(auth, /criarUrlPdf: criarUrlPdfColecaoVade/);
    assert.match(auth, /excluirPdf: excluirPdfColecaoVade/);
});

test("os PDFs privados permanecem preservados enquanto sua interface está pausada", () => {
    const html = readProjectFile("index.html");

    assert.match(html, /const interfacePdfsPrivadosAtiva = false/);
    assert.match(html, /if \(!interfacePdfsPrivadosAtiva && aba === "materiais"\)/);
    assert.match(html, /class="legal-notebook-tab btn-aba-materiais-caderno/);
    assert.match(html, /function htmlPainelPdfsCaderno/);
    assert.match(html, /class="legal-notebook-file-upload form-upload-pdf-caderno"/);
    assert.match(html, /accept="application\/pdf,\.pdf"/);
    assert.match(html, /Fonte \/ autoria \/ editora \(opcional\)/);
    assert.match(html, /O envio não transfere autoria ou direitos de distribuição/);
    assert.match(html, /Material de terceiros · uso privado/);
    assert.match(html, /descricao: form\.querySelector\("\.campo-fonte-pdf-caderno"\)/);
    assert.match(html, /atualizarPdf\(arquivo\.id, \{ nome, descricao \}\)/);
    assert.match(html, /class="legal-notebook-file-edit form-editar-pdf-caderno"/);
    assert.match(html, /Salvar identificação/);
    assert.match(html, /function iniciarEdicaoPdfCaderno/);
    assert.match(html, /function salvarEdicaoPdfCaderno/);
    assert.doesNotMatch(html, /prompt\("Nome do material no caderno:/);
    assert.match(html, /Até 25 MB/);
    assert.match(html, /20 arquivos/);
    assert.match(html, /class="legal-notebook-pdf-viewer"/);
    assert.match(html, /referrerpolicy="no-referrer"/);
    assert.match(html, /sandbox="allow-downloads"/);
    assert.match(html, /PDF\(s\) privado\(s\) preservado\(s\)/);
    assert.match(html, /target="_blank" rel="noopener noreferrer"/);
    assert.match(html, /listarPdfs\(colecao\.id\)/);
    assert.match(html, /enviarPdf\(colecao\.id, arquivo/);
    assert.match(html, /criarUrlPdf\(arquivo\.id\)/);
    assert.match(html, /excluirPdf\(arquivo\.id\)/);
    assert.match(html, /Este caderno possui \$\{arquivos\.length\} PDF\(s\) privado\(s\)/);
});

test("o progresso de leitura dos PDFs é privado, persistente e retoma na página salva", () => {
    const migration = readProjectFile("supabase/migrations/202609020001_private_vade_pdf_reading_progress.sql");
    const repository = readProjectFile("src/cloud-core-repository.js");
    const html = readProjectFile("index.html");

    assert.match(migration, /add column page_count integer/i);
    assert.match(migration, /add column last_page integer not null default 1/i);
    assert.match(migration, /add column last_read_at timestamptz/i);
    assert.match(migration, /check \(page_count is null or last_page <= page_count\)/i);
    assert.match(migration, /grant update \(page_count, last_page, last_read_at\)[\s\S]*?to authenticated/i);
    assert.doesNotMatch(migration, /grant update on table public\.user_vade_files/i);

    assert.match(repository, /totalPaginas: item\.page_count == null \? null : Number\(item\.page_count\)/);
    assert.match(repository, /paginaAtual: Number\(item\.last_page\) \|\| 1/);
    assert.match(repository, /ultimaLeituraEm: item\.last_read_at \|\| null/);
    assert.match(repository, /valores\.last_page = numeroLimitado\(alteracoes\.paginaAtual/);
    assert.match(repository, /valores\.page_count = numeroLimitado\(alteracoes\.totalPaginas/);
    assert.match(repository, /alteracoes\.registrarLeitura === true/);

    assert.match(html, /function percentualLeituraPdf/);
    assert.match(html, /function urlPdfNaPagina/);
    assert.match(html, /#page=\$\{Math\.max\(1, Number\(pagina\) \|\| 1\)\}&zoom=page-width/);
    assert.match(html, /class="legal-notebook-pdf-progress form-progresso-pdf-caderno"/);
    assert.match(html, /Página atual/);
    assert.match(html, /Total de páginas/);
    assert.match(html, /Salvar progresso/);
    assert.match(html, /function salvarProgressoPdfCaderno/);
    assert.match(html, /atualizarPdf\(aberto\.id, \{ paginaAtual, totalPaginas, registrarLeitura: true \}\)/);
    assert.match(html, /arquivo\.ultimaLeituraEm \? "Continuar" : "Abrir"/);
    assert.match(html, /function rotuloUltimaLeituraPdf/);
    assert.match(html, /class="legal-notebook-pdf-progress is-compact"/);
    assert.match(html, /class="btn btn-sm btn-outline-light btn-editar-progresso-pdf"/);
    assert.match(html, /pdfProgressoEmEdicaoCaderno\.add\(colecao\.id\)/);
    assert.match(html, /pdfProgressoEmEdicaoCaderno\.delete\(colecao\.id\)/);
    assert.match(html, /percentualLeituraPdf\(arquivo\) === 100 \? "Revisar"/);
    assert.match(html, /Leitura concluída/);
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
    assert.match(edgeFunction, /private_vade_pdfs/);
    assert.match(edgeFunction, /\.from\(PRIVATE_VADE_BUCKET\)[\s\S]*?\.remove\(paths\)/);
    assert.match(edgeFunction, /\.from\("user_vade_files"\)[\s\S]*?\.delete\(\)[\s\S]*?\.in\("storage_path", paths\)/);
    assert.match(edgeFunction, /auth\.admin\.deleteUser/);
    assert.ok(edgeFunction.indexOf("prepare_user_deletion") < edgeFunction.indexOf("auth.admin.deleteUser"));
    assert.ok(edgeFunction.indexOf(".remove(paths)") < edgeFunction.indexOf("auth.admin.deleteUser"));
    assert.match(edgeFunction, /expectedConfirmation\s*=\s*`EXCLUIR \$\{target\.email\}`/);
    assert.match(frontend, /confirmation !== currentDeletion\.confirmation/);
    assert.match(frontend, /preview-delete/);
    assert.match(frontend, /private_vade_pdfs", "PDFs privados dos cadernos jurídicos/);
    assert.match(html, /id=["']modalExcluirUsuario["']/);
    assert.match(html, /id=["']confirmacaoExclusaoUsuario["']/);
});

test("os Cadernos jurídicos oferecem revisão ordenada, progresso e retomada privados", () => {
    const migration = readProjectFile("supabase/migrations/202608310006_legal_notebook_review.sql");
    const repository = readProjectFile("src/cloud-core-repository.js");
    const auth = readProjectFile("src/auth.js");
    const html = readProjectFile("index.html");

    assert.match(migration, /add column reviewed_at timestamptz/i);
    assert.match(migration, /add column last_provision_id uuid references public\.legal_provisions\(id\) on delete set null/i);
    assert.match(migration, /set_user_vade_provision_review[\s\S]*?user_id = current_user_id[\s\S]*?private\.is_workspace_member/i);
    assert.match(migration, /replace_user_vade_provision_order[\s\S]*?count\(distinct requested_id\)[\s\S]*?exatamente os artigos atuais/i);
    assert.match(migration, /remember_user_vade_provision[\s\S]*?exists \([\s\S]*?item\.provision_id = p_provision_id/i);
    assert.match(migration, /grant execute on function public\.set_user_vade_provision_review\(uuid, uuid, boolean\) to authenticated/i);
    assert.match(migration, /grant execute on function public\.replace_user_vade_provision_order\(uuid, uuid\[\]\) to authenticated/i);
    assert.match(migration, /grant execute on function public\.remember_user_vade_provision\(uuid, uuid\) to authenticated/i);
    assert.match(repository, /\.rpc\("set_user_vade_provision_review"/);
    assert.match(repository, /\.rpc\("replace_user_vade_provision_order"/);
    assert.match(repository, /\.rpc\("remember_user_vade_provision"/);
    assert.match(auth, /salvarRevisaoArtigo:/);
    assert.match(auth, /salvarOrdemArtigos:/);
    assert.match(auth, /salvarUltimoArtigo:/);
    assert.match(html, /class="[^"]*btn-estudar-vade/);
    assert.match(html, /class="[^"]*filtro-busca-caderno/);
    assert.match(html, /id="wsModoRevisaoCaderno"/);
    assert.match(html, /id="btnMarcarRevisadoCaderno"/);
});

test("as seções dos Cadernos jurídicos organizam artigos sem romper o isolamento por usuário", () => {
    const migration = readProjectFile("supabase/migrations/202608310007_legal_notebook_sections.sql");
    const repository = readProjectFile("src/cloud-core-repository.js");
    const auth = readProjectFile("src/auth.js");
    const html = readProjectFile("index.html");

    assert.match(migration, /create table public\.user_vade_collection_sections/i);
    assert.match(migration, /foreign key \(collection_id, workspace_id, user_id\)[\s\S]*?references public\.user_vade_collections\(id, workspace_id, user_id\) on delete cascade/i);
    assert.match(migration, /add column section_id uuid references public\.user_vade_collection_sections\(id\) on delete set null/i);
    assert.match(migration, /user_vade_collection_sections_select_self[\s\S]*?user_id = \(select auth\.uid\(\)\)[\s\S]*?private\.is_workspace_member\(workspace_id\)/i);
    assert.match(migration, /set_user_vade_provision_section[\s\S]*?section\.collection_id = p_collection_id[\s\S]*?section\.user_id = current_user_id/i);
    assert.match(migration, /replace_user_vade_section_order[\s\S]*?exatamente as seções atuais do caderno/i);
    assert.match(migration, /grant select on table public\.user_vade_collection_sections to authenticated/i);
    assert.doesNotMatch(migration, /grant (?:insert|update|delete|all)[^;]*user_vade_collection_sections[^;]*authenticated/i);
    assert.match(repository, /\.rpc\("create_user_vade_section"/);
    assert.match(repository, /\.rpc\("set_user_vade_provision_section"/);
    assert.match(auth, /criarSecao:/);
    assert.match(auth, /moverArtigoParaSecao:/);
    assert.match(html, /class="[^"]*btn-secoes-vade/);
    assert.match(html, /class="[^"]*mover-artigo-secao-vade/);
    assert.match(html, />Sem seção</);
});

test("cada Caderno jurídico abre em um espaço amplo sem duplicar o modelo de dados", () => {
    const html = readProjectFile("index.html");

    assert.match(html, /let cadernoVadeAbertoId = null/);
    assert.match(html, /function htmlWorkspaceCaderno\(colecao\)/);
    assert.match(html, /class="legal-notebook-workspace"/);
    assert.match(html, /class="legal-notebook-workspace-body"/);
    assert.match(html, /class="legal-notebook-sidebar"/);
    assert.match(html, /class="[^\"]*seletor-secao-caderno/);
    assert.match(html, /class="[^\"]*btn-voltar-lista-vade/);
    assert.match(html, /class="[^\"]*btn-abrir-caderno-vade/);
    assert.match(html, /class="legal-notebook-article-menu"/);
    assert.match(html, /@media \(max-width: 767\.98px\)[\s\S]*?\.legal-notebook-sidebar \{ display: none; \}/);
    assert.doesNotMatch(html, /HUB_CLOUD_VADE\.criarWorkspaceCaderno/);
});

test("as ações coletivas dos Cadernos jurídicos são atômicas, privadas e explícitas", () => {
    const migration = readProjectFile("supabase/migrations/202608310008_legal_notebook_bulk_actions.sql");
    const repository = readProjectFile("src/cloud-core-repository.js");
    const auth = readProjectFile("src/auth.js");
    const html = readProjectFile("index.html");

    for (const functionName of ["set_user_vade_provisions_review", "set_user_vade_provisions_section", "remove_user_vade_provisions"]) {
        assert.match(migration, new RegExp(`create or replace function public\\.${functionName}`, "i"));
        assert.match(migration, new RegExp(`${functionName}[\\s\\S]*?current_user_id[\\s\\S]*?private\\.is_workspace_member`, "i"));
        assert.match(migration, new RegExp(`grant execute on function public\\.${functionName}\\([^;]+to authenticated`, "i"));
    }
    assert.match(migration, /count\(distinct requested_id\)/g);
    assert.match(migration, /A seleção contém artigos inválidos ou repetidos\./g);
    assert.match(migration, /set_user_vade_provisions_section[\s\S]*?section\.collection_id = p_collection_id[\s\S]*?section\.user_id = current_user_id/i);
    assert.doesNotMatch(migration, /delete from public\.user_legal_(?:highlights|bookmarks|reading_history)/i);
    assert.match(repository, /\.rpc\("set_user_vade_provisions_review"/);
    assert.match(repository, /\.rpc\("set_user_vade_provisions_section"/);
    assert.match(repository, /\.rpc\("remove_user_vade_provisions"/);
    assert.match(auth, /salvarRevisaoArtigos:/);
    assert.match(auth, /moverArtigosParaSecao:/);
    assert.match(auth, /removerArtigos:/);
    assert.match(html, /btn-alternar-selecao-caderno/);
    assert.match(html, /class="[^"]*selecionar-artigo-caderno/);
    assert.match(html, /class="legal-notebook-bulk-bar"/);
    assert.match(html, /Selecionar visíveis/);
    assert.match(html, /Os textos legais, grifos, favoritos, notas e o histórico de leitura serão preservados\./);
});
