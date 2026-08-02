-- 0017 — "Reliable buno" package. Three schema needs:
--   • item 3  — processing-failure health (complements 0016 send-failure health)
--   • item 9  — rolling per-user conversation summary (~30d memory)
--   • item 11 — persisted assistant gender (same buno across sessions/channels)

-- Item 3: processing failures on the WhatsApp door (0016 tracked SEND failures;
-- this tracks failures to PRODUCE a reply, so silent drops surface + alert).
alter table whatsapp_link add column if not exists proc_fail_streak int not null default 0;
alter table whatsapp_link add column if not exists proc_last_error  text;
alter table whatsapp_link add column if not exists proc_last_at     timestamptz;

-- Item 9: rolling conversation summary. Recent messages stay verbatim in context;
-- older history is compressed into this per-user summary, refreshed nightly.
create table if not exists conversation_summary (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  summary         text not null default '',
  covered_through timestamptz,               -- newest message folded into the summary
  updated_at      timestamptz not null default now()
);
alter table conversation_summary enable row level security;
drop policy if exists "own conversation summary" on conversation_summary;
create policy "own conversation summary" on conversation_summary
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant all on conversation_summary to service_role;

-- Item 11: persisted assistant gender — null/'m' = masculine (default), 'f' = feminine.
alter table assistant_settings add column if not exists gender text;
