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

const CREATE_CARD_TOOL = {
  name: "create_card",
  description: "Create a task card on the user's board. Use only when the user clearly asks to add/open/create a task. Cards are created as pending drafts the user approves unless their permission level is 'act'.",
  input_schema: { type: "object", properties: {
    title: { type: "string", description: "Short task title, ≤10 words, verb-first, in Hebrew." },
    description: { type: "string", description: "Optional one-sentence Hebrew context." },
    project: { type: "string", description: "Optional project name to place the card under." },
    deadline: { type: "string", description: "Optional due date YYYY-MM-DD, only if the user stated one." },
    priority: { type: "string", enum: ["regular", "important", "critical"] },
  }, required: ["title"] },
};
const MOVE_CARD_TOOL = { name: "move_card", description: "Move an existing card to another column on its board. Only on explicit request. Reversible.", input_schema: { type: "object", properties: { card: { type: "string" }, column: { type: "string" } }, required: ["card", "column"] } };
const COMPLETE_CARD_TOOL = { name: "complete_card", description: "Mark a card done (move to the Done column). Only when the user says a task is finished.", input_schema: { type: "object", properties: { card: { type: "string" } }, required: ["card"] } };
const ARCHIVE_CARD_TOOL = { name: "archive_card", description: "Archive a card (remove from the active board, reversible). Only on explicit request.", input_schema: { type: "object", properties: { card: { type: "string" } }, required: ["card"] } };

function summarize(projects: any[], cards: any[], cols: any[]): string {
  const colTitle = new Map<string, string>(cols.map((c: any) => [c.id, c.title]));
  const projName = new Map<string, string>(projects.map((p: any) => [p.id, p.name]));
  const active = cards.filter((c: any) => !c.archived);
  const head = `הפרויקטים: ${projects.map((p: any) => p.name).join(" · ") || "—"}`;
  if (!active.length) return head + "\n(אין משימות פעילות.)";
  const byProj: Record<string, any[]> = {};
  for (const c of active) (byProj[c.project_id] = byProj[c.project_id] || []).push(c);
  const lines = [head];
  for (const pid of Object.keys(byProj)) {
    lines.push(`\nפרויקט: ${projName.get(pid) || "—"}`);
    for (const c of byProj[pid].slice(0, 30)) {
      const parts = [`• ${c.title || "ללא כותרת"}`];
      if (c.column_id && colTitle.get(c.column_id)) parts.push(`[${colTitle.get(c.column_id)}]`);
      if (c.deadline) parts.push(`דדליין ${c.deadline}`);
      if (c.priority && c.priority !== "regular") parts.push(c.priority === "critical" ? "קריטי" : "חשוב");
      lines.push(parts.join(" "));
    }
  }
  return lines.join("\n");
}

