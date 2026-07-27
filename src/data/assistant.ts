// buno — client bridge to the live assistant Edge Function (/chat).
// Conversation only (Stage 3a). The board summary is built server-side under
// the user's RLS; nothing sensitive is assembled here.
import { supabase } from "../lib/supabase";

export type CreatedCard = { id: string; title: string; project: string; level: string };
export type AssistantReply = { reply: string; threadId?: string; voiceOk?: boolean; refused?: boolean; created?: CreatedCard[] };

export async function askAssistant(
  message: string,
  history: { role: "user" | "assistant"; content: string }[],
  threadId?: string,
  currentProjectId?: string | null,
): Promise<AssistantReply> {
  if (!supabase) throw new Error("assistant requires cloud mode");
  const { data, error } = await supabase.functions.invoke("chat", {
    body: { message, history, threadId, currentProjectId },
  });
  if (error) throw new Error(error.message || "assistant unavailable");
  return data as AssistantReply;
}

export const assistantLive = !!supabase;

// The unified thread's history (oldest first) + its id, straight from the DB
// under RLS. This is what makes the conversation continue across devices and,
// later, across doors — the panel opens where you left off, anywhere.
export type ThreadHistory = { threadId?: string; msgs: { by: "me" | "twin"; text: string }[] };
export async function loadThreadHistory(limit = 60): Promise<ThreadHistory> {
  if (!supabase) return { msgs: [] };
  const { data: threads } = await supabase.from("assistant_thread")
    .select("id").order("created_at").limit(1);
  const threadId = threads?.[0]?.id;
  if (!threadId) return { msgs: [] };
  const { data } = await supabase.from("assistant_message")
    .select("role,content,created_at").eq("thread_id", threadId)
    .order("created_at", { ascending: false }).limit(limit);
  const msgs = (data || []).reverse()
    .map((m) => ({ by: m.role === "assistant" ? "twin" as const : "me" as const, text: m.content }));
  return { threadId, msgs };
}
