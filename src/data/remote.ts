// buno — remote data layer: load the board from Supabase, then keep it in
// sync by diffing state snapshots. Components never see any of this; App
// hands the same state object it already keeps to sync.schedule() and the
// engine works out the minimal writes.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ColMap, clientToRow, rowToClient, cardToRow, rowToCard,
  subtaskToRow, rowToSubtask, commentToRow, rowToComment,
  attachmentToRow, rowToAttachment, historyToRow, rowToHistory,
  columnToRow, profileToRow, rowToProfile,
} from "./mappers";

export type BoardState = {
  clients: any[]; currentId: string | null; columns: any[];
  cards: Record<string, any>; order: Record<string, string[]>;
  lastReset: string; profile: any;
};

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------
export type Roster = { userId: string; name: string; photo: string | null; role: string; self: boolean }[];
export type Sharing = {
  roles: Record<string, string>;          // projectId -> my role
  rosters: Record<string, Roster>;         // projectId -> members (with names)
};

export async function loadRemote(sb: SupabaseClient, userId: string):
  Promise<{ state: BoardState | null; colMap: ColMap; sharing: Sharing }> {
  const [projects, cols, cards, subs, comms, atts, hist, prof, asst, members, memberProfiles] = await Promise.all([
    sb.from("project").select("*").order("created_at"),
    sb.from("board_column").select("*").order("position"),
    sb.from("card").select("*"),
    sb.from("subtask").select("*").order("position"),
    sb.from("comment").select("*").order("created_at"),
    sb.from("attachment").select("*").order("created_at"),
    sb.from("card_history").select("*").order("at"),
    sb.from("profile").select("*").eq("id", userId).maybeSingle(),
    sb.from("assistant_settings").select("*").eq("user_id", userId).maybeSingle(),
    sb.from("project_member").select("project_id,user_id,role"),
    sb.from("profile").select("id,name,photo_url"),   // co-members visible via 0006 policy
  ]);
  const err = [projects, cols, cards, subs, comms, atts, hist, prof, asst, members, memberProfiles].find((r) => r.error);
  if (err?.error) throw new Error(err.error.message);

  const nameById = new Map<string, { name: string; photo: string | null }>();
  for (const p of memberProfiles.data || []) nameById.set(p.id, { name: p.name || "", photo: p.photo_url || null });
  const roles: Record<string, string> = {};
  const rosters: Record<string, Roster> = {};
  for (const m of members.data || []) {
    if (m.user_id === userId) roles[m.project_id] = m.role;
    const np = nameById.get(m.user_id) || { name: "", photo: null };
    (rosters[m.project_id] = rosters[m.project_id] || []).push({
      userId: m.user_id, name: np.name, photo: np.photo, role: m.role, self: m.user_id === userId,
    });
  }
  const sharing: Sharing = { roles, rosters };
  if (!projects.data?.length) return { state: null, colMap: {}, sharing };

  const colMap: ColMap = {};
  const columnsByKey = new Map<string, any>();
  for (const r of cols.data || []) {
    if (!r.key) continue;
    (colMap[r.project_id] = colMap[r.project_id] || {})[r.key] = r.id;
    if (!columnsByKey.has(r.key)) columnsByKey.set(r.key, { id: r.key, title: r.title, _pos: r.position });
  }
  const columns = [...columnsByKey.values()].sort((a, b) => a._pos - b._pos).map(({ _pos, ...c }) => c);
  const colKeyById = new Map<string, string>();
  for (const r of cols.data || []) if (r.key) colKeyById.set(r.id, r.key);

  const cardMap: Record<string, any> = {};
  for (const r of cards.data || []) cardMap[r.id] = rowToCard(r);
  for (const r of subs.data || []) cardMap[r.card_id]?.subtasks.push(rowToSubtask(r));
  for (const r of comms.data || []) cardMap[r.card_id]?.comments.push(rowToComment(r));
  for (const r of atts.data || []) cardMap[r.card_id]?.attachments.push(rowToAttachment(r));
  for (const r of hist.data || []) cardMap[r.card_id]?.history.push(rowToHistory(r));

  const order: Record<string, string[]> = {};
  for (const c of columns) order[c.id] = [];
  const placed = (cards.data || [])
    .filter((r) => !r.archived && r.column_id && colKeyById.has(r.column_id))
    .sort((a, b) => a.position - b.position);
  for (const r of placed) order[colKeyById.get(r.column_id)!]?.push(r.id);

  const profile = rowToProfile(prof.data, asst.data);
  const settings = prof.data?.settings || {};
  const clients = (projects.data || []).map(rowToClient);
  const currentId =
    clients.find((c) => c.id === settings.current_project)?.id || clients[0]?.id || null;

  return {
    state: {
      clients, currentId, columns, cards: cardMap, order,
      lastReset: settings.last_reset || "", profile,
    },
    colMap,
    sharing,
  };
}

