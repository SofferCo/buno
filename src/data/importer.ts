// buno — one-time importer: local board (localStorage blob) → Postgres.
// Two phases, strictly separated:
//   buildManifest(blob)  — pure read; everything the user sees before saying yes
//   pushImport(...)      — rewrites ids to uuids, inserts in dependency order,
//                          returns the rewritten state for the app to adopt.
// Nothing is written anywhere until pushImport is called.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ColMap } from "./mappers";
import { clientToRow, cardToRow, subtaskToRow, commentToRow, attachmentToRow, historyToRow, columnToRow, profileToRow } from "./mappers";
import type { BoardState } from "./remote";

export type Manifest = {
  clients: { name: string; color: string; home: boolean; active: number; archived: number; hours: number }[];
  columns: string[];
  totals: {
    cards: number; archived: number; subtasks: number; comments: number;
    links: number; files: number; historyEntries: number; hours: number;
    drafts: number; proposals: number;
  };
};

const hoursOf = (sec: number) => Math.round((sec / 3600) * 10) / 10;

export function buildManifest(blob: any): Manifest {
  const cards = Object.values(blob.cards || {}) as any[];
  const perClient = (blob.clients || []).map((cl: any) => {
    const own = cards.filter((c) => c.clientId === cl.id);
    return {
      name: cl.name, color: cl.color, home: !!cl.home,
      active: own.filter((c) => !c.archived).length,
      archived: own.filter((c) => c.archived).length,
      hours: hoursOf(own.reduce((a, c) => a + (c.timeSpent || 0), 0)),
    };
  });
  const count = (f: (c: any) => number) => cards.reduce((a, c) => a + f(c), 0);
  return {
    clients: perClient,
    columns: (blob.columns || []).map((c: any) => c.title),
    totals: {
      cards: cards.filter((c) => !c.archived).length,
      archived: cards.filter((c) => c.archived).length,
      subtasks: count((c) => (c.subtasks || []).length),
      comments: count((c) => (c.comments || []).length),
      links: count((c) => (c.attachments || []).filter((a: any) => a.type === "link").length),
      files: count((c) => (c.attachments || []).filter((a: any) => a.type !== "link").length),
      historyEntries: count((c) => (c.history || []).length),
      hours: hoursOf(count((c) => c.timeSpent || 0)),
      drafts: cards.filter((c) => c.draft && !c.archived).length,
      proposals: cards.filter((c) => c.proposed && !c.archived).length,
    },
  };
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const fresh = (map: Map<string, string>, id: string) => {
  if (!map.has(id)) map.set(id, isUuid(id) ? id : crypto.randomUUID());
  return map.get(id)!;
};

export async function pushImport(sb: SupabaseClient, userId: string, blob: any):
  Promise<{ state: BoardState; colMap: ColMap }> {
  const clientIds = new Map<string, string>(), cardIds = new Map<string, string>();

  // rewrite state to uuid ids (columns keep their semantic keys)
  const clients = (blob.clients || []).map((c: any) => ({ ...c, id: fresh(clientIds, c.id) }));
  const columns = blob.columns || [];
  const cards: Record<string, any> = {};
  for (const c of Object.values(blob.cards || {}) as any[]) {
    if (!clientIds.has(c.clientId)) continue; // orphan card of a deleted client
    cards[fresh(cardIds, c.id)] = {
      ...c,
      id: fresh(cardIds, c.id),
      clientId: clientIds.get(c.clientId),
      subtasks: (c.subtasks || []).map((s: any) => ({ ...s, id: isUuid(s.id) ? s.id : crypto.randomUUID() })),
      comments: rewriteComments(c.comments || []),
      attachments: (c.attachments || []).map((a: any) => ({ ...a, id: isUuid(a.id) ? a.id : crypto.randomUUID() })),
      history: (c.history || []).map((h: any) => ({ ...h, id: isUuid(h.id) ? h.id : crypto.randomUUID() })),
    };
  }
  const order: Record<string, string[]> = {};
  for (const k of Object.keys(blob.order || {}))
    order[k] = (blob.order[k] || []).filter((id: string) => cardIds.has(id)).map((id: string) => cardIds.get(id)!);

  // dependency-ordered inserts; on any failure delete the inserted projects —
  // the cascade wipes columns/cards/children, so a failed import leaves nothing
  const run = async (q: any) => { const { error } = await q; if (error) throw new Error(error.message); };
  const chunked = async (table: string, rows: any[]) => {
    for (let i = 0; i < rows.length; i += 400) await run(sb.from(table).insert(rows.slice(i, i + 400)));
  };

  const colMap: ColMap = {};
  const profile = blob.profile || { name: "", photo: null, assistant: { cards: "draft", calendar: "draft", outbound: "suggest" } };
  const currentId = clientIds.get(blob.currentId) || clients[0]?.id || null;
  const lastReset = blob.lastReset || "";

  try {
    await doPush();
  } catch (e) {
    await sb.from("project").delete().in("id", clients.map((c: any) => c.id));
    throw e;
  }
  return { state: { clients, currentId, columns, cards, order, lastReset, profile }, colMap };

  async function doPush() {
  await chunked("project", clients.map((c: any) => clientToRow(c, userId)));

  const colRows: any[] = [];
  for (const cl of clients) {
    colMap[cl.id] = {};
    columns.forEach((col: any, i: number) => {
      const id = crypto.randomUUID();
      colMap[cl.id][col.id] = id;
      colRows.push(columnToRow(col, cl.id, i, id));
    });
  }
  await chunked("board_column", colRows);

  const colOf: Record<string, string> = {}, posInCol: Record<string, number> = {};
  for (const k of Object.keys(order)) order[k].forEach((id, i) => { colOf[id] = k; posInCol[id] = i; });
  await chunked("card", Object.values(cards).map((c: any) => cardToRow(c, colOf[c.id] || null, posInCol[c.id] ?? 0, colMap)));

  const subs: any[] = [], comms: any[] = [], atts: any[] = [], hist: any[] = [];
  for (const c of Object.values(cards) as any[]) {
    c.subtasks.forEach((s: any, i: number) => subs.push(subtaskToRow(s, c.id, i)));
    c.comments.forEach((cm: any) => comms.push(commentToRow(cm, c.id)));
    // files/images have no Storage bucket yet — import metadata, data stays local
    c.attachments.forEach((a: any) => atts.push(attachmentToRow(a, c.id)));
    c.history.forEach((h: any) => hist.push(historyToRow(h, c.id)));
  }
  await chunked("subtask", subs);
  await chunked("comment", comms);
  await chunked("attachment", atts);
  await chunked("card_history", hist);

  await run(sb.from("profile").update(profileToRow(profile, lastReset, currentId)).eq("id", userId));
  if (profile.assistant) await run(sb.from("assistant_settings").update(profile.assistant).eq("user_id", userId));
  } // end doPush
}

function rewriteComments(comments: any[]) {
  const ids = new Map<string, string>();
  for (const c of comments) fresh(ids, c.id);
  return comments.map((c) => ({ ...c, id: ids.get(c.id), parentId: c.parentId ? ids.get(c.parentId) || null : null }));
}
