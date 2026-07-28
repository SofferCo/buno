-- 0013 — nudge infrastructure (P1.5) + a reliable "last column change" signal.
--
-- P1.5: nudge_log records every proactive line a sweep rule produced (which
-- rule, which card, when) so we can later measure which nudges actually help.
-- P1.6 (kaizen) needs to know when a card last CHANGED COLUMN — moves only set
-- active_column_key and were never timestamped — so we add card.column_changed_at,
-- maintained by a trigger, and backfill existing rows to created_at.

-- ---- last column change -----------------------------------------------------
alter table card add column if not exists column_changed_at timestamptz;
update card set column_changed_at = created_at where column_changed_at is null;
alter table card alter column column_changed_at set default now();

create or replace function set_card_column_changed() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.column_changed_at := coalesce(new.column_changed_at, new.created_at, now());
  elsif new.column_id is distinct from old.column_id then
    new.column_changed_at := now();
  end if;
  return new;
end; $$;

drop trigger if exists trg_card_column_changed on card;
create trigger trg_card_column_changed
  before insert or update on card
  for each row execute function set_card_column_changed();

-- ---- nudge log --------------------------------------------------------------
create table if not exists nudge_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profile(id) on delete cascade,
  rule_id    text not null,                  -- which rule fired (e.g. 'kaizen')
  card_id    uuid references card(id) on delete set null,
  text       text not null,                  -- the exact line shown in the snapshot
  created_at timestamptz not null default now()
);
create index if not exists nudge_log_user_idx on nudge_log (user_id, created_at desc);

alter table nudge_log enable row level security;
-- the owner may read their own nudges; writes come only from the sweep
-- (service role, which bypasses RLS) — so no insert policy is granted.
drop policy if exists nudge_log_select_own on nudge_log;
create policy nudge_log_select_own on nudge_log for select using (user_id = auth.uid());

grant select on nudge_log to authenticated;
grant all on nudge_log to service_role;
