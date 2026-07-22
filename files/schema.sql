-- ============================================================================
-- Air Doctor Kanban — Supabase schema (v1)
-- Multi-user, project-scoped board + AI assistant (digital twin) + WhatsApp.
--
-- Core model: a PROJECT is an independent shared entity (not owned by one user).
-- Each user has a per-project ROLE (owner / member / viewer) = "overlapping areas".
-- The assistant is just another actor that acts on the user's behalf, in code.
--
-- Run order: this file is idempotent-ish; run once on a fresh project.
-- Requires: pgcrypto (gen_random_uuid) — enabled by default on Supabase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Enums
-- ---------------------------------------------------------------------------
create type member_role     as enum ('owner', 'member', 'viewer');
create type card_priority   as enum ('regular', 'important', 'critical');
create type card_routine    as enum ('none', 'daily', 'weekly', 'monthly');
create type removed_by       as enum ('owner', 'member', 'assistant');
create type attach_type      as enum ('image', 'file', 'link');
create type assist_level     as enum ('suggest', 'draft', 'act');       -- 🔵 🟡 🟢
create type assist_status    as enum ('pending', 'approved', 'rejected', 'expired', 'executed');
create type origin_type      as enum ('email', 'calendar', 'chat', 'whatsapp', 'manual');
create type integration_kind as enum ('gmail', 'gcal', 'gdrive', 'whatsapp');

-- ---------------------------------------------------------------------------
-- 1. Profiles  (mirrors auth.users; 1:1)
-- ---------------------------------------------------------------------------
create table profile (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null default '',
  photo_url   text,
  -- per-account settings, incl. time-rounding philosophy (value not minutes)
  settings    jsonb not null default '{"time_round_mode":"ceil_hour"}'::jsonb,
  created_at  timestamptz not null default now()
);

