// buno — the guided review engine. A scan builds a queue of thread updates +
// calendar invites; buno walks them one at a time with real buttons. State lives
// in review_session (per user, shared across web + WhatsApp — one twin). The
// action ids ("rv:*") are channel-agnostic: web buttons and WhatsApp interactive
// replies map to the same handler.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type ReviewItem =
  | { kind: "update"; updateId: string; cardId: string; cardTitle: string; from: string; summary: string }
  | { kind: "invite"; title: string; from: string; when: string; url: string }
  | { kind: "draft"; cardId: string; title: string; project: string };

export type Action = { id: string; label: string; url?: string };
// `project` is the current item's board name — carried structured so the web door
// can paint it as a colored chip (WhatsApp just reads it off the text line).
// `pending`/`started` describe the live session so the chat can show the right
// continuity chip on open (pending & !started = a snapshot queue not yet begun).
export type Render = { text: string; actions: Action[]; done?: boolean; project?: string; pending?: number; started?: boolean };

// ---- session store ---------------------------------------------------------
export async function setSession(admin: SupabaseClient, userId: string, queue: ReviewItem[], cursor: number) {
  await admin.from("review_session").upsert({ user_id: userId, queue, cursor, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
}
export async function getSession(admin: SupabaseClient, userId: string): Promise<{ queue: ReviewItem[]; cursor: number } | null> {
  try {
    const { data } = await admin.from("review_session").select("queue,cursor").eq("user_id", userId).maybeSingle();
    if (!data || !Array.isArray(data.queue) || !data.queue.length) return null;
    return { queue: data.queue as ReviewItem[], cursor: Number(data.cursor) || 0 };
  } catch { return null; }
}
export async function clearSession(admin: SupabaseClient, userId: string) { try { await admin.from("review_session").delete().eq("user_id", userId); } catch { /* ok */ } }

// ---- rendering -------------------------------------------------------------
// the "2 מתוך 4" progress line (only when there's more than one item to walk).
function progressLine(idx: number, total: number): string {
  return total > 1 ? `ממשיכים הלאה ${idx + 1} מתוך ${total}` : "";
}
// bare per-item render — no preamble/progress/ack prefix; the callers assemble
// those. The project goes on its own text line (WhatsApp) AND as a structured
// `project` field (web chip).
function renderItem(item: ReviewItem, _idx: number, _total: number): Render {
  if (item.kind === "invite") {
    return { text: `התקבלה הזמנה מ־${item.from} ל"${item.title}"${item.when ? ` · ${item.when}` : ""}.`, actions: [{ id: "rv:open_cal", label: "פתח ביומן", url: item.url }, { id: "rv:skip", label: "הבא ›" }] };
  }
  if (item.kind === "draft") {
    return { text: `הצעה: ${item.title}${item.project ? `\n${item.project}` : ""}`, actions: [{ id: "rv:approve", label: "אשר" }, { id: "rv:reject", label: "דחה" }], project: item.project || undefined };
  }
  return { text: `עדכון על "${item.cardTitle}" — ${item.from}: ${item.summary}`, actions: [{ id: "rv:update", label: "עדכן כרטיס" }, { id: "rv:close", label: "סגור כרטיס" }, { id: "rv:new", label: "פתח חדשה" }, { id: "rv:skip", label: "דלג" }] };
}
// immediate opening for a multi-draft walk (3+): preamble + the first item.
export function draftsOpening(queue: ReviewItem[]): Render {
  const first = renderItem(queue[0], 0, queue.length);
  return { ...first, text: `קלטתי ${queue.length} דברים — נעבור אחד־אחד:\n${first.text}` };
}
export function offerRender(count: number): Render {
  return { text: `סרקתי — יש ${count} עדכונים בשרשורים קיימים. בוא נעבור עליהם.`, actions: [{ id: "rv:start", label: "בוא נעבור" }] };
}
// the opening the caller shows after storing the queue: X=1 goes straight in.
export function openingRender(queue: ReviewItem[]): Render {
  return queue.length === 1 ? renderItem(queue[0], 0, 1) : offerRender(queue.length);
}
export function currentRender(s: { queue: ReviewItem[]; cursor: number }): Render {
  if (s.cursor >= s.queue.length) return { text: "זהו, עברנו על הכול. הלוח מעודכן.", actions: [], done: true };
  return renderItem(s.queue[s.cursor], s.cursor, s.queue.length);
}

// ---- actions ---------------------------------------------------------------
async function doneColumn(admin: SupabaseClient, projectId: string): Promise<any> {
  const { data } = await admin.from("board_column").select("id,key,is_done").eq("project_id", projectId);
  return (data || []).find((c: any) => c.key === "col-done") || (data || []).find((c: any) => c.is_done) || null;
}
async function briefColumn(admin: SupabaseClient, projectId: string): Promise<any> {
  const { data } = await admin.from("board_column").select("id,key,position").eq("project_id", projectId);
  return (data || []).find((c: any) => c.key === "col-brief") || (data || []).sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))[0] || null;
}

