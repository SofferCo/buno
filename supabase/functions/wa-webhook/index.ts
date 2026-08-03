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
import { sendWhatsApp, sendWhatsAppList, sendRender, verifyWaSignature, noteWaSend, waErrorReason, sendReaction, fetchWaMedia } from "../_shared/whatsapp.ts";
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

const FALLBACK = "מצטער, לא הצלחתי להשיב כרגע.";

// Hard idempotency (layer 1): claim a wamid before ANY work. First sighting inserts
// and returns true (process); a Meta retry hits the PK and returns false (skip with
// zero processing → no duplicate reply). Fail-open if wa_seen isn't there yet
// (pre-0020) so nothing breaks before the migration lands.
async function claimMessage(admin: any, wamid: string): Promise<boolean> {
  if (!wamid) return true;
  try {
    const { error } = await admin.from("wa_seen").insert({ message_id: wamid });
    if (!error) return true;
    if (String((error as any).code) === "23505" || /duplicate key/i.test((error as any).message || "")) { console.log("wa: DEDUP drop (Meta retry) wamid", wamid); return false; }
    return true; // table missing / other error → fail-open
  } catch { return true; }
}

// item 3 — processing-failure health (parallel to send-failure health in 0016).
async function noteProc(admin: any, userId: string, ok: boolean, err?: string): Promise<number> {
  try {
    if (ok) { await admin.from("whatsapp_link").update({ proc_fail_streak: 0 }).eq("user_id", userId); return 0; }
    const { data } = await admin.from("whatsapp_link").select("proc_fail_streak").eq("user_id", userId).maybeSingle();
    const streak = (Number(data?.proc_fail_streak) || 0) + 1;
    await admin.from("whatsapp_link").update({ proc_fail_streak: streak, proc_last_error: String(err || "").slice(0, 300), proc_last_at: new Date().toISOString() }).eq("user_id", userId);
    return streak;
  } catch { return 0; }
}
// item 2 — the previous assistant reply, to refuse an identical repeat.
async function lastAssistantText(admin: any, userId: string): Promise<string> {
  try {
    const threadId = await getThread(admin, userId); if (!threadId) return "";
    const { data } = await admin.from("assistant_message").select("content").eq("thread_id", threadId).eq("role", "assistant").order("created_at", { ascending: false }).limit(1).maybeSingle();
    return String(data?.content || "").trim();
  } catch { return ""; }
}
// item 8 — media: one honest, varied acknowledgment per type per conversation.
function mediaAckLine(type: string): string {
  const m: Record<string, string> = {
    image: "קיבלתי תמונה — עדיין לא יודע לקרוא תמונות, זה בדרך 🙂",
    audio: "קיבלתי הקלטה קולית — עדיין לא מתמלל אותן, בקרוב 🙂",
    voice: "קיבלתי הקלטה קולית — עדיין לא מתמלל אותן, בקרוב 🙂",
    video: "קיבלתי וידאו — עדיין לא צופה בהם, בקרוב 🙂",
    document: "קיבלתי קובץ — עדיין לא קורא מסמכים, בקרוב 🙂",
  };
  return m[type] || "קיבלתי — עדיין לא יודע לעבד את זה, בקרוב 🙂";
}
// item 8 phase B — transcribe a WhatsApp voice note to Hebrew text (Whisper).
// Needs a transcription key (OPENAI_API_KEY); absent/failed → null → graceful phase A.
async function transcribeVoice(mediaId: string): Promise<string | null> {
  const key = Deno.env.get("OPENAI_API_KEY"); if (!key) return null;
  const media = await fetchWaMedia(mediaId); if (!media) return null;
  try {
    const form = new FormData();
    form.append("file", new Blob([media.bytes], { type: media.mime || "audio/ogg" }), "voice.ogg");
    form.append("model", "whisper-1");
    form.append("language", "he");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
    if (!res.ok) { console.error("transcribe failed", res.status, (await res.text()).slice(0, 200)); return null; }
    const j = await res.json(); const t = String(j?.text || "").trim();
    return t || null;
  } catch (e) { console.error("transcribe error", String((e as any)?.message || e)); return null; }
}
// Part 1 — image/document understanding. Same shape as voice: download the media,
// read it with Claude (native image/document base64 blocks via the EXISTING
// ANTHROPIC_API_KEY — audio isn't accepted by the Messages API, images & PDFs are),
// and hand the extracted text into the normal assistant turn (tools, drafts, gender).
const IMG_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
function toBase64(bytes: Uint8Array): string {
  let bin = ""; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}
