// buno — the assistant conversation core, runnable SERVER-SIDE (service role)
// for a given userId. Used by the WhatsApp door (wa-webhook). It shares the
// SAME thread + memory as the web chat AND the SAME tools + permission model:
// create_card (draft-gated by assistant_settings.cards) and move/complete/archive
// on explicit request. One twin — WhatsApp buno does what web buno does.
//
// (The web /chat function still has its own copy of this tool loop under the
// user's JWT/RLS; this admin-scoped copy mirrors it. Unifying both is a planned
// follow-up.)
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.68.0";
import { systemPrompt } from "./voice.ts";
import { summarizeBoard } from "./boardContext.ts";
import { CORE_TOOLS, matchCard } from "./tools.ts";
import { ensureOrgBoard } from "./orgboard.ts";
import { freshAccessToken, listCalendarEvents } from "./google.ts";

// Tool DEFINITIONS come from _shared/tools.ts (CORE_TOOLS) — one contract with the web chat.

// board perception now comes from the shared summarizeBoard (_shared/boardContext.ts)
// — same brain as the web /chat. Comments/attachments are fetched below for parity.

// Get (or create) the user's shared thread — exported so callers can persist the
// assistant message themselves (with the real send outcome).
export async function getThread(admin: SupabaseClient, userId: string): Promise<string | undefined> {
  const { data: t } = await admin.from("assistant_thread").select("id").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (t?.id) return t.id;
  const { data: nt } = await admin.from("assistant_thread").insert({ user_id: userId }).select("id").single();
  return nt?.id;
}

