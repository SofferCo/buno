-- 0006 — server-side guard for viewer card edits.
-- RLS decides which ROWS a user reaches; it cannot restrict which FIELDS.
-- card_update (0001) lets every project member update cards, so a viewer
-- could PATCH any field (column_id, time_spent, archived, …) through the
-- REST API directly, bypassing the app's field rules. Per the iron rules,
-- this must be enforced in the database, not only in app code.
--
-- Rule: a viewer may only change `proposed` (the rolling schedule
-- negotiation). Any other change to a card is rejected.
-- service_role / triggers with no auth context (auth.uid() is null) pass —
-- project_role() returns null, which is not 'viewer'.

create or replace function guard_viewer_card_update()
returns trigger language plpgsql security definer as $$
begin
  if project_role(old.project_id) = 'viewer'
     and (to_jsonb(new) - 'proposed') is distinct from (to_jsonb(old) - 'proposed')
  then
    raise exception 'viewers may only update the schedule proposal'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists card_viewer_guard on card;
create trigger card_viewer_guard
  before update on card
  for each row execute function guard_viewer_card_update();
