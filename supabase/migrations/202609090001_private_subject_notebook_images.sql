begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'private-subject-notebook-images',
    'private-subject-notebook-images',
    false,
    8388608,
    array['image/png', 'image/jpeg', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy private_subject_notebook_images_select_self
on storage.objects for select to authenticated
using (
    bucket_id = 'private-subject-notebook-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy private_subject_notebook_images_insert_self
on storage.objects for insert to authenticated
with check (
    bucket_id = 'private-subject-notebook-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy private_subject_notebook_images_delete_self
on storage.objects for delete to authenticated
using (
    bucket_id = 'private-subject-notebook-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
);

commit;
