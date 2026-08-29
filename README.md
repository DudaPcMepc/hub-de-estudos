# Hub de Estudos

[![CI](https://github.com/DudaPcMepc/hub-de-estudos/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/DudaPcMepc/hub-de-estudos/actions/workflows/ci.yml)

Aplicação de organização de estudos com matérias, notas, flashcards, cronograma, edital, caderno de erros e simulados.

## Estado atual

O frontend já exige autenticação pelo Supabase antes de liberar o Hub. A primeira cópia dos dados locais para o banco remoto já foi executada e conferida. Durante o uso normal, matérias, tópicos, notas, flashcards, materiais, links, sessões do cronograma, edital, caderno de erros e histórico de desempenho são mantidos no Supabase e em uma cópia local isolada pelo identificador de cada usuário. O nome visível do produto é **Hub Pimentel — Estudos para Concursos**.

A área autenticada possui uma prévia de migração somente leitura, que compara as contagens locais com o espaço pessoal no Supabase e calcula uma identificação do conjunto antes de qualquer transferência. Depois da importação, uma conferência semântica reconstrói o conteúdo remoto e compara assinaturas por categoria sem exibir matérias ou notas nos registros.

A camada de gravação remota do núcleo está preparada em `src/cloud-core-repository.js`, com isolamento explícito por espaço e usuário, controle de concorrência nas notas e no edital e separação entre o conteúdo compartilhado dos flashcards e o progresso pessoal de revisão. Testes controlados de matérias, tópicos, notas, flashcards, materiais, sessões do cronograma e edital compartilhado foram concluídos no Supabase sem deixar registros temporários. A migration `202608290002` do edital pessoal foi aplicada, e o carregamento autenticado da nova área foi validado sem criar registros temporários.

As operações normais de matérias — criar, editar, ordenar e excluir — já confirmam a alteração no Supabase e mantêm a cópia local sincronizada. O ciclo completo foi validado com um registro temporário e a exclusão renumera as posições restantes; a entrada também repara automaticamente eventuais intervalos antigos na ordem.

As operações normais de tópicos — criação individual ou em lote, mudança de status, contagem de revisões e exclusão — também confirmam a alteração no Supabase antes de consolidar a cópia local. O ciclo de criação, mudança para “Estudando”, recarga da página e exclusão foi validado, seguido de uma comparação integral entre as duas cópias.

As notas são carregadas do Supabase e permitem criação, edição automática de título, conteúdo e tags, fixação e exclusão sincronizadas. O salvamento automático é serializado e usa a versão do registro para impedir que uma edição antiga sobrescreva silenciosamente uma alteração mais recente. O ciclo completo foi validado após recarregar a página e comparar as duas cópias.

Os flashcards são carregados do Supabase e permitem criação, edição, exclusão e revisão sincronizadas. A pergunta e a resposta pertencem ao espaço de estudos e podem ser compartilhadas; caixa de revisão, próxima data, acertos e erros são mantidos separadamente para cada usuário. Quando um participante acessa pela primeira vez um cartão compartilhado, o progresso pessoal ausente é criado automaticamente. O ciclo completo foi validado com criação, edição, recarga, avanço da caixa 1 para a caixa 2 e exclusão, seguido da comparação integral entre navegador e Supabase.

Materiais e links também são carregados do Supabase e permitem criação, edição e exclusão sincronizadas. Eles pertencem ao espaço de estudos e são compartilhados entre seus participantes. A interface e o repositório aceitam apenas endereços `http://` ou `https://`, rejeitam credenciais embutidas no endereço e pedem confirmação antes da exclusão compartilhada. O ciclo completo foi validado após recarregar a página e comparar as duas cópias.

As sessões do cronograma são carregadas do Supabase e permitem criação, edição, conclusão, reabertura e exclusão sincronizadas. Cada nova sessão é atribuída à conta que a criou, enquanto o cronograma pertence ao espaço compartilhado. As mudanças de estado funcionam tanto pelos cartões quanto pelo calendário semanal. O ciclo completo foi validado após recarregar a página e comparar as duas cópias.

A configuração do concurso e a matriz de matérias do edital são pessoais: cada participante escolhe o próprio concurso sem alterar o planejamento dos demais. Elas são carregadas do Supabase e permitem criação, edição e exclusão sincronizadas. Questões e peso são confirmados por um botão explícito de salvamento, e a versão remota impede que uma edição antiga aberta em outra sessão sobrescreva uma alteração mais recente. A configuração pode ser limpa sem remover a matriz ou os tópicos.

O checklist do edital também é pessoal e fica separado dos tópicos compartilhados da matéria. Ao adicionar uma matéria à matriz, tópicos opcionais podem ser colados um por linha. Marcar ou desmarcar um tópico altera apenas o planejamento do usuário conectado. Backups novos incluem esse checklist; backups antigos continuam aceitos e têm seus tópicos convertidos para o formato pessoal durante a restauração. O ciclo completo de configuração, inclusão de matéria e tópicos, marcação, recarga, remoção e limpeza foi validado no Supabase sem deixar registros temporários.

O Caderno de Erros é pessoal e sincronizado com o Supabase. Registros manuais, erros de revisão de flashcards e respostas incorretas em simulados usam a mesma gravação protegida; a interface não afirma que um item foi salvo quando o banco não confirma a operação. A exclusão exige confirmação e também é validada remotamente. O ciclo manual de criação, recarga e exclusão foi testado sem deixar registros temporários.

O histórico de desempenho também é pessoal. Cada resposta de simulado incrementa acertos e total de forma atômica no banco, evitando perda de pontuação quando há mais de uma sessão aberta. Os resultados são recarregados na entrada e alimentam os indicadores e o gráfico por matéria. A migration `202608290003` foi aplicada e o carregamento autenticado do estado vazio foi validado sem alterar pontuações.

Ao entrar, matérias, tópicos, notas, flashcards, materiais, links, sessões do cronograma, edital, caderno de erros e desempenho são recarregados do Supabase sem descartar itens locais ainda pendentes de conferência.

## Arquitetura multiusuário planejada

- Supabase Auth ativo para contas por convite, com primeiro acesso e recuperação de senha.
- PostgreSQL com Row Level Security em todas as tabelas expostas.
- Espaços pessoais e compartilhados com papéis de proprietário, editor e leitor.
- Conteúdo compartilhado separado do progresso individual de cada participante.
- Edge Function autenticada para chamar o Gemini sem expor a chave no navegador.

## Configuração local

1. Copie `.env.example` para `.env.local`.
2. Preencha somente a URL e a chave publicável do projeto Supabase.
3. Instale as dependências com `npm install`.
4. Inicie o ambiente local com `npm run dev` e abra `http://localhost:5173`.
5. Nunca adicione senhas, chaves administrativas ou a chave Gemini ao repositório. A chave Gemini deve ser cadastrada como o segredo `GEMINI_API_KEY` da Edge Function no Supabase.

O arquivo `.env.local` é lido pelo Vite e ignorado pelo Git. A chave publicável pode aparecer no código entregue ao navegador; a segurança dos dados depende das políticas RLS do banco.

## Validação automática

O workflow `.github/workflows/ci.yml` roda em cada Pull Request para `main` e em cada atualização da própria `main`. Ele instala exatamente as versões do `package-lock.json`, executa `npm test` e só então compila com `npm run build`. As ações externas ficam fixadas por identificadores imutáveis e o token do workflow possui somente permissão de leitura.

Os testes iniciais em `tests/project-contracts.test.mjs` verificam contratos importantes: ausência de formatos conhecidos de segredos nos arquivos versionados, chave Gemini fora do navegador, autenticação da Edge Function, permissões da cota diária, proteção da restauração e ordem das migrations.

## Publicação no GitHub Pages

O workflow `.github/workflows/deploy-pages.yml` prepara a versão hospedada em `/hub-de-estudos/`, executa os testes e somente publica quando todas as validações passam. O endereço de recuperação de senha utiliza automaticamente o caminho correto do ambiente atual, mantendo compatibilidade com `localhost` e com o GitHub Pages.

Antes da primeira publicação, cadastre `VITE_SUPABASE_URL` como variável do repositório e `VITE_SUPABASE_PUBLISHABLE_KEY` como segredo do GitHub Actions. Depois, selecione **GitHub Actions** como origem em **Settings → Pages** e registre o endereço HTTPS de produção na configuração de URLs do Supabase Auth.

A Supabase CLI está instalada como dependência de desenvolvimento e o projeto local está vinculado ao projeto remoto `zmlodrbvceavvtqgslsz`. O arquivo `supabase/config.toml` replica as decisões locais de segurança: acesso por convite, confirmação de e-mail, senhas fortes e redirecionamento em `http://localhost:5173`.

## Ativação dos simulados seguros

1. Cadastre `GEMINI_API_KEY` em **Supabase → Edge Functions → Secrets**. Não cole o valor em arquivos do projeto, commits ou mensagens.
2. Publique a função `generate-quiz` somente após revisar a configuração do segredo.
3. Entre com uma conta convidada e gere um simulado curto para validar a integração.

A função aceita apenas contas autenticadas, limita cada pedido a dez questões, valida tamanhos e formatos e usa resposta estruturada do Gemini. A migration `202608290004` acrescenta uma cota atômica de 50 questões diárias por usuário. Pedidos que falham no Gemini devolvem automaticamente a reserva, e somente a função do servidor pode alterar a contagem.

## Banco de dados

As migrations versionadas ficam em `supabase/migrations/`. Elas devem ser revisadas e aplicadas na ordem do nome do arquivo. As migrations `202608280001` e `202608290001` até `202608290005` estão registradas como aplicadas tanto localmente quanto no histórico remoto.

A migration inicial:

- cria perfis, espaços e participantes;
- cria as tabelas do domínio de estudos;
- separa conteúdo compartilhado de progresso pessoal;
- habilita RLS e nega acesso anônimo;
- cria automaticamente um perfil e um espaço pessoal para novos usuários.

## Segurança

- Arquivos `.env` são ignorados pelo Git.
- A chave publicável do Supabase pode ser usada no frontend somente com RLS habilitado.
- Chaves `secret` e `service_role` nunca podem ser usadas no navegador.
- A chave Gemini é lida somente do segredo `GEMINI_API_KEY` da função no servidor; configurações antigas salvas no navegador são removidas na entrada.
- O cadastro público e o acesso anônimo estão desativados.
- Contas por e-mail exigem confirmação e senhas fortes.
- A recuperação usa resposta neutra para não revelar se um e-mail está cadastrado.
- Links de convite e recuperação abrem uma etapa própria para definição da senha.
- O token pessoal usado pela CLI fica fora do repositório e possui validade limitada.
- O conteúdo principal permanece oculto até a sessão e o espaço pessoal serem validados.
- As chaves do armazenamento local são separadas por usuário, evitando mistura de dados no mesmo navegador.
- Dados locais antigos são preservados e não são atribuídos automaticamente a uma conta.
- Contas novas podem abrir um espaço vazio sem depender de um lote de migração anterior.
- A restauração de backup substitui somente o espaço pessoal do proprietário e só confirma sucesso após a transação no Supabase.
- Backups atuais preservam também o checklist pessoal de tópicos do edital durante importações e restaurações.

