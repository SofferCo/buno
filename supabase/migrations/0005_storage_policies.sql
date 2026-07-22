-- 0005 — storage access for the private "attachments" bucket.
-- Object path convention (enforced by the app): <project_id>/<card_id>/<attachment_id>
-- Access follows project membership — the same "overlapping areas" as the tables.
-- Run AFTER the bucket exists (Storage → New bucket → "attachments", private).

create policy attachments_read on storage.objects
  for select using (
    bucket_id = 'attachments'
    and is_project_member((split_part(name, '/', 1))::uuid)
  );

create policy attachments_insert on storage.objects
  for insert with check (
    bucket_id = 'attachments'
    and project_role((split_part(name, '/', 1))::uuid) in ('owner', 'member')
  );

create policy attachments_delete on storage.objects
  for delete using (
    bucket_id = 'attachments'
    and project_role((split_part(name, '/', 1))::uuid) in ('owner', 'member')
  );
