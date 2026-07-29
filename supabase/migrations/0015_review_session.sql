-- 0015 — guided review conversation state. When a scan finds thread updates /
-- calendar invites, buno walks them one-by-one with buttons instead of dumping a
-- report. This holds the per-user queue + cursor so the guided sequence survives
-- across messages AND across doors (web + WhatsApp — one twin, one session).
create table if not exists review_session (
  user_id    uuid primary key references profile(id) on delete cascade,
  queue      jsonb not null default '[]'::jsonb,   -- ordered [{kind, ...}]
  cursor     int   not null default 0,             -- index of the item in play
  updated_at timestamptz not null default now()
);
alter table review_session enable row level security;
drop policy if exists rs_select_own on review_session;
create policy rs_select_own on review_session for select using (user_id = auth.uid());
grant select on review_session to authenticated;
grant all on review_session to service_role;
