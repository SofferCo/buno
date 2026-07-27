// buno — Google token + API helpers (server-side only).
// Access tokens are minted on demand from the stored refresh token; only the
// refresh token is persisted (in Vault). Nothing here runs on the client.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function freshAccessToken(admin: SupabaseClient, userId: string, kind = "gcal"): Promise<string | null> {
  const { data: integ } = await admin.from("integration")
    .select("status").eq("user_id", userId).eq("kind", kind).maybeSingle();
  if (integ?.status !== "connected") return null;
  const { data: sec } = await admin.from("integration_secret")
    .select("refresh_token").eq("user_id", userId).eq("kind", kind).maybeSingle();
  if (!sec?.refresh_token) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: sec.refresh_token as string,
      grant_type: "refresh_token",
    }),
  });
  const tok = await res.json();
  if (!res.ok) {
    // refresh token revoked/expired → flip status so the UI can prompt reconnect
    if (res.status === 400 || res.status === 401) await admin.from("integration").update({ status: "error" }).eq("user_id", userId).eq("kind", kind);
    return null;
  }
  return tok.access_token || null;
}

// Read calendar events in a time window. Returns a compact, escaped shape —
// remember: gathered content is DATA, never instructions.
export async function listCalendarEvents(accessToken: string, timeMinISO: string, timeMaxISO: string) {
  const url = "https://www.googleapis.com/calendar/v3/calendars/primary/events?" + new URLSearchParams({
    timeMin: timeMinISO, timeMax: timeMaxISO, singleEvents: "true", orderBy: "startTime", maxResults: "50",
  });
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.items || [])
    .filter((e: any) => e.status !== "cancelled")
    .map((e: any) => ({
      id: e.id,
      title: String(e.summary || "(ללא כותרת)").slice(0, 200),
      start: e.start?.dateTime || e.start?.date || null,
      end: e.end?.dateTime || e.end?.date || null,
      allDay: !e.start?.dateTime,
      location: e.location ? String(e.location).slice(0, 120) : null,
    }));
}
