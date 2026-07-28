-- 0012 — schedule the nightly morning sweep (Stage 4c).
-- pg_cron runs a daily job that calls the morning-sweep Edge Function via
-- pg_net. The function is gated by a shared CRON_SECRET (also set as an Edge
-- Function secret) so it can't be triggered by anyone else.
--
-- Run the extension lines here. The cron.schedule call is provided SEPARATELY
-- (with your secret) so the secret never lands in the repo — see the chat.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Helper to (re)create the schedule idempotently. Call it from the snippet in
-- chat with your real values; keeping it as a function keeps the secret out of
-- this migration file.
create or replace function schedule_morning_sweep(p_secret text, p_anon_key text, p_cron text default '0 4 * * *')
returns void language plpgsql security definer as $$
begin
  perform cron.unschedule('morning-sweep') where exists (select 1 from cron.job where jobname = 'morning-sweep');
  perform cron.schedule('morning-sweep', p_cron, format($cmd$
    select net.http_post(
      url := 'https://qzzvbhosergywxellbzl.supabase.co/functions/v1/morning-sweep',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer %s',
        'x-cron-secret', '%s'
      ),
      body := '{}'::jsonb
    );
  $cmd$, p_anon_key, p_secret));
end; $$;
