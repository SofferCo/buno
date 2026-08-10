// buno assistant — /chat Edge Function.
// Stage 3a: conversation over the board. Stage 3b: a create_card tool routed
// through a server-side permission gate (iron rule #1: enforce in code, not
// the prompt — and here, on the SERVER, closing OPEN_THREADS #6 for cards).
//
// Security posture:
// - The caller's JWT is forwarded to a per-request Supabase client, so every
//   read AND write runs under the user's RLS. The function never uses
//   service_role.
// - Board content is injected as DATA; the prompt states it is never
//   instructions (iron rule #2).
// - The assistant never creates a live card on its own: unless the user's
//   matrix says "act", cards are born as amber DRAFTS pending one-click
//   approval (iron rule #3).
import Anthropic from "npm:@anthropic-ai/sdk@0.68.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { systemPrompt, voiceLint } from "../_shared/voice.ts";
import { freshAccessToken, listCalendarEvents, shiftCalendarEvent, moveCalendarEvent, deleteCalendarEvent } from "../_shared/google.ts";
import { ensureOrgBoard } from "../_shared/orgboard.ts";
import { handleAction, setSession, draftsOpening } from "../_shared/review.ts";
import { summarizeBoard } from "../_shared/boardContext.ts";
import { computeDayFacts, renderDayFacts } from "../_shared/dayFacts.ts";
import { WEB_TOOLS, matchCard } from "../_shared/tools.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// summarizeBoard now lives in _shared/boardContext.ts — one brain, one perception
// (shared with the WhatsApp/sweep core). Imported above.

