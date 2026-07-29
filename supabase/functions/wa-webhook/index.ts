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
import { sendWhatsApp, sendWhatsAppList, sendRender, verifyWaSignature } from "../_shared/whatsapp.ts";
import { assistantReply } from "../_shared/assistantCore.ts";
import { getSession, currentRender, handleAction } from "../_shared/review.ts";

const digits = (s: string) => String(s || "").replace(/\D/g, "");
const ONBOARD = "היי, אני בונו. כדי שנתחבר — היכנס ל־buno.io וחבר את המספר שלך.";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

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
  if (appSecret) {
    const ok = await verifyWaSignature(raw, req.headers.get("x-hub-signature-256"), appSecret);
    if (!ok) { console.warn("wa: signature mismatch"); return new Response("bad signature", { status: 401 }); }
  } else {
    console.warn("wa: WA_APP_SECRET not set — signature not enforced");
  }

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");

  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      if (value.statuses) continue; // delivery/read acks
      for (const msg of value.messages || []) {
        const from = digits(msg.from);
        try {
          const { data: links } = await admin.from("whatsapp_link").select("user_id,phone");
          const link = (links || []).find((l: any) => digits(l.phone) === from);
          if (!link) { await sendWhatsApp(from, ONBOARD); continue; }
          const userId = link.user_id;

          // real buttons: interactive button_reply / list_reply → review actions
          if (msg.type === "interactive") {
            const id = msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id || "";
            if (id === "rv:more") { const s = await getSession(admin, userId); if (s) { const r = currentRender(s); await sendWhatsAppList(from, r.text, "בחר פעולה", r.actions.filter((a) => !a.url).map((a) => ({ id: a.id, title: a.label }))); } continue; }
            if (id.startsWith("rv:")) { await sendRender(from, await handleAction(admin, userId, id)); continue; }
            continue;
          }
          if (msg.type !== "text") { await sendWhatsApp(from, "כרגע אני קורא טקסט וכפתורים. כתוב לי מה תרצה 🙂"); continue; }
          const text = String(msg.text?.body || "").trim();
          if (!text) continue;

          // resume a paused guided review with a natural phrase
          const s = await getSession(admin, userId);
          if (s && /^(בוא נעבור|נמשיך|כן|יאללה|בוא)\b/.test(text)) { await sendRender(from, currentRender(s)); continue; }

          const reply = apiKey ? await assistantReply(admin, userId, text, apiKey, "whatsapp") : "מצטער, אני לא זמין כרגע.";
          const sent = await sendWhatsApp(from, reply);
          if (!sent.ok) console.error("wa: send failed", sent.status, sent.body.slice(0, 300));
        } catch (e) {
          console.error("wa: handler error", String((e as any)?.message || e));
          try { await sendWhatsApp(from, "נתקלתי בתקלה זמנית בצד שלי — כבר מטפלים בזה."); } catch { /* nothing more */ }
        }
      }
    }
  }

  return new Response("ok", { status: 200 });
});