export async function assistantReply(admin: SupabaseClient, userId: string, userMessage: string, apiKey: string, door = "whatsapp"): Promise<{ reply: string; created: any[]; threadId?: string }> {
  // board context + settings, admin-scoped to the user's own projects (no RLS)
  const { data: mem } = await admin.from("project_member").select("project_id,role").eq("user_id", userId);
  const writeIds = (mem || []).filter((m: any) => m.role !== "viewer").map((m: any) => m.project_id);
  const ids = (mem || []).map((m: any) => m.project_id);
  const [{ data: projRows }, { data: cardRows }, { data: colRows }, { data: prof }, { data: asst }] = await Promise.all([
    ids.length ? admin.from("project").select("*").in("id", ids) : Promise.resolve({ data: [] as any[] }),   // '*' tolerates pre-migration schema
    ids.length ? admin.from("card").select("*").in("project_id", ids) : Promise.resolve({ data: [] as any[] }),
    ids.length ? admin.from("board_column").select("id,project_id,key,title,position,is_done").in("project_id", ids) : Promise.resolve({ data: [] as any[] }),
    admin.from("profile").select("name").eq("id", userId).maybeSingle(),
    admin.from("assistant_settings").select("cards,gender").eq("user_id", userId).maybeSingle(),
  ]);
  const projects = (projRows || []).filter((p: any) => writeIds.includes(p.id) || !writeIds.length);
  const cards = cardRows || [];
  const cols = colRows || [];
  // comments + attachments → same depth of board perception as the web chat (one brain).
  const cardIds = cards.map((c: any) => c.id);
  const [{ data: commRows }, { data: attRows }] = cardIds.length
    ? await Promise.all([
        admin.from("comment").select("card_id,by_name,text,created_at").in("card_id", cardIds).order("created_at"),
        admin.from("attachment").select("card_id,type,name").in("card_id", cardIds),
      ])
    : [{ data: [] as any[] }, { data: [] as any[] }];
  const commentsByCard = new Map<string, any[]>();
  for (const r of (commRows || [])) { const a = commentsByCard.get(r.card_id) || []; a.push(r); commentsByCard.set(r.card_id, a); }
  const attachByCard = new Map<string, any[]>();
  for (const r of (attRows || [])) { const a = attachByCard.get(r.card_id) || []; a.push(r); attachByCard.set(r.card_id, a); }
  const cardLevel = (asst?.cards || "draft") as "suggest" | "draft" | "act";
  // item 11 — persisted gender; auto-switch (silently) to feminine if the user
  // addresses buno in feminine, and remember it across sessions/channels.
  let gender: "m" | "f" = asst?.gender === "f" ? "f" : "m";
  if (gender !== "f" && /תעשי|תגידי|תבדקי|תפתחי|תסדרי|תכתבי|תשלחי|תוסיפי|את יכולה|עשית לי|ראית/.test(userMessage)) {
    gender = "f"; try { await admin.from("assistant_settings").upsert({ user_id: userId, gender: "f" }, { onConflict: "user_id" }); } catch { /* best-effort */ }
  }

  // ---- tools (same behavior + enforcement as web chat) ----------------------
  const created: any[] = [];
  const changed: string[] = [];
  const doneColIds = new Set(cols.filter((c: any) => c.is_done).map((c: any) => c.id));
  const findCard = (q: string) => matchCard(cards.filter((c: any) => !c.archived && !doneColIds.has(c.column_id)), q);
  async function doCreateCard(input: any): Promise<string> {
    const title = String(input?.title || "").trim(); if (!title) return "לא נוצר: חסרה כותרת.";
    const project = projects.find((p: any) => input?.project && p.name && p.name.toLowerCase().includes(String(input.project).toLowerCase())) || projects[0];
    if (!project) return "לא נוצר: אין פרויקט זמין.";
    const projCols = cols.filter((c: any) => c.project_id === project.id);
    const brief = projCols.find((c: any) => c.key === "col-brief") || projCols.slice().sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))[0];
    const maxPos = cards.filter((c: any) => c.project_id === project.id && c.column_id === brief?.id && !c.archived).length;
    const draft = cardLevel === "act" ? null : { by: "buno", at: Date.now(), level: cardLevel };
    // brief-giver = a real person (a contact), never buno.
    const bf = String(input?.brief_from || "").trim();
    const giver = bf && !/^(buno|בונו|העוזר)$/i.test(bf) ? bf : "";
    const { data, error } = await admin.from("card").insert({
      project_id: project.id, column_id: brief?.id || null, position: maxPos, title, creator: giver || "buno",
      description: String(input?.description || ""), deadline: /^\d{4}-\d{2}-\d{2}$/.test(input?.deadline || "") ? input.deadline : null,
      priority: ["regular", "important", "critical"].includes(input?.priority) ? input.priority : "regular",
      origin: { type: "whatsapp", ref: "wa-" + crypto.randomUUID() }, draft,
    }).select("id,title,project_id,column_id,archived").single();
    if (error) return "לא נוצר (שגיאה): " + error.message;
    if (giver) { try { await admin.from("contacts").upsert({ user_id: userId, name: giver, source: "mentioned", created_from: data.id }, { onConflict: "user_id,name" }); } catch { /* pre-0022 */ } }
    cards.push(data); created.push({ id: data.id, title: data.title, project: project.name, level: cardLevel });
    return cardLevel === "act" ? `נוצר כרטיס "${title}" ב${project.name}.` : `נוצרה טיוטה "${title}" ב${project.name}, ממתינה לאישורך.`;
  }
  async function doCreateCards(input: any): Promise<string> {
    const list = Array.isArray(input?.cards) ? input.cards.slice(0, 40) : [];
    if (!list.length) return "לא צוינו משימות.";
    const before = created.length; let failed = 0;
    for (const item of list) { const out = await doCreateCard({ ...item, project: item?.project || input?.project }); if (out.startsWith("לא נוצר")) failed++; }
    const n = created.length - before; const projName = created[created.length - 1]?.project || "";
    return `${cardLevel === "act" ? `נוצרו ${n} כרטיסים` : `נוצרו ${n} טיוטות`}${projName ? ` ב${projName}` : ""}${failed ? ` (${failed} נכשלו)` : ""}.`;
  }
  async function doCreateProject(input: any): Promise<string> {
    const name = String(input?.name || "").trim(); if (!name) return "לא נוצר: חסר שם.";
    try {
      const usedColors = new Set<string>((projects as any[]).map((p: any) => p.color).filter(Boolean));
      const proj = await ensureOrgBoard(admin, userId, name, "", projects as any[], usedColors);
      if (!proj) return "לא הצלחתי לפתוח בורד.";
      const { data: newCols } = await admin.from("board_column").select("id,project_id,key,title,position,is_done").eq("project_id", proj.id);
      for (const c of newCols || []) (cols as any[]).push(c);
      return `פתחתי בורד "${proj.name}".`;
    } catch (e) { return "לא הצלחתי לפתוח בורד: " + String((e as any)?.message || e); }
  }
  async function moveTo(card: any, col: any): Promise<boolean> {
    const { error } = await admin.from("card").update({ column_id: col.id, active_column_key: col.key }).eq("id", card.id);
    if (error) return false; card.column_id = col.id; changed.push(card.id); return true;
  }
  async function doMoveCard(input: any): Promise<string> {
    const card = findCard(input?.card); if (!card) return `לא מצאתי כרטיס פעיל בשם "${input?.card}".`;
    const projCols = cols.filter((c: any) => c.project_id === card.project_id);
    const q = String(input?.column || "").toLowerCase().trim();
    const target = projCols.find((c: any) => (c.title || "").toLowerCase() === q) || projCols.find((c: any) => (c.title || "").toLowerCase().includes(q)) || projCols.find((c: any) => c.key === q);
    if (!target) return `לא מצאתי עמודה "${input?.column}".`;
    return (await moveTo(card, target)) ? `הזזתי את "${card.title}" ל"${target.title}".` : "לא הצלחתי להזיז.";
  }
  async function doCompleteCard(input: any): Promise<string> {
    const card = findCard(input?.card); if (!card) return `לא מצאתי כרטיס פעיל בשם "${input?.card}".`;
    const projCols = cols.filter((c: any) => c.project_id === card.project_id);
    const done = projCols.find((c: any) => c.key === "col-done") || projCols.find((c: any) => c.is_done);
    if (!done) return "לא מצאתי עמודת 'הושלם'."; return (await moveTo(card, done)) ? `סימנתי את "${card.title}" כבוצע.` : "לא הצלחתי לסמן.";
  }
  async function doArchiveCard(input: any): Promise<string> {
    const card = findCard(input?.card); if (!card) return `לא מצאתי כרטיס פעיל בשם "${input?.card}".`;
    const { error } = await admin.from("card").update({ archived: true, archived_at: new Date().toISOString() }).eq("id", card.id);
    if (error) return "לא הצלחתי לארכב."; card.archived = true; changed.push(card.id);
    return `ארכבתי את "${card.title}".`;
  }
  // item 6 — edit existing card(s): deadline/priority/title/description/board, single or bulk.
  async function doUpdateCard(input: any): Promise<string> {
    const patch: any = {};
    if (typeof input?.deadline === "string") {
      const d = input.deadline.trim().toLowerCase();
      if (d === "clear" || d === "") patch.deadline = null;
      else if (/^\d{4}-\d{2}-\d{2}$/.test(input.deadline.trim())) patch.deadline = input.deadline.trim();
    }
    if (["regular", "important", "critical"].includes(input?.priority)) patch.priority = input.priority;
    if (typeof input?.title === "string" && input.title.trim()) patch.title = input.title.trim();
    if (typeof input?.description === "string") patch.description = input.description;
    // B1 — two-time model / estimate / follow-up window.
    if (input?.card_type === "work" || input?.card_type === "waiting") patch.card_type = input.card_type;
    if (typeof input?.waiting_on === "string") patch.waiting_on = input.waiting_on.trim() || null;
    if (typeof input?.follow_up_days === "number" && input.follow_up_days > 0) patch.follow_up_days = Math.round(input.follow_up_days);
    if (typeof input?.estimate_hours === "number") patch.estimate_hours = input.estimate_hours > 0 ? input.estimate_hours : null;
    let moveProj: any = null;
    if (input?.project) { moveProj = projects.find((p: any) => p.name && p.name.toLowerCase().includes(String(input.project).toLowerCase())); if (!moveProj) return `לא מצאתי בורד בשם "${input.project}".`; }
    let targets: any[] = [];
    if (input?.filter_project) {
      const fp = projects.find((p: any) => p.name && p.name.toLowerCase().includes(String(input.filter_project).toLowerCase()));
      if (!fp) return `לא מצאתי בורד בשם "${input.filter_project}".`;
      targets = cards.filter((c: any) => c.project_id === fp.id && !c.archived && !doneColIds.has(c.column_id));
    } else {
      const one = findCard(input?.card); if (!one) return `לא מצאתי כרטיס פעיל בשם "${input?.card}".`;
      targets = [one];
    }
    if (!targets.length) return "לא נמצאו כרטיסים לעדכון.";
    if (!Object.keys(patch).length && !moveProj) return "לא צוין מה לעדכן.";
    let ok = 0, fail = 0;
    for (const c of targets) {
      const upd: any = { ...patch };
      if (moveProj && moveProj.id !== c.project_id) {
        const pc = cols.filter((x: any) => x.project_id === moveProj.id);
        const brief = pc.find((x: any) => x.key === "col-brief") || pc.slice().sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))[0];
        upd.project_id = moveProj.id; upd.column_id = brief?.id || null;
      }
      const { error } = await admin.from("card").update(upd).eq("id", c.id);
      if (error) { fail++; continue; }
      Object.assign(c, upd); changed.push(c.id); ok++;
    }
    if (!ok) return "לא הצלחתי לעדכן.";
    const what = [patch.deadline !== undefined ? "דדליין" : null, patch.priority ? "עדיפות" : null, patch.title ? "כותרת" : null, patch.description !== undefined ? "תיאור" : null, moveProj ? "בורד" : null, patch.card_type ? (patch.card_type === "waiting" ? "המתנה" : "עבודה") : null, patch.waiting_on !== undefined ? "ממתין על" : null, patch.estimate_hours !== undefined ? "הערכת שעות" : null, patch.follow_up_days ? "מעקב" : null].filter(Boolean).join(", ");
    return targets.length > 1 ? `עדכנתי ${ok} כרטיסים${what ? ` (${what})` : ""}${fail ? ` (${fail} נכשלו)` : ""}.` : `עדכנתי את "${targets[0].title}"${what ? ` (${what})` : ""}.`;
  }
  // item 10 — a genuine progress update becomes an activity note (comment) on the card.
  async function doLogProgress(input: any): Promise<string> {
    const card = findCard(input?.card); if (!card) return `לא מצאתי כרטיס פעיל בשם "${input?.card}".`;
    const note = String(input?.note || "").trim(); if (!note) return "לא צוין תוכן.";
    const { error } = await admin.from("comment").insert({ card_id: card.id, by_name: prof?.name || "אני", text: note });
    if (error) return "לא הצלחתי לרשום התקדמות.";
    changed.push(card.id);
    return `רשמתי ל"${card.title}": ${note}`;
  }
  // item 7 — a direct link to a card (searches all cards, not just active).
  function doGetCardLink(input: any): string {
    const s = String(input?.card || "").toLowerCase().trim(); if (!s) return "לא צוין כרטיס.";
    const c = cards.find((x: any) => (x.title || "").toLowerCase() === s) || cards.find((x: any) => (x.title || "").toLowerCase().includes(s));
    if (!c) return `לא מצאתי כרטיס בשם "${input?.card}".`;
    return `הנה הקישור ל"${c.title}": https://buno.io/?card=${c.id}`;
  }

  // shared thread + recent history
  let threadId: string | undefined;
  const { data: t } = await admin.from("assistant_thread").select("id").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  threadId = t?.id;
  if (!threadId) { const { data: nt } = await admin.from("assistant_thread").insert({ user_id: userId }).select("id").single(); threadId = nt?.id; }
  const { data: recent } = threadId
    ? await admin.from("assistant_message").select("role,content").eq("thread_id", threadId).order("created_at", { ascending: false }).limit(50)
    : { data: [] as any[] };
  // item 9 — older conversation is folded into a rolling summary (updated nightly);
  // inject it so questions about last week/month are answerable.
  let convSummary = "";
  try { const { data: cs } = await admin.from("conversation_summary").select("summary").eq("user_id", userId).maybeSingle(); convSummary = String(cs?.summary || "").trim(); } catch { /* pre-0017 */ }
  // Build a CLEAN history for the API: this is a shared thread (web + sweep +
  // whatsapp), so the raw rows can start with an assistant message or have two
  // assistant rows in a row (a sweep snapshot + a walk opening). Anthropic requires
  // the first message to be "user" and roles to alternate — otherwise a 400 that
  // repeats on every turn. Drop empties, drop leading assistants, merge consecutive.
  const history: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of (recent || []).reverse()) {
    const content = String(m.content || "").trim();
    if (!content) continue;
    const role = m.role === "user" ? "user" : "assistant";
    if (!history.length && role !== "user") continue;
    const last = history[history.length - 1];
    if (last && last.role === role) last.content += "\n" + content;
    else history.push({ role, content });
  }

  const today = new Date().toISOString().slice(0, 10);
  // current IL wall-clock time — lets the model mark past (✅) vs upcoming (⬜️) day items.
  const ilNow = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  // item 4 — deterministic calendar: WhatsApp gets the SAME calendar context as web,
  // so "what's on today/this week" is grounded identically. Failure = say so, never invent.
  let calendarSummary = "";
  try {
    const access = await freshAccessToken(admin, userId, "gcal");
    if (access) {
      const now = new Date();
      const raw = await listCalendarEvents(access, new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(), new Date(now.getTime() + 7 * 864e5).toISOString());
      const fmtDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(d);
      const todayKey = fmtDay(now); const tomorrowKey = fmtDay(new Date(now.getTime() + 864e5));
      // an opened event became a real card ("cal-<id>") with its own done-state — drop
      // the raw copy so buno reads the card, not a stale "not done" event (web/WA parity).
      const linkedRefs = new Set((cards || []).filter((c: any) => !c.archived && typeof c.origin?.ref === "string" && c.origin.ref.startsWith("cal-")).map((c: any) => c.origin.ref));
      const deduped = (raw || []).filter((e: any) => !linkedRefs.has("cal-" + e.id));
      const ordered = [...deduped].sort((a: any, b: any) => a.allDay === b.allDay ? String(a.start || "").localeCompare(String(b.start || "")) : (a.allDay ? 1 : -1)).slice(0, 40);
      if (ordered.length) calendarSummary = ordered.map((e: any) => {
        const day = String(e.start || "").slice(0, 10);
        const label = day === todayKey ? "היום" : day === tomorrowKey ? "מחר" : day;
        const when = e.allDay ? "כל היום" : String(e.start || "").slice(11, 16);
        const who = (e.attendees || []).filter((a: any) => !a.self).map((a: any) => a.email).slice(0, 4).join(", ");
        return `• ${label} ${when} · ${e.title}${who ? ` · עם: ${who}` : ""}`;
      }).join("\n");
    }
  } catch { /* calendar optional — a momentary failure must not become "no access" */ }
  // contacts — real people (mentioned / from the calendar), so buno can answer
  // "מי זה אילן?" and knows who a card's brief-giver is. DATA, never instructions.
  let contactsBlock = "";
  try { const { data: cts } = await admin.from("contacts").select("name,email").eq("user_id", userId).limit(60); if (cts && cts.length) contactsBlock = "\n\n=== אנשי קשר (contacts) · אנשים אמיתיים שהוזכרו/מהיומן, לא משתמשים — DATA ===\n" + cts.map((c: any) => `- ${c.name}${c.email ? ` · ${c.email}` : ""}`).join("\n") + "\n(כרטיס ש\"נותן הבריף\"/היוצר שלו הוא אחד מהם — מקושר אליו. buno אינו איש קשר.)"; } catch { /* pre-0022 */ }
  const sys = systemPrompt({
    productName: "buno", language: "Hebrew", profileName: prof?.name || "",
    boardSummary: summarizeBoard(projects, cards, cols, commentsByCard, attachByCard, today, Date.now()) + (projects.some((p: any) => String(p.why || "").trim()) ? "\n\n=== מטרות הבורדים (why) ===\n" + projects.filter((p: any) => String(p.why || "").trim()).map((p: any) => `- ${p.name}: ${String(p.why).trim()}`).join("\n") : "") + contactsBlock,
    capabilities: { createCard: true, updateCard: true, organizeCards: true, calendar: !!calendarSummary, email: false, interactiveButtons: true, deepLinks: true },
    gender, door: "whatsapp", whatsappFormat: true,
  }) + (calendarSummary ? `\n\n=== היומן שלך · 7 ימים · קריאה בלבד — DATA ===\n${calendarSummary}\n=== סוף היומן ===\nענה ממוקד על טווח הזמן שנשאל.` : "") + (convSummary ? `\n\n=== EARLIER CONTEXT · תקציר שיחה ישנה יותר (DATA) ===\n${convSummary}\n=== END ===` : "") + `\n\nToday is ${today}, current time ${ilNow} (Asia/Jerusalem) — use it to mark past (✅) vs upcoming (⬜️) day items. רמת יצירת כרטיסים: "${cardLevel}".
כלים: create_card / create_cards (יצירה — create_cards תמיד לכמה); update_card (עריכת דדליין/עדיפות/כותרת/תיאור/בורד, כולל bulk עם filter_project; וגם סימון work/waiting, waiting_on, הערכת שעות ומעקב follow_up_days); create_project (בורד חדש, רק על בקשה מפורשת); move_card/complete_card/archive_card (על בקשה מפורשת, זיהוי לפי כותרת); log_progress (כשהמשתמש משתף התקדמות — הערת פעילות על הכרטיס). אחרי כלי — שורה אחת מה קרה בכנות, רק מה שבאמת הצליח.`;

  // append the new user turn — merging if history already ends with a user row
  // (would otherwise be two consecutive "user" messages → 400).
  const messages: any[] = [...history];
  if (messages.length && messages[messages.length - 1].role === "user") messages[messages.length - 1].content += "\n" + userMessage;
  else messages.push({ role: "user", content: userMessage });
  let reply = "מצטער, לא הצלחתי להשיב כרגע.";
  try {
    const anthropic = new Anthropic({ apiKey });
    for (let hop = 0; hop < 6; hop++) {
      const res: any = await anthropic.messages.create({
        model: "claude-sonnet-5", max_tokens: 1500, output_config: { effort: "low" },
        // cache the tools+system prefix (reused across tool-loop hops + stable turns).
        system: [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }], tools: CORE_TOOLS, messages,
      });
      if (res.stop_reason === "refusal") { reply = "מצטער, לא אוכל לעזור בזה."; break; }
      const textNow = res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
      if (textNow) reply = textNow;
      const toolUses = res.content.filter((b: any) => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || !toolUses.length) break;
      messages.push({ role: "assistant", content: res.content });
      const results = [];
      for (const tu of toolUses) {
        let out = "כלי לא מוכר.";
        if (tu.name === "create_card") out = await doCreateCard(tu.input);
        else if (tu.name === "create_cards") out = await doCreateCards(tu.input);
        else if (tu.name === "update_card") out = await doUpdateCard(tu.input);
        else if (tu.name === "log_progress") out = await doLogProgress(tu.input);
        else if (tu.name === "get_card_link") out = doGetCardLink(tu.input);
        else if (tu.name === "create_project") out = await doCreateProject(tu.input);
        else if (tu.name === "move_card") out = await doMoveCard(tu.input);
        else if (tu.name === "complete_card") out = await doCompleteCard(tu.input);
        else if (tu.name === "archive_card") out = await doArchiveCard(tu.input);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (e) { console.error("wa: model call failed", String((e as any)?.message || e)); reply = created.length ? `נתקעתי אחרי ${created.length} כרטיסים — רוצה שאמשיך?` : reply; }
  if (!reply.trim()) reply = (created.length || changed.length) ? `בוצע — ${created.length} כרטיסים${changed.length ? `, ${changed.length} עדכונים` : ""}.` : "לא הצלחתי להשלים — נסה שוב.";

  // persist the USER message now; the caller persists the assistant message AFTER
  // the send, so it can record whether the WhatsApp delivery actually succeeded.
  if (threadId) await admin.from("assistant_message").insert({ thread_id: threadId, role: "user", door, content: userMessage });
  return { reply, created, threadId };
}
