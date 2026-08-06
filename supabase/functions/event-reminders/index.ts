// buno — /event-reminders: the every-15-min cron (D4). For each connected user
// it looks at the next 2 hours of calendar and, for any meeting starting within
// ~30 minutes that hasn't been flagged yet, drops ONE proactive message into the
// assistant thread: "⏰ ‹meeting› in N minutes" with the event chip (→ opens the
// event, where a prep card is one tap away) and a Meet button when there is one.
//
// Invoked by pg_cron (see 0025), NOT the browser: verify_jwt is off, gated by the
// shared CRON_SECRET. Service role only. Read-only on the calendar. The proactive
// message surfaces live in the always-open chat via a Realtime subscription.
import { createClient } from "npm:@supabase/supabase-js@2";
import { freshAccessToken, listCalendarEvents } from "../_shared/google.ts";

const WINDOW_MIN = 30;   // remind when a meeting starts within this many minutes
const LOOKAHEAD_MS = 2 * 3600e3;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== Deno.env.get("CRON_SECRET")) return new Response("forbidden", { status: 403 });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let onlyUser: string | null = null;
  try { onlyUser = (await req.json())?.userId || null; } catch { /* no body */ }

  const { data: integ } = await admin.from("integration").select("user_id").eq("kind", "gcal").eq("status", "connected");
  const userIds = [...new Set((integ || []).map((i: any) => i.user_id))].filter((u) => !onlyUser || u === onlyUser);

  const now = Date.now();
  const results: any[] = [];
  for (const userId of userIds) {
    try {
      const access = await freshAccessToken(admin, userId, "gcal");
      if (!access) { results.push({ userId, skipped: "not_connected" }); continue; }
      const events = await listCalendarEvents(access, new Date(now).toISOString(), new Date(now + LOOKAHEAD_MS).toISOString());

      // meetings starting within the window that the user hasn't declined
      const soon = events.filter((e: any) => {
        if (e.allDay || !e.start || e.myStatus === "declined") return false;
        const mins = (Date.parse(e.start) - now) / 60000;
        return mins > 0 && mins <= WINDOW_MIN;
      });
      if (!soon.length) { results.push({ userId, reminded: 0 }); continue; }

      // resolve (or open) the user's thread once
      let { data: thread } = await admin.from("assistant_thread").select("id").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      let threadId = thread?.id;
      if (!threadId) { const { data: t } = await admin.from("assistant_thread").insert({ user_id: userId }).select("id").single(); threadId = t?.id; }
      if (!threadId) { results.push({ userId, error: "no_thread" }); continue; }

      let reminded = 0;
      for (const ev of soon) {
        // dedup: one reminder per event (look back 6h for a matching reminder row)
        const { data: dupe } = await admin.from("assistant_message")
          .select("id").eq("thread_id", threadId).eq("door", "reminder")
          .filter("meta->>eventId", "eq", ev.id)
          .gte("created_at", new Date(now - 6 * 3600e3).toISOString()).limit(1);
        if (dupe && dupe.length) continue;

        const mins = Math.max(1, Math.round((Date.parse(ev.start) - now) / 60000));
        const who = (ev.attendees || []).filter((a: any) => !a.self).map((a: any) => a.name || String(a.email || "").split("@")[0]).filter(Boolean).slice(0, 2).join(", ");
        let content = `⏰ ${ev.title}${who ? ` עם ${who}` : ""} — בעוד ${mins} דקות.`;
        if (ev.meetLink) content += " הצטרפות ב־Meet למטה.";
        else if (ev.location) content += ` מיקום: ${ev.location} — צא בזמן (קח בחשבון זמן נסיעה).`;

        await admin.from("assistant_message").insert({
          thread_id: threadId, role: "assistant", door: "reminder", content,
          meta: {
            eventId: ev.id,
            events: [ev], // renders as a clickable chip → opens the event (prep card one tap away)
            actions: ev.meetLink ? [{ id: "meet", label: "פתח Meet", url: ev.meetLink }] : undefined,
          },
        });
        reminded++;
      }
      results.push({ userId, reminded });
    } catch (e) {
      results.push({ userId, error: String((e as any)?.message || e) });
    }
  }

  return new Response(JSON.stringify({ ran: userIds.length, results }), { headers: { "Content-Type": "application/json" } });
});
