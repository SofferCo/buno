-- buno — inbound WhatsApp de-duplication. Meta redelivers the same message
-- (same wamid) aggressively while a slow webhook hasn't returned 200, and can
-- redeliver even after a 200. This table is the hard idempotency key: the first
-- sighting of a wamid inserts a row; a retry hits the PK and is dropped with zero
-- processing. Written only by the service role (the webhook); RLS on, no policies.
create table if not exists wa_seen (
  message_id text primary key,
  at         timestamptz not null default now()
);
alter table wa_seen enable row level security;
grant all on wa_seen to service_role;
