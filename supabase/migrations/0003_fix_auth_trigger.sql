-- 0003 — fix: signup failed with "Database error saving new user".
-- handle_new_user runs as supabase_auth_admin, whose search_path is "auth",
-- so the unqualified table names in 0001 resolved to nothing. Pin the
-- search_path and schema-qualify everything. Also seed the profile photo and
-- prefer Google's full_name while we're here.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profile (id, name, photo_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  );
  insert into public.assistant_settings (user_id) values (new.id);
  return new;
end; $$;

-- same hardening for the project trigger and the RLS helpers (defense in depth;
-- they currently run with a "public" search_path but nothing guarantees that).
create or replace function public.handle_new_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_member (project_id, user_id, role, invited_by)
  values (new.id, new.created_by, 'owner', new.created_by);
  return new;
end; $$;

create or replace function public.is_project_member(pid uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.project_member
    where project_id = pid and user_id = auth.uid()
  );
$$;

create or replace function public.project_role(pid uuid)
returns public.member_role language sql security definer set search_path = public stable as $$
  select role from public.project_member
  where project_id = pid and user_id = auth.uid();
$$;
