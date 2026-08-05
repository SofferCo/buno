-- buno — contextual invited-onboarding support.
-- (1) A PUBLIC (anon) invite summary for the pre-auth entry screen: just the
--     non-sensitive header (board name, inviter, role) for a valid, unexpired,
--     unaccepted token — so a logged-out invitee sees WHERE they were invited
--     before signing in. Acceptance stays email-bound (accept_project_invite).
create or replace function invite_public_summary(invite_token text)
returns table (project_name text, inviter_name text, role text)
language sql security definer set search_path = public stable as $$
  select p.name, coalesce(nullif(pr.name, ''), 'מישהו'), i.role::text
  from project_invite i
  join project p on p.id = i.project_id
  left join profile pr on pr.id = i.invited_by
  where i.token = invite_token
    and i.accepted_at is null
    and i.created_at > now() - interval '14 days'
  limit 1;
$$;
grant execute on function invite_public_summary(text) to anon, authenticated;

-- (2) Card-context: an invite may be created from a specific card (share-from-card).
--     Nullable — the field is prepared now even though the card-share UI is later.
alter table project_invite add column if not exists card_id uuid references card on delete set null;