async function describeMedia(kind: "image" | "document", media: { bytes: Uint8Array; mime: string }, caption: string, apiKey: string): Promise<string | null> {
  try {
    const b64 = toBase64(media.bytes);
    const block = kind === "image"
      ? { type: "image", source: { type: "base64", media_type: IMG_MIMES.has(media.mime) ? media.mime : "image/jpeg", data: b64 } }
      : { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } };
    const instruction = `אתה בונו, קורא מדיה ששלח משתמש בוואטסאפ${caption ? ` עם ההודעה: "${caption}"` : " בלי טקסט מצורף"}. תמצת בעברית בקצרה ועניינית מה יש כאן. אם יש פריטי פעולה, משימות, מועדים או פרטים שאפשר להפוך לכרטיסים — פרט אותם כרשימה קצרה. אל תמציא פרטים שאינם במדיה; אם משהו לא ברור, ציין זאת.`;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-opus-5", max_tokens: 2048, output_config: { effort: "low" }, messages: [{ role: "user", content: [block, { type: "text", text: instruction }] }] }),
    });
    if (!res.ok) { console.error("describeMedia failed", res.status, (await res.text()).slice(0, 200)); return null; }
    const j = await res.json();
    const t = (j?.content || []).filter((b: any) => b?.type === "text").map((b: any) => String(b.text || "")).join("\n").trim();
    return t || null;
  } catch (e) { console.error("describeMedia error", String((e as any)?.message || e)); return null; }
}
async function ackedMediaBefore(admin: any, userId: string, type: string): Promise<boolean> {
  try {
    const threadId = await getThread(admin, userId); if (!threadId) return false;
    const { data } = await admin.from("assistant_message").select("meta").eq("thread_id", threadId).eq("door", "whatsapp").order("created_at", { ascending: false }).limit(30);
    return (data || []).some((r: any) => r?.meta?.mediaAck === type);
  } catch { return false; }
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

  // Layer 2 — FAST ACK: return 200 in <1s and run the (slow) media/LLM processing
  // in the background, so Meta never times out and retries. waitUntil keeps the
  // isolate alive to finish the work after the response is sent.
  const work = processInbound(admin, payload, apiKey);
  const wu = (globalThis as any).EdgeRuntime?.waitUntil;
  if (typeof wu === "function") wu.call((globalThis as any).EdgeRuntime, work);
  else await work; // fallback for a runtime without waitUntil
  return new Response("ok", { status: 200 });
});