// Handle a button. Returns the next render (with a short ack folded in), advancing
// the cursor. `rv:start` just presents the current item; `rv:open_cal` is a link
// (no state change) so it re-shows the current item.
export async function handleAction(admin: SupabaseClient, userId: string, actionId: string): Promise<Render> {
  const s = await getSession(admin, userId);
  // peek: report the live session without touching it (chat-open continuity chip).
  if (actionId === "rv:peek") return s ? { text: "", actions: [], pending: s.queue.length - s.cursor, started: s.cursor > 0 } : { text: "", actions: [], done: true, pending: 0 };
  if (!s) return { text: "הכול מעודכן 👍 רוצה שאסרוק שוב?", actions: [], done: true, pending: 0 };
  // skip the rest of the walk in one go — and (item 1) never leave un-approved
  // draft cards behind: archive every remaining draft that wasn't explicitly approved.
  if (actionId === "rv:skipall") {
    try {
      const remaining = s.queue.slice(s.cursor).filter((it: any) => it.kind === "draft" && it.cardId).map((it: any) => it.cardId);
      if (remaining.length) await admin.from("card").update({ archived: true, archived_at: new Date().toISOString(), removed_by: "assistant" }).in("id", remaining).not("draft", "is", null);
    } catch { /* best-effort cleanup */ }
    await clearSession(admin, userId);
    return { text: "בסדר — דילגתי על השאר וניקיתי מה שלא אושר. הכול מעודכן 👍", actions: [], done: true, pending: 0 };
  }
  const item = s.queue[s.cursor];
  if (!item) { await clearSession(admin, userId); return { text: "זהו, עברנו על הכול. הלוח מעודכן.", actions: [], done: true, pending: 0 }; }

  // present the current item (no state change) — with its progress line.
  if (actionId === "rv:start" || actionId === "rv:open_cal") {
    const r = currentRender(s);
    const p = progressLine(s.cursor, s.queue.length);
    return { ...r, text: [p, r.text].filter(Boolean).join("\n"), pending: s.queue.length - s.cursor, started: true };
  }

  let ack = "";
  try {
    if (item.kind === "update") {
      if (actionId === "rv:update") { await admin.from("comment").insert({ card_id: item.cardId, by_name: "buno", text: item.summary }); ack = "עודכן ✓"; }
      else if (actionId === "rv:close") { const col = await doneColumn(admin, (await cardProject(admin, item.cardId))); if (col) await admin.from("card").update({ column_id: col.id, active_column_key: col.key }).eq("id", item.cardId); ack = "נסגר ✓"; }
      else if (actionId === "rv:new") { await createFromUpdate(admin, item); ack = "נפתחה משימה ✓"; }
      else ack = "דילגתי.";
      if (item.updateId) await admin.from("card_thread_update").delete().eq("id", item.updateId);
    } else if (item.kind === "draft") {
      if (actionId === "rv:approve") { await admin.from("card").update({ draft: null }).eq("id", item.cardId); ack = "אושר ✓"; }
      else if (actionId === "rv:reject") { await admin.from("card").update({ archived: true, archived_at: new Date().toISOString(), removed_by: "assistant" }).eq("id", item.cardId); ack = "נדחה ✓"; }
      else ack = "";
    } else {
      ack = actionId === "rv:skip" ? "" : "";
    }
  } catch { ack = "לא הצלחתי — ממשיך."; }

  const next = { queue: s.queue, cursor: s.cursor + 1 };
  await setSession(admin, userId, next.queue, next.cursor);
  const r = currentRender(next);
  if (r.done) { await clearSession(admin, userId); return { ...r, text: [ack, r.text].filter(Boolean).join("\n"), pending: 0 }; }
  // ack on its own line, a blank line, then "ממשיכים הלאה X מתוך Y", then the item.
  const p = progressLine(next.cursor, next.queue.length);
  const parts: string[] = [];
  if (ack) parts.push(ack, "");
  if (p) parts.push(p);
  parts.push(r.text);
  return { ...r, text: parts.join("\n"), pending: next.queue.length - next.cursor, started: true };
}

async function cardProject(admin: SupabaseClient, cardId: string): Promise<string> {
  const { data } = await admin.from("card").select("project_id").eq("id", cardId).maybeSingle();
  return data?.project_id || "";
}
async function createFromUpdate(admin: SupabaseClient, item: any) {
  const pid = await cardProject(admin, item.cardId); if (!pid) return;
  const brief = await briefColumn(admin, pid);
  await admin.from("card").insert({
    project_id: pid, column_id: brief?.id || null, position: 0,
    title: String(item.summary || item.cardTitle || "משימה").slice(0, 80), creator: "buno",
    description: `מעדכון בשרשור: ${item.from}`, origin: { type: "email", ref: "upd-" + crypto.randomUUID() },
    draft: { by: "buno", at: Date.now(), level: "draft" },
  });
}
