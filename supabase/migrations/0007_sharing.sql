-- 0007 — Stage D: sharing (projects · invites · roles).
-- Adds: co-member profile visibility, a secure invite-accept RPC, and a
-- self-service "leave project". RLS stays the boundary; nothing here lets a
-- user touch a project they aren't entitled to.
-- Complements 0006_viewer_card_guard.sql (DB-level field guard for viewers).

-- ---------------------------------------------------------------------------
-- 1. Co-member profile visibility
-- ---------------------------------------------------------------------------
-- profile_self (0001) means a user can read ONLY their own profile row, so a
-- board can't show its other members' names/photos. Let users see the basic
-- profile of anyone they share a project with. (Table already RLS-enabled.)
create or replace function shares_project(other uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1
    from project_member me
    join project_member them on them.project_id = me.project_id
    where me.user_id = auth.uid() and them.user_id = other
  );
$$;

create policy profile_comembers_read on profile
  for select using (shares_project(id));

-- ---------------------------------------------------------------------------
-- 2. Accept an invitation
-- ---------------------------------------------------------------------------
-- The invitee can't read project_invite (owner-only) or insert into
-- project_member (owner-only) — by design. This SECURITY DEFINER function is
-- the ONE sanctioned path: it validates the token, binds to the caller's
-- email, creates the membership, and marks the invite used. Invites expire
-- after 14 days.
create or replace function accept_project_invite(invite_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  inv    project_invite;
  myemail text;
begin
  select email into myemail from auth.users where id = auth.uid();
  if myemail is null then
    raise exception 'not authenticated';
  end if;

  select * into inv from project_invite
  where token = invite_token and accepted_at is null
  order by created_at desc limit 1;

  if inv.id is null then
    raise exception 'invite not found or already used';
  end if;
  if inv.created_at < now() - interval '14 days' then
    raise exception 'invite expired';
  end if;
  -- bind the invite to the address it was sent to: a leaked link is useless
  -- to anyone signed in with a different email.
  if lower(inv.email) <> lower(myemail) then
    raise exception 'invite was issued to a different email';
  end if;

  insert into project_member (project_id, user_id, role, invited_by)
  values (inv.project_id, auth.uid(), inv.role, inv.invited_by)
  on conflict (project_id, user_id) do nothing;

  update project_invite set accepted_at = now() where id = inv.id;
  return inv.project_id;
end; $$;

-- Read a pending invite's summary WITHOUT accepting (to show "X invited you to
-- <project> as <role>"). Still token-gated and email-bound.
create or replace function peek_project_invite(invite_token text)
returns table (project_id uuid, project_name text, role member_role, inviter text)
language sql security definer set search_path = public stable as $$
  select p.id, p.name, i.role,
         coalesce(nullif(pr.name, ''), 'מישהו')
  from project_invite i
  join project p  on p.id = i.project_id
  left join profile pr on pr.id = i.invited_by
  where i.token = invite_token
    and i.accepted_at is null
    and i.created_at > now() - interval '14 days'
    and lower(i.email) = lower((select email from auth.users where id = auth.uid()))
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 3. Leave a project (self-service; owners can't leave — they delete or
--    transfer, which is a later concern)
-- ---------------------------------------------------------------------------
create policy member_leave on project_member
  for delete using (user_id = auth.uid() and role <> 'owner');

grant execute on function accept_project_invite(text) to authenticated;
grant execute on function peek_project_invite(text)   to authenticated;
