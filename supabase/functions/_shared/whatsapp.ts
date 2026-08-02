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

// Human-readable reason for a failed send — the Graph error code + message
// (e.g. "code 190: Error validating access token: expired").
export function waErrorReason(sent: { ok: boolean; status: number; body: string }): string | null {
  if (sent?.ok) return null;
  try { const e = JSON.parse(sent.body || "{}")?.error; if (e) return `code ${e.code}: ${e.message}`; } catch { /* not json */ }
  return `HTTP ${sent?.status}`;
}

// Record send health on whatsapp_link: reset the streak on success, increment +
// store the reason on failure. Returns the current consecutive-failure streak.
export async function noteWaSend(admin: any, userId: string, sent: { ok: boolean; status: number; body: string }): Promise<number> {
  try {
    if (sent?.ok) { await admin.from("whatsapp_link").update({ wa_fail_streak: 0, wa_last_error: null, wa_last_at: new Date().toISOString() }).eq("user_id", userId); return 0; }
    const { data } = await admin.from("whatsapp_link").select("wa_fail_streak").eq("user_id", userId).maybeSingle();
    const streak = (Number(data?.wa_fail_streak) || 0) + 1;
    await admin.from("whatsapp_link").update({ wa_fail_streak: streak, wa_last_error: waErrorReason(sent), wa_last_at: new Date().toISOString() }).eq("user_id", userId);
    return streak;
  } catch { return 0; }
}

async function post(payload: any): Promise<{ ok: boolean; status: number; body: string }> {
  const token = Deno.env.get("WA_ACCESS_TOKEN");
  if (!token) return { ok: false, status: 500, body: "WA_ACCESS_TOKEN missing" };
  const res = await fetch(`${GRAPH}/${WA_PHONE_NUMBER_ID}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

// item 13 — WhatsApp interactive bodies don't render markdown, and stray bullets /
// dashes look broken. Strip asterisks, normalize "• "/"–" bullets, collapse blanks.
function cleanInteractive(s: string): string {
  return String(s || "")
    .replace(/\*\*?/g, "")
    .replace(/^[\s]*[•\-–—]\s?/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
// interactive reply buttons (up to 3, title ≤20 chars)
export async function sendWhatsAppButtons(to: string, body: string, buttons: { id: string; title: string }[]) {
  return post({
    messaging_product: "whatsapp", to: String(to).replace(/\D/g, ""), type: "interactive",
    interactive: { type: "button", body: { text: cleanInteractive(body).slice(0, 1024) }, action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id.slice(0, 256), title: cleanInteractive(b.title).slice(0, 20) } })) } },
  });
}

// interactive list (for 4+ options)
export async function sendWhatsAppList(to: string, body: string, buttonLabel: string, rows: { id: string; title: string; description?: string }[]) {
  return post({
    messaging_product: "whatsapp", to: String(to).replace(/\D/g, ""), type: "interactive",
    interactive: { type: "list", body: { text: cleanInteractive(body).slice(0, 1024) }, action: { button: buttonLabel.slice(0, 20), sections: [{ title: "פעולות", rows: rows.slice(0, 10).map((r) => ({ id: r.id.slice(0, 200), title: cleanInteractive(r.title).slice(0, 24), description: cleanInteractive(r.description || "").slice(0, 72) })) }] } },
  });
}

// Send a channel-agnostic Render over WhatsApp: url actions become text links;
// reply actions become buttons (≤3), or 2 buttons + "עוד…" that opens a list.
export async function sendRender(to: string, render: { text: string; actions: { id: string; label: string; url?: string }[] }, expandList = false) {
  const urls = render.actions.filter((a) => a.url);
  const btns = render.actions.filter((a) => !a.url);
  let body = render.text;
  for (const u of urls) body += `\n${u.label}: ${u.url}`;
  if (!btns.length) return sendWhatsApp(to, body);
  if (expandList || btns.length > 3) {
    if (!expandList && btns.length > 3) {
      // 2 primary + "עוד…" (opens the full list on tap)
      return sendWhatsAppButtons(to, body, [...btns.slice(0, 2).map((b) => ({ id: b.id, title: b.label })), { id: "rv:more", title: "עוד…" }]);
    }
    return sendWhatsAppList(to, body, "בחר פעולה", btns.map((b) => ({ id: b.id, title: b.label })));
  }
  return sendWhatsAppButtons(to, body, btns.map((b) => ({ id: b.id, title: b.label })));
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
