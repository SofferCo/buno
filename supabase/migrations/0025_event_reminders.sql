-- 0025 — proactive meeting reminders (D4).
-- (1) Realtime: let the always-open chat receive proactively-inserted assistant
--     messages live. RLS still gates delivery — a user only receives rows on
--     their own thread (the existing assistant_message SELECT policy applies to
--     Realtime too). The client filters to proactive doors (reminder/sweep).
-- (2) A 15-minute cron that calls the event-reminders Edge Function (gated by the
--     shared CRON_SECRET). Mirrors 0012: the schedule call is applied SEPARATELY
--     with your secret so it never lands in the repo — see the chat.

-- (1) add the table to the realtime publication (idempotent guard)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'assistant_message'
  ) then
    alter publication supabase_realtime add table assistant_message;
  end if;
end $$;

-- (2) cron helper — call from the snippet in chat with your real secret + anon key.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function schedule_event_reminders(p_secret text, p_anon_key text, p_cron text default '*/15 * * * *')
returns void language plpgsql security definer as $$
begin
  perform cron.unschedule('event-reminders') where exists (select 1 from cron.job where jobname = 'event-reminders');
  perform cron.schedule('event-reminders', p_cron, format($cmd$
    select net.http_post(
      url := 'https://qzzvbhosergywxellbzl.supabase.co/functions/v1/event-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer %s',
        'x-cron-secret', '%s'
      ),
      body := '{}'::jsonb
    );
  $cmd$, p_anon_key, p_secret));
end; $$;
