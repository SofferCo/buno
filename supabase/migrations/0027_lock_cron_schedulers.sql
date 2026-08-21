-- 0027 — lock down the cron-scheduler RPCs (audit finding, HIGH).
-- schedule_morning_sweep (0012) and schedule_event_reminders (0025) are
-- SECURITY DEFINER functions in the public schema. Postgres grants EXECUTE to
-- PUBLIC by default and PostgREST exposes public-schema functions at
-- /rest/v1/rpc/*, so ANY authenticated (or anon) caller could invoke them and,
-- running with the definer's cron privileges, unschedule or re-time every
-- user's morning sweep / reminders — a silent kill-switch for the whole cron
-- infrastructure. These are operator-only setup functions; no client role
-- should reach them. (0009 already did exactly this for its Vault helpers.)
revoke all on function schedule_morning_sweep(text, text, text) from public, anon, authenticated;
revoke all on function schedule_event_reminders(text, text, text) from public, anon, authenticated;

-- service_role (the trusted server identity) keeps execute for programmatic
-- setup; a human operator runs them from the SQL editor as the table owner.
grant execute on function schedule_morning_sweep(text, text, text) to service_role;
grant execute on function schedule_event_reminders(text, text, text) to service_role;
