// buno — Google OAuth for integrations (Stage 4). One function, two roles:
//   POST  {action:"start"}  (user JWT)  → returns the Google consent URL
//   GET   ?code=…&state=…   (Google redirect, no JWT) → exchanges the code,
//                             stores the refresh token in Vault, marks the
//                             integration connected, redirects back to the app.
//
// Security:
// - verify_jwt is OFF (the Google redirect can't carry a Supabase JWT); the
//   user is proven instead by a state string HMAC-signed with the service-role
//   key, minted only after we verified the caller's JWT on "start".
// - The refresh token never touches the browser: it goes straight into Vault
//   via a service-role client, server-side only.
// - We request offline access with include_granted_scopes so later scopes
//   (gmail, in 4b) are additive without dropping calendar.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-oauth`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// ---- signed state (HMAC-SHA256 with the service key) -----------------------
const enc = new TextEncoder();
async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(SERVICE_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function mintState(uid: string, origin: string): Promise<string> {
  const body = btoa(JSON.stringify({ uid, origin, exp: Date.now() + 10 * 60_000 })).replace(/=+$/, "");
  return `${body}.${await hmac(body)}`;
}
async function readState(state: string): Promise<{ uid: string; origin: string } | null> {
  const [body, sig] = (state || "").split(".");
  if (!body || !sig || (await hmac(body)) !== sig) return null;
  try {
    const p = JSON.parse(atob(body));
    if (!p.uid || p.exp < Date.now()) return null;
    return { uid: p.uid, origin: p.origin };
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);

  // ---- callback from Google (browser redirect) -----------------------------
  if (req.method === "GET" && (url.searchParams.get("code") || url.searchParams.get("error"))) {
    const st = await readState(url.searchParams.get("state") || "");
    const backTo = (st?.origin || "https://www.buno.io") + "/?connected=";
    if (url.searchParams.get("error")) return Response.redirect(backTo + "denied", 302);
    if (!st) return Response.redirect(backTo + "badstate", 302);
    try {
      // exchange the code for tokens
      const tokRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: url.searchParams.get("code")!,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          grant_type: "authorization_code",
        }),
      });
      const tok = await tokRes.json();
      if (!tok.refresh_token) {
        // no refresh token (already granted before without offline) — still ok
        // if we get one; otherwise ask the user to reconnect with consent.
        if (!tokRes.ok) return Response.redirect(backTo + "exchange_failed", 302);
      }
      const admin = createClient(SUPABASE_URL, SERVICE_KEY);
      // which Google account was connected
      let external = "";
      try {
        const who = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` } });
        external = (await who.json())?.email || "";
      } catch {}
      const scopes = String(tok.scope || "").split(" ").filter(Boolean);
      // store the refresh token in the service-role-only secrets table
      if (tok.refresh_token) {
        const { error: secErr } = await admin.from("integration_secret").upsert(
          { user_id: st.uid, kind: "gcal", refresh_token: tok.refresh_token, updated_at: new Date().toISOString() },
          { onConflict: "user_id,kind" },
        );
        if (secErr) return Response.redirect(backTo + "err_secret_" + encodeURIComponent(secErr.message).slice(0, 90), 302);
      }
      const { error: upErr } = await admin.from("integration").upsert({
        user_id: st.uid, kind: "gcal", status: "connected", external_id: external,
        scopes, connected_at: new Date().toISOString(),
      }, { onConflict: "user_id,kind" });
      if (upErr) return Response.redirect(backTo + "err_row_" + encodeURIComponent(upErr.message).slice(0, 90), 302);
      return Response.redirect(backTo + "calendar", 302);
    } catch (e) {
      return Response.redirect(backTo + "err_" + encodeURIComponent(String(e)).slice(0, 90), 302);
    }
  }

  // ---- start (from the app, authenticated) ---------------------------------
  if (req.method === "POST") {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing authorization" }, 401);
    const supabase = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) return json({ error: "not authenticated" }, 401);
    let body: any = {};
    try { body = await req.json(); } catch {}
    const origin = String(body?.origin || "https://www.buno.io").replace(/\/$/, "");
    const state = await mintState(u.user.id, origin);
    const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly",
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent",
      state,
    });
    return json({ url: authUrl });
  }

  return json({ error: "not found" }, 404);
});
