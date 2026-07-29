// buno — /wa-webhook: the WhatsApp door (Stage 5 / Step A).
// GET  = Meta webhook verification (hub.mode / hub.verify_token / hub.challenge).
// POST = inbound messages + statuses. verify_jwt is OFF (Meta can't send a
// Supabase JWT); authenticity is proven by the X-Hub-Signature-256 HMAC over the
// raw body, using the Meta App Secret (WA_APP_SECRET).
//
// Flow: inbound text → resolve the user by phone (whatsapp_link) → run the SAME
// buno conversation (shared thread, door='whatsapp') → reply via sendWhatsApp.
// Unknown number → one short onboarding line.
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendWhatsApp, verifyWaSignature } from "../_shared/whatsapp.ts";
import { assistantReply } from "../_shared/assistantCore.ts";

const digits = (s: string) => String(s || "").replace(/\D/g, "");
const ONBOARD = "היי, אני בונו. כדי שנתחבר — היכנס ל־buno.io וחבר את המספר שלך.";

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // ---- GET: webhook verification handshake --------------------------------
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token && token === Deno.env.get("WA_VERIFY_TOKEN")) {
      return new Response(challenge || "", { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  // ---- POST: verify signature over the RAW body ---------------------------
  const raw = await req.text();
  const appSecret = Deno.env.get("WA_APP_SECRET") || "";
  const sigHeader = req.headers.get("x-hub-signature-256");
  console.log("wa: POST received, bytes=", raw.length, "hasSecret=", !!appSecret, "hasSig=", !!sigHeader);
  if (appSecret) {
    const ok = await verifyWaSignature(raw, sigHeader, appSecret);
    if (!ok) { console.warn("wa: SIGNATURE MISMATCH — check WA_APP_SECRET matches Meta App Secret"); return new Response("bad signature", { status: 401 }); }
  } else {
    console.warn("wa: WA_APP_SECRET not set — skipping signature check (Step A only; set it!)");
  }

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      if (value.statuses) { console.log("wa: status update, ignoring"); continue; }
      for (const msg of value.messages || []) {
        const from = digits(msg.from);
        try {
          if (msg.type !== "text") { console.log("wa: non-text", msg.type); await sendWhatsApp(from, "כרגע אני קורא רק הודעות טקסט. כתוב לי מה תרצה 🙂"); continue; }
          const text = String(msg.text?.body || "").trim();
          console.log("wa: text from", from, "len", text.length);
          if (!text) continue;

          const { data: links, error: linkErr } = await admin.from("whatsapp_link").select("user_id,phone");
          if (linkErr) console.error("wa: whatsapp_link query error", linkErr.message);
          const link = (links || []).find((l: any) => digits(l.phone) === from);
          console.log("wa: link match", !!link, "known phones", (links || []).map((l: any) => digits(l.phone)));
          if (!link) { const r = await sendWhatsApp(from, ONBOARD); console.log("wa: onboarding sent", r.status, r.body.slice(0, 200)); continue; }

          const reply = apiKey ? await assistantReply(admin, link.user_id, text, apiKey, "whatsapp") : "מצטער, אני לא זמין כרגע.";
          console.log("wa: reply ready, len", reply.length);
          const sent = await sendWhatsApp(from, reply);
          console.log("wa: sendWhatsApp", sent.status, sent.ok, sent.body.slice(0, 300));
          if (!sent.ok) { console.error("wa: SEND FAILED — likely WA_ACCESS_TOKEN expired or recipient not allow-listed"); }
        } catch (e) {
          console.error("wa: handler error", String((e as any)?.message || e));
          try { await sendWhatsApp(from, "נתקלתי בתקלה זמנית בצד שלי — כבר מטפלים בזה."); } catch { /* nothing more to do */ }
        }
      }
    }
  }

  return new Response("ok", { status: 200 });
});
