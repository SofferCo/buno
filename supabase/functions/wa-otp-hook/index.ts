// buno — /wa-otp-hook: the Supabase Auth "Send SMS Hook" target.
//
// Login OTP architecture (Tal, 2026-08-02): onboarding sign-in is native Supabase
// PHONE auth — the client calls signInWithOtp({phone}) / verifyOtp(...) and gets a
// real Supabase session. Supabase GENERATES the code; this hook only routes the
// DELIVERY to WhatsApp (an approved Authentication-category template) instead of an
// SMS provider. No SMS provider is used in this phase.
//
// Auth: Supabase signs the hook request (Standard Webhooks) with the secret shown
// when you enable the hook — stored here as SEND_SMS_HOOK_SECRET. verify_jwt is off
// (Supabase Auth doesn't send a user JWT). The WhatsApp send uses the same live
// number + WA_ACCESS_TOKEN as the inbound webhook.
import { sendWhatsAppTemplate, waErrorReason } from "../_shared/whatsapp.ts";

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Standard Webhooks symmetric verification: signature = base64(HMAC_SHA256(secret,
// `${id}.${timestamp}.${body}`)). The header is a space-separated list of "v1,<sig>".
async function verifyHook(secret: string, id: string, ts: string, body: string, header: string): Promise<boolean> {
  if (!secret || !id || !ts || !header) return false;
  // the secret is base64, usually prefixed "v1,whsec_" or "whsec_"
  const raw = secret.replace(/^v1,/, "").replace(/^whsec_/, "");
  let keyBytes: Uint8Array;
  try { keyBytes = b64ToBytes(raw); } catch { return false; }
  // reject stale deliveries (> 5 min skew) — replay hardening
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return header.split(" ").some((p) => p.startsWith("v1,") && p.slice(3) === expected);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const body = await req.text();

  const secret = Deno.env.get("SEND_SMS_HOOK_SECRET") || "";
  const ok = await verifyHook(
    secret,
    req.headers.get("webhook-id") || "",
    req.headers.get("webhook-timestamp") || "",
    body,
    req.headers.get("webhook-signature") || "",
  );
  if (!ok) { console.warn("wa-otp-hook: signature mismatch / secret missing"); return new Response("bad signature", { status: 401 }); }

  let payload: any;
  try { payload = JSON.parse(body); } catch { return new Response("bad json", { status: 400 }); }

  const phone = String(payload?.user?.phone || "").trim();
  const otp = String(payload?.sms?.otp || "").trim();
  if (!phone || !otp) return new Response(JSON.stringify({ error: "missing phone/otp" }), { status: 400, headers: { "Content-Type": "application/json" } });

  const template = Deno.env.get("WA_OTP_TEMPLATE") || "buno_login_code";
  const lang = Deno.env.get("WA_OTP_LANG") || "he";
  const sent = await sendWhatsAppTemplate(phone, template, lang, otp);
  if (!sent.ok) {
    console.error("wa-otp-hook: WA send failed", sent.status, waErrorReason(sent));
    // non-2xx so Supabase surfaces the delivery failure to the client (retryable).
    return new Response(JSON.stringify({ error: "delivery_failed" }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
});
