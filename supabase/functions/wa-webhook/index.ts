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

const DEBUG_UID = "bbb70540-4804-418d-a033-01056fb9b382"; // Step-A: stamp target for the inbound peek

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // ---- GET: webhook verification handshake --------------------------------
  if (req.method === "GET") {
    // Step-A debug: ?peek=<verify_token> returns the last inbound POST stamp
    if (url.searchParams.get("peek") && url.searchParams.get("peek") === Deno.env.get("WA_VERIFY_TOKEN")) {
      const { data } = await admin.from("integration").select("external_id,connected_at").eq("kind", "whatsapp").order("connected_at", { ascending: false }).limit(1).maybeSingle();
      return new Response(JSON.stringify(data || { none: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
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
  // Step-A debug stamp (before signature) so ANY delivery from Meta is recorded
  try { await admin.from("integration").upsert({ user_id: DEBUG_UID, kind: "whatsapp", status: "connected", external_id: `in ${new Date().toISOString()} sig=${!!sigHeader} len=${raw.length}`, connected_at: new Date().toISOString() }, { onConflict: "user_id,kind" }); } catch (_e) { /* best-effort */ }
  if (appSecret) {
    const ok = await verifyWaSignature(raw, sigHeader, appSecret);
    if (!ok) { console.warn("wa: SIGNATURE MISMATCH — check WA_APP_SECRET matches Meta App Secret"); return new Response("bad signature", { status: 401 }); }
  } else {
    console.warn("wa: WA_APP_SECRET not set — skipping signature check (Step A only; set it!)");
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
          if (msg.type !== "text") { await sendWhatsApp(from, "כרגע אני קורא רק הודעות טקסט. כתוב לי מה תרצה 🙂"); continue; }
          const text = String(msg.text?.body || "").trim();
          if (!text) continue;

          const { data: links } = await admin.from("whatsapp_link").select("user_id,phone");
          const link = (links || []).find((l: any) => digits(l.phone) === from);
          if (!link) { await sendWhatsApp(from, ONBOARD); continue; }

          const reply = apiKey ? await assistantReply(admin, link.user_id, text, apiKey, "whatsapp") : "מצטער, אני לא זמין כרגע.";
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
