// buno — /morning-sweep: the nightly cron. Runs the sweep for every user with
// Google connected and leaves ONE "day snapshot" in their assistant thread.
// Invoked by pg_cron (see 0012), NOT by the browser: verify_jwt is off and the
// caller must present the shared CRON_SECRET. Uses the service role only.
//
// Iron rules hold: only amber DRAFTS are created (approval pending), the
// snapshot is a private chat message, gathered content is DATA.
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.68.0";
import { sweepUser, daySnapshot, warmDaySnapshot } from "../_shared/sweep.ts";
import { BUNO_VERSION } from "../_shared/bunoConfig.ts";
import { sendWhatsApp, sendRender, noteWaSend, waErrorReason } from "../_shared/whatsapp.ts";

// item 9 — fold older conversation into a rolling per-user summary (updated nightly).
async function updateSummary(admin: any, userId: string, apiKey: string) {
  try {
    const { data: thread } = await admin.from("assistant_thread").select("id").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!thread?.id) return;
    const { data: msgs } = await admin.from("assistant_message").select("role,content").eq("thread_id", thread.id).order("created_at", { ascending: false }).limit(120);
    const rows = (msgs || []).reverse().filter((m: any) => String(m.content || "").trim());
    if (rows.length < 20) return; // not enough history to summarize yet
    const { data: prev } = await admin.from("conversation_summary").select("summary").eq("user_id", userId).maybeSingle();
    const transcript = rows.map((m: any) => `${m.role === "user" ? "משתמש" : "בונו"}: ${String(m.content).slice(0, 300)}`).join("\n").slice(0, 12000);
    const anthropic = new Anthropic({ apiKey });
    const res: any = await anthropic.messages.create({
      model: "claude-sonnet-5", max_tokens: 700, output_config: { effort: "low" },
      system: "אתה מתחזק תקציר מתגלגל של שיחה בעברית (עד ~200 מילים, גוף שלישי): פרויקטים ולקוחות, החלטות, העדפות, משימות פתוחות, ומה המשתמש ביקש ומתי. ענייני וקצר — זהו זיכרון ארוך־טווח, לא סיכום מילולי.",
      messages: [{ role: "user", content: `תקציר קודם:\n${prev?.summary || "(אין)"}\n\nהודעות אחרונות:\n${transcript}\n\nהחזר תקציר מעודכן בלבד.` }],
    });
    const summary = res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    if (summary) await admin.from("conversation_summary").upsert({ user_id: userId, summary: summary.slice(0, 4000), covered_through: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  } catch (e) { console.error("summary update failed", String((e as any)?.message || e)); }
}

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
      // v2 hands the SAME facts to the model to synthesize a warm brief (one call,
      // reused for both channels); v1 keeps the deterministic daySnapshot. warm*
      // falls back to daySnapshot internally, so this never breaks the cron.
      let gender: "m" | "f" | undefined;
      if (BUNO_VERSION === "v2") {
        const { data: st } = await admin.from("assistant_settings").select("gender").eq("user_id", userId).maybeSingle();
        gender = st?.gender === "f" ? "f" : st?.gender === "m" ? "m" : undefined;
      }
      const snapshot = BUNO_VERSION === "v2" ? await warmDaySnapshot(r, apiKey, { gender }) : daySnapshot(r);
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
          // item 14 — ONE morning message: the snapshot text (which already carries
          // the single offer line) + one button. No separate second "shall we?" ask.
          // WhatsApp gets the formatted variant (*bold* labels + blank lines).
          // v2: reuse the warm brief already synthesized above (short prose reads
          // fine on WhatsApp) — no second model call. v1: the formatted variant.
          const waText = BUNO_VERSION === "v2" ? snapshot : daySnapshot(r, { whatsapp: true });
          const open = { text: waText, actions: r.reviewCount ? [{ id: "rv:start", label: "בוא נעבור" }] : [] };
          const s = await sendRender(link.phone, open); waSent = s.ok;
          const streak = await noteWaSend(admin, userId, s);
          if (!s.ok) console.error("wa: morning SEND FAILED", s.status, waErrorReason(s), "streak", streak);
        }
      } catch { /* whatsapp push best-effort */ }
      await updateSummary(admin, userId, apiKey); // item 9 — refresh the rolling memory summary
      results.push({ userId, created: r.created.length, considered: r.considered, waSent });
    } catch (e) {
      results.push({ userId, error: String(e) });
    }
  }

  return new Response(JSON.stringify({ ran: userIds.length, results }), { headers: { "Content-Type": "application/json" } });
});