// Tool DEFINITIONS now live in _shared/tools.ts (WEB_TOOLS) — one contract for web + WhatsApp.
// The implementations (doCreateCard, …) stay below, under the caller's JWT/RLS.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing authorization" }, 401);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "assistant not configured" }, 500);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: "not authenticated" }, 401);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const userMessage = String(payload?.message || "").trim();
  const history = Array.isArray(payload?.history) ? payload.history : [];
  const currentProjectId = payload?.currentProjectId || null;

  // guided-review button (web): map the action id to the shared engine — same
  // logic path as WhatsApp interactive replies. No LLM needed.
  const reviewAction = String(payload?.reviewAction || "");
  if (reviewAction.startsWith("rv:")) {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const r = await handleAction(admin, user.id, reviewAction);
    return json({ reply: r.text, actions: r.actions, reviewDone: !!r.done, review: r.project ? { project: r.project } : undefined, pending: r.pending ?? 0, started: !!r.started });
  }

  if (!userMessage) return json({ error: "empty message" }, 400);

  const [proj, cards, cols, prof, asst, comm, att] = await Promise.all([
    supabase.from("project").select("*"),                    // '*' tolerates pre-migration schema (why)
    supabase.from("card").select("*"),                       // '*' tolerates pre-migration schema (card_type, waiting_on)
    supabase.from("board_column").select("id,project_id,key,title,position"),
    supabase.from("profile").select("name").eq("id", user.id).maybeSingle(),
    supabase.from("assistant_settings").select("cards,gender").eq("user_id", user.id).maybeSingle(),
    supabase.from("comment").select("card_id,by_name,text,created_at"),
    supabase.from("attachment").select("card_id,type,name"),
  ]);
  const projects = proj.data || [];
  // group comments/attachments per card so buno sees the real content, not just
  // titles (self-audit weakness B) — comments sorted oldest→newest for "last".
  const commentsByCard = new Map<string, any[]>();
  for (const c of (comm.data || []).sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)))) {
    (commentsByCard.get(c.card_id) || commentsByCard.set(c.card_id, []).get(c.card_id))!.push(c);
  }
  const attachByCard = new Map<string, any[]>();
  for (const a of att.data || []) (attachByCard.get(a.card_id) || attachByCard.set(a.card_id, []).get(a.card_id))!.push(a);
  const cardLevel = (asst.data?.cards || "draft") as "suggest" | "draft" | "act"; // server-side matrix
  // item 11 — persisted gender (masculine default). Auto-switch silently to match
  // how the user ACTUALLY addresses buno — BIDIRECTIONAL, so a wrong guess self-heals
  // on the next clearly-gendered message. Only UNAMBIGUOUS markers count: feminine =
  // imperatives ending -י ("תעשי"), or "את יכולה"; masculine = the bare forms
  // ("תעשה") or "אתה יכול". Forms spelled the same for both genders (עשית/ראית) are
  // NEVER used — they caused false feminine flips (buno-reliability §11 regression).
  let gender: "m" | "f" = asst.data?.gender === "f" ? "f" : "m";
  {
    const fem = /תעשי|תגידי|תבדקי|תפתחי|תסדרי|תכתבי|תשלחי|תוסיפי|תראי|תזכירי|את יכולה/.test(userMessage);
    const masc = !fem && /תעשה|תגיד|תבדוק|תפתח|תסדר|תכתוב|תשלח|תוסיף|תראה|תזכיר|אתה יכול/.test(userMessage);
    const next: "m" | "f" | null = fem ? "f" : masc ? "m" : null;
    if (next && next !== gender) {
      gender = next; try { await supabase.from("assistant_settings").upsert({ user_id: user.id, gender: next }, { onConflict: "user_id" }); } catch { /* best-effort */ }
    }
  }

  // ---- calendar context: the twin must see the schedule, not just the board.
  // We scope to the window the user actually asked about — TODAY by default,
  // tomorrow, or the week — so "מה פתוח היום?" answers about today alone instead
  // of dumping a noisy 7-day list. Events are ordered (timed by hour, then
  // all-day). Read-only; the browser never sees the Google token.
  const nowD = new Date();
  const TZ = "Asia/Jerusalem";
  const fmtDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d); // YYYY-MM-DD in IL
  const todayStr2 = fmtDay(nowD);
  const tomorrowStr = fmtDay(new Date(nowD.getTime() + 864e5));
  const dateOf = (e: any) => String(e.start || "").slice(0, 10);
  const orderEvents = (list: any[]) => [...list].sort((a, b) =>
    a.allDay === b.allDay ? String(a.start || "").localeCompare(String(b.start || "")) : (a.allDay ? 1 : -1));

  // a create/organize COMMAND ("תוסיף משימה... לקבוע פגישה בבנק") is not a request
  // to see the agenda — don't drag the day's calendar into it just because a task
  // text happens to contain "פגישה"/"היום".
  const createIntent = /תוסיף|תוסיפי|הוסף|הוסיפי|תפתח|פתח|תצור|צור|תרשום|רשום|תזכיר|תכתוב/.test(userMessage);
  const scheduleIntent = !createIntent && /יומן|פגיש|מתי|היום|מחר|מחרתיים|השבוע|לו"?ז|לו״ז|לוח.?זמנ|meeting|schedule|calendar|agenda/i.test(userMessage);
  const asksTomorrow = /מחר/.test(userMessage) && !/מחרתיים/.test(userMessage);
  const asksWeek = /השבוע|שבוע|לו"?ז|לו״ז|week|agenda/i.test(userMessage);
  const scope: "today" | "tomorrow" | "week" = asksWeek ? "week" : asksTomorrow ? "tomorrow" : "today";
  const scopeDay = scope === "tomorrow" ? tomorrowStr : todayStr2;

  let calendarSummary = "";
  let scoped: any[] = [];
  // TODAY's events specifically (for the computed day-facts) — null until the
  // calendar is actually read, so an unread calendar leaves eventsToday unknown.
  let eventsTodayList: any[] | null = null;
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const access = await freshAccessToken(admin, user.id, "gcal");
    if (access) {
      const raw = await listCalendarEvents(access, new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()).toISOString(), new Date(nowD.getTime() + 7 * 864e5).toISOString());
      // an event the user already opened became a real card ("cal-<id>") that carries
      // its own done-state. Drop the raw event so buno reads the CARD (via the board
      // summary) instead of double-listing it — or worse, calling a DONE task "not done".
      const linkedRefs = new Set((cards.data || []).filter((c: any) => !c.archived && typeof c.origin?.ref === "string" && c.origin.ref.startsWith("cal-")).map((c: any) => c.origin.ref));
      const deduped = raw.filter((e: any) => !linkedRefs.has("cal-" + e.id));
      eventsTodayList = deduped.filter((e: any) => dateOf(e) === todayStr2);
      const inScope = scope === "week" ? deduped : deduped.filter((e: any) => dateOf(e) === scopeDay);
      scoped = orderEvents(inScope);
      if (scoped.length) {
        calendarSummary = scoped.slice(0, 30).map((e: any) => {
          const when = e.allDay ? "כל היום" : (scope === "week" ? String(e.start || "").replace("T", " ").slice(0, 16) : String(e.start || "").slice(11, 16));
          const who = (e.attendees || []).filter((a: any) => !a.self).map((a: any) => a.email).slice(0, 6).join(", ");
          return `• ${when} · ${e.title}${who ? ` · עם: ${who}` : ""}${e.meetLink ? " · Meet" : ""}`;
        }).join("\n");
      }
    }
  } catch { /* calendar optional */ }
  // surface the scoped, ordered events as clickable chips (not just prose).
  const responseEvents = scheduleIntent ? scoped.slice(0, 12) : [];

  // ---- server-side card creation (the enforcement point) --------------------
  const created: { id: string; title: string; project: string; level: string }[] = [];
  let boardChanged = false; // a new project/board was opened → the client should refresh
  async function doCreateCard(input: any): Promise<string> {
    const title = String(input?.title || "").trim();
    if (!title) return "לא נוצר: חסרה כותרת.";
    // resolve project: by name, else current, else first
    let project = projects.find((p) => input?.project && p.name && p.name.toLowerCase().includes(String(input.project).toLowerCase()));
    if (!project) project = projects.find((p) => p.id === currentProjectId) || projects[0];
    if (!project) return "לא נוצר: אין פרויקט זמין.";
    // brief column (key col-brief) or lowest-position column of that project
    const projCols = (cols.data || []).filter((c) => c.project_id === project!.id);
    const brief = projCols.find((c) => c.key === "col-brief") || projCols.sort((a, b) => a.position - b.position)[0];
    const maxPos = (cards.data || [])
      .filter((c) => c.project_id === project!.id && c.column_id === brief?.id && !c.archived).length;
    const draft = cardLevel === "act" ? null : { by: "buno", at: Date.now(), level: cardLevel };
    // the brief-GIVER is a real person (a contact), never buno. buno's authorship
    // lives in draft/origin metadata only.
    const bf = String(input?.brief_from || "").trim();
    const giver = bf && !/^(buno|בונו|העוזר)$/i.test(bf) ? bf : "";
    const row: any = {
      project_id: project.id, column_id: brief?.id || null, position: maxPos,
      title, creator: giver || "buno", description: String(input?.description || ""),
      deadline: /^\d{4}-\d{2}-\d{2}$/.test(input?.deadline || "") ? input.deadline : null,
      priority: ["regular", "important", "critical"].includes(input?.priority) ? input.priority : "regular",
      origin: { type: "chat", ref: "chat-" + crypto.randomUUID() },
      draft,
    };
    const { data, error } = await supabase.from("card").insert(row).select("id,title").single();
    if (error) return "לא נוצר (שגיאה): " + error.message;
    if (giver) { try { await supabase.from("contacts").upsert({ user_id: user.id, name: giver, source: "mentioned", created_from: data.id }, { onConflict: "user_id,name" }); } catch { /* pre-0022 */ } }
    created.push({ id: data.id, title: data.title, project: project.name, level: cardLevel });
    return cardLevel === "act"
      ? `נוצר כרטיס פעיל "${title}" בפרויקט ${project.name}.`
      : `נוצרה טיוטה "${title}" בפרויקט ${project.name}, ממתינה לאישור המשתמש.`;
  }
  // bulk create — one tool call for many cards (avoids blowing max_tokens on many
  // separate create_card calls). Reuses the single-create insert + enforcement.
  async function doCreateCards(input: any): Promise<string> {
    const list = Array.isArray(input?.cards) ? input.cards.slice(0, 40) : [];
    if (!list.length) return "לא צוינו משימות ליצירה.";
    const before = created.length; let failed = 0;
    for (const item of list) { const out = await doCreateCard({ ...item, project: item?.project || input?.project }); if (out.startsWith("לא נוצר")) failed++; }
    const n = created.length - before;
    const projName = created[created.length - 1]?.project || "";
    return `${cardLevel === "act" ? `נוצרו ${n} כרטיסים` : `נוצרו ${n} טיוטות`}${projName ? ` ב${projName}` : ""}${failed ? ` (${failed} נכשלו)` : ""}.`;
  }
  // open a new board on explicit request (reuses ensureOrgBoard; idempotent by name)
  async function doCreateProject(input: any): Promise<string> {
    const name = String(input?.name || "").trim();
    if (!name) return "לא נוצר: חסר שם לבורד.";
    try {
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const usedColors = new Set<string>((projects as any[]).map((p: any) => p.color).filter(Boolean));
      const proj = await ensureOrgBoard(admin, user.id, name, "", projects as any[], usedColors);
      if (!proj) return "לא הצלחתי לפתוח בורד.";
      // pull the new board's columns into scope so create_card(s) can target it now
      const { data: newCols } = await admin.from("board_column").select("id,project_id,key,title,position").eq("project_id", proj.id);
      for (const c of newCols || []) (cols.data as any[]).push(c);
      boardChanged = true;
      return `פתחתי בורד "${proj.name}".`;
    } catch (e) { return "לא הצלחתי לפתוח בורד: " + String((e as any)?.message || e); }
  }

  // ---- board organization (agency): reversible ops on explicit request -------
  const changed: string[] = [];
  const activeCards = () => (cards.data || []).filter((c: any) => !c.archived);
  const findCard = (q: string): any | null => matchCard(activeCards(), q);
  async function moveTo(card: any, col: any, verb: string): Promise<string> {
    const { error } = await supabase.from("card").update({ column_id: col.id, active_column_key: col.key }).eq("id", card.id);
    if (error) return `לא הצלחתי ${verb} (שגיאה): ${error.message}`;
    card.column_id = col.id; changed.push(card.id);
    return "";
  }
  async function doMoveCard(input: any): Promise<string> {
    const card = findCard(input?.card);
    if (!card) return `לא מצאתי כרטיס פעיל בשם "${input?.card}".`;
    const projCols = (cols.data || []).filter((c: any) => c.project_id === card.project_id);
    const q = String(input?.column || "").toLowerCase().trim();
    const target = projCols.find((c: any) => (c.title || "").toLowerCase() === q)
      || projCols.find((c: any) => (c.title || "").toLowerCase().includes(q))
      || projCols.find((c: any) => c.key === q);
    if (!target) return `לא מצאתי עמודה "${input?.column}" בלוח של "${card.title}".`;
    const err = await moveTo(card, target, "להזיז");
    return err || `הזזתי את "${card.title}" ל"${target.title}".`;
  }
  async function doCompleteCard(input: any): Promise<string> {
    const card = findCard(input?.card);
    if (!card) return `לא מצאתי כרטיס פעיל בשם "${input?.card}".`;
    const projCols = (cols.data || []).filter((c: any) => c.project_id === card.project_id);
    const done = projCols.find((c: any) => c.key === "col-done") || projCols.find((c: any) => /done|הושלם|בוצע/i.test(c.title || ""));
    if (!done) return `לא מצאתי עמודת "הושלם" בלוח של "${card.title}".`;
    const err = await moveTo(card, done, "לסמן כבוצע");
    return err || `סימנתי את "${card.title}" כבוצע.`;
  }
  async function doArchiveCard(input: any): Promise<string> {
    const card = findCard(input?.card);
    if (!card) return `לא מצאתי כרטיס פעיל בשם "${input?.card}".`;
    const { error } = await supabase.from("card").update({ archived: true, archived_at: new Date().toISOString() }).eq("id", card.id);
    if (error) return `לא הצלחתי לארכב (שגיאה): ${error.message}`;
    card.archived = true; changed.push(card.id);
    return `ארכבתי את "${card.title}" — אפשר לשחזר מהארכיון.`;
  }
  // item 6 — edit existing card(s), single or bulk.
  async function doUpdateCard(input: any): Promise<string> {
    const patch: any = {};
    if (typeof input?.deadline === "string") { const d = input.deadline.trim().toLowerCase(); if (d === "clear" || d === "") patch.deadline = null; else if (/^\d{4}-\d{2}-\d{2}$/.test(input.deadline.trim())) patch.deadline = input.deadline.trim(); }
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
      targets = activeCards().filter((c: any) => c.project_id === fp.id);
    } else { const one = findCard(input?.card); if (!one) return `לא מצאתי כרטיס פעיל בשם "${input?.card}".`; targets = [one]; }
    if (!targets.length) return "לא נמצאו כרטיסים לעדכון.";
    if (!Object.keys(patch).length && !moveProj) return "לא צוין מה לעדכן.";
    let ok = 0, fail = 0;
    for (const c of targets) {
      const upd: any = { ...patch };
      if (moveProj && moveProj.id !== c.project_id) { const pc = (cols.data || []).filter((x: any) => x.project_id === moveProj.id); const brief = pc.find((x: any) => x.key === "col-brief") || pc.slice().sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))[0]; upd.project_id = moveProj.id; upd.column_id = brief?.id || null; }
      const { error } = await supabase.from("card").update(upd).eq("id", c.id);
      if (error) { fail++; continue; }
      Object.assign(c, upd); changed.push(c.id); ok++;
    }
    if (!ok) return "לא הצלחתי לעדכן.";
    const what = [patch.deadline !== undefined ? "דדליין" : null, patch.priority ? "עדיפות" : null, patch.title ? "כותרת" : null, patch.description !== undefined ? "תיאור" : null, moveProj ? "בורד" : null, patch.card_type ? (patch.card_type === "waiting" ? "המתנה" : "עבודה") : null, patch.waiting_on !== undefined ? "ממתין על" : null, patch.estimate_hours !== undefined ? "הערכת שעות" : null, patch.follow_up_days ? "מעקב" : null].filter(Boolean).join(", ");
    return targets.length > 1 ? `עדכנתי ${ok} כרטיסים${what ? ` (${what})` : ""}${fail ? ` (${fail} נכשלו)` : ""}.` : `עדכנתי את "${targets[0].title}"${what ? ` (${what})` : ""}.`;
  }
  // item 10 — a progress update → an activity note (comment) on the card.
  async function doLogProgress(input: any): Promise<string> {
    const card = findCard(input?.card); if (!card) return `לא מצאתי כרטיס פעיל בשם "${input?.card}".`;
    const note = String(input?.note || "").trim(); if (!note) return "לא צוין תוכן.";
    const { error } = await supabase.from("comment").insert({ card_id: card.id, by_name: prof.data?.name || "אני", text: note });
    if (error) return "לא הצלחתי לרשום התקדמות."; changed.push(card.id);
    return `רשמתי ל"${card.title}": ${note}`;
  }
  // item 7 — direct link to a card (searches all cards, active or not).
  function doGetCardLink(input: any): string {
    const s = String(input?.card || "").toLowerCase().trim(); if (!s) return "לא צוין כרטיס.";
    const all = cards.data || [];
    const c = all.find((x: any) => (x.title || "").toLowerCase() === s) || all.find((x: any) => (x.title || "").toLowerCase().includes(s));
    if (!c) return `לא מצאתי כרטיס בשם "${input?.card}".`;
    return `הנה הקישור ל"${c.title}": https://buno.io/?card=${c.id}`;
  }

  // item 9 — inject the rolling conversation summary (older history, updated nightly)
  let convSummary = "";
  try { const { data: cs } = await supabase.from("conversation_summary").select("summary").eq("user_id", user.id).maybeSingle(); convSummary = String(cs?.summary || "").trim(); } catch { /* pre-0017 */ }
  const today = todayStr2; // YYYY-MM-DD in IL, for relative dates
  const nowIL = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(nowD);
  // D1 — the board's "why" (project purpose) rides alongside the summary so buno
  // can connect a task to what it serves.
  const whyBlock = projects.filter((p: any) => String(p.why || "").trim()).map((p: any) => `- ${p.name}: ${String(p.why).trim()}`).join("\n");
  // contacts — real people so buno can answer "מי זה אילן?" + know a card's giver.
  let contactsBlock = "";
  try { const { data: cts } = await supabase.from("contacts").select("name,email").limit(60); if (cts && cts.length) contactsBlock = "\n\n=== אנשי קשר (contacts) · אנשים אמיתיים שהוזכרו/מהיומן, לא משתמשים — DATA ===\n" + cts.map((c: any) => `- ${c.name}${c.email ? ` · ${c.email}` : ""}`).join("\n") + "\n(כרטיס ש\"נותן הבריף\"/היוצר שלו הוא אחד מהם — מקושר אליו. buno אינו איש קשר.)"; } catch { /* pre-0022 */ }
  // Wave B inputs (best-effort): subtask progress (almost-closed) + replies that
  // landed recently on tracked cards (from the nightly sweep's thread-update log).
  const allCardIds = (cards.data || []).map((c: any) => c.id);
  const subHoursByCard = new Map<string, number>();
  const subDoneByCard = new Map<string, { done: number; total: number }>();
  const recentReplies: { card: string; from: string; summary: string }[] = [];
  try {
    if (allCardIds.length) {
      const sinceReplies = new Date(nowD.getTime() - 36 * 3600e3).toISOString();
      const [subsR, repR] = await Promise.all([
        supabase.from("subtask").select("card_id,hours,done").in("card_id", allCardIds),
        supabase.from("card_thread_update").select("card_id,from_name,summary,created_at").in("card_id", allCardIds).gte("created_at", sinceReplies).order("created_at", { ascending: false }),
      ]);
      for (const s of subsR.data || []) {
        subHoursByCard.set(s.card_id, (subHoursByCard.get(s.card_id) || 0) + (Number(s.hours) || 0));
        const e = subDoneByCard.get(s.card_id) || { done: 0, total: 0 }; e.total++; if (s.done) e.done++; subDoneByCard.set(s.card_id, e);
      }
      const titleById = new Map((cards.data || []).map((c: any) => [c.id, String(c.title || "")]));
      const aliveIds = new Set((cards.data || []).filter((c: any) => !c.archived && !c.draft).map((c: any) => c.id));
      const seen = new Set<string>();
      for (const r of repR.data || []) {
        if (!aliveIds.has(r.card_id) || seen.has(r.card_id)) continue;   // one (newest) per card
        seen.add(r.card_id);
        recentReplies.push({ card: titleById.get(r.card_id) || "משימה", from: String(r.from_name || ""), summary: String(r.summary || "") });
      }
    }
  } catch { /* Wave B inputs best-effort — never block the brief */ }
  // the DATA layer of the brief: counts + day-load computed in code (the single
  // source for any number buno may state). Logged so every brief line is auditable.
  const facts = computeDayFacts({ cards: cards.data || [], cols: cols.data || [], projects, todayStr: todayStr2, nowMs: nowD.getTime(), events: eventsTodayList, subHoursByCard, subDoneByCard, recentReplies });
  console.log("dayFacts(web)", JSON.stringify(facts));
  const sys = systemPrompt({
    productName: "buno",
    language: "Hebrew",
    profileName: prof.data?.name || "",
    boardSummary: summarizeBoard(projects, cards.data || [], cols.data || [], commentsByCard, attachByCard, todayStr2, nowD.getTime()) + (whyBlock ? `\n\n=== מטרות הבורדים (why) ===\n${whyBlock}` : "") + contactsBlock,
    // capabilities reflect exactly what THIS request sends: the create + organize
    // tools are always attached; calendar is context-only when we have events;
    // email is never available in the chat. Keeps the prompt honest to itself.
    capabilities: { createCard: true, updateCard: true, organizeCards: true, calendar: !!calendarSummary, email: false, interactiveButtons: true, deepLinks: true },
    gender, door: "web",
  }) + (convSummary ? `\n\n=== EARLIER CONTEXT · תקציר שיחה ישנה יותר (DATA) ===\n${convSummary}\n=== END ===` : "") + (calendarSummary ? `\n\n=== היומן שלך · ${scope === "week" ? "7 ימים קרובים" : scope === "tomorrow" ? `מחר (${tomorrowStr})` : `היום (${todayStr2})`} · קריאה בלבד — DATA ===\n${calendarSummary}\n=== סוף היומן ===\nענה ממוקד על טווח הזמן שנשאל בלבד: אם שאלו "מה פתוח היום" — דבר על היום בלבד, פגישות לפי סדר השעות, בלי לגלוש למחר או לשבוע (אלא אם ביקשו). קצר ותכליתי — בלי לחזור על כל שורה ביומן. אם משתתף בפגישה שייך ללקוח מסוים (לפי דומיין המייל), אפשר לקשר את הפגישה לאותו לקוח.` : "") + "\n\n" + renderDayFacts(facts) + `

=== כללי־יסוד (מעל הכל — שבירתם שוברת אמון) ===
1. קצר. זו העדיפות העליונה. ברירת מחדל: 1–3 משפטים קצרים, רק אם המשתמש ביקש במפורש פירוט. בלי הרצאות, בלי להסביר מתודולוגיה ("צעד קטן יזיז..."), בלי "זה ייקח שתי דקות", בלי להסביר מה זה כרטיס/בריף, בלי לחזור על מה שכבר מוצג על המסך. ענה לשאלה ותעצור.
2. אל תהיה נודניק. הצע לכל היותר דבר אחד, במשפט אחד, ורק אם באמת רלוונטי. אם המשתמש לא ביקש תוכנית — אל תיתן תוכנית רב־שלבית. שאלה אחת לכל היותר, ולרוב אף לא אחת.
3. הסריקה אמיתית — אל תכחיש אותה. buno סורק מייל ויומן: גם בלילה (cron) וגם ב"סרוק עכשיו" שהמשתמש מפעיל — אלה פעולות אמיתיות של המערכת. אם בהיסטוריה יש הודעת "סרקתי"/"סרקתי שוב" — היא אמיתית; אסור לך לומר "לא סרקתי", "ההודעה הקודמת שגויה" או "זה לא בא מנתון אמיתי". מה שאין לך בשיחה הזו זה תוכן המיילים הספציפיים. לכן כשנשאל "האם הסריקה כללה מייל / למה מייל X לא נתפס" — ענה קצר ובכנות: הסריקה עוברת על תיבת הנכנס (30 יום אחרונים), אבל אין לי כאן את המיילים עצמם כדי לומר למה פריט מסוים לא הפך לכרטיס.
4. בלי המצאות: נתון שלא בקונטקסט — אמור שאין לך אותו, אל תנחש. במיוחד: אל תסיק את תאריך המייל מגיל הכרטיס ("פתוח 6 ימים" ≠ "המייל מהיום"). זמן אמיתי: כרגע בישראל ${nowIL}.
5. סגנון: עברית טבעית, טקסט רגיל בלבד. בלי Markdown, בלי כוכביות (** או *), בלי כותרות #. תבליט • קצר רק אם חייבים רשימה.
6. עדיפות: כשנשאל "מה הכי דחוף/חשוב" — קריטי ראשון, אחריו חשוב, ורק אז דדליין (בעקביות עם "היום שלי").
7. החלטה = הודעה משלה: אל תבלע שאלת כן/לא בתוך פסקת טקסט (למשל "רוצה שאתעד את X כהושלם?"). אם המשתמש לא ביקש פעולה — אל תבצע ואל תשאל בפרוזה; דווח קצר מה עשית ותעצור. הבקשה של המשתמש היא הטריגר, לא ניחוש שלך.
8. יצירת כרטיס = שורת אישור אחת בלבד: כשאתה מוסיף משימה, ענה במשפט קצר על מה שביקשו בלבד (למשל "צירפתי להיום את 'לסדר משימות'"). הכרטיס עצמו כבר מוצג על המסך עם הפרויקט וכפתורי אישור — אל תחזור עליו. אסור: לסקור את היומן, למנות משימות/פגישות אחרות שלא התבקשו, או "לתקן" משהו שאמרת קודם. רק מה שביקשו.

Today is ${today}. When the user gives a relative date ("מחר", "יום ראשון"), convert it to a real YYYY-MM-DD for the deadline; if no real date is given, omit it.

=== TOOLS ===
create_card — one task. The card-permission level is "${cardLevel}" ("act" = live immediately; "draft"/"suggest" = pending draft the user approves — enforced in code). Never invent tasks the user didn't ask for.
create_cards — MANY tasks at once. ALWAYS use this (a single call with the array) when the user asks to add more than one task — do NOT call create_card many times.
create_project — open a NEW board, ONLY on an explicit request ("תפתח בורד ל…"). After opening, you can add its cards with create_cards (project = the new board's name).
move_card / complete_card / archive_card — organize the board on the user's EXPLICIT request only (e.g. "העבר ל'בעבודה'", "סמן שסיימתי", "תארכב"). Act directly (reversible), identify by title.
After any tool call, tell the user plainly in one line what actually happened. If a tool reported it couldn't find the card/column, say so honestly — don't pretend it worked.

=== שבבי המשך (SUGGESTIONS) ===
בסוף התשובה — ורק אם יש ערך אמיתי — פלוט בשורה נפרדת אחרונה עד 3 הצעות המשך שסביר שהמשתמש ירצה *עכשיו*, לפי השעה, מה נסגר היום, מה נאמר בשיחה, ומה שאתה יודע עליו. זה הניחוש הכי טוב שלך למה הכי שימושי כרגע — לא תפריט של מה שאתה יודע לענות. כללים: העדף פעולות/מידע על שאלות גנריות; אל תציע דבר שכבר על המסך או שנענה בתשובה הזו; קצר (עד ~5 מילים); ואם שום דבר לא מוסיף ערך — פלוט מערך ריק []. אחרי סיכום־יום, שיחה שאינה על משימות, או אחרי חצות — לרוב [] היא התשובה הנכונה.
הפורמט (השרת מסיר אותו לפני שהמשתמש רואה — לעולם אל תזכיר אותו):
<<SUGGEST>>[{"label":"טקסט קצר","value":"high","key":"complete_next"}]<<SUGGEST>>
value=high = מביא מידע שהמשתמש לא ידע (מוצג ראשון) · value=low = חוסך הקלדה בלבד (אחרון, אחד לכל היותר).
key = קטגוריה סמנטית (ללמידה): complete_next (סמן/סיים משימה) · summarize_day (סיכום יום) · followup_contact (מעקב אחרי אדם) · plan_tomorrow (תכנון מחר/קדימה) · other.`;

  // calendar WRITE from chat (B6ג) — resolve the meeting by title/attendee within
  // the next 14 days, then postpone / move / cancel. Ambiguity → ask, never guess.
  let calendarChanged = false;
  async function doManageEvent(input: any): Promise<string> {
    const match = String(input?.match || "").trim().toLowerCase();
    const action = String(input?.action || "");
    if (!match || !action) return "לא בוצע: חסר זיהוי הפגישה או הפעולה.";
    try {
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const access = await freshAccessToken(admin, user.id, "gcal");
      if (!access) return "היומן לא מחובר — אי אפשר לנהל פגישות.";
      const list = await listCalendarEvents(access, new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()).toISOString(), new Date(nowD.getTime() + 14 * 864e5).toISOString());
      const cands = list.filter((e: any) => !e.allDay && (
        String(e.title || "").toLowerCase().includes(match) ||
        (e.attendees || []).some((a: any) => String(a.email || "").toLowerCase().includes(match) || String(a.name || "").toLowerCase().includes(match))
      ));
      if (!cands.length) return `לא מצאתי פגישה שמתאימה ל"${input.match}".`;
      if (cands.length > 1) return `יש כמה פגישות שמתאימות ל"${input.match}": ${cands.slice(0, 4).map((c: any) => c.title).join(", ")} — תגיד לי איזו במדויק.`;
      const ev = cands[0];
      const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
      if (action === "postpone") { const r = await shiftCalendarEvent(access, ev.id, Number(input?.minutes) || 30); if (!r.ok) return "לא הצלחתי לדחות: " + r.error; calendarChanged = true; return `דחיתי את "${ev.title}" ל-${hhmm(r.start!)} — המשתתפים עודכנו.`; }
      if (action === "move") { if (!input?.start_iso) return "כדי לתזמן מחדש אני צריך שעה חדשה — מתי?"; const r = await moveCalendarEvent(access, ev.id, String(input.start_iso)); if (!r.ok) return "לא הצלחתי לתזמן מחדש: " + r.error; calendarChanged = true; return `העברתי את "${ev.title}" ל-${new Date(r.start!).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })} — המשתתפים עודכנו.`; }
      if (action === "cancel") { const r = await deleteCalendarEvent(access, ev.id); if (!r.ok) return "לא הצלחתי לבטל: " + r.error; calendarChanged = true; return `ביטלתי את "${ev.title}" — המשתתפים קיבלו עדכון.`; }
      return "פעולה לא מוכרת.";
    } catch (e) { console.error("manage_event", String((e as any)?.message || e)); return "נתקלתי בתקלה בניהול היומן — נסה שוב."; }
  }

  const anthropic = new Anthropic({ apiKey });
  const messages: any[] = [
    ...history
      .filter((m: any) => m?.role === "user" || m?.role === "assistant")
      .slice(-12)
      .map((m: any) => ({ role: m.role, content: String(m.content || "") })),
    { role: "user", content: userMessage },
  ];

  let reply = "";
  try {
    for (let hop = 0; hop < 6; hop++) {
      const res: any = await anthropic.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 2048,
        output_config: { effort: "low" },
        // cache the tools+system prefix: reused across the 2–6 tool-loop hops of a
        // single turn, and across turns while the board is unchanged (~0.1× reads).
        system: [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }],
        tools: WEB_TOOLS,
        messages,
      });
      if (res.stop_reason === "refusal") return json({ reply: "מצטער, לא אוכל לעזור בזה.", refused: true });
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
        else if (tu.name === "manage_event") out = await doManageEvent(tu.input);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (e) {
    // NEVER an empty bubble: report honestly what got done before the failure.
    console.error("chat: loop error", String((e as any)?.message || e));
    reply = reply || (created.length ? `נתקעתי אחרי ${created.length} כרטיסים — רוצה שאמשיך מהמקום שעצרתי?` : "נתקלתי בתקלה זמנית — נסה שוב בעוד רגע.");
  }
  // Dynamic suggestion chips (step 1): the model appends a <<SUGGEST>>[…] tail block.
  // Strip EVERYTHING from the first marker so it can never leak into the visible reply,
  // then parse the first JSON array defensively. high first, ≤1 low, ≤3 total.
  type Sug = { label: string; value: "high" | "low"; key: string };
  let suggestions: Sug[] = [];
  {
    const idx = reply.indexOf("<<SUGGEST>>");
    if (idx !== -1) {
      const tail = reply.slice(idx);
      reply = reply.slice(0, idx).trim();
      const jm = tail.match(/\[[\s\S]*\]/);
      if (jm) {
        try {
          const arr = JSON.parse(jm[0]);
          const KEYS = ["complete_next", "summarize_day", "followup_contact", "plan_tomorrow", "other"];
          if (Array.isArray(arr)) {
            suggestions = arr
              .filter((s: any) => s && typeof s.label === "string" && s.label.trim())
              .map((s: any) => ({ label: String(s.label).trim().slice(0, 40), value: s.value === "high" ? "high" as const : "low" as const, key: KEYS.includes(String(s.key)) ? String(s.key) : "other" }));
          }
        } catch { /* malformed tail → no chips, reply already cleaned */ }
      }
    }
  }
  // Suggestion chips step 2 — FLOOR rules: guarantee urgent items surface even when the
  // model didn't propose them. Computed from the real board, so nothing important falls.
  {
    const all = (cards.data || []) as any[];
    const floor: Sug[] = [];
    const drafts = all.filter((c) => c.draft && !c.archived).length;
    if (drafts >= 5) floor.push({ label: `נעבור על ${drafts} הטיוטות?`, value: "high", key: "floor:drafts" });
    // a waiting card whose silent window (follow_up_days) has passed → nudge to remind
    const nowMs = nowD.getTime();
    const waitingDue = all.find((c) => !c.archived && c.card_type === "waiting" && Number(c.follow_up_days) > 0 && String(c.waiting_on || "").trim()
      && (nowMs - new Date(c.updated_at || c.created_at).getTime()) / 864e5 >= Number(c.follow_up_days));
    if (waitingDue) floor.push({ label: `להזכיר ל${String(waitingDue.waiting_on).trim()}?`, value: "high", key: "floor:waiting" });
    // overdue open tasks, and it's evening (≥18:00) → offer to roll them to tomorrow
    const doneCols = new Set((cols.data || []).filter((c: any) => c.key === "col-done").map((c: any) => c.id));
    const overdue = all.filter((c) => !c.archived && !doneCols.has(c.column_id) && /^\d{4}-\d{2}-\d{2}$/.test(c.deadline || "") && c.deadline < todayStr2).length;
    if (overdue > 0 && nowD.getHours() >= 18) floor.push({ label: `לגלגל את ${overdue} המאחרות למחר?`, value: "high", key: "floor:overdue" });
    // step 5 — a project silent for 2+ weeks but still holding open cards → still live?
    for (const p of (proj.data || []) as any[]) {
      const openInP = all.filter((c) => c.project_id === p.id && !c.archived && !doneCols.has(c.column_id));
      if (openInP.length && openInP.every((c) => (nowMs - new Date(c.updated_at || c.created_at).getTime()) / 864e5 >= 14)) {
        floor.push({ label: `${p.name} שקט שבועיים — עדיין רלוונטי?`, value: "high", key: "floor:silent" }); break;
      }
    }
    // step 5 — body before tasks (Rambam 4): a gentle morning check-in, trailing.
    if (nowD.getHours() >= 6 && nowD.getHours() < 11) floor.push({ label: "איך הבוקר?", value: "low", key: "floor:morning" });
    // merge floor + model, dedupe by label.
    const merged: Sug[] = [];
    const seen = new Set<string>();
    for (const s of [...floor, ...suggestions]) { const k = s.label.toLowerCase(); if (seen.has(k)) continue; seen.add(k); merged.push(s); }
    // step 4 — LEARNING: mute categories the user keeps ignoring (floor rules are urgent,
    // never muted); demote low-engagement to the tail; log what we actually show. Degrades
    // gracefully if the suggestion_stats migration hasn't run yet.
    let live = merged;
    try {
      const keys = [...new Set(merged.map((s) => s.key))];
      if (keys.length) {
        const { data: stats } = await supabase.from("suggestion_stats").select("suggestion_key,shown_count,clicked_count,last_shown_at").in("suggestion_key", keys);
        const stat = new Map((stats || []).map((r: any) => [r.suggestion_key, r]));
        const muted = (k: string) => { if (k.startsWith("floor:")) return false; const r: any = stat.get(k); if (!r || r.clicked_count > 0) return false; const days = r.last_shown_at ? (Date.now() - new Date(r.last_shown_at).getTime()) / 864e5 : 999; return r.shown_count >= 15 && days < 30; };
        const demote = (k: string) => { if (k.startsWith("floor:")) return false; const r: any = stat.get(k); return !!(r && r.clicked_count === 0 && r.shown_count >= 8); };
        live = merged.filter((s) => !muted(s.key));
        live = [...live.filter((s) => !demote(s.key)), ...live.filter((s) => demote(s.key))]; // demoted sink, order stable
      }
    } catch { /* stats table not applied yet — chips still work */ }
    const highs = live.filter((s) => s.value === "high");
    const lows = live.filter((s) => s.value === "low").slice(0, 1);
    suggestions = [...highs, ...lows].slice(0, 3);
    // log the shows (fire-and-forget; RPC missing = ignored)
    for (const s of suggestions) supabase.rpc("bump_suggestion", { p_key: s.key, p_shown: 1, p_clicked: 0 }).then(() => {}, () => {});
  }
  // guard: if the loop ended with tools but no closing text, still say something real
  if (!reply.trim()) reply = (created.length || changed.length) ? `בוצע — ${created.length} כרטיסים${changed.length ? `, ${changed.length} עדכונים` : ""}.` : "לא הצלחתי להשלים את הבקשה — נסה שוב.";

  // unify (threshold): 1–2 drafts stay chips; 3+ become a guided one-by-one walk.
  let reviewActions: any = null;
  let reviewProject: string | undefined;
  let showCards = created;
  if (created.length >= 3) {
    try {
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const queue = created.map((c) => ({ kind: "draft", cardId: c.id, title: c.title, project: c.project }));
      await setSession(admin, user.id, queue as any, 0);
      const opening = draftsOpening(queue as any);
      reply = opening.text; reviewActions = opening.actions; reviewProject = opening.project; showCards = []; // the walk replaces the chip dump
    } catch { /* fall back to chips */ }
  }

  const lint = voiceLint(reply);
  try {
    // one continuous conversation: reuse the passed thread, else the user's
    // latest, else create the first one. The twin is a single entity.
    let threadId = payload?.threadId;
    if (!threadId) {
      const { data: existing } = await supabase.from("assistant_thread").select("id").order("created_at", { ascending: false }).limit(1).maybeSingle();
      threadId = existing?.id;
    }
    if (!threadId) {
      const { data: t } = await supabase.from("assistant_thread").insert({ user_id: user.id }).select("id").single();
      threadId = t?.id;
    }
    // when the turn CREATED cards (or opened a walk), answer only that — don't
    // also dump the day's agenda just because the ask mentioned "היום".
    const eventsOut = (reviewActions || created.length) ? [] : responseEvents;
    const meta = reviewActions ? { actions: reviewActions, ...(reviewProject ? { review: { project: reviewProject } } : {}) } : ((showCards.length || eventsOut.length) ? { created: showCards, ...(eventsOut.length ? { events: eventsOut } : {}) } : null);
    if (threadId) {
      await supabase.from("assistant_message").insert([
        { thread_id: threadId, role: "user", door: "web", content: userMessage },
        { thread_id: threadId, role: "assistant", door: "web", content: reply, meta },
      ]);
    }
    return json({ reply, threadId, created: showCards, actions: reviewActions || undefined, review: reviewProject ? { project: reviewProject } : undefined, pending: reviewActions ? created.length : undefined, started: reviewActions ? true : undefined, changed: changed.length + (boardChanged ? 1 : 0), calendarChanged, events: eventsOut, suggestions, voiceOk: lint.ok, voiceHits: lint.hits });
  } catch {
    return json({ reply, created: showCards, actions: reviewActions || undefined, changed: changed.length + (boardChanged ? 1 : 0), calendarChanged, suggestions, voiceOk: lint.ok, voiceHits: lint.hits });
  }
});
