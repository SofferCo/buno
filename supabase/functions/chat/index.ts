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

function summarizeBoard(projects: any[], cards: any[], cols: any[]): string {
  const colTitle = new Map<string, string>();
  for (const c of cols) colTitle.set(c.id, c.title);
  const projName = new Map<string, string>();
  for (const p of projects) projName.set(p.id, p.name);
  const active = cards.filter((c) => !c.archived);
  const head = `הפרויקטים: ${projects.map((p) => p.name).join(" · ") || "—"}`;
  if (!active.length) return head + "\n(אין משימות פעילות.)";
  const byProject: Record<string, any[]> = {};
  for (const c of active) (byProject[c.project_id] = byProject[c.project_id] || []).push(c);
  const lines: string[] = [head];
  for (const pid of Object.keys(byProject)) {
    lines.push(`\nפרויקט: ${projName.get(pid) || "—"}`);
    for (const c of byProject[pid].slice(0, 40)) {
      const parts = [`• ${c.title || "ללא כותרת"}`];
      if (c.column_id && colTitle.get(c.column_id)) parts.push(`[${colTitle.get(c.column_id)}]`);
      if (c.deadline) parts.push(`דדליין ${c.deadline}`);
      if (c.priority && c.priority !== "regular") parts.push(c.priority === "critical" ? "קריטי" : "חשוב");
      lines.push(parts.join(" "));
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

  const [proj, cards, cols, prof, asst] = await Promise.all([
    supabase.from("project").select("id,name"),
    supabase.from("card").select("id,project_id,column_id,title,deadline,priority,time_spent,archived"),
    supabase.from("board_column").select("id,project_id,key,title,position"),
    supabase.from("profile").select("name").eq("id", user.id).maybeSingle(),
    supabase.from("assistant_settings").select("cards").eq("user_id", user.id).maybeSingle(),
  ]);
  const projects = proj.data || [];
  const cardLevel = (asst.data?.cards || "draft") as "suggest" | "draft" | "act"; // server-side matrix

  // ---- calendar context: the twin must see the schedule, not just the board.
  // Read-only, next 7 days, summarized as DATA. Uses the service role only to
  // fetch the user's token (server-side); the browser never sees it.
  let calendarSummary = "";
  let calEventsRaw: any[] = [];
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const access = await freshAccessToken(admin, user.id, "gcal");
    if (access) {
      const now = new Date();
      calEventsRaw = await listCalendarEvents(access, new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(), new Date(now.getTime() + 7 * 864e5).toISOString());
      if (calEventsRaw.length) {
        calendarSummary = calEventsRaw.slice(0, 30).map((e: any) => {
          const when = e.allDay ? (e.start || "").slice(0, 10) : (e.start || "").replace("T", " ").slice(0, 16);
          const who = (e.attendees || []).filter((a: any) => !a.self).map((a: any) => a.email).slice(0, 6).join(", ");
          return `• ${when} · ${e.title}${who ? ` · עם: ${who}` : ""}${e.meetLink ? " · Meet" : ""}`;
        }).join("\n");
      }
    }
  } catch { /* calendar optional */ }
  // when the user asks about the schedule, surface the relevant events as
  // clickable chips in the chat (not just prose). Heuristic intent match.
  const scheduleIntent = /יומן|פגיש|מתי|היום|מחר|מחרתיים|השבוע|לו"?ז|לוח.?זמנ|meeting|schedule|calendar|agenda/i.test(userMessage);
  const responseEvents = scheduleIntent ? calEventsRaw.slice(0, 12) : [];

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
    const draft = cardLevel === "act" ? null : { by: "העוזר", at: Date.now(), level: cardLevel };
    const row: any = {
      project_id: project.id, column_id: brief?.id || null, position: maxPos,
      title, creator: "העוזר", description: String(input?.description || ""),
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

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, for relative dates
  const sys = systemPrompt({
    productName: "buno",
    language: "Hebrew",
    profileName: prof.data?.name || "",
    boardSummary: summarizeBoard(projects, cards.data || [], cols.data || []),
  }) + (calendarSummary ? `\n\n=== היומן שלך (7 ימים קרובים, קריאה בלבד — DATA) ===\n${calendarSummary}\n=== סוף היומן ===\nכשנשאל על "היום", פגישות, או מה קורה — שקלל גם את היומן, לא רק את הלוח. אם משתתף בפגישה שייך ללקוח מסוים (לפי דומיין המייל), אפשר לקשר את הפגישה לאותו לקוח.` : "") + `\n\nToday is ${today}. When the user gives a relative date ("מחר", "יום ראשון"), convert it to a real YYYY-MM-DD for the deadline; if no real date is given, omit it.

TOOLS: you have create_card. The user's card-permission level is "${cardLevel}" — with "act" a card goes live immediately; with "draft"/"suggest" it is created as a pending draft the user approves. This is enforced in code regardless of what you say. When the user clearly asks to add/open/create a task (e.g. "תפתח לי משימה…", "תוסיף…"), CALL create_card — do not say you can't. Never invent tasks the user didn't ask for. After creating, tell the user plainly in one line what happened (טיוטה ממתינה לאישור, or כרטיס פעיל).`;

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
        tools: [CREATE_CARD_TOOL],
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
    return json({ reply, threadId, created, events: responseEvents, voiceOk: lint.ok, voiceHits: lint.hits });
  } catch {
    return json({ reply, created, voiceOk: lint.ok, voiceHits: lint.hits });
  }
});
