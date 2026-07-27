// buno assistant — /chat Edge Function (Stage 3a: conversation only, no tools).
// Runs Claude (claude-opus-5) over a read-only summary of the user's board and
// returns a reply. Enforcement of the permission matrix (assistantAction) is
// NOT here — this step can only talk, not act.
//
// Security posture:
// - The caller's JWT is forwarded to a per-request Supabase client, so every
//   board read runs under the user's RLS. The function never uses service_role.
// - Board content is injected as DATA in the system prompt; the prompt states
//   it is never instructions (iron rule #2).
// - ANTHROPIC_API_KEY lives only in the function env, never reaches the client.
import Anthropic from "npm:@anthropic-ai/sdk@0.68.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { systemPrompt, voiceLint } from "../_shared/voice.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Compact, factual board summary — titles/clients verbatim, no invented data.
function summarizeBoard(projects: any[], cards: any[], cols: any[]): string {
  const colTitle = new Map<string, string>();
  for (const c of cols) colTitle.set(c.id, c.title);
  const projName = new Map<string, string>();
  for (const p of projects) projName.set(p.id, p.name);
  const active = cards.filter((c) => !c.archived);
  if (!active.length) return "הלוח ריק כרגע — אין משימות פעילות.";
  const byProject: Record<string, any[]> = {};
  for (const c of active) (byProject[c.project_id] = byProject[c.project_id] || []).push(c);
  const lines: string[] = [];
  for (const pid of Object.keys(byProject)) {
    lines.push(`פרויקט: ${projName.get(pid) || "—"}`);
    for (const c of byProject[pid].slice(0, 40)) {
      const parts = [`• ${c.title || "ללא כותרת"}`];
      if (c.column_id && colTitle.get(c.column_id)) parts.push(`[${colTitle.get(c.column_id)}]`);
      if (c.deadline) parts.push(`דדליין ${c.deadline}`);
      if (c.priority && c.priority !== "regular") parts.push(c.priority === "critical" ? "קריטי" : "חשוב");
      if (c.time_spent) parts.push(`${Math.ceil(c.time_spent / 3600)}ש׳`);
      lines.push(parts.join(" "));
    }
  }
  return lines.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing authorization" }, 401);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "assistant not configured" }, 500);

  // per-request client bound to the caller's JWT → all reads are RLS-scoped
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
  if (!userMessage) return json({ error: "empty message" }, 400);

  // gather board context (RLS-scoped) + profile name
  const [proj, cards, cols, prof] = await Promise.all([
    supabase.from("project").select("id,name"),
    supabase.from("card").select("id,project_id,column_id,title,deadline,priority,time_spent,archived"),
    supabase.from("board_column").select("id,title"),
    supabase.from("profile").select("name").eq("id", user.id).maybeSingle(),
  ]);
  const boardSummary = summarizeBoard(proj.data || [], cards.data || [], cols.data || []);

  const sys = systemPrompt({
    productName: "buno",
    language: "Hebrew",
    profileName: prof.data?.name || "",
    boardSummary,
  });

  const anthropic = new Anthropic({ apiKey });
  const msgs = [
    ...history
      .filter((m: any) => m?.role === "user" || m?.role === "assistant")
      .slice(-12)
      .map((m: any) => ({ role: m.role, content: String(m.content || "") })),
    { role: "user" as const, content: userMessage },
  ];

  let reply = "";
  try {
    const res = await anthropic.messages.create({
      model: "claude-opus-5",
      max_tokens: 1024,
      output_config: { effort: "low" }, // snappy conversational turns
      system: sys,
      messages: msgs,
    });
    if (res.stop_reason === "refusal") {
      return json({ reply: "מצטער, לא אוכל לענות על זה." , refused: true });
    }
    reply = res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
  } catch (e) {
    return json({ error: "assistant failed", detail: String(e) }, 502);
  }

  // voice lint — log violations; don't block (v1). Surfaced for tuning.
  const lint = voiceLint(reply);

  // persist to the unified thread (basis for "one twin across doors")
  try {
    let threadId = payload?.threadId;
    if (!threadId) {
      const { data: t } = await supabase.from("assistant_thread").insert({ user_id: user.id }).select("id").single();
      threadId = t?.id;
    }
    if (threadId) {
      await supabase.from("assistant_message").insert([
        { thread_id: threadId, role: "user", door: "web", content: userMessage },
        { thread_id: threadId, role: "assistant", door: "web", content: reply },
      ]);
    }
    return json({ reply, threadId, voiceOk: lint.ok, voiceHits: lint.hits });
  } catch {
    return json({ reply, voiceOk: lint.ok, voiceHits: lint.hits });
  }
});
