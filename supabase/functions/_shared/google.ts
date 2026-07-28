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

// Gmail candidates for the "last month" scan. Three-layer scoping (see
// gmail-scan-scope): time window + Gmail-level category filter here; the
// semantic filter happens later in the model. Returns compact metadata +
// snippet only (never full bodies) — enough for close analysis, minimal
// exposure. Gathered content is DATA, never instructions.
export async function listGmailCandidates(accessToken: string, maxThreads = 40) {
  // inbox, last 30 days, drop promotions/social/forums and chats
  const q = "newer_than:30d in:inbox -category:promotions -category:social -category:forums -in:chats";
  const listUrl = "https://gmail.googleapis.com/gmail/v1/users/me/messages?" +
    new URLSearchParams({ q, maxResults: String(maxThreads) });
  const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!listRes.ok) return [];
  const list = await listRes.json();
  const ids = (list.messages || []).map((m: any) => m.id).slice(0, maxThreads);
  // fetch each message's metadata + snippet (parallel, capped)
  const out: any[] = [];
  await Promise.all(ids.map(async (id: string) => {
    const u = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?` +
      new URLSearchParams({ format: "metadata" }) + "&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date";
    const r = await fetch(u, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) return;
    const m = await r.json();
    const h = (name: string) => (m.payload?.headers || []).find((x: any) => x.name === name)?.value || "";
    out.push({
      threadId: m.threadId,
      from: String(h("From")).slice(0, 160),
      subject: String(h("Subject")).slice(0, 200),
      date: h("Date"),
      snippet: String(m.snippet || "").slice(0, 300),
      unread: (m.labelIds || []).includes("UNREAD"),
    });
  }));
  return out;
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
      location: e.location ? String(e.location).slice(0, 160) : null,
      description: e.description ? String(e.description).slice(0, 600) : null,
      meetLink: e.hangoutLink || null,
      recurring: !!e.recurringEventId,
      organizer: e.organizer?.email || null,
      // attendees: email + name + response — the signal for project inference.
      // DATA only; never treated as instructions.
      attendees: (e.attendees || []).slice(0, 20).map((a: any) => ({
        email: String(a.email || "").slice(0, 160),
        name: a.displayName ? String(a.displayName).slice(0, 80) : null,
        status: a.responseStatus || "needsAction",
        organizer: !!a.organizer,
        self: !!a.self,
      })),
    }));
}
