-- Suggestion chips — learning layer (step 4). Per-user counters that turn the chip
-- set from a static menu into something that learns: a category shown many times with
-- zero clicks sinks, then mutes; a high click-rate rises. Not ML — just counters.
--
-- suggestion_key = the floor-rule id (floor:drafts, floor:waiting, …) or a semantic
-- category the model tags its own suggestions with (complete_next, summarize_day, …).

create table if not exists suggestion_stats (
  user_id        uuid not null references auth.users(id) on delete cascade,
  suggestion_key text not null,
  shown_count    int  not null default 0,
  clicked_count  int  not null default 0,
  last_shown_at  timestamptz,
  primary key (user_id, suggestion_key)
);

alter table suggestion_stats enable row level security;

-- a user only ever sees/writes their own rows
drop policy if exists "suggestion_stats own" on suggestion_stats;
create policy "suggestion_stats own" on suggestion_stats
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- atomic upsert-increment, callable from the web chat (shown) and the client (clicked).
-- security definer + auth.uid() so each caller can only bump their own row.
create or replace function bump_suggestion(p_key text, p_shown int default 0, p_clicked int default 0)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or coalesce(p_key,'') = '' then return; end if;
  insert into suggestion_stats (user_id, suggestion_key, shown_count, clicked_count, last_shown_at)
  values (auth.uid(), p_key, greatest(coalesce(p_shown,0),0), greatest(coalesce(p_clicked,0),0),
          case when coalesce(p_shown,0) > 0 then now() else null end)
  on conflict (user_id, suggestion_key) do update set
    shown_count   = suggestion_stats.shown_count   + greatest(coalesce(p_shown,0),0),
    clicked_count = suggestion_stats.clicked_count + greatest(coalesce(p_clicked,0),0),
    last_shown_at = case when coalesce(p_shown,0) > 0 then now() else suggestion_stats.last_shown_at end;
end;
$$;

grant execute on function bump_suggestion(text, int, int) to authenticated;
