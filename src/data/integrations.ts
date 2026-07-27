// buno — client bridge to the Google integration (Stage 4). All the sensitive
// work (tokens, Google API) is server-side; this only kicks off the consent
// redirect and reads back status/events.
import { supabase } from "../lib/supabase";

export type Integration = { kind: string; status: string; external_id: string | null; scopes: string[]; connected_at: string | null };
export type CalEvent = { id: string; title: string; start: string | null; end: string | null; allDay: boolean; location: string | null };

export async function listIntegrations(): Promise<Integration[]> {
  if (!supabase) return [];
  const { data } = await supabase.from("integration").select("kind,status,external_id,scopes,connected_at");
  return (data as Integration[]) || [];
}

// Start the Google consent flow: get the URL from the function, send the
// browser there. Google redirects back to the app with ?connected=…
export async function connectGoogle(): Promise<void> {
  if (!supabase) throw new Error("cloud mode required");
  const { data, error } = await supabase.functions.invoke("google-oauth", {
    body: { action: "start", origin: window.location.origin },
  });
  if (error) throw new Error(error.message || "connect failed");
  if (data?.url) window.location.href = data.url;
}

export async function disconnectGoogle(): Promise<void> {
  if (!supabase) return;
  await supabase.from("integration").delete().eq("kind", "gcal");
}

export async function fetchCalendar(timeMin?: string, timeMax?: string): Promise<{ connected: boolean; events: CalEvent[] }> {
  if (!supabase) return { connected: false, events: [] };
  const { data, error } = await supabase.functions.invoke("calendar", { body: { timeMin, timeMax } });
  if (error) return { connected: false, events: [] };
  return data as { connected: boolean; events: CalEvent[] };
}
