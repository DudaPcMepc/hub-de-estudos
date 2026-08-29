# Hub de Estudos

Aplicação de organização de estudos com matérias, notas, flashcards, cronograma, edital, caderno de erros e simulados.

## Estado atual

O aplicativo continua funcionando localmente pelo `index.html` e mantém os dados no `localStorage`. A fundação multiusuário está sendo preparada de forma incremental; a migration do Supabase ainda não deve ser aplicada sem revisão.

## Arquitetura multiusuário planejada

- Supabase Auth para contas por convite.
- PostgreSQL com Row Level Security em todas as tabelas expostas.
- Espaços pessoais e compartilhados com papéis de proprietário, editor e leitor.
- Conteúdo compartilhado separado do progresso individual de cada participante.
- Edge Function futura para chamar o Gemini sem expor a chave no navegador.

## Configuração local futura

1. Copie `.env.example` para `.env.local`.
2. Preencha somente a URL e a chave publicável do projeto Supabase.
3. Nunca adicione senhas, chaves administrativas ou a chave Gemini ao repositório.

O frontend ainda não lê essas variáveis. A conexão será adicionada em uma etapa posterior.

## Banco de dados

As migrations versionadas ficam em `supabase/migrations/`. Elas devem ser revisadas e aplicadas na ordem do nome do arquivo.

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

