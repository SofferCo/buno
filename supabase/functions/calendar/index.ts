// buno — /calendar: returns the signed-in user's Google Calendar events for a
// window. The client calls it with its JWT; the function verifies the user,
// then uses the service role only to fetch that user's token from Vault and
// mint an access token. The browser never sees a Google token.
import { createClient } from "npm:@supabase/supabase-js@2";
import { freshAccessToken, listCalendarEvents } from "../_shared/google.ts";

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
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) return json({ error: "not authenticated" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch {}
  const now = new Date();
  const timeMin = body?.timeMin || new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const timeMax = body?.timeMax || new Date(now.getTime() + 14 * 864e5).toISOString();

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const access = await freshAccessToken(admin, u.user.id, "gcal");
  if (!access) return json({ connected: false, events: [] });

  try {
    const events = await listCalendarEvents(access, timeMin, timeMax);
    return json({ connected: true, events });
  } catch {
    return json({ connected: true, events: [], error: "calendar_read_failed" });
  }
});
