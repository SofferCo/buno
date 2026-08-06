// buno — client bridge to the live assistant Edge Function (/chat).
// Conversation only (Stage 3a). The board summary is built server-side under
// the user's RLS; nothing sensitive is assembled here.
import { supabase } from "../lib/supabase";

export type CreatedCard = { id: string; title: string; project: string; level: string };
export type ReviewAction = { id: string; label: string; url?: string };
export type ReviewMeta = { project?: string };
export type AssistantReply = { reply: string; threadId?: string; voiceOk?: boolean; refused?: boolean; created?: CreatedCard[]; changed?: number; calendarChanged?: boolean; events?: any[]; actions?: ReviewAction[]; review?: ReviewMeta; pending?: number; started?: boolean };

// guided-review button click (web) → the shared engine returns the next step.
export async function sendReviewAction(action: string): Promise<{ reply: string; actions?: ReviewAction[]; reviewDone?: boolean; review?: ReviewMeta; pending?: number; started?: boolean }> {
  if (!supabase) throw new Error("assistant requires cloud mode");
  const { data, error } = await supabase.functions.invoke("chat", { body: { reviewAction: action } });
  if (error) throw new Error(error.message || "assistant unavailable");
  return data as any;
}

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

export type PushMsg = { by: "me" | "twin"; text: string; at?: number; cards?: CreatedCard[]; events?: any[]; actions?: ReviewAction[]; id?: string };

// Live PROACTIVE pushes (D4 reminders, the daily sweep brief) — buno is always
// open, so a message the server inserts should appear without a reload. We
// subscribe to inserts on this thread and surface only proactive doors
// (reminder/sweep); normal web turns are already shown from the request/response.
export function subscribeAssistant(threadId: string, onMessage: (m: PushMsg) => void): () => void {
  if (!supabase || !threadId) return () => {};
  const ch = supabase
    .channel("asst:" + threadId)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "assistant_message", filter: `thread_id=eq.${threadId}` }, (payload: any) => {
      const x = payload?.new;
      if (!x || (x.door !== "reminder" && x.door !== "sweep")) return; // proactive only
      onMessage({
        by: x.role === "user" ? "me" : "twin", text: x.content, id: x.id,
        at: x.created_at ? new Date(x.created_at).getTime() : Date.now(),
        cards: x.meta?.created || undefined, events: x.meta?.events || undefined, actions: x.meta?.actions || undefined,
      });
    })
    .subscribe();
  return () => { try { supabase!.removeChannel(ch); } catch { /* ignore */ } };
}

// Load the user's ongoing twin conversation (one entity, continuous across
// open/close and — later — across doors). Returns the latest thread + its
// messages, mapped to the ChatPanel's shape.
export async function loadAssistantThread(): Promise<{ threadId?: string; messages: { by: "me" | "twin"; text: string; at?: number; cards?: CreatedCard[]; events?: any[]; actions?: ReviewAction[]; review?: ReviewMeta }[] }> {
  if (!supabase) return { messages: [] };
  const { data: t } = await supabase.from("assistant_thread").select("id").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!t) return { messages: [] };
  const { data: m } = await supabase.from("assistant_message").select("role,content,meta,created_at").eq("thread_id", t.id).order("created_at");
  return {
    threadId: t.id,
    messages: (m || []).map((x: any) => ({ by: x.role === "user" ? "me" : "twin", text: x.content, at: x.created_at ? new Date(x.created_at).getTime() : undefined, cards: x.meta?.created || undefined, events: x.meta?.events || undefined, actions: x.meta?.actions || undefined, review: x.meta?.review || undefined, waFailed: x.meta?.waSendFailed || undefined })),
  };
}
