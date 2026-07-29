-- 0016 — WhatsApp send health. Track consecutive send failures so a dead channel
-- (usually an expired access token) surfaces a warning instead of failing silently.
alter table whatsapp_link add column if not exists wa_fail_streak int not null default 0;
alter table whatsapp_link add column if not exists wa_last_error  text;
alter table whatsapp_link add column if not exists wa_last_at     timestamptz;
