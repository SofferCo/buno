// buno — the assistant conversation core, runnable SERVER-SIDE (service role)
// for a given userId. Used by the WhatsApp door (wa-webhook). It shares the
// SAME thread + memory as the web chat: one twin, one conversation, one board
// context — just entered through a different door.
//
// Note: the web /chat function still has its own copy of this loop (with the
// create_card/move tools). Step A keeps WhatsApp conversational (board-aware,
// no tools yet); unifying both onto this core is a planned follow-up.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.68.0";
import { systemPrompt } from "./voice.ts";

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

// Run one conversational turn for userId over their shared thread. Persists the
// user message and buno's reply with the given door. Returns the reply text.
export async function assistantReply(admin: SupabaseClient, userId: string, userMessage: string, apiKey: string, door = "whatsapp"): Promise<string> {
  // board context, admin-scoped to the user's own projects (no RLS here)
  const { data: mem } = await admin.from("project_member").select("project_id").eq("user_id", userId);
  const ids = (mem || []).map((m: any) => m.project_id);
  const [{ data: projects }, { data: cards }, { data: cols }, { data: prof }] = await Promise.all([
    ids.length ? admin.from("project").select("id,name").in("id", ids) : Promise.resolve({ data: [] as any[] }),
    ids.length ? admin.from("card").select("id,project_id,column_id,title,deadline,priority,archived").in("project_id", ids) : Promise.resolve({ data: [] as any[] }),
    ids.length ? admin.from("board_column").select("id,project_id,key,title").in("project_id", ids) : Promise.resolve({ data: [] as any[] }),
    admin.from("profile").select("name").eq("id", userId).maybeSingle(),
  ]);

  // shared thread: reuse the user's latest, else create one
  let threadId: string | undefined;
  const { data: t } = await admin.from("assistant_thread").select("id").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  threadId = t?.id;
  if (!threadId) { const { data: nt } = await admin.from("assistant_thread").insert({ user_id: userId }).select("id").single(); threadId = nt?.id; }

  const { data: recent } = threadId
    ? await admin.from("assistant_message").select("role,content").eq("thread_id", threadId).order("created_at", { ascending: false }).limit(12)
    : { data: [] as any[] };
  const history = (recent || []).reverse().map((m: any) => ({ role: m.role === "user" ? "user" : "assistant", content: String(m.content || "") }));

  const sys = systemPrompt({
    productName: "buno", language: "Hebrew", profileName: prof?.name || "",
    boardSummary: summarize(projects || [], cards || [], cols || []),
    capabilities: { createCard: false, organizeCards: false, calendar: false, email: false },
  }) + `\n\nהודעת וואטסאפ — קצר במיוחד: משפט־שניים, בלי הרצאות, בלי Markdown. ענה לעניין ותעצור.`;

  let reply = "מצטער, לא הצלחתי להשיב כרגע.";
  try {
    const anthropic = new Anthropic({ apiKey });
    const res: any = await anthropic.messages.create({
      model: "claude-opus-5", max_tokens: 400, output_config: { effort: "low" },
      system: sys, messages: [...history, { role: "user", content: userMessage }],
    });
    const txt = res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    if (txt) reply = txt;
  } catch { /* fall through to the default reply */ }

  if (threadId) {
    await admin.from("assistant_message").insert([
      { thread_id: threadId, role: "user", door, content: userMessage },
      { thread_id: threadId, role: "assistant", door, content: reply },
    ]);
  }
  return reply;
}
