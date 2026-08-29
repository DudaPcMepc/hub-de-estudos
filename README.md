# Hub de Estudos

Aplicação de organização de estudos com matérias, notas, flashcards, cronograma, edital, caderno de erros e simulados.

## Estado atual

O aplicativo continua funcionando localmente pelo `index.html` e mantém os dados no `localStorage`. A fundação multiusuário do Supabase já foi criada, aplicada e sincronizada, mas o frontend ainda não usa autenticação nem persiste dados no banco remoto.

## Arquitetura multiusuário planejada

- Supabase Auth para contas por convite.
- PostgreSQL com Row Level Security em todas as tabelas expostas.
- Espaços pessoais e compartilhados com papéis de proprietário, editor e leitor.
- Conteúdo compartilhado separado do progresso individual de cada participante.
- Edge Function futura para chamar o Gemini sem expor a chave no navegador.

## Configuração local

1. Copie `.env.example` para `.env.local`.
2. Preencha somente a URL e a chave publicável do projeto Supabase.
3. Nunca adicione senhas, chaves administrativas ou a chave Gemini ao repositório.

O frontend ainda não lê essas variáveis. A conexão será adicionada em uma etapa posterior.

A Supabase CLI está instalada como dependência de desenvolvimento e o projeto local está vinculado ao projeto remoto `zmlodrbvceavvtqgslsz`. O arquivo `supabase/config.toml` replica as decisões locais de segurança: acesso por convite, confirmação de e-mail, senhas fortes e redirecionamento em `http://localhost:5173`.

## Banco de dados

As migrations versionadas ficam em `supabase/migrations/`. Elas devem ser revisadas e aplicadas na ordem do nome do arquivo. A migration inicial `202608280001` está registrada como aplicada tanto localmente quanto no histórico remoto.

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
- A chave Gemini será armazenada como segredo de uma função no servidor.
- O cadastro público e o acesso anônimo estão desativados.
- Contas por e-mail exigem confirmação e senhas fortes.
- O token pessoal usado pela CLI fica fora do repositório e possui validade limitada.

