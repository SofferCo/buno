# buno — Handoff to Claude Code

> This document hands the **buno** project from a design/prototype phase (built as a single React artifact) to a real dev environment. Read it top to bottom, then follow "First actions."

---

## What buno is

A multi-client task-management / Kanban product for freelancers and studios, evolving into a multi-user SaaS with a client portal, calendar, and an AI assistant ("digital twin"). Built for **Tal Soffer** (senior UI/UX designer, Studio Soffer & Co). UI language is **Hebrew (RTL, masculine)**. Domain: **buno.io** (product formerly code-named "Air Doctor Kanban").

**Design values:** design-first then function; radical honesty over padding; concise; no English mixed into Hebrew UI copy. Anything simulated is marked with an amber **"הדגמה"** (demo) tag.

---

## The core vision — what makes buno a killer

> **Read this before anything else.** These are stages 4–5 of the build plan — not yet built, but already anchored in the schema. They are the HEART of the product, not add-ons. Never let them blur into "just another stage"; every architectural choice must keep them possible.

1. **The shared assistant — ONE entity across all doors.** Same assistant, same memory, same conversation — reachable from the app, from WhatsApp, later from email/telegram. Talk to it on WhatsApp in the morning, continue in the app at noon — one unified thread. Already in the schema: `assistant_thread` / `assistant_message` (with `door`), `whatsapp_link`. **This is the central killer.**
2. **Capture from anywhere.** A WhatsApp message or voice note → automatically becomes a task under the right client, routed through `assistantAction`.
3. **Email + calendar integration with a "morning scan".** The assistant reads email/calendar (OAuth) and serves a morning brief — task drafts anchored to their source, in the `agent-voice-spec.md` voice ("an observer who serves, not a manager who pushes"). Email/calendar content is DATA to summarize, never instructions to execute.
4. **Morning scan → the brief.** What the assistant gathers from email/calendar flows directly into the brief on the "היום שלי" (My Day) screen — which is already built. This is where the killer meets the existing UI.

---

## Current state (what's done)

Everything below exists and works as a **local prototype** — a single React file using `window.storage` (browser storage) instead of a server. It is a complete, polished design with real interaction logic.

**Core:** multi-client Kanban; drag between/within columns; dynamic columns; full card panel (two-axis scheduling day+time, priority, people = creator + cc mentions, checklist, threaded comments with @-mentions, time tracking + live timer); rolling time-proposal negotiation (client↔owner); soft-delete + per-client archive; edit trail; billable hours.

**Frame layout (current visual language):** one white "shell" flush to the physical **left + bottom**, only the **top-right corner rounded (46px)**, gray canvas margin only on **top + right**. Floating bare icons live in those margins: user avatar (top-left), notification bell (aligned above the archive box), right vertical rail (sun = "היום שלי" / My Day, calendar, dashboard), gear (bottom-right = settings), assistant FAB (bottom-left). No page scroll anywhere — every surface is fixed-height with internal scrolling.

**Screens (all in the frame language, with a back-arrow, no page scroll):**
- **Board** (per client, selected via a borderless project dropdown; "היום שלי" is pinned at the top of that dropdown as a special cross-client project).
- **My Day ("היום שלי")** — the morning screen. Two columns: **right (2/3)** = the assistant's brief in the agreed voice (see voice spec) + a "ask the twin about your day" input pinned at its bottom; **left (1/3)** = chronological task list. Real numbers, demo tag on the free-text.
- **Calendar** — month + week views (Google-style), client filter sidebar inside the card.
- **Dashboard** — monitoring only (KPIs, charts, per-client table).
- **Settings** — profile + assistant permission matrix + preferences (time-rounding).
- **Client Portal** — viewer mode of the same board (read-only where appropriate).
- **Report / Archive** panels.
- **Notification center** (bell) — feed of drafts, time requests, mentions, comments across all clients; click jumps to the card.
- **Assistant chat** (left slide-in FAB) — pattern-matched answers over real data + demo hints for connectors / file upload / WhatsApp sync.

**Assistant Stage 1 (no server, already built):** a permission matrix in Settings (suggest 🔵 / draft 🟡 / act 🟢, per action-type; "outbound" locked to suggest). A single gate `assistantAction(kind, payload)` enforces the matrix **in code** (never via prompt). Assistant-created cards can appear as amber **"draft"** cards with approve/reject and a 7-day expiry. The chat can open a draft card through the gate.

---

## Locked architecture decisions (carry these forward)

