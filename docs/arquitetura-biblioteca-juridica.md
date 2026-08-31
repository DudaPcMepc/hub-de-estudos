# Biblioteca jurídica e widgets por matéria

## Objetivo

Evoluir cada matéria para um hub modular sem substituir Tópicos, Notas, Flashcards, Materiais ou Resumo. A nova Biblioteca deve oferecer fontes específicas por disciplina e manter conteúdo pessoal, conteúdo do espaço e conteúdo comunitário claramente separados.

## Princípios

1. A matéria do usuário continua pertencendo ao seu espaço de estudos.
2. O vínculo com o catálogo comum é opcional; matérias personalizadas continuam funcionando.
3. Textos jurídicos oficiais são compartilhados pela plataforma, mas grifos, notas, favoritos e preferências são individuais.
4. Nada privado é publicado automaticamente.
5. Uma importação da comunidade cria uma cópia no espaço pessoal e preserva a origem.
6. PDFs e obras editoriais não podem ser publicados sem autorização ou licença compatível.
7. Cada documento jurídico informa fonte, versão e data de atualização.

## Camadas propostas

### 1. Catálogo de matérias

- `catalog_subjects`: identidade comum, nome canônico, categoria, ícone e tema visual.
- Vínculo opcional entre `subjects` e `catalog_subjects`.
- A correspondência definitiva nunca depende apenas do nome digitado pelo usuário.

### 2. Configuração dos widgets

- `user_subject_widgets`: usuário, matéria do espaço, tipo do widget, posição, estado habilitado e configuração.
- O layout é individual mesmo quando a matéria pertence a um espaço compartilhado.
- Tipos iniciais: `legal_library`, `personal_vade`, `private_documents` e, futuramente, `community`.

### 3. Biblioteca oficial

- `legal_documents`: título, tipo, jurisdição, órgão responsável, URL oficial, versão atual e data de conferência.
- `legal_provisions`: estrutura da norma por livro, título, capítulo, seção e artigo.
- `catalog_subject_documents`: normas sugeridas para cada matéria do catálogo.
- Atualizações devem gerar uma nova versão; o texto anterior não deve ser sobrescrito sem histórico.

### 4. Dados pessoais de leitura

- `user_legal_highlights`: usuário, dispositivo legal, versão, cor, trecho selecionado, contexto anterior/posterior e comentário.
- `user_legal_bookmarks`: favoritos e posição de leitura.

## Importação integral da Constituição e do ADCT

- A Constituição Federal é importada da página oficial da Câmara dos Deputados, atualizada até a Emenda Constitucional nº 139/2026.
- O ADCT usa o arquivo oficial identificado como atualizado até a Emenda Constitucional nº 136/2025. As Emendas nº 137, 138 e 139 alteraram somente artigos do corpo principal da Constituição, por isso não mudaram a versão material do ADCT.
- O importador reproduzível valida artigos-base ausentes, chaves duplicadas e conteúdos vazios antes de gerar a migration.
- Uma nova versão integral é criada sem apagar a versão inicial. Os grifos existentes são transferidos pelo identificador lógico do artigo antes da troca da versão atual.
- O índice do leitor agrupa os dispositivos por título e capítulo; Constituição e ADCT aparecem como documentos oficiais separados na mesma matéria.
- `user_vade_collections`: cadernos pessoais e ordem das normas.
- Todas as tabelas pessoais usam RLS por `user_id` e participação no espaço quando aplicável.

## Importação integral do Código Penal

- O Código Penal é importado do texto compilado oficial da Presidência da República, consultado em 30/08/2026.
- A importação preserva Parte, Livro, Título, Capítulo, Seção e Subseção no índice do leitor.
- Artigos acrescidos com sufixos compostos, como `359-M-A`, recebem identificadores próprios e não substituem outros dispositivos.
- Epígrafes como “Anterioridade da Lei” e “Lei penal no tempo” pertencem ao artigo seguinte e aparecem junto ao seu título, sem contaminar o conteúdo do artigo anterior.
- Artigos-base revogados e ausentes da consolidação oficial são dispensados de forma explícita na validação; artigos essenciais e o art. 361 continuam obrigatórios.
- O documento é compartilhado e somente leitura, vinculado ao catálogo de Direito Penal. Grifos e notas permanecem isolados por usuário e espaço.

