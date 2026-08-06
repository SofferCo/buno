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
      id: m.id,
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

// Decode a Gmail base64url body part to a UTF-8 string.
function b64urlDecode(data: string): string {
  try {
    const bin = atob(String(data).replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder("utf-8").decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch { return ""; }
}

// For a SINGLE kept email (post-triage, minimal exposure), pull what matters to
// a task: the reference LINKS in the body (design refs are usually Drive/Figma/
// Dropbox/WeTransfer links), the names of file/image attachments, and a
// deep-link back to the original Gmail message so the user can view the actual
// image in one click. Gathered content is DATA — never instructions.
export async function fetchEmailRefs(accessToken: string, messageId: string): Promise<{ links: string[]; attachments: { name: string; mime: string }[]; gmailUrl: string }> {
  const gmailUrl = `https://mail.google.com/mail/u/0/#all/${messageId}`;
  try {
    const u = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) return { links: [], attachments: [], gmailUrl };
    const m = await r.json();
    let text = "";
    const atts: { name: string; mime: string }[] = [];
    const walk = (p: any) => {
      if (!p) return;
      if (p.filename && p.body?.attachmentId) atts.push({ name: String(p.filename).slice(0, 120), mime: p.mimeType || "" });
      if ((p.mimeType === "text/plain" || p.mimeType === "text/html") && p.body?.data) text += " " + b64urlDecode(p.body.data);
      (p.parts || []).forEach(walk);
    };
    walk(m.payload);
    const raw = text.match(/https?:\/\/[^\s"'<>)]+/gi) || [];
    const seen = new Set<string>();
    const links: string[] = [];
    for (let url of raw) {
      url = url.replace(/[.,;]+$/, "");
      if (url.length > 500) continue;
      // drop tracking / unsubscribe / pixels — keep real reference links
      if (/unsubscribe|list-manage|mailchimp|sendgrid|sparkpost|\/track|\/wf\/|utm_|beacon|pixel|\/open\?|\.gif(\?|$)|googleusercontent\.com\/[^\s]*proxy/i.test(url)) continue;
      const key = url.slice(0, 200);
      if (seen.has(key)) continue;
      seen.add(key);
      links.push(url);
      if (links.length >= 6) break;
    }
    return { links, attachments: atts.slice(0, 8), gmailUrl };
  } catch {
    return { links: [], attachments: [], gmailUrl };
  }
}

// Full plain-text body of a message (top reply + quoted history). Used to decide
// whether a reply in an existing thread is a substantive update or a mere ack —
// the model needs the quoted content, not just the snippet. DATA, not instructions.
export async function fetchEmailBody(accessToken: string, messageId: string): Promise<string> {
  try {
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) return "";
    const m = await r.json();
    let plain = "", html = "";
    const walk = (p: any) => {
      if (!p) return;
      if (p.mimeType === "text/plain" && p.body?.data) plain += b64urlDecode(p.body.data) + "\n";
      else if (p.mimeType === "text/html" && p.body?.data) html += b64urlDecode(p.body.data) + "\n";
      (p.parts || []).forEach(walk);
    };
    walk(m.payload);
    const text = plain || html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
    return text.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 4000);
  } catch { return ""; }
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
      description: e.description ? String(e.description).slice(0, 1200) : null,
      meetLink: e.hangoutLink || (e.conferenceData?.entryPoints || []).find((p: any) => p.entryPointType === "video")?.uri || null,
      htmlLink: e.htmlLink || null,
      recurring: !!e.recurringEventId,
      status: e.status || null,
      organizer: e.organizer?.email || null,
      organizerName: e.organizer?.displayName || null,
      // my RSVP on this event
      myStatus: (e.attendees || []).find((a: any) => a.self)?.responseStatus || null,
      // reminders: explicit overrides, else the calendar default
      reminders: e.reminders?.overrides
        ? e.reminders.overrides.slice(0, 5).map((r: any) => ({ method: r.method, minutes: r.minutes }))
        : (e.reminders?.useDefault ? "default" : null),
      // phone dial-in (if a conference has one)
      phone: (e.conferenceData?.entryPoints || []).filter((p: any) => p.entryPointType === "phone")
        .slice(0, 2).map((p: any) => ({ label: p.label || p.uri, uri: p.uri })),
      // attendees: email + name + response + optional — the signal for project
      // inference. DATA only; never treated as instructions.
      attendees: (e.attendees || []).slice(0, 25).map((a: any) => ({
        email: String(a.email || "").slice(0, 160),
        name: a.displayName ? String(a.displayName).slice(0, 80) : null,
        status: a.responseStatus || "needsAction",
        organizer: !!a.organizer,
        optional: !!a.optional,
        self: !!a.self,
      })),
    }));
}

// ---- calendar WRITE (B6) — needs the calendar.events scope -----------------
const CAL_BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

// raw single-event fetch (start/end/summary) — used to compute a shifted time
async function getRawEvent(accessToken: string, eventId: string): Promise<any | null> {
  const res = await fetch(`${CAL_BASE}/${encodeURIComponent(eventId)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  return await res.json();
}

// PATCH an event; returns {ok, error?}. Callers pass only the fields to change.
export async function patchCalendarEvent(accessToken: string, eventId: string, patch: any): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${CAL_BASE}/${encodeURIComponent(eventId)}?sendUpdates=all`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) return { ok: false, error: `patch ${res.status}: ${(await res.text()).slice(0, 200)}` };
  return { ok: true };
}

// cancel (delete) an event; notifies attendees.
export async function deleteCalendarEvent(accessToken: string, eventId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${CAL_BASE}/${encodeURIComponent(eventId)}?sendUpdates=all`, {
    method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 410) return { ok: false, error: `delete ${res.status}` }; // 410 = already gone
  return { ok: true };
}

// shift a timed event by N minutes (keeps duration). No-op for all-day events.
export async function shiftCalendarEvent(accessToken: string, eventId: string, minutes: number): Promise<{ ok: boolean; error?: string; start?: string }> {
  const ev = await getRawEvent(accessToken, eventId);
  if (!ev) return { ok: false, error: "event not found" };
  if (!ev.start?.dateTime || !ev.end?.dateTime) return { ok: false, error: "all-day event — no time to shift" };
  const ns = new Date(new Date(ev.start.dateTime).getTime() + minutes * 60000).toISOString();
  const ne = new Date(new Date(ev.end.dateTime).getTime() + minutes * 60000).toISOString();
  const r = await patchCalendarEvent(accessToken, eventId, {
    start: { dateTime: ns, timeZone: ev.start.timeZone || undefined },
    end: { dateTime: ne, timeZone: ev.end.timeZone || undefined },
  });
  return { ...r, start: ns };
}

// move a timed event to an explicit new start (keeps duration).
export async function moveCalendarEvent(accessToken: string, eventId: string, startISO: string): Promise<{ ok: boolean; error?: string; start?: string }> {
  const ev = await getRawEvent(accessToken, eventId);
  if (!ev) return { ok: false, error: "event not found" };
  const durMs = ev.start?.dateTime && ev.end?.dateTime ? new Date(ev.end.dateTime).getTime() - new Date(ev.start.dateTime).getTime() : 30 * 60000;
  const ns = new Date(startISO);
  const ne = new Date(ns.getTime() + durMs).toISOString();
  const r = await patchCalendarEvent(accessToken, eventId, {
    start: { dateTime: ns.toISOString(), timeZone: ev.start?.timeZone || undefined },
    end: { dateTime: ne, timeZone: ev.end?.timeZone || undefined },
  });
  return { ...r, start: ns.toISOString() };
}