-- assistant authority matrix, per user, per action-type (never one global switch)
create table assistant_settings (
  user_id     uuid primary key references profile(id) on delete cascade,
  cards       assist_level not null default 'draft',
  calendar    assist_level not null default 'draft',
  outbound    assist_level not null default 'suggest',   -- fixed: never auto-send
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Projects  (the shared board — was "client" in the prototype)
-- ---------------------------------------------------------------------------
create table project (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  color       text not null default '#0E8F8C',
  contact     text,
  email       text,
  notes       text,
  rate        numeric,                       -- hourly rate for revenue calc
  logo_url    text,
  created_by  uuid not null references profile(id),
  created_at  timestamptz not null default now()
);

-- membership = permission per project ("overlapping areas")
create table project_member (
  project_id  uuid not null references project(id) on delete cascade,
  user_id     uuid not null references profile(id) on delete cascade,
  role        member_role not null default 'member',
  invited_by  uuid references profile(id),
  created_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- pending invitations by email (before the invitee has an account)
create table project_invite (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references project(id) on delete cascade,
  email       text not null,
  role        member_role not null default 'member',
  token       text not null unique,
  invited_by  uuid not null references profile(id),
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. Board structure
-- ---------------------------------------------------------------------------
create table board_column (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references project(id) on delete cascade,
  title       text not null,
  position    int  not null default 0,
  is_done     boolean not null default false   -- the "done" column (billable logic)
);

create table card (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references project(id) on delete cascade,
  column_id     uuid references board_column(id) on delete set null,
  position      int  not null default 0,

  title         text not null default '',
  creator       text not null default '',      -- display name of opener (locked chip)
  cc            text[] not null default '{}',   -- additional people (removable chips)
  description   text not null default '',

  deadline      date,
  time          text,                            -- 'HH:MM' or null = flexible time
  routine       card_routine  not null default 'none',
  day_flex      boolean not null default false,  -- only meaningful weekly/monthly
  priority      card_priority not null default 'regular',

  time_spent    int not null default 0,          -- seconds
  timer_start   timestamptz,                     -- running timer anchor

  archived      boolean not null default false,
  archived_at   timestamptz,
  removed_by    removed_by,                       -- who soft-deleted (billable if 'member')

  -- assistant / negotiation payloads (jsonb — app enforces, model only proposes)
  origin        jsonb,   -- {type, ref, url, quote} — anchor for assistant-born cards
  draft         jsonb,   -- {by, at} present => pending draft; approve clears it
  proposed      jsonb,   -- {deadline, routine, day_flex, time, by, at} rolling proposal

  created_at    timestamptz not null default now()
);
-- dedupe: a source (thread/event id) produces at most one card per project
create unique index card_origin_ref_uniq
  on card (project_id, ((origin->>'ref')))
  where origin is not null;

create table subtask (
  id        uuid primary key default gen_random_uuid(),
  card_id   uuid not null references card(id) on delete cascade,
  text      text not null default '',
  done      boolean not null default false,
  hours     numeric not null default 0,
  position  int not null default 0
);

create table comment (
  id         uuid primary key default gen_random_uuid(),
  card_id    uuid not null references card(id) on delete cascade,
  parent_id  uuid references comment(id) on delete cascade,
  by_name    text not null,                  -- display name (member or "העוזר")
  by_user    uuid references profile(id),    -- null when assistant/external
  text       text not null,
  created_at timestamptz not null default now()
);

create table attachment (
  id          uuid primary key default gen_random_uuid(),
  card_id     uuid not null references card(id) on delete cascade,
  type        attach_type not null,
  name        text,
  url         text,                            -- for links, or public URL
  storage_key text,                            -- Supabase Storage path for files/images
  meta        jsonb,
  created_at  timestamptz not null default now()
);

-- edit trail (editWithTrail) — coarse "who · what · when"; assistant is an actor
create table card_history (
  id        uuid primary key default gen_random_uuid(),
  card_id   uuid not null references card(id) on delete cascade,
  by_name   text not null,
  field     text not null,
  label     text not null,
  at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. Assistant plumbing
-- ---------------------------------------------------------------------------
-- every model-requested action is logged here and passes through assistantAction()
-- in code; the app (not the prompt) enforces the permission matrix.
create table assistant_action (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profile(id) on delete cascade,
  project_id   uuid references project(id) on delete cascade,
  card_id      uuid references card(id) on delete set null,
  action_type  text not null,               -- 'create_card' | 'move_card' | 'draft_event' | ...
  payload      jsonb not null,
  status       assist_status not null default 'pending',
  source_ref   text,                         -- origin fingerprint if any
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

-- unified conversation (one twin across doors: web, whatsapp, ...)
create table assistant_thread (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profile(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table assistant_message (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references assistant_thread(id) on delete cascade,
  role       text not null,                  -- 'user' | 'assistant'
  door       text not null default 'web',    -- 'web' | 'whatsapp' | 'email'
  content    text not null,
  meta       jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. Integrations & WhatsApp
-- ---------------------------------------------------------------------------
-- OAuth tokens should live in Supabase Vault; this table holds status + refs only.
create table integration (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profile(id) on delete cascade,
  kind         integration_kind not null,
  status       text not null default 'disconnected',  -- connected/disconnected/error
  external_id  text,                                    -- account email / phone / etc.
  vault_secret_id uuid,                                 -- reference into Vault
  scopes       text[] not null default '{}',
  connected_at timestamptz,
  unique (user_id, kind)
);

create table whatsapp_link (
  user_id     uuid primary key references profile(id) on delete cascade,
  phone       text not null,
  wa_id       text,                            -- WhatsApp Business contact id
  verified    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ============================================================================
-- 6. Row Level Security  — the heart of "overlapping areas"
-- ============================================================================
alter table profile             enable row level security;
alter table assistant_settings  enable row level security;
alter table project             enable row level security;
alter table project_member      enable row level security;
alter table project_invite      enable row level security;
alter table board_column        enable row level security;
alter table card                enable row level security;
alter table subtask             enable row level security;
alter table comment             enable row level security;
alter table attachment          enable row level security;
alter table card_history        enable row level security;
alter table assistant_action    enable row level security;
alter table assistant_thread    enable row level security;
alter table assistant_message   enable row level security;
alter table integration         enable row level security;
alter table whatsapp_link       enable row level security;

-- helper: is the current user a member of a project?
create or replace function is_project_member(pid uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from project_member
    where project_id = pid and user_id = auth.uid()
  );
$$;

-- helper: current user's role on a project (null if none)
create or replace function project_role(pid uuid)
returns member_role language sql security definer stable as $$
  select role from project_member
  where project_id = pid and user_id = auth.uid();
$$;

-- profile: a user sees/edits only their own row
create policy profile_self on profile
  for all using (id = auth.uid()) with check (id = auth.uid());
create policy assist_settings_self on assistant_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- project: members can read; owners can update/delete; anyone can create (becomes owner)
create policy project_read on project
  for select using (is_project_member(id));
create policy project_insert on project
  for insert with check (created_by = auth.uid());
create policy project_update on project
  for update using (project_role(id) = 'owner');
create policy project_delete on project
  for delete using (project_role(id) = 'owner');

-- membership: members can read the roster; owners manage it
create policy member_read on project_member
  for select using (is_project_member(project_id));
create policy member_write on project_member
  for all using (project_role(project_id) = 'owner')
  with check (project_role(project_id) = 'owner');

-- invites: owners manage
create policy invite_rw on project_invite
  for all using (project_role(project_id) = 'owner')
  with check (project_role(project_id) = 'owner');

-- columns: members read; non-viewers write (viewers cannot move columns)
create policy col_read on board_column
  for select using (is_project_member(project_id));
create policy col_write on board_column
  for all using (project_role(project_id) in ('owner','member'))
  with check (project_role(project_id) in ('owner','member'));

-- cards: members read; viewers may INSERT (briefs) & UPDATE content but the
-- app-layer restricts which fields; column moves are guarded in code + col policy.
create policy card_read on card
  for select using (is_project_member(project_id));
create policy card_insert on card
  for insert with check (is_project_member(project_id));
create policy card_update on card
  for update using (is_project_member(project_id));
create policy card_delete on card
  for delete using (project_role(project_id) = 'owner');  -- hard delete: owner only

-- child rows inherit access via their card's project
create policy subtask_rw on subtask
  for all using (exists (select 1 from card c where c.id = card_id and is_project_member(c.project_id)))
  with check (exists (select 1 from card c where c.id = card_id and is_project_member(c.project_id)));
create policy comment_rw on comment
  for all using (exists (select 1 from card c where c.id = card_id and is_project_member(c.project_id)))
  with check (exists (select 1 from card c where c.id = card_id and is_project_member(c.project_id)));
create policy attach_rw on attachment
  for all using (exists (select 1 from card c where c.id = card_id and is_project_member(c.project_id)))
  with check (exists (select 1 from card c where c.id = card_id and is_project_member(c.project_id)));
create policy history_read on card_history
  for select using (exists (select 1 from card c where c.id = card_id and is_project_member(c.project_id)));
create policy history_insert on card_history
  for insert with check (exists (select 1 from card c where c.id = card_id and is_project_member(c.project_id)));

-- assistant + integrations: strictly per-user
create policy action_self on assistant_action
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy thread_self on assistant_thread
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy message_self on assistant_message
  for all using (exists (select 1 from assistant_thread t where t.id = thread_id and t.user_id = auth.uid()))
  with check (exists (select 1 from assistant_thread t where t.id = thread_id and t.user_id = auth.uid()));
create policy integration_self on integration
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy whatsapp_self on whatsapp_link
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================================
-- 7. Triggers
-- ============================================================================
-- auto-create profile + default assistant settings on signup
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profile (id, name) values (new.id, coalesce(new.raw_user_meta_data->>'name',''));
  insert into assistant_settings (user_id) values (new.id);
  return new;
end; $$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- creator of a project is automatically its owner
create or replace function handle_new_project()
returns trigger language plpgsql security definer as $$
begin
  insert into project_member (project_id, user_id, role, invited_by)
  values (new.id, new.created_by, 'owner', new.created_by);
  return new;
end; $$;
create trigger on_project_created
  after insert on project
  for each row execute function handle_new_project();

-- ============================================================================
-- Notes
-- - Time is stored precisely (seconds); ROUNDING to whole hours is a DISPLAY
--   choice driven by profile.settings.time_round_mode (default ceil_hour).
-- - "draft" / "proposed" / "origin" are app-enforced jsonb; the model only
--   proposes actions -> assistant_action -> assistantAction() applies per matrix.
-- - Gathered content (email/calendar/filename) is DATA, never instructions.
-- ============================================================================
