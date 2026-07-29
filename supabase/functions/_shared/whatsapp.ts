// buno — WhatsApp Cloud API helpers (server-side only).
// Stage 5 / Step A: send a text message, and verify Meta's webhook signature.
// The access token lives ONLY in the WA_ACCESS_TOKEN secret (temp 24h now,
// System User token later); never in code.

const GRAPH = "https://graph.facebook.com/v25.0";
// the test sender's Phone Number ID (not secret) — Meta app "buno" test number
export const WA_PHONE_NUMBER_ID = "1281762435014816";

// Send a plain-text WhatsApp message. `to` is the recipient's number in E.164
// digits (no '+'), e.g. "15556621764".
export async function sendWhatsApp(to: string, text: string): Promise<{ ok: boolean; status: number; body: string }> {
  const token = Deno.env.get("WA_ACCESS_TOKEN");
  if (!token) return { ok: false, status: 500, body: "WA_ACCESS_TOKEN missing" };
  const res = await fetch(`${GRAPH}/${WA_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: String(to).replace(/\D/g, ""), type: "text", text: { preview_url: false, body: String(text).slice(0, 4096) } }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

// Verify the X-Hub-Signature-256 header = "sha256=" + HMAC_SHA256(appSecret, rawBody).
export async function verifyWaSignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header || !header.startsWith("sha256=") || !appSecret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = "sha256=" + [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // length-safe constant-ish compare
  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
