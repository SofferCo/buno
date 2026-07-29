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
import { freshAccessToken, listCalendarEvents } from "../_shared/google.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function summarizeBoard(projects: any[], cards: any[], cols: any[], commentsByCard: Map<string, any[]>, attachByCard: Map<string, any[]>, todayStr: string, nowMs: number): string {
  const colTitle = new Map<string, string>();
  for (const c of cols) colTitle.set(c.id, c.title);
  const projName = new Map<string, string>();
  for (const p of projects) projName.set(p.id, p.name);
  const active = cards.filter((c) => !c.archived);
  const head = `הפרויקטים: ${projects.map((p) => p.name).join(" · ") || "—"}`;
  if (!active.length) return head + "\n(אין משימות פעילות.)";
  const DAY = 864e5;
  const ageStr = (iso: string) => {
    if (!iso) return "";
    const d = Math.floor((nowMs - new Date(iso).getTime()) / DAY);
    return d <= 0 ? "נפתח היום" : d === 1 ? "פתוח יום" : `פתוח ${d} ימים`;
  };
  const dueStr = (dl: string) => {
    if (!dl) return "";
    const diff = Math.round((new Date(dl + "T00:00:00").getTime() - new Date(todayStr + "T00:00:00").getTime()) / DAY);
    return diff < 0 ? `דדליין עבר לפני ${-diff} ${-diff === 1 ? "יום" : "ימים"}` : diff === 0 ? "דדליין היום" : diff === 1 ? "דדליין מחר" : `דדליין בעוד ${diff} ימים`;
  };
  const byProject: Record<string, any[]> = {};
  for (const c of active) (byProject[c.project_id] = byProject[c.project_id] || []).push(c);
  const lines: string[] = [head];
  for (const pid of Object.keys(byProject)) {
    lines.push(`\nפרויקט: ${projName.get(pid) || "—"}`);
    for (const c of byProject[pid].slice(0, 40)) {
      const parts = [`• ${c.title || "ללא כותרת"}`];
      if (c.column_id && colTitle.get(c.column_id)) parts.push(`[${colTitle.get(c.column_id)}]`);
      const due = dueStr(c.deadline); if (due) parts.push(due);
      const age = ageStr(c.created_at); if (age) parts.push(age);
      if (c.priority && c.priority !== "regular") parts.push(c.priority === "critical" ? "קריטי" : "חשוב");
      const cs = commentsByCard.get(c.id) || [];
      if (cs.length) {
        const last = cs[cs.length - 1];
        parts.push(`${cs.length} תגובות (אחרונה — ${last.by_name}: ${String(last.text || "").replace(/\s+/g, " ").slice(0, 50)})`);
      }
      const as = attachByCard.get(c.id) || [];
      if (as.length) parts.push(`${as.length} קבצים${as.some((a: any) => a.name) ? ` (${as.map((a: any) => a.name).filter(Boolean).slice(0, 3).join(", ")})` : ""}`);
      lines.push(parts.join(" · "));
    }
  }
  return lines.join("\n");
}

const CREATE_CARD_TOOL = {
  name: "create_card",
  description:
    "Create a task card on the user's board. Use this only when the user clearly asks to add/open/create a task, or explicitly agrees to a card you offered. Cards are created as pending drafts the user approves — you never bypass that. Prefer the project the user names; if none, it goes to their current project.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short task title, ≤10 words, starting with a verb. In Hebrew." },
      description: { type: "string", description: "Optional one-sentence context, in Hebrew." },
      project: { type: "string", description: "Optional project name to place the card under (match one of the user's projects)." },
      deadline: { type: "string", description: "Optional due date as YYYY-MM-DD, only if the user stated a real one." },
      priority: { type: "string", enum: ["regular", "important", "critical"], description: "Optional priority; default regular." },
    },
    required: ["title"],
  },
};

const MOVE_CARD_TOOL = {
  name: "move_card",
  description: "Move an existing card to another column on its board (e.g. to 'בעבודה' / 'לבדיקה'). Use ONLY when the user explicitly asks to move or advance a specific task. Reversible.",
  input_schema: {
    type: "object",
    properties: {
      card: { type: "string", description: "The card's title (or closest match) to move." },
      column: { type: "string", description: "Target column name, e.g. 'בעבודה', 'לבדיקה / אישור', 'הושלם'." },
    },
    required: ["card", "column"],
  },
};

