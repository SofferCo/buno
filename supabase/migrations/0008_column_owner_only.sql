-- 0008 — restrict board_column writes to owners (defense in depth).
-- 0001's col_write allowed 'owner' AND 'member' to write columns. But columns
-- are structural (and in buno's model one set is shared across a user's
-- projects), so a member editing them affects the owner's board. Members move
-- CARDS between columns (card.column_id — card_update, still allowed); they do
-- not restructure the board. The app UI already hides column management from
-- non-owners (canManageColumns); this enforces the same rule in the DB, per
-- iron rule #1 (enforce in code/DB, never only in the client).
drop policy if exists col_write on board_column;

create policy col_insert on board_column
  for insert with check (project_role(project_id) = 'owner');
create policy col_update on board_column
  for update using (project_role(project_id) = 'owner')
  with check (project_role(project_id) = 'owner');
create policy col_delete on board_column
  for delete using (project_role(project_id) = 'owner');
-- (col_read from 0001 stays: all members can read the columns)
