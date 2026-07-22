-- 0004 — fix: authenticated API requests got "permission denied for table …".
-- RLS policies exist (0001) but the API roles were never GRANTed table-level
-- access, so every query died before RLS was even consulted. Grant the
-- authenticated role full DML on the public schema — RLS remains the row gate.
-- anon deliberately gets nothing: the login screen queries no tables, and any
-- future public surface should earn its grants explicitly.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- future tables created from the SQL editor inherit the same access
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