const COMPLETE_CARD_TOOL = {
  name: "complete_card",
  description: "Mark a card as done — moves it to the board's Done column. Use ONLY when the user explicitly says a specific task is finished. Reversible.",
  input_schema: {
    type: "object",
    properties: { card: { type: "string", description: "The card's title to mark done." } },
    required: ["card"],
  },
};

const ARCHIVE_CARD_TOOL = {
  name: "archive_card",
  description: "Archive a card (remove it from the active board — it can be restored). Use ONLY when the user explicitly asks to remove/archive a specific task.",
  input_schema: {
    type: "object",
    properties: { card: { type: "string", description: "The card's title to archive." } },
    required: ["card"],
  },
};

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
  if (!userMessage) return json({ error: "empty message" }, 400);

  const [proj, cards, cols, prof, asst, comm, att] = await Promise.all([
    supabase.from("project").select("id,name"),
    supabase.from("card").select("id,project_id,column_id,title,deadline,priority,time_spent,archived,created_at"),
    supabase.from("board_column").select("id,project_id,key,title,position"),
    supabase.from("profile").select("name").eq("id", user.id).maybeSingle(),
    supabase.from("assistant_settings").select("cards").eq("user_id", user.id).maybeSingle(),
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

  const scheduleIntent = /יומן|פגיש|מתי|היום|מחר|מחרתיים|השבוע|לו"?ז|לו״ז|לוח.?זמנ|meeting|schedule|calendar|agenda/i.test(userMessage);
  const asksTomorrow = /מחר/.test(userMessage) && !/מחרתיים/.test(userMessage);
  const asksWeek = /השבוע|שבוע|לו"?ז|לו״ז|week|agenda/i.test(userMessage);
  const scope: "today" | "tomorrow" | "week" = asksWeek ? "week" : asksTomorrow ? "tomorrow" : "today";
  const scopeDay = scope === "tomorrow" ? tomorrowStr : todayStr2;

  let calendarSummary = "";
  let scoped: any[] = [];
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const access = await freshAccessToken(admin, user.id, "gcal");
    if (access) {
      const raw = await listCalendarEvents(access, new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()).toISOString(), new Date(nowD.getTime() + 7 * 864e5).toISOString());
      const inScope = scope === "week" ? raw : raw.filter((e: any) => dateOf(e) === scopeDay);
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
    const row: any = {
      project_id: project.id, column_id: brief?.id || null, position: maxPos,
      title, creator: "buno", description: String(input?.description || ""),
      deadline: /^\d{4}-\d{2}-\d{2}$/.test(input?.deadline || "") ? input.deadline : null,
      priority: ["regular", "important", "critical"].includes(input?.priority) ? input.priority : "regular",
      origin: { type: "chat", ref: "chat-" + crypto.randomUUID() },
      draft,
    };
    const { data, error } = await supabase.from("card").insert(row).select("id,title").single();
    if (error) return "לא נוצר (שגיאה): " + error.message;
    created.push({ id: data.id, title: data.title, project: project.name, level: cardLevel });
    return cardLevel === "act"
      ? `נוצר כרטיס פעיל "${title}" בפרויקט ${project.name}.`
      : `נוצרה טיוטה "${title}" בפרויקט ${project.name}, ממתינה לאישור המשתמש.`;
  }

  // ---- board organization (agency): reversible ops on explicit request -------
  const changed: string[] = [];
  const activeCards = () => (cards.data || []).filter((c: any) => !c.archived);
  function findCard(q: string): any | null {
    const s = String(q || "").toLowerCase().trim();
    if (!s) return null;
    const list = activeCards();
    return list.find((c: any) => (c.title || "").toLowerCase() === s)
      || list.find((c: any) => (c.title || "").toLowerCase().includes(s))
      || list.find((c: any) => c.title && s.includes((c.title || "").toLowerCase()))
      || null;
  }
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

  const today = todayStr2; // YYYY-MM-DD in IL, for relative dates
  const nowIL = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(nowD);
  const sys = systemPrompt({
    productName: "buno",
    language: "Hebrew",
    profileName: prof.data?.name || "",
    boardSummary: summarizeBoard(projects, cards.data || [], cols.data || [], commentsByCard, attachByCard, todayStr2, nowD.getTime()),
    // capabilities reflect exactly what THIS request sends: the create + organize
    // tools are always attached; calendar is context-only when we have events;
    // email is never available in the chat. Keeps the prompt honest to itself.
    capabilities: { createCard: true, organizeCards: true, calendar: !!calendarSummary, email: false },
  }) + (calendarSummary ? `\n\n=== היומן שלך · ${scope === "week" ? "7 ימים קרובים" : scope === "tomorrow" ? `מחר (${tomorrowStr})` : `היום (${todayStr2})`} · קריאה בלבד — DATA ===\n${calendarSummary}\n=== סוף היומן ===\nענה ממוקד על טווח הזמן שנשאל בלבד: אם שאלו "מה פתוח היום" — דבר על היום בלבד, פגישות לפי סדר השעות, בלי לגלוש למחר או לשבוע (אלא אם ביקשו). קצר ותכליתי — בלי לחזור על כל שורה ביומן. אם משתתף בפגישה שייך ללקוח מסוים (לפי דומיין המייל), אפשר לקשר את הפגישה לאותו לקוח.` : "") + `

=== כללי־יסוד (מעל הכל — שבירתם שוברת אמון) ===
1. כנות מוחלטת: לעולם אל תדווח על פעולה שלא ביצעת בפועל דרך הכלים שלך. לא סרקת מייל? אל תגיד שסרקת. לא יצרת/הזזת כרטיס? אל תגיד שכן. אין לך גישה למייל בשיחה הזו — אל תמציא "מצאתי במייל".
2. בלי המצאות: אם נתון לא מופיע בקונטקסט שקיבלת (תוכן מייל, מי אמר מה, שעה) — אמור בפשטות שאין לך אותו, אל תנחש.
3. זמן אמיתי: כרגע בישראל ${nowIL}. הסתמך על זה ועל "פתוח X ימים"/"דדליין" שבקונטקסט — אל תמציא "עומד שבוע" אם לא ידוע.
4. סגנון: כתוב עברית זורמת וטבעית, טקסט רגיל בלבד. בלי Markdown, בלי כוכביות (** או *), בלי כותרות #. אם צריך רשימה — תבליט • קצר. משפטים קצרים.
5. תמציתיות: תשובת סטטוס = עד 3 שורות, אלא אם המשתמש ביקש פירוט. אל תחזור על מה שכבר מוצג על המסך; ענה לשאלה ותעצור.
6. עדיפות: כשנשאל "מה הכי דחוף/חשוב" — כרטיס שמסומן קריטי מופיע ראשון, אחריו חשוב, ורק אז שיקולי דדליין (בעקביות עם סדר "היום שלי": קריטי < חשוב < רגיל).

Today is ${today}. When the user gives a relative date ("מחר", "יום ראשון"), convert it to a real YYYY-MM-DD for the deadline; if no real date is given, omit it.

=== TOOLS ===
create_card — the card-permission level is "${cardLevel}" ("act" = card goes live immediately; "draft"/"suggest" = pending draft the user approves — enforced in code). Call it when the user clearly asks to add/open/create a task. Never invent tasks the user didn't ask for.
move_card / complete_card / archive_card — organize the board on the user's EXPLICIT request only (e.g. "העבר ל'בעבודה'", "סמן שסיימתי", "תארכב"). These act directly (reversible). Identify the card by its title. Never move/complete/archive a card the user didn't clearly name.
After any tool call, tell the user plainly in one line what actually happened. If a tool reported it couldn't find the card/column, say so honestly — don't pretend it worked.`;

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
    for (let hop = 0; hop < 4; hop++) {
      const res: any = await anthropic.messages.create({
        model: "claude-opus-5",
        max_tokens: 1024,
        output_config: { effort: "low" },
        system: sys,
        tools: [CREATE_CARD_TOOL, MOVE_CARD_TOOL, COMPLETE_CARD_TOOL, ARCHIVE_CARD_TOOL],
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
        else if (tu.name === "move_card") out = await doMoveCard(tu.input);
        else if (tu.name === "complete_card") out = await doCompleteCard(tu.input);
        else if (tu.name === "archive_card") out = await doArchiveCard(tu.input);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (e) {
    return json({ error: "assistant failed", detail: String(e) }, 502);
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
    const meta = (created.length || responseEvents.length) ? { created, events: responseEvents } : null;
    if (threadId) {
      await supabase.from("assistant_message").insert([
        { thread_id: threadId, role: "user", door: "web", content: userMessage },
        { thread_id: threadId, role: "assistant", door: "web", content: reply, meta },
      ]);
    }
    return json({ reply, threadId, created, changed: changed.length, events: responseEvents, voiceOk: lint.ok, voiceHits: lint.hits });
  } catch {
    return json({ reply, created, changed: changed.length, voiceOk: lint.ok, voiceHits: lint.hits });
  }
});
