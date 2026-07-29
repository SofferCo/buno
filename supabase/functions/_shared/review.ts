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
export type Render = { text: string; actions: Action[]; done?: boolean };

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
function renderItem(item: ReviewItem, idx: number, total: number): Render {
  const n = total > 1 ? `(${idx + 1}/${total}) ` : "";
  if (item.kind === "invite") {
    return { text: `${n}התקבלה הזמנה מ־${item.from} ל"${item.title}"${item.when ? ` · ${item.when}` : ""}.`, actions: [{ id: "rv:open_cal", label: "פתח ביומן", url: item.url }, { id: "rv:skip", label: "הבא ›" }] };
  }
  if (item.kind === "draft") {
    return { text: `${n}טיוטה: "${item.title}"${item.project ? ` · ${item.project}` : ""}`, actions: [{ id: "rv:approve", label: "אשר" }, { id: "rv:reject", label: "דחה" }] };
  }
  return { text: `${n}עדכון על "${item.cardTitle}" — ${item.from}: ${item.summary}`, actions: [{ id: "rv:update", label: "עדכן כרטיס" }, { id: "rv:close", label: "סגור כרטיס" }, { id: "rv:new", label: "פתח חדשה" }, { id: "rv:skip", label: "דלג" }] };
}
// immediate opening for a multi-draft walk (3+): preamble + the first item.
export function draftsOpening(queue: ReviewItem[]): Render {
  const first = currentRender({ queue, cursor: 0 });
  return { text: `קלטתי ${queue.length} דברים — נעבור אחד־אחד:\n${first.text}`, actions: first.actions };
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
  if (!s) return { text: "אין כרגע רצף פעיל. אפשר לבקש 'סרוק עכשיו'.", actions: [], done: true };
  const item = s.queue[s.cursor];
  if (!item) { await clearSession(admin, userId); return { text: "זהו, עברנו על הכול. הלוח מעודכן.", actions: [], done: true }; }

  if (actionId === "rv:start" || actionId === "rv:open_cal") return currentRender(s);

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
  if (r.done) await clearSession(admin, userId);
  return { ...r, text: [ack, r.text].filter(Boolean).join("\n") };
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