O grifo deve guardar o texto selecionado e seu contexto, não apenas posições numéricas. Após uma atualização da norma, o sistema tenta reposicionar o trecho e marca para conferência quando houver ambiguidade.

### 5. Documentos privados

- Arquivos ficam em bucket privado no Supabase Storage.
- O acesso ocorre por URL assinada de curta duração.
- Devem existir limites de tamanho e formato, validação de arquivo, cota por usuário e verificação de direitos de uso.
- Documentos privados não entram na comunidade por padrão.

### 6. Comunidade

- `community_posts`: autor, matéria do catálogo, tipo, título, conteúdo, visibilidade e estado de moderação.
- `community_votes`, `community_reports` e `community_imports` ficam separados.
- A publicação exige ação explícita e confirmação do autor.
- A primeira versão não deve incluir mensagens privadas nem comentários.

## Experiência proposta

A janela da matéria mantém as abas atuais e recebe a aba **Biblioteca**. Nela aparecem:

- normas sugeridas pela matéria;
- Cadernos jurídicos;
- documentos particulares autorizados;
- comunidade, somente em etapa futura.

O leitor jurídico terá índice, pesquisa, favoritos, grifos, notas, cópia com citação e atalhos para Nota, Flashcard e tópico do edital.

## Fases de implementação

1. Protótipo visual local e validação da experiência.
2. Catálogo de matérias e configuração individual de widgets.
3. Leitor oficial com Constituição Federal e Código Penal. **Preparado:** textos integrais e importadores reproduzíveis.
4. Grifos, anotações, favoritos, citações e criação de flashcards.
5. Cadernos jurídicos e coleções temáticas.
6. Documentos privados com Storage e controles de segurança.
7. Comunidade, importação, moderação, votos e denúncias.

## Estado atual: Fase 4 concluída e fundação da Fase 5 preparada localmente

O catálogo e as preferências individuais de widgets já possuem tabelas protegidas no Supabase. O vínculo da matéria ao catálogo continua opcional, e matérias ainda não classificadas recebem sugestões compatíveis pelo nome.

A interface já permite ativar, ocultar e ordenar widgets por usuário. A Constituição Federal e o ADCT estão disponíveis integralmente a partir das fontes oficiais da Câmara dos Deputados. A integração integral do Código Penal está preparada a partir do texto compilado oficial da Presidência da República.

O leitor informa a fonte, a versão e o escopo importado, permite pesquisa entre os dispositivos disponíveis, cópia com citação, grifos privados, notas de margem, favoritos, retomada de leitura e criação de flashcards. O texto oficial é compartilhado e somente leitura; todos os dados pessoais de leitura ficam separados por usuário, matéria e espaço.

A fundação local da Fase 5 acrescenta cadernos pessoais de Vade Mecum e uma lista ordenada de normas oficiais. Cada caderno pertence simultaneamente ao usuário e ao espaço de estudos. A lista de normas só pode ser substituída por uma função transacional que valida a sessão, a participação no espaço, o limite de 100 itens, duplicidades e a disponibilidade dos documentos antes de gravar. O navegador recebe acesso direto de leitura aos itens, mas não recebe permissão direta para inseri-los, alterá-los ou excluí-los.

A migration `202608300010_personal_vade_collections.sql` foi aplicada e validada no Supabase. A interface inicial dos Cadernos jurídicos permite criar, renomear e excluir coleções privadas, escolher e ordenar normas oficiais e abrir cada documento no leitor jurídico existente. A migration `202608310005_legal_notebook_articles.sql` acrescenta artigos específicos: o leitor permite salvar ou remover o artigo atual em qualquer caderno, e a listagem abre o dispositivo diretamente na norma correspondente. A função transacional valida usuário, espaço, caderno e versão oficial atual; o navegador recebe apenas leitura direta da tabela de itens. Todas as gravações aguardam confirmação do Supabase antes de atualizar a interface. Documentos privados e comunidade permanecem reservados às fases posteriores.
