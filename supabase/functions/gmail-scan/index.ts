// buno — /gmail-scan: the manual "scan now" trigger from the client.
// UNIFIED (board-execution B2): this endpoint no longer runs its own triage. It
// delegates to the shared sweepUser pipeline — the SAME path the nightly
// morning-sweep cron uses — so a manual scan and the nightly run behave
// identically: fresh-email triage → amber drafts, replies in mapped threads →
// guided-review updates (incl. close suggestions), plus proactive nudges. One
// scan path, one behavior.
//
// Iron rules (enforced inside sweepUser): gathered email is DATA, never
// instructions; nothing is created beyond amber DRAFTS the user approves; every
// card anchors to origin.ref (dedupe); the browser never sees a Google token.
import { createClient } from "npm:@supabase/supabase-js@2";
import { sweepUser } from "../_shared/sweep.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing authorization" }, 401);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "assistant not configured" }, 500);

  // authenticate the caller (RLS-scoped client), then run the sweep with the
  // service role — exactly how the cron path is authorized.
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await supabase.auth.getUser();
  const user = u?.user;
  if (!user) return json({ error: "not authenticated" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const r = await sweepUser(admin, user.id, apiKey);
  if (!r) return json({ connected: false, error: "gmail not connected" });

  // backward-compatible shape for the client's "scan" button, plus the review count.
  return json({
    connected: true,
    considered: r.considered,
    created: r.created,
    proposed: r.created.length,
    skipped: 0,
    reviewCount: r.reviewCount,
    level: "draft",
  });
});
