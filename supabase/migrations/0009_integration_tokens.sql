-- 0009 — Google integration tokens (Stage 4).
-- Refresh tokens are secrets: they live in Supabase Vault (encrypted at rest),
-- never in a plain column and never in client-reachable tables. The Edge
-- Functions reach Vault with the SERVICE ROLE only (server-side); the browser
-- never sees a token. The `integration` table (0001) holds status + the
-- vault_secret_id pointer, and its RLS keeps each row to its own user.
--
-- These SECURITY DEFINER helpers are the only sanctioned path in/out of Vault
-- for integration tokens, callable by service_role from the functions.

-- store (or replace) a user's refresh token; returns the vault secret id
create or replace function set_integration_token(p_user uuid, p_kind integration_kind, p_token text)
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare
  sid uuid;
  existing uuid;
begin
  select vault_secret_id into existing from integration where user_id = p_user and kind = p_kind;
  if existing is not null then
    perform vault.update_secret(existing, p_token);
    return existing;
  end if;
  select vault.create_secret(p_token, 'gtok_' || p_user || '_' || p_kind) into sid;
  return sid;
end; $$;

-- read a user's refresh token back (service_role only path)
create or replace function get_integration_token(p_secret uuid)
returns text language sql security definer set search_path = public, vault stable as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_secret;
$$;

revoke all on function set_integration_token(uuid, integration_kind, text) from public, anon, authenticated;
revoke all on function get_integration_token(uuid) from public, anon, authenticated;
grant execute on function set_integration_token(uuid, integration_kind, text) to service_role;
grant execute on function get_integration_token(uuid) to service_role;