export async function assistantReply(admin: SupabaseClient, userId: string, userMessage: string, apiKey: string, door = "whatsapp"): Promise<string> {
  // board context + settings, admin-scoped to the user's own projects (no RLS)
  const { data: mem } = await admin.from("project_member").select("project_id,role").eq("user_id", userId);
  const writeIds = (mem || []).filter((m: any) => m.role !== "viewer").map((m: any) => m.project_id);
  const ids = (mem || []).map((m: any) => m.project_id);
  const [{ data: projRows }, { data: cardRows }, { data: colRows }, { data: prof }, { data: asst }] = await Promise.all([
    ids.length ? admin.from("project").select("id,name").in("id", ids) : Promise.resolve({ data: [] as any[] }),
    ids.length ? admin.from("card").select("id,project_id,column_id,title,deadline,priority,archived").in("project_id", ids) : Promise.resolve({ data: [] as any[] }),
    ids.length ? admin.from("board_column").select("id,project_id,key,title,position,is_done").in("project_id", ids) : Promise.resolve({ data: [] as any[] }),
    admin.from("profile").select("name").eq("id", userId).maybeSingle(),
    admin.from("assistant_settings").select("cards").eq("user_id", userId).maybeSingle(),
  ]);
  const projects = (projRows || []).filter((p: any) => writeIds.includes(p.id) || !writeIds.length);
  const cards = cardRows || [];
  const cols = colRows || [];
  const cardLevel = (asst?.cards || "draft") as "suggest" | "draft" | "act";

  // ---- tools (same behavior + enforcement as web chat) ----------------------
  const created: any[] = [];
  const changed: string[] = [];
  const doneColIds = new Set(cols.filter((c: any) => c.is_done).map((c: any) => c.id));
  const findCard = (q: string) => {
    const s = String(q || "").toLowerCase().trim(); if (!s) return null;
    const list = cards.filter((c: any) => !c.archived && !doneColIds.has(c.column_id));
    return list.find((c: any) => (c.title || "").toLowerCase() === s)
      || list.find((c: any) => (c.title || "").toLowerCase().includes(s))
      || list.find((c: any) => c.title && s.includes((c.title || "").toLowerCase())) || null;
  };
  async function doCreateCard(input: any): Promise<string> {
    const title = String(input?.title || "").trim(); if (!title) return "לא נוצר: חסרה כותרת.";
    const project = projects.find((p: any) => input?.project && p.name && p.name.toLowerCase().includes(String(input.project).toLowerCase())) || projects[0];
    if (!project) return "לא נוצר: אין פרויקט זמין.";
    const projCols = cols.filter((c: any) => c.project_id === project.id);
    const brief = projCols.find((c: any) => c.key === "col-brief") || projCols.slice().sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))[0];
    const maxPos = cards.filter((c: any) => c.project_id === project.id && c.column_id === brief?.id && !c.archived).length;
    const draft = cardLevel === "act" ? null : { by: "buno", at: Date.now(), level: cardLevel };
    const { data, error } = await admin.from("card").insert({
      project_id: project.id, column_id: brief?.id || null, position: maxPos, title, creator: "buno",
      description: String(input?.description || ""), deadline: /^\d{4}-\d{2}-\d{2}$/.test(input?.deadline || "") ? input.deadline : null,
      priority: ["regular", "important", "critical"].includes(input?.priority) ? input.priority : "regular",
      origin: { type: "whatsapp", ref: "wa-" + crypto.randomUUID() }, draft,
    }).select("id,title,project_id,column_id,archived").single();
    if (error) return "לא נוצר (שגיאה): " + error.message;
    cards.push(data); created.push({ id: data.id, title: data.title, project: project.name, level: cardLevel });
    return cardLevel === "act" ? `נוצר כרטיס "${title}" ב${project.name}.` : `נוצרה טיוטה "${title}" ב${project.name}, ממתינה לאישורך.`;
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

  // shared thread + recent history
  let threadId: string | undefined;
  const { data: t } = await admin.from("assistant_thread").select("id").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  threadId = t?.id;
  if (!threadId) { const { data: nt } = await admin.from("assistant_thread").insert({ user_id: userId }).select("id").single(); threadId = nt?.id; }
  const { data: recent } = threadId
    ? await admin.from("assistant_message").select("role,content").eq("thread_id", threadId).order("created_at", { ascending: false }).limit(12)
    : { data: [] as any[] };
  const history = (recent || []).reverse().map((m: any) => ({ role: m.role === "user" ? "user" : "assistant", content: String(m.content || "") }));

  const today = new Date().toISOString().slice(0, 10);
  const sys = systemPrompt({
    productName: "buno", language: "Hebrew", profileName: prof?.name || "",
    boardSummary: summarize(projects, cards, cols),
    capabilities: { createCard: true, organizeCards: true, calendar: false, email: false },
  }) + `\n\nToday is ${today}. הודעת וואטסאפ — קצר במיוחד: משפט־שניים, בלי Markdown.
כלים: create_card ברמת "${cardLevel}" ("act"=כרטיס חי מיד; אחרת טיוטה לאישור — נאכף בקוד). move_card/complete_card/archive_card רק על בקשה מפורשת, זיהוי לפי כותרת. אחרי כלי — שורה אחת מה קרה, בכנות.`;

  const messages: any[] = [...history, { role: "user", content: userMessage }];
  let reply = "מצטער, לא הצלחתי להשיב כרגע.";
  try {
    const anthropic = new Anthropic({ apiKey });
    for (let hop = 0; hop < 4; hop++) {
      const res: any = await anthropic.messages.create({
        model: "claude-opus-5", max_tokens: 700, output_config: { effort: "low" },
        system: sys, tools: [CREATE_CARD_TOOL, MOVE_CARD_TOOL, COMPLETE_CARD_TOOL, ARCHIVE_CARD_TOOL], messages,
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
        else if (tu.name === "move_card") out = await doMoveCard(tu.input);
        else if (tu.name === "complete_card") out = await doCompleteCard(tu.input);
        else if (tu.name === "archive_card") out = await doArchiveCard(tu.input);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
      }
      messages.push({ role: "user", content: results });
    }
  } catch { /* keep the default reply */ }

  if (threadId) {
    await admin.from("assistant_message").insert([
      { thread_id: threadId, role: "user", door, content: userMessage },
      { thread_id: threadId, role: "assistant", door, content: reply, meta: created.length ? { created } : null },
    ]);
  }
  return reply;
}
