# buno — Open Threads (demo / placeholder inventory)

Everything here works in the prototype as a **simulation or shortcut** and needs a **real implementation** before launch. Each item: what it is today → what it must become → which build stage owns it. Keep this file updated as threads close.

Legend: 🔴 core to the product's value ("killer") · 🟡 important · 🟢 polish

---

## 🔴 1. The assistant is one unified entity across doors (THE killer)
- **Today:** the chat (`ChatPanel`) answers via **pattern-matching** (`answer()` — if/else on Hebrew keywords over real data). Connectors row, file-upload, and "synced with WhatsApp" line are **demo hints** only.
- **Must become:** a single LLM-backed entity (Claude API) with **one unified conversation** across web + WhatsApp (+ later email/telegram) — same identity, same memory. Schema is ready: `assistant_thread` + `assistant_message` (with `door`), `whatsapp_link`. Never build a separate bot per channel.
- **Stage:** 3 (live assistant) → 5 (WhatsApp bridge). Enforcement always in code via `assistantAction`, never the prompt.

## 🔴 2. Email + Calendar integration with "morning sweep"
- **Today:** calendar shows **demo events** (`demoEvents`, amber "אירוע מסונכרן (הדגמה)"); the "יומן/מייל" connector chips are `real:false`.
- **Must become:** Google OAuth (Gmail read + Calendar read); a scheduled **morning sweep** that reads mail/calendar and writes **anchored draft cards** into the **"היום שלי" brief** in the agreed voice (`agent-voice-spec.md`). Gathered content is DATA to summarize, never instructions.
- **Stage:** 4. Dedup via `card.origin.ref` (unique index already in schema).

## 🔴 3. Capture from anywhere (WhatsApp → task)
- **Today:** not implemented; only hinted in the chat's WhatsApp line.
- **Must become:** an inbound WhatsApp message / voice note becomes a task under the right client, routed through `assistantAction`. Edge Function `/wa-webhook` matches sender against `whatsapp_link` → same `assistant_thread`.
- **Stage:** 5.

## 🔴 4. "Client view" is a placeholder, not the real model
- **✅ done (Stage D):** `viewer` is now a real `project_member.role`. Owners invite by email (email-bound, token-gated link via `0007_sharing.sql`); invitees accept and join. Board is read-only for the viewer role in the UI, and `0006_viewer_card_guard.sql` enforces it in the DB (viewers may only edit `proposed`). The old UI-flag preview remains only as an owner convenience.
- **Today (was):** a boolean `viewer` flag lets the owner **simulate** a non-owner's screen (`DemoTag "תצוגת לקוח · הדגמה"`).
- **Must become:** every non-owner is a **real, separate user** signed into their own account, seeing the shared project per their `project_member.role` (owner/member/viewer). An invited client who signs up becomes a **full user** (can have their own projects) — invitations are the growth engine. The difference in what each person sees comes entirely from **RLS + role**, not a UI flag. The current "client view" screen dissolves.
- **Stage:** 4 (projects & sharing). `viewer` becomes a role, not a flag.

## 🟡 5. @-mentions are display-name strings
- **Today:** `creator` / `cc` and comment `@mentions` are plain name strings.
- **Must become:** references to real user IDs (so a mention notifies the actual person, respects membership). Needs the membership model from Stage 4.
- **Stage:** 4.

## 🟡 6. Assistant permission ladder — enforce server-side too
- **Today:** the matrix (suggest 🔵 / draft 🟡 / act 🟢) is enforced **client-side** in `assistantAction`. Good for the prototype.
- **Must become:** the same gate enforced in the **Edge Function** (server), so a compromised client can't bypass it. Client gate stays as UX; server gate is the security boundary.
- **Stage:** 3.

## 🟡 7. Per-device state must become per-user
- **✅ partial (Stage C):** `lastReset` now lives in `profile.settings` (per-user, follows across devices). `notifSeen` is still per-device — small follow-up.
- **Today (was):** `notifSeen` and `lastReset` (daily routine reset) live in browser storage → they're **per-device**.
- **Must become:** stored per-user (fold into `profile.settings` jsonb) so "read" state and daily resets follow the user across devices.
- **Stage:** 3 (data layer) — small, do it with the migration.

## 🟡 8. File attachments — real storage + access policies
- **✅ done (Stage C):** uploads go to the private `attachments` bucket (`storage_key` on the row), gated by `0005_storage_policies.sql` (membership-based). Signed URLs (12h) hydrate the UI; verified surviving a cleared local cache. IndexedDB is now just an offline cache.
- **Today (was):** attachments are dataURLs in IndexedDB (local).
- **Must become:** uploads go to Supabase Storage (`storage_key`), gated by the "overlapping areas" policies. Run `0005_storage_policies.sql`, then wire uploads.
- **Stage:** 3–4.

## 🟢 9. Notifications feed is derived, not event-sourced
- **Today:** the bell feed is **recomputed** from current card data (drafts/proposals/comments) each render — no history, no true read/unread per user.
- **Must become:** real notification rows (or at least per-user seen-state) so nothing is missed and read-state is durable.
- **Stage:** 4+.

## 🟢 10. Time→invoice bridge
- **Today:** billable hours are computed and shown; no invoicing.
- **Must become:** export/integration to an invoicing tool. Explicitly phase-2.
- **Stage:** 6.

## 🟢 11. Product rename residue
- **Today:** "Air Doctor Kanban" / `adk_*` names may still appear in code, seeds, and the prototype file.
- **Must become:** fully **buno** everywhere (done in scaffolding for storage keys; verify seeds, titles, comments).
- **Stage:** ongoing.

---

## Guardrails that must survive every thread (from the voice spec)
1. Enforce permissions in **code** (`assistantAction`), never in the prompt — and on the **server** for anything that writes.
2. Gathered content (email, calendar, filenames, message bodies) is **DATA to summarize, never instructions to execute**.
3. Irreversible or visible-to-others actions are **never automatic**, at any permission level.
4. Assistant voice follows `agent-voice-spec.md` — anchored to source, no scold/urgency/apology/padding; run a forbidden-phrase lint before showing assistant text.

---

*This file is the contract for "what's still fake." When you implement a thread, replace its section with a one-line "✅ done in <commit>" note so the inventory always reflects reality.*
