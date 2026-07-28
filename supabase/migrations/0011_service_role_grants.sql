-- 0011 — grant service_role table access (Edge Functions, server-side only).
-- The OAuth callback failed with "permission denied for table
-- integration_secret": this project's default privileges granted new tables to
-- authenticated (via 0004) but NOT to service_role, and service_role is not a
-- superuser — it needs explicit table GRANTs even though it bypasses RLS.
--
-- Grant service_role full DML across public (it is the trusted server identity,
-- used only inside Edge Functions, never on the client). RLS still governs the
-- authenticated/anon roles.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- defense in depth: the secrets table should be reachable ONLY by service_role.
-- (RLS with no policies already denies authenticated/anon every row, but there
-- is no reason for them to hold table grants either.)
revoke all on table integration_secret from anon, authenticated;