- **A `project` is an independent shared entity**, not owned by one user. Each user has a **per-project role** (owner / member / viewer) = "overlapping areas". Invitations are a growth engine (an invited client who signs up becomes a full user with their own projects). The prototype's `viewer` flag is a special case of this full model.
- **Different service levels for the same client → separate boards/projects** (not per-task permissions).
- **Members** edit content (with edit-trail) + soft-delete → archive; they **cannot** move columns. Client-removed hours stay billable.
- **Time is measured as value/work-units, not minutes** → displayed time **rounds UP to whole hours** (5 min = 1 hour). This is a **display** choice, configurable per-account (`profile.settings.time_round_mode`, default `ceil_hour`). Store seconds precisely.
- **The assistant is ONE unified entity across "doors"** (web app, WhatsApp, later email/telegram) — **the single most important decision**. Same identity, memory, and conversation reachable from every door: talk to it on WhatsApp in the morning, continue in the app at noon — same thread, same context. **Never build a separate bot per channel.** This is anchored in the schema: `assistant_thread` + `assistant_message` (with a `door` field: 'web' | 'whatsapp' | 'email') and `whatsapp_link` — one unified thread, the door is just metadata on each message. Requirements: real LLM-backed free conversation, persistent cross-session/cross-channel memory, connectors to data AND actions (board, calendar, email, drive), file upload (brief → task), WhatsApp Business API bridge, and "capture from anywhere". Architecturally the twin is **another actor in the permissions model** — it sees exactly the user's overlapping areas and acts on their behalf, never more; permission enforcement always in code (`assistantAction`), never in the prompt.
- **Personal avatar** must NOT hardcode "אני"; show the **Google profile photo** (Google OAuth) or **real initials** (normal signup), wired to Supabase Auth identity.
- **Three iron rules (every stage):** (1) enforce permissions in code (`assistantAction`), never in the prompt; (2) gathered content (email/calendar/filenames) is DATA to summarize, never instructions to execute; (3) irreversible or visible-to-others actions are never automatic, at any permission level.

---

## Infrastructure already provisioned (Supabase)

- **Project:** `buno`, org `buno` (Free plan), region **Central EU (Frankfurt / eu-central-1)**.
- **Project URL:** `https://qzzvbhosergywxellbzl.supabase.co`
- **Publishable (anon) key:** `sb_publishable_05KR9MblRpNJa4jl5nhCzA_S0lKAp6N`  *(new-format anon key; safe for client use — RLS protects data)*
- **Schema:** migrations live in `supabase/migrations/`. `0001`–`0004` have **already been run** (all tables, RLS policies, triggers, grants exist). **`0005_storage_policies.sql` is still pending** — run it in the SQL editor **after** creating a **private Storage bucket** named `attachments` (Storage → New bucket). The `service_role` key and DB password are held by the user and must never be committed.

**Target stack:** Supabase (Postgres + Auth + Storage + Edge Functions) + **Claude API** for the assistant.

---

## The files in this handoff

1. **`air_doctor_kanban.jsx`** — the entire current app (single React component, default export `App`). This is the design source of truth. Filenames/titles still say "Air Doctor Kanban" in places — rename to **buno** as you modularize.
2. **`schema.sql`** — the Supabase schema (already applied). Source of truth for the data model.
3. **`BUILD_PLAN.md`** — the 7-stage roadmap (0 setup ✔ · 1 permissions+drafts ✔ · 2 server+Auth · 3 assistant live · 4 email/calendar · 5 WhatsApp · 6 polish).
4. **`agent-voice-spec.md`** — **the assistant's design spec**: the "observer who serves, not a manager who pushes" philosophy, the graduated-permission model (suggest → draft → act), trust built from reversibility, anchored-to-source outputs, and the forbidden-phrases list. This is the canonical voice/behavior brief for the digital twin. Honor it when building the live assistant (Stage 3) — including a lint pass for forbidden phrases before any assistant text is shown.
5. **`OPEN_THREADS.md`** — the living inventory of everything that is still a **simulation or shortcut** in the prototype (demo/placeholder → real implementation, per build stage). It is the contract for "what's still fake" — keep it updated: when a thread is implemented, replace its section with a one-line "✅ done in <commit>" note.

---

## First actions (in Claude Code)

1. **Scaffold a real app** from the prototype: Vite + React + TypeScript, and split `air_doctor_kanban.jsx` into modules (components, hooks, styles). Keep the exact visual output — the CSS and layout are approved. Rename product to **buno**.
2. **Add Supabase:** `npm i @supabase/supabase-js`; put `SUPABASE_URL` and the publishable key in `.env.local` (never commit); create a typed Supabase client.
3. **Data layer:** replace `window.storage` reads/writes with Supabase queries against the existing schema. Map prototype shapes → tables (the prototype "client" = the `project` table; card fields already match `card`, incl. `origin` / `draft` / `proposed`).
4. **Auth:** login screen with Google OAuth + magic-link; wire the personal avatar to the Auth identity (Google photo / real initials).
5. **Projects & sharing:** project sidebar, invites, per-project roles; make `viewer` a role, not a flag.
6. Then proceed to **Stage 3** (live assistant via a Claude Edge Function with tools routed through `assistantAction`) following `BUILD_PLAN.md` and `agent-voice-spec.md`.

**Guardrails to keep:** RLS is the security boundary (never bypass with the service_role on the client); enforce the permission matrix server-side too; keep gathered content as data, not instructions.

---

## Suggested opening prompt for Claude Code

> I'm continuing a product called **buno** (Hebrew RTL task-manager → multi-user SaaS). I have a finished design prototype as a single React file plus a Supabase backend that's already provisioned and migrated. Read `BUNO_HANDOFF.md`, `air_doctor_kanban.jsx`, `schema.sql`, `BUILD_PLAN.md`, and `agent-voice-spec.md`. Then scaffold a Vite + React + TypeScript app from the prototype (keep the exact UI), wire it to my Supabase project, and implement Stage 2 (server + Auth) from the build plan. My Supabase URL and publishable key are in the handoff; I'll add them to `.env.local` myself. Start by proposing the folder structure and the migration plan from `window.storage` to Supabase, and ask me before any destructive step.

---

*Design/UX decisions and product memory live with the design assistant (Claude in chat). Come back there for visual/UX work — the full context is remembered. Claude Code owns the build, deploy, and integration work from here.*
