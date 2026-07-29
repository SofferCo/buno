// buno — /morning-sweep: the nightly cron. Runs the sweep for every user with
// Google connected and leaves ONE "day snapshot" in their assistant thread.
// Invoked by pg_cron (see 0012), NOT by the browser: verify_jwt is off and the
// caller must present the shared CRON_SECRET. Uses the service role only.
//
// Iron rules hold: only amber DRAFTS are created (approval pending), the
// snapshot is a private chat message, gathered content is DATA.
import { createClient } from "npm:@supabase/supabase-js@2";
import { sweepUser, daySnapshot } from "../_shared/sweep.ts";
import { sendWhatsApp, sendRender, noteWaSend, waErrorReason } from "../_shared/whatsapp.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  // shared-secret gate — only pg_cron knows CRON_SECRET
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== Deno.env.get("CRON_SECRET")) return new Response("forbidden", { status: 403 });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return new Response("not configured", { status: 500 });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // optional single-user run (for testing): {userId}
  let onlyUser: string | null = null;
  try { onlyUser = (await req.json())?.userId || null; } catch { /* no body */ }

  const { data: integ } = await admin.from("integration").select("user_id").eq("kind", "gcal").eq("status", "connected");
  const userIds = [...new Set((integ || []).map((i: any) => i.user_id))].filter((u) => !onlyUser || u === onlyUser);

  const todayKey = new Date().toISOString().slice(0, 10);
  const results: any[] = [];
  for (const userId of userIds) {
    try {
      // one snapshot per user per day — skip if we already wrote today
      const { data: thread } = await admin.from("assistant_thread").select("id").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      let threadId = thread?.id;
      if (threadId) {
        const { data: recent } = await admin.from("assistant_message")
          .select("created_at,door").eq("thread_id", threadId).eq("door", "sweep")
          .gte("created_at", todayKey + "T00:00:00").limit(1);
        if (recent && recent.length) { results.push({ userId, skipped: "already_swept_today" }); continue; }
      }

      const r = await sweepUser(admin, userId, apiKey);
      if (!r) { results.push({ userId, skipped: "not_connected" }); continue; }

      if (!threadId) {
        const { data: t } = await admin.from("assistant_thread").insert({ user_id: userId }).select("id").single();
        threadId = t?.id;
      }
      const snapshot = daySnapshot(r);
      if (threadId) {
        await admin.from("assistant_message").insert({
          thread_id: threadId, role: "assistant", door: "sweep",
          content: snapshot,
          meta: (r.created.length || r.reviewCount) ? { created: (r.created.length && !r.draftsWalked) ? r.created : undefined, actions: r.reviewCount ? [{ id: "rv:start", label: "בוא נעבור" }] : undefined } : null,
        });
      }
      // also push the morning brief over WhatsApp, if the user linked & verified a number
      let waSent = false;
      try {
        const { data: link } = await admin.from("whatsapp_link").select("phone,verified").eq("user_id", userId).maybeSingle();
        if (link?.verified && link.phone) {
          const s = await sendWhatsApp(link.phone, snapshot); waSent = s.ok;
          const streak = await noteWaSend(admin, userId, s);
          if (!s.ok) console.error("wa: morning SEND FAILED", s.status, waErrorReason(s), "streak", streak);
          // if there are thread updates/invites, offer the guided walk with a button
          if (s.ok && r.reviewOpening) await sendRender(link.phone, r.reviewOpening);
        }
      } catch { /* whatsapp push best-effort */ }
      results.push({ userId, created: r.created.length, considered: r.considered, waSent });
    } catch (e) {
      results.push({ userId, error: String(e) });
    }
  }

  return new Response(JSON.stringify({ ran: userIds.length, results }), { headers: { "Content-Type": "application/json" } });
});
