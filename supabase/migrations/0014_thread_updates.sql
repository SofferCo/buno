-- 0014 — thread updates: a new reply in an email thread that's ALREADY mapped to
-- a card is no longer dropped by the origin.ref dedup. Instead it's recorded here
-- (one row per gmail message, deduped) so the sweep / "סרוק עכשיו" can report
-- "N new replies on <card> — <sender>: <summary>. update / close?".
create table if not exists card_thread_update (
  id          uuid primary key default gen_random_uuid(),
  card_id     uuid not null references card(id) on delete cascade,
  message_ref text not null,                       -- gmail message id (per-message dedup)
  from_name   text,
  summary     text,
  created_at  timestamptz not null default now()
);
create unique index if not exists card_thread_update_uniq on card_thread_update (card_id, message_ref);
create index if not exists card_thread_update_card_idx on card_thread_update (card_id, created_at desc);

alter table card_thread_update enable row level security;
-- the user may read updates on cards in their projects; writes come from the
-- sweep (service role, bypasses RLS).
drop policy if exists ctu_select_own on card_thread_update;
create policy ctu_select_own on card_thread_update for select using (
  exists (select 1 from card c join project_member pm on pm.project_id = c.project_id
          where c.id = card_thread_update.card_id and pm.user_id = auth.uid())
);

grant select on card_thread_update to authenticated;
grant all on card_thread_update to service_role;
