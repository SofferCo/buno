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
