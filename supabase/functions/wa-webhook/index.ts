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
import { sendWhatsApp, sendWhatsAppList, sendRender, verifyWaSignature, noteWaSend, waErrorReason } from "../_shared/whatsapp.ts";
import { assistantReply, getThread } from "../_shared/assistantCore.ts";
import { getSession, currentRender, handleAction, setSession, draftsOpening } from "../_shared/review.ts";

const digits = (s: string) => String(s || "").replace(/\D/g, "");
const ONBOARD = "היי, אני בונו. כדי שנתחבר — היכנס ל־buno.io וחבר את המספר שלך.";

// Persist an assistant outbound to the shared thread, recording whether the
// WhatsApp send actually succeeded — so a failed delivery is never swallowed and
// still surfaces in the web chat (with its buttons).
async function recordOutbound(admin: any, userId: string, text: string, extraMeta: any, sent: any) {
  try {
    const threadId = await getThread(admin, userId);
    if (!threadId) return;
    const meta: any = { ...(extraMeta || {}) };
    if (meta.actions && !meta.actions.length) delete meta.actions;
    if (sent && !sent.ok) { meta.waSendFailed = true; meta.waStatus = sent.status; }
    await admin.from("assistant_message").insert({ thread_id: threadId, role: "assistant", door: "whatsapp", content: text, meta: Object.keys(meta).length ? meta : null });
    const streak = await noteWaSend(admin, userId, sent);
    if (sent && !sent.ok) console.error("wa: SEND FAILED (review)", sent.status, waErrorReason(sent), "streak", streak);
  } catch { /* recording best-effort */ }
}

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
            if (id.startsWith("rv:")) { const r = await handleAction(admin, userId, id); const sent = await sendRender(from, r); await recordOutbound(admin, userId, r.text, { actions: r.actions }, sent); continue; }
            continue;
          }
          if (msg.type !== "text") { await sendWhatsApp(from, "כרגע אני קורא טקסט וכפתורים. כתוב לי מה תרצה 🙂"); continue; }
          const text = String(msg.text?.body || "").trim();
          if (!text) continue;

          // resume a paused guided review with a natural phrase
          const s = await getSession(admin, userId);
          if (s && /^(בוא נעבור|נמשיך|כן|יאללה|בוא)\b/.test(text)) { const r = currentRender(s); const sent = await sendRender(from, r); await recordOutbound(admin, userId, r.text, { actions: r.actions }, sent); continue; }

          const out = apiKey ? await assistantReply(admin, userId, text, apiKey, "whatsapp") : { reply: "מצטער, אני לא זמין כרגע.", created: [], threadId: await getThread(admin, userId) };

          // threshold (same as web): 3+ new drafts → a guided one-by-one walk with
          // real buttons; 1–2 stay a plain reply. Keeps both doors identical.
          if ((out.created?.length || 0) >= 3) {
            const queue = out.created.map((c: any) => ({ kind: "draft", cardId: c.id, title: c.title, project: c.project }));
            await setSession(admin, userId, queue as any, 0);
            const opening = draftsOpening(queue as any);
            const sent = await sendRender(from, opening);
            await recordOutbound(admin, userId, opening.text, { actions: opening.actions }, sent);
            continue;
          }

          const sent = await sendWhatsApp(from, out.reply);
          // persist the assistant reply WITH the send outcome — so a failed WhatsApp
          // delivery is never swallowed: it's logged, recorded, and still shows in web.
          if (out.threadId) {
            const meta: any = {};
            if (out.created?.length) meta.created = out.created;
            if (!sent.ok) { meta.waSendFailed = true; meta.waStatus = sent.status; }
            await admin.from("assistant_message").insert({ thread_id: out.threadId, role: "assistant", door: "whatsapp", content: out.reply, meta: Object.keys(meta).length ? meta : null });
          }
          const streak = await noteWaSend(admin, userId, sent);
          if (!sent.ok) console.error("wa: SEND FAILED", sent.status, waErrorReason(sent), "streak", streak);
        } catch (e) {
          console.error("wa: handler error", String((e as any)?.message || e));
          try { await sendWhatsApp(from, "נתקלתי בתקלה זמנית בצד שלי — כבר מטפלים בזה."); } catch { /* nothing more */ }
        }
      }
    }
  }

  return new Response("ok", { status: 200 });
});
