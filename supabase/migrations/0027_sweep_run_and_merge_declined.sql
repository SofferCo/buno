-- 0027 — two reliability tables for the sweep pipeline.
--
-- merge_declined: a duplicate pair the user explicitly chose to KEEP APART
-- ("השאר בנפרד"). Duplicate detection re-runs on every sweep over the whole
-- board, so without memory the same pair was re-offered every night. Pairs are
-- stored normalized (a < b) so A/B and B/A are one row.
--
-- sweep_run: one row per user per sweep attempt (cron or on-demand), including
-- skips and failures. Until now a failed morning brief was a silent lost day —
-- the only record was the HTTP response nobody read.
--
-- Both are written by the service role only (edge functions); RLS on with no
-- user policies = invisible to the anon/user roles.

create table if not exists merge_declined (
  user_id    uuid not null references auth.users(id) on delete cascade,
  card_a     uuid not null,
  card_b     uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, card_a, card_b),
  check (card_a < card_b)
);
alter table merge_declined enable row level security;

create table if not exists sweep_run (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete cascade,
  source      text not null,                 -- 'cron' | 'now'
  ran_at      timestamptz not null default now(),
  ok          boolean not null,
  skipped     text,                          -- 'already_swept_today' | 'not_connected' | null
  error       text,
  created     int,
  considered  int,
  review      int,
  wa_sent     boolean,
  wa_error    text
);
create index if not exists sweep_run_user_ran_idx on sweep_run (user_id, ran_at desc);
alter table sweep_run enable row level security;
