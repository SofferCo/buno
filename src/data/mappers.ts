// buno — shape mappers: prototype state ⇄ Supabase rows.
// State keeps the prototype's shapes untouched (components never change);
// only this file knows what the tables look like.
//
// Identity rules:
// - projects / cards / subtasks / comments / attachments / history → uuid ids
//   (state and DB share the same uuid once remote mode is on).
// - columns → semantic KEY in state ("col-brief", "col-done", "col-xyz");
//   one DB row per project per key. colMap[projectId][key] = row uuid.

export type ColMap = Record<string, Record<string, string>>;

const toIso = (ms: any) => (ms ? new Date(ms).toISOString() : null);
const toMs = (iso: any) => (iso ? new Date(iso).getTime() : null);

// ---- client / project ------------------------------------------------------
export function clientToRow(c: any, userId: string) {
  return {
    id: c.id, name: c.name || "", color: c.color || "#0E8F8C",
    contact: c.contact || null, email: c.email || null, notes: c.notes || null,
    rate: c.rate === "" || c.rate == null ? null : Number(c.rate),
    logo_url: c.logo || null, is_personal: !!c.home, created_by: userId,
  };
}
export function rowToClient(r: any) {
  return {
    id: r.id, name: r.name, color: r.color, contact: r.contact || "",
    email: r.email || "", notes: r.notes || "", rate: r.rate == null ? "" : r.rate,
    logo: r.logo_url || null, home: !!r.is_personal,
    why: r.why || "",   // D1 — board purpose (undefined pre-0018 → "")
  };
}

// ---- card ------------------------------------------------------------------
export function cardToRow(c: any, colKey: string | null, position: number, colMap: ColMap) {
  return {
    id: c.id, project_id: c.clientId,
    column_id: (colKey && colMap[c.clientId]?.[colKey]) || null,
    position,
    title: c.title || "", creator: c.creator ?? c.briefFrom ?? "", cc: c.cc || [],
    description: c.description || "",
    deadline: c.deadline || null, time: c.time || null,
    routine: c.routine === true ? "daily" : (c.routine || "none"),
    day_flex: !!(c.dayFlex ?? c.flex),
    priority: c.priority || "regular",
    time_spent: Math.floor(c.timeSpent || 0), timer_start: toIso(c.timerStart),
    archived: !!c.archived, archived_at: toIso(c.archivedAt),
    removed_by: c.removedBy || null,
    origin: c.origin || null, draft: c.draft || null, proposed: c.proposed || null,
    active_column_key: c.activeColumn || null,
    created_at: toIso(c.createdAt) || new Date().toISOString(),
  };
}
export function rowToCard(r: any) {
  return {
    id: r.id, clientId: r.project_id,
    title: r.title, creator: r.creator, cc: r.cc || [], description: r.description,
    deadline: r.deadline || "", time: r.time || "",
    routine: r.routine === "none" ? "none" : r.routine,
    dayFlex: !!r.day_flex, priority: r.priority,
    timeSpent: r.time_spent || 0, timerStart: toMs(r.timer_start),
    archived: !!r.archived, archivedAt: toMs(r.archived_at),
    removedBy: r.removed_by || undefined,
    origin: r.origin || undefined, draft: r.draft || undefined, proposed: r.proposed || undefined,
    activeColumn: r.active_column_key || undefined,
    columnChangedAt: toMs(r.column_changed_at) || undefined,   // when it last changed column (done time for col-done)
    createdAt: toMs(r.created_at) || Date.now(),
    // B1 — two-time model (undefined pre-0018 → safe defaults). Read-only in the
    // client for now; buno sets these via the update_card tool, server-side.
    cardType: r.card_type === "waiting" ? "waiting" : "work",
    waitingOn: r.waiting_on || "",
    subtasks: [], comments: [], attachments: [], history: [],
  };
}

// ---- children --------------------------------------------------------------
export const subtaskToRow = (s: any, cardId: string, i: number) =>
  ({ id: s.id, card_id: cardId, text: s.text || "", done: !!s.done, hours: Number(s.hours) || 0, position: i });
export const rowToSubtask = (r: any) =>
  ({ id: r.id, text: r.text, done: r.done, hours: r.hours == null ? 0 : Number(r.hours) });

export const commentToRow = (c: any, cardId: string) =>
  ({ id: c.id, card_id: cardId, parent_id: c.parentId || null, by_name: c.by || "", by_user: c.byUser || null, text: c.text || "", created_at: toIso(c.at) || new Date().toISOString() });
export const rowToComment = (r: any) =>
  ({ id: r.id, by: r.by_name, byUser: r.by_user || undefined, text: r.text, at: toMs(r.created_at), parentId: r.parent_id || null });

export const attachmentToRow = (a: any, cardId: string) =>
  ({ id: a.id, card_id: cardId, type: a.type, name: a.name || null, url: a.type === "link" ? (a.url || null) : null, storage_key: a.storageKey || null, meta: a.meta || null });
export const rowToAttachment = (r: any) =>
  ({ id: r.id, type: r.type, name: r.name || "", url: r.url || "", storageKey: r.storage_key || undefined });

export const historyToRow = (h: any, cardId: string) =>
  ({ id: h.id, card_id: cardId, by_name: h.by || "", field: h.field || "", label: h.label || "", at: toIso(h.at) || new Date().toISOString() });
export const rowToHistory = (r: any) =>
  ({ id: r.id, by: r.by_name, field: r.field, label: r.label, at: toMs(r.at) });

// ---- columns ---------------------------------------------------------------
export const columnToRow = (col: any, projectId: string, position: number, id: string) =>
  ({ id, project_id: projectId, key: col.id, title: col.title || "", position, is_done: col.id === "col-done" });

// ---- profile ---------------------------------------------------------------
export function profileToRow(profile: any, lastReset: string, currentId: string | null) {
  return {
    name: profile.name || "",
    photo_url: profile.photo || null,
    settings: {
      time_round_mode: profile.settings?.timeRound || "ceil_hour",
      daily_capacity_hours: Number(profile.settings?.dailyCapacity) || 6,
      // UI prefs — theme + interface language. Persisted here so they survive a
      // cloud reload (their absence made the choice reset to system/Hebrew daily).
      theme: profile.settings?.theme || "system",
      lang: profile.settings?.lang || "he",
      last_reset: lastReset || null,
      current_project: currentId || null,
      onboarding: profile.settings?.onboarding || null,   // A1 first-run state (jsonb; no migration)
    },
  };
}
export function rowToProfile(r: any, asst: any) {
  return {
    name: r?.name || "",
    photo: r?.photo_url || null,
    assistant: asst
      ? { cards: asst.cards, calendar: asst.calendar, outbound: asst.outbound }
      : { cards: "draft", calendar: "draft", outbound: "suggest" },
    settings: { timeRound: r?.settings?.time_round_mode || "ceil_hour", dailyCapacity: Number(r?.settings?.daily_capacity_hours) || 6, theme: r?.settings?.theme || "system", lang: r?.settings?.lang || "he", onboarding: r?.settings?.onboarding || null },
  };
}