async function processInbound(admin: any, payload: any, apiKey: string | undefined) {
 try {
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      if (value.statuses) continue; // delivery/read acks
      for (const msg of value.messages || []) {
        const from = digits(msg.from);
        try {
          // layer 1 — claim the wamid before any processing; a retry is dropped here.
          if (!(await claimMessage(admin, msg.id))) continue;
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
          // item 8 — media. Voice notes are transcribed (phase B) and enter the
          // pipeline as if typed; other media get a typed, honest ack once per type.
          let voiceText = "";
          if (msg.type !== "text") {
            const type = String(msg.type || "");
            if ((type === "audio" || type === "voice") && msg.audio?.id) {
              const t = await transcribeVoice(msg.audio.id);
              if (t) voiceText = `(הודעה קולית): ${t}`;
              else { const line = "קיבלתי הקלטה — לא הצלחתי להבין אותה, אפשר בטקסט? 🙂"; const sent = await sendWhatsApp(from, line); await recordOutbound(admin, userId, line, {}, sent); continue; }
            } else if ((type === "image" || type === "document") && apiKey) {
              // Part 1 — read the media with Claude, then enter the SAME text pipeline
              // (reactions, assistant tools, draft walk) as a voice note does.
              const mid = type === "image" ? msg.image?.id : msg.document?.id;
              const mime = String((type === "image" ? msg.image?.mime_type : msg.document?.mime_type) || "");
              const caption = String((type === "image" ? msg.image?.caption : msg.document?.caption) || "").trim();
              const kindWord = type === "image" ? "תמונה" : "מסמך";
              // Claude's document block reads PDF (and text); other doc types → honest ack.
              if (type === "document" && mime && mime !== "application/pdf") {
                const line = "קיבלתי קובץ מסוג שאני עדיין לא קורא ישירות — תרצה לספר לי בקצרה מה יש בו, או לשלוח PDF/תמונה?";
                const sent = await sendWhatsApp(from, line); await recordOutbound(admin, userId, line, { media: type }, sent); continue;
              }
              const media = mid ? await fetchWaMedia(mid) : null;
              const tooBig = !!media && ((type === "image" && media.bytes.length > 5_000_000) || (type === "document" && media.bytes.length > 15_000_000));
              if (!media || tooBig) {
                const line = tooBig ? `ה${kindWord} גדול/ה מדי לניתוח כאן — תרצה לתמצת לי במילים מה חשוב בו?` : `קיבלתי ${kindWord} אבל לא הצלחתי להוריד אותו — תנסה לשלוח שוב, או לספר לי בקצרה?`;
                const sent = await sendWhatsApp(from, line); await recordOutbound(admin, userId, line, { media: type }, sent); continue;
              }
              const extracted = await describeMedia(type, media, caption, apiKey);
              if (!extracted) {
                const line = `קראתי את ה${kindWord} אבל לא הצלחתי להוציא ממנו משהו ברור — תרצה לספר לי בקצרה מה חשוב בו?`;
                const sent = await sendWhatsApp(from, line); await recordOutbound(admin, userId, line, { media: type }, sent); continue;
              }
              voiceText = caption
                ? `(${kindWord}) ${caption}\n\n[תוכן ה${kindWord} שקראתי: ${extracted}]`
                : `(${kindWord} ללא טקסט) [תוכן ה${kindWord} שקראתי: ${extracted}]\n\n[הנחיה פנימית: תאר בקצרה מה קיבלת ושאל אם לפתוח מזה משימות; אל תפתח טיוטות לפני אישור.]`;
              // fall through to the shared text pipeline below.
            } else {
              const acked = await ackedMediaBefore(admin, userId, type);
              if (type === "sticker") { const line = acked ? "🙂" : "😄"; const sent = await sendWhatsApp(from, line); await recordOutbound(admin, userId, line, { mediaAck: type }, sent); }
              else if (!acked) { const line = mediaAckLine(type); const sent = await sendWhatsApp(from, line); await recordOutbound(admin, userId, line, { mediaAck: type }, sent); }
              continue;
            }
          }
          const text = voiceText || String(msg.text?.body || "").trim();
          if (!text) continue;

          // status reaction (Cloud API): 👀 on receipt for anything that needs work,
          // 👍 on success, removed on failure. Small-talk / lone emoji get no reaction,
          // and a reaction never replaces the verbal reply (guaranteed response holds).
          const bare = text.replace(/^\(הודעה קולית\):?\s*/, "");
          const trivial = /^[\p{Extended_Pictographic}\s\p{P}]+$/u.test(bare) || /^(בוקר טוב|בוקר אור|תודה|תודה רבה|היי|הי|שלום|אחלה|סבבה|ok|okay|אוקיי)\W*$/i.test(bare);
          const msgId = msg.id;
          const react = !trivial && !!msgId;
          if (react) { try { await sendReaction(from, msgId, "👀"); } catch { /* reaction best-effort */ } }

          // resume a paused guided review with a natural phrase
          const s = await getSession(admin, userId);
          if (s && /^(בוא נעבור|נמשיך|כן|יאללה|בוא)\b/.test(text)) { const r = currentRender(s); const sent = await sendRender(from, r); await recordOutbound(admin, userId, r.text, { actions: r.actions }, sent); if (react) await sendReaction(from, msgId, "👍"); continue; }

          const out = apiKey ? await assistantReply(admin, userId, text, apiKey, "whatsapp") : { reply: FALLBACK, created: [], threadId: await getThread(admin, userId) };

          // item 3 — a processing failure (empty / canned fallback) is never silent:
          // one honest message; a 2nd consecutive failure alerts Tal (logged + health).
          if (!out.reply || !out.reply.trim() || out.reply.trim() === FALLBACK) {
            const streak = await noteProc(admin, userId, false, "empty/fallback reply");
            const line = streak >= 2 ? "משהו תקוע אצלי כרגע — טל מקבל התראה, ואחזור אליך." : "לא הצלחתי לענות כרגע — נסה שוב בעוד רגע.";
            const sent = await sendWhatsApp(from, line);
            await recordOutbound(admin, userId, line, streak >= 2 ? { procAlert: true } : {}, sent);
            if (react) { try { await sendReaction(from, msgId, ""); } catch { /* remove best-effort */ } }
            if (streak >= 2) console.error("wa: PROC FAIL ALERT — user", userId, "streak", streak);
            continue;
          }

          // item 2 — loop breaker: never send a reply identical to the previous one.
          // A broken loop is a degraded (fallback) turn, not a real answer → the 👍
          // is withheld and the receipt reaction removed below.
          const prev = await lastAssistantText(admin, userId);
          const loopBroke = !!(prev && prev === out.reply.trim());
          if (loopBroke) out.reply = "לא עניתי טוב קודם — תנסח לי בדיוק מה חסר ואחזור עם תשובה מדויקת.";

          // WhatsApp has no inline chips — so EVERY draft created here must be
          // approvable from the channel. Any 1+ drafts open a guided walk with real
          // [אשר]/[דחה] buttons (web keeps 1–2 as chips, 3+ as a walk).
          if ((out.created?.length || 0) >= 1) {
            const n = out.created.length;
            const queue = out.created.map((c: any) => ({ kind: "draft", cardId: c.id, title: c.title, project: c.project }));
            await setSession(admin, userId, queue as any, 0);
            const first = currentRender({ queue: queue as any, cursor: 0 });
            const preamble = n >= 3 ? `קלטתי ${n} דברים — נעבור אחד־אחד:` : n === 2 ? "פתחתי 2 טיוטות — נאשר אחת־אחת:" : "פתחתי טיוטה — לאשר?";
            const opening = { text: `${preamble}\n${first.text}`, actions: first.actions };
            const sent = await sendRender(from, opening);
            await recordOutbound(admin, userId, opening.text, { actions: opening.actions }, sent);
            await noteProc(admin, userId, true);
            if (react) await sendReaction(from, msgId, "👍");
            continue;
          }

          const sent = await sendWhatsApp(from, out.reply);
          if (out.threadId) {
            const meta: any = {};
            if (out.created?.length) meta.created = out.created;
            if (voiceText) meta.voice = true;
            if (!sent.ok) { meta.waSendFailed = true; meta.waStatus = sent.status; }
            await admin.from("assistant_message").insert({ thread_id: out.threadId, role: "assistant", door: "whatsapp", content: out.reply, meta: Object.keys(meta).length ? meta : null });
          }
          const streak = await noteWaSend(admin, userId, sent);
          await noteProc(admin, userId, true); // a real reply went out → reset processing health
          // 👍 only on genuine, successfully-sent processing; a fallback/loop-broken
          // turn or a failed send removes the receipt reaction instead of confirming.
          if (react) await sendReaction(from, msgId, (sent.ok && !loopBroke) ? "👍" : "");
          if (!sent.ok) console.error("wa: SEND FAILED", sent.status, waErrorReason(sent), "streak", streak);
        } catch (e) {
          console.error("wa: handler error", String((e as any)?.message || e));
          try { await sendReaction(from, msg.id, ""); } catch { /* remove reaction best-effort */ }
          try { await sendWhatsApp(from, "נתקלתי בתקלה זמנית בצד שלי — כבר מטפלים בזה."); } catch { /* nothing more */ }
        }
      }
    }
  }
 } catch (e) { console.error("wa: processInbound error", String((e as any)?.message || e)); }
}
