// buno — client bridge to the live assistant Edge Function (/chat).
// Conversation only (Stage 3a). The board summary is built server-side under
// the user's RLS; nothing sensitive is assembled here.
import { supabase } from "../lib/supabase";

export type CreatedCard = { id: string; title: string; project: string; level: string };
export type AssistantReply = { reply: string; threadId?: string; voiceOk?: boolean; refused?: boolean; created?: CreatedCard[]; events?: any[] };

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

// Load the user's ongoing twin conversation (one entity, continuous across
// open/close and — later — across doors). Returns the latest thread + its
// messages, mapped to the ChatPanel's shape.
export async function loadAssistantThread(): Promise<{ threadId?: string; messages: { by: "me" | "twin"; text: string; cards?: CreatedCard[]; events?: any[] }[] }> {
  if (!supabase) return { messages: [] };
  const { data: t } = await supabase.from("assistant_thread").select("id").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!t) return { messages: [] };
  const { data: m } = await supabase.from("assistant_message").select("role,content,meta").eq("thread_id", t.id).order("created_at");
  return {
    threadId: t.id,
    messages: (m || []).map((x: any) => ({ by: x.role === "user" ? "me" : "twin", text: x.content, cards: x.meta?.created || undefined, events: x.meta?.events || undefined })),
  };
}
