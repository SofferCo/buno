-- buno — contact→board affinity (A2 calendar co-creation memory).
-- When the user corrects (or confirms) which board a calendar event belongs to,
-- we remember the affinity between the contact (an attendee/organizer email
-- domain) and the chosen board, weighted by how often it happened. Future
-- auto-assignment consults this first, so buno gets the mapping right over time.
create table if not exists contact_board_affinity (
  user_id    uuid not null references auth.users on delete cascade,
  contact    text not null,                 -- normalized email domain, e.g. "codata.io"
  project_id uuid not null references project on delete cascade,
  weight     int  not null default 1,       -- times this contact landed on this board
  updated_at timestamptz not null default now(),
  primary key (user_id, contact, project_id)
);
alter table contact_board_affinity enable row level security;
-- each user manages only their own affinity rows.
create policy "own contact affinity" on contact_board_affinity
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant all on contact_board_affinity to authenticated, service_role;

-- atomic "record one assignment": insert the affinity, or bump its weight if it
-- already exists. Only ever writes the caller's own rows.
create or replace function public.bump_contact_affinity(p_contact text, p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into contact_board_affinity (user_id, contact, project_id, weight, updated_at)
  values (auth.uid(), p_contact, p_project, 1, now())
  on conflict (user_id, contact, project_id)
  do update set weight = contact_board_affinity.weight + 1, updated_at = now();
end; $$;
grant execute on function public.bump_contact_affinity(text, uuid) to authenticated;
