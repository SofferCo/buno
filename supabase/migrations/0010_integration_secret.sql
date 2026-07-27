-- 0010 — integration secrets, the simple robust way (supersedes 0009's Vault
-- path, which added an extension dependency that broke the OAuth callback).
--
-- A dedicated table for refresh tokens with RLS ENABLED and NO policies: the
-- authenticated/anon roles get zero rows (RLS default-deny), and only the
-- SERVICE ROLE — used exclusively server-side in the Edge Functions — bypasses
-- RLS to read/write. The browser can never reach a token, same guarantee as
-- Vault, without the extension.
create table if not exists integration_secret (
  user_id       uuid not null references profile(id) on delete cascade,
  kind          integration_kind not null,
  refresh_token text not null,
  updated_at    timestamptz not null default now(),
  primary key (user_id, kind)
);
alter table integration_secret enable row level security;
-- intentionally NO policies → no client role can select/insert/update/delete;
-- service_role bypasses RLS entirely.

-- 0009's Vault helpers are no longer used by the functions; drop them so the
-- Vault extension isn't a hidden requirement. (Safe if they don't exist.)
drop function if exists set_integration_token(uuid, integration_kind, text);
drop function if exists get_integration_token(uuid);
