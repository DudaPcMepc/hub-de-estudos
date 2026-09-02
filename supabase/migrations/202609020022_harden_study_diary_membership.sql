begin;

drop policy study_session_logs_select_self on public.study_session_logs;
drop policy study_session_logs_insert_self on public.study_session_logs;
drop policy study_session_logs_update_self on public.study_session_logs;
drop policy study_session_logs_delete_self on public.study_session_logs;

create policy study_session_logs_select_self on public.study_session_logs
for select to authenticated using (
    user_id = (select auth.uid())
    and private.is_workspace_member(workspace_id)
);
create policy study_session_logs_insert_self on public.study_session_logs
for insert to authenticated with check (
    user_id = (select auth.uid())
    and private.is_workspace_member(workspace_id)
);
create policy study_session_logs_update_self on public.study_session_logs
for update to authenticated using (
    user_id = (select auth.uid())
    and private.is_workspace_member(workspace_id)
)
with check (
    user_id = (select auth.uid())
    and private.is_workspace_member(workspace_id)
);
create policy study_session_logs_delete_self on public.study_session_logs
for delete to authenticated using (
    user_id = (select auth.uid())
    and private.is_workspace_member(workspace_id)
);

commit;
