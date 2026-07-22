-- ============================================================================
-- buno — 0002: gaps between the prototype's data shape and schema v1.
-- Purely additive; safe to run on live data. Run in the Supabase SQL Editor.
-- (0001_init.sql is the schema that was already applied — do not re-run it.)
-- ============================================================================

-- The prototype identifies columns by a stable semantic key ("col-brief",
-- "col-done", "col-<rand>") shared across all boards; app logic (restore,
-- routine reset, assistant drafts) targets those keys directly. The DB keeps
-- one row per project per key; the key is the bridge.
alter table board_column
  add column if not exists key text;
create unique index if not exists board_column_project_key_uniq
  on board_column (project_id, key) where key is not null;

-- Which column a card lived in before "done"/archive, so restore and the
-- routine reset can put it back. A key, not a uuid — it must survive the
-- column row being recreated and work across projects.
alter table card
  add column if not exists active_column_key text;

-- The prototype marks one client as the personal/home board (home: true).
alter table project
  add column if not exists is_personal boolean not null default false;

-- NOTE (no DDL needed): per-device values move into profile.settings jsonb:
--   settings.last_reset      — date of the last routine daily reset ("YYYY-MM-DD")
--   settings.current_project — last selected project (uuid as text)
-- The app reads/writes these keys; jsonb needs no schema change.
