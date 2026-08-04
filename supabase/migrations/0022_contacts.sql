-- buno — contacts: thin people entities born from conversation. A contact is NOT
-- a user — it's a lightweight record (a name, maybe an email/phone) that buno
-- creates when it recognizes a real person (mentioned in a brief, a calendar
-- attendee, an email sender). It can accumulate an email over time and, in the
-- future, an invite can merge it into a real user carrying all its history.
create table if not exists contacts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  name         text not null,
  email        text,
  phone        text,
  source       text,        -- mentioned | calendar | email | manual
  created_from text,        -- free note about origin (card id / event id / …)
  created_at   timestamptz not null default now(),
  unique (user_id, name)
);
alter table contacts enable row level security;
create policy "own contacts" on contacts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant all on contacts to authenticated, service_role;
