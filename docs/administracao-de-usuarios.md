# Administração segura de usuários

O Hub cria um espaço pessoal para cada conta. Por isso, a remoção de um usuário precisa tratar a conta e o espaço na mesma operação, sem afetar futuros espaços compartilhados.

## Proteções

- A exclusão direta de uma conta é bloqueada sem uma prévia recente.
- A prévia contabiliza o conteúdo do espaço pessoal e os registros individuais do usuário em outros espaços.
- A aprovação expira após 15 minutos.
- Qualquer mudança nos dados invalida a aprovação.
- Uma conta que possui espaço compartilhado não pode ser apagada até a transferência da propriedade.
- Somente o `service_role` pode solicitar a prévia e preparar a exclusão.
- A chave `service_role` nunca deve ser colocada no navegador ou no código público.
- A conclusão fica registrada em auditoria sem armazenar o e-mail do usuário.

## Processo administrativo

1. Identificar a conta no painel **Authentication → Users**.
2. Fazer backup quando a prévia indicar conteúdo relevante.
3. Solicitar a prévia pelo ambiente administrativo confiável.
4. Preparar a exclusão usando a confirmação exata `EXCLUIR <UUID>`.
5. Em até 15 minutos, excluir a conta pelo painel do Supabase.
6. Conferir o registro de auditoria.

O painel administrativo executa a prévia antes de habilitar a confirmação. A Edge Function confere novamente o usuário e os privilégios, prepara a exclusão e só então solicita a remoção da conta. O gatilho do banco rejeita a operação se os dados tiverem mudado. Contas administradoras são bloqueadas nesse fluxo, inclusive a própria conta conectada.

## Ativação inicial do painel

1. Abra **Authentication → Users** no Supabase e copie o UUID exato da conta principal.
2. No **SQL Editor**, execute a inserção abaixo substituindo somente o UUID indicado:

```sql
insert into private.platform_admins (user_id)
values ('UUID_EXATO_DA_CONTA_PRINCIPAL')
on conflict (user_id) do nothing;
```

3. Publique a Edge Function `admin-users`.
4. Saia e entre novamente no Hub. A aba **Administração** aparecerá apenas para a conta autorizada.

O painel permite listar contas, enviar convites e revisar uma exclusão antes de confirmar. A frase exigida usa o e-mail da conta selecionada, enquanto a função protegida converte internamente a confirmação para o UUID esperado pelo banco. Nenhuma chave privilegiada ou UUID de confirmação precisa ser digitado no navegador.
