// buno — /sweep-now: an on-demand sweep for the CURRENT user (B4).
// Same pipeline as the nightly morning-sweep (email triage → draft cards →
// calendar snapshot → nudges), but triggered by the user from the app instead
// of pg_cron. JWT-gated (the caller's own session); rate-limited to once per
// 10 minutes so it can't be hammered. Uses the service role only to run the
// shared sweepUser under the authenticated user's id.
import { createClient } from "npm:@supabase/supabase-js@2";
import { sweepUser } from "../_shared/sweep.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const RATE_MS = 10 * 60 * 1000; // once per 10 minutes

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing authorization" }, 401);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "assistant not configured" }, 500);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await supabase.auth.getUser();
  const user = u?.user;
  if (!user) return json({ error: "not authenticated" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // the user's latest thread — used for the rate-limit check and to write into
  const { data: thread } = await admin.from("assistant_thread").select("id").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  let threadId = thread?.id;

  // rate limit: reject if a sweep ran for this user in the last 10 minutes
  if (threadId) {
    const { data: recent } = await admin.from("assistant_message")
      .select("created_at").eq("thread_id", threadId).eq("door", "sweep")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (recent?.created_at && (Date.now() - new Date(recent.created_at).getTime()) < RATE_MS) {
      return json({ ok: false, rateLimited: true, message: "סרקתי ממש עכשיו, הכול מעודכן." });
    }
  }

  const r = await sweepUser(admin, user.id, apiKey);
  if (!r) return json({ ok: false, connected: false, message: "היומן/מייל לא מחוברים — אפשר לחבר בהגדרות." });

  if (!threadId) {
    const { data: t } = await admin.from("assistant_thread").insert({ user_id: user.id }).select("id").single();
    threadId = t?.id;
  }
  // scan-framed message; thread updates/invites are offered as a guided walk (buttons)
  const base = r.created.length
    ? `סרקתי שוב — ${r.created.length === 1 ? "יש טיוטה אחת חדשה" : `יש ${r.created.length} טיוטות חדשות`} על הלוח.`
    : (r.reviewCount ? "סרקתי שוב." : "סרקתי שוב — לא נראים דברים חדשים באופק.");
  const snapshot = [base, ...(r.nudges || [])].join("\n");
  if (threadId) {
    await admin.from("assistant_message").insert([
      { thread_id: threadId, role: "user", door: "web", content: "סרוק עכשיו" },
      { thread_id: threadId, role: "assistant", door: "sweep", content: snapshot, meta: r.created.length ? { created: r.created } : null },
    ]);
  }
  return json({ ok: true, snapshot, created: r.created, considered: r.considered, nudges: r.nudges, review: r.reviewOpening });
});