// ---------------------------------------------------------------------------
// Sync engine — diff two snapshots, push the difference. Writes are
// serialized; a new schedule() during a push queues exactly one more pass.
// ---------------------------------------------------------------------------
const cardColOf = (order: Record<string, string[]>) => {
  const m: Record<string, string> = {};
  for (const k of Object.keys(order)) for (const id of order[k]) m[id] = k;
  return m;
};
const posOf = (order: Record<string, string[]>) => {
  const m: Record<string, number> = {};
  for (const k of Object.keys(order)) order[k].forEach((id, i) => (m[id] = i));
  return m;
};
const jeq = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export class SyncEngine {
  private last: BoardState | null = null;
  private next: BoardState | null = null;
  private timer: any = null;
  private pushing = false;
  onError: ((e: Error) => void) | null = null;
  onDirty: ((dirty: boolean) => void) | null = null;

  constructor(private sb: SupabaseClient, private userId: string, private colMap: ColMap, baseline: BoardState) {
    this.last = baseline;
  }

  schedule(state: BoardState) {
    this.next = state;
    this.onDirty?.(true);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 800);
  }

  async flush() {
    if (this.pushing) return; // the running pass re-checks this.next when done
    const cur = this.next;
    if (!cur || !this.last) return;
    this.pushing = true;
    try {
      await this.push(this.last, cur);
      this.last = cur;
      if (this.next !== cur) { this.pushing = false; return this.flush(); }
      this.next = null;
      this.onDirty?.(false);
    } catch (e: any) {
      // clock-skew / stale token: refresh once so the queued retry succeeds
      if (/jwt|issued at future|token|expired/i.test(e?.message || "")) {
        try { await this.sb.auth.refreshSession(); } catch {}
      }
      this.onError?.(e); // keep this.last; the next schedule() retries the same diff
    } finally { this.pushing = false; }
  }

  private async run(q: any) { const { error } = await q; if (error) throw new Error(error.message); }

  private async push(prev: BoardState, cur: BoardState) {
    const sb = this.sb;

    // projects
    const prevCl = new Map(prev.clients.map((c) => [c.id, c]));
    const curCl = new Map(cur.clients.map((c) => [c.id, c]));
    for (const c of cur.clients) {
      const was = prevCl.get(c.id);
      if (!was) { await this.run(sb.from("project").insert(clientToRow(c, this.userId))); this.colMap[c.id] = {}; }
      else if (!jeq(was, c)) { const { id, created_by, ...row } = clientToRow(c, this.userId) as any; await this.run(sb.from("project").update(row).eq("id", c.id)); }
    }
    for (const c of prev.clients) if (!curCl.has(c.id)) { await this.run(sb.from("project").delete().eq("id", c.id)); delete this.colMap[c.id]; }

    // columns — one row per project per key; new keys get client-side uuids
    const prevKeys = new Set(prev.columns.map((c) => c.id));
    const curKeys = new Set(cur.columns.map((c) => c.id));
    const colsChanged = !jeq(prev.columns, cur.columns) || !jeq(prev.clients.map((c) => c.id), cur.clients.map((c) => c.id));
    if (colsChanged) {
      const rows: any[] = [];
      for (const cl of cur.clients) {
        const pm = (this.colMap[cl.id] = this.colMap[cl.id] || {});
        cur.columns.forEach((col, i) => {
          if (!pm[col.id]) pm[col.id] = crypto.randomUUID();
          rows.push(columnToRow(col, cl.id, i, pm[col.id]));
        });
      }
      if (rows.length) await this.run(sb.from("board_column").upsert(rows));
      for (const k of prevKeys) if (!curKeys.has(k)) {
        await this.run(sb.from("board_column").delete().eq("key", k));
        for (const pid of Object.keys(this.colMap)) delete this.colMap[pid][k];
      }
    }

    // cards + children
    const prevPos = posOf(prev.order), curPos = posOf(cur.order);
    const prevCol = cardColOf(prev.order), curCol = cardColOf(cur.order);
    for (const id of Object.keys(cur.cards)) {
      const c = cur.cards[id], was = prev.cards[id];
      const colKey = curCol[id] || null, pos = curPos[id] ?? 0;
      const placementChanged = colKey !== (prevCol[id] || null) || pos !== (prevPos[id] ?? 0);
      if (!was) {
        await this.run(sb.from("card").insert(cardToRow(c, colKey, pos, this.colMap)));
      } else if (!jeq(was, c) || placementChanged || colsChanged) {
        const { id: _i, project_id: _p, created_at: _c, ...row } = cardToRow(c, colKey, pos, this.colMap) as any;
        await this.run(sb.from("card").update(row).eq("id", id));
      }
      await this.pushChildren(id, was, c);
    }
    for (const id of Object.keys(prev.cards)) if (!cur.cards[id]) await this.run(sb.from("card").delete().eq("id", id));

    // profile + assistant matrix
    if (!jeq(prev.profile, cur.profile) || prev.lastReset !== cur.lastReset || prev.currentId !== cur.currentId) {
      await this.run(sb.from("profile").update(profileToRow(cur.profile, cur.lastReset, cur.currentId)).eq("id", this.userId));
      if (!jeq(prev.profile?.assistant, cur.profile?.assistant) && cur.profile?.assistant)
        await this.run(sb.from("assistant_settings").update(cur.profile.assistant).eq("user_id", this.userId));
    }
  }

  private async pushChildren(cardId: string, was: any, cur: any) {
    const sb = this.sb;
    const sync = async (table: string, prevArr: any[], curArr: any[], toRow: (x: any, i: number) => any, updatable = true) => {
      if (jeq(prevArr, curArr)) return;
      const prevM = new Map((prevArr || []).map((x) => [x.id, x]));
      const curIds = new Set((curArr || []).map((x) => x.id));
      const inserts: any[] = [];
      for (let i = 0; i < (curArr || []).length; i++) {
        const x = curArr[i], w = prevM.get(x.id);
        if (!w) inserts.push(toRow(x, i));
        else if (updatable && !jeq(w, x)) { const { id, card_id, ...row } = toRow(x, i); await this.run(sb.from(table).update(row).eq("id", x.id)); }
      }
      if (inserts.length) await this.run(sb.from(table).insert(inserts));
      for (const x of prevArr || []) if (!curIds.has(x.id)) await this.run(sb.from(table).delete().eq("id", x.id));
    };
    await sync("subtask", was?.subtasks, cur.subtasks, (s, i) => subtaskToRow(s, cardId, i));
    await sync("comment", was?.comments, cur.comments, (c) => commentToRow(c, cardId));
    await sync("attachment", was?.attachments, cur.attachments, (a) => attachmentToRow(a, cardId));
    // history is append-only in the DB (RLS: insert+select only); the app's
    // "merge consecutive edits" tweak of `at` is cosmetic and is not pushed
    await sync("card_history", was?.history, cur.history, (h) => historyToRow(h, cardId), false);
  }
}
