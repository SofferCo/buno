-- buno — richer, still-safe context for the invited-entry screen.
-- One anon RPC returns, for a valid/unexpired/unaccepted token:
--   • the header (board name, inviter, role)
--   • the invited EMAIL — so a logged-in wrong user can be told exactly which
--     address the invite went to (mismatch exit, no dead-end button)
--   • a board OUTLINE: column titles + up to 6 card TITLES each + open counts +
--     the board color. Titles only — never descriptions, people, files, or any
--     inner content — so a leaked link reveals nothing sensitive.
-- board_column has no color and cards inherit the board color, so a single
-- board-level color is returned (honest to the schema).
create or replace function invite_public_context(invite_token text)
returns jsonb
language sql security definer set search_path = public stable as $$
  select case when i.token is not null then jsonb_build_object(
    'projectName', p.name,
    'inviter',     coalesce(nullif(pr.name, ''), 'מישהו'),
    'role',        i.role::text,
    'email',       i.email,
    'color',       p.color,
    'outline', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name',  bc.title,
               'count', (select count(*) from card k
                          where k.column_id = bc.id and k.archived = false),
               'titles', coalesce((
                  select jsonb_agg(t.title order by t.position)
                  from (select k.title, k.position from card k
                        where k.column_id = bc.id and k.archived = false
                          and length(btrim(k.title)) > 0
                        order by k.position limit 6) t), '[]'::jsonb)
             ) order by bc.position)
      from board_column bc where bc.project_id = p.id), '[]'::jsonb)
  ) else null end
  from project_invite i
  join project p on p.id = i.project_id
  left join profile pr on pr.id = i.invited_by
  where i.token = invite_token
    and i.accepted_at is null
    and i.created_at > now() - interval '14 days'
  limit 1;
$$;
grant execute on function invite_public_context(text) to anon, authenticated;
