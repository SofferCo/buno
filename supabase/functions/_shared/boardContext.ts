// One brain, one perception. Both the web /chat and the WhatsApp/sweep core
// (assistantCore) build the board summary and the calendar summary from HERE, so
// buno "sees" the same board and the same day the same way on every surface.
// (voice.ts already unifies the persona; this unifies what buno knows.)

const DAY = 864e5;

// The rich board summary (comments, attachments, age, relative deadline). Callers
// pass per-card comment/attachment maps when they have them (web); WhatsApp may
// pass empty maps — the shape stays identical, only the depth differs by what was fetched.
export function summarizeBoard(
  projects: any[], cards: any[], cols: any[],
  commentsByCard: Map<string, any[]>, attachByCard: Map<string, any[]>,
  todayStr: string, nowMs: number,
): string {
  const colTitle = new Map<string, string>();
  for (const c of cols) colTitle.set(c.id, c.title);
  const projName = new Map<string, string>();
  for (const p of projects) projName.set(p.id, p.name);
  const active = cards.filter((c) => !c.archived);
  const head = `הפרויקטים: ${projects.map((p) => p.name).join(" · ") || "—"}`;
  if (!active.length) return head + "\n(אין משימות פעילות.)";
  const ageStr = (iso: string) => {
    if (!iso) return "";
    const d = Math.floor((nowMs - new Date(iso).getTime()) / DAY);
    return d <= 0 ? "נפתח היום" : d === 1 ? "פתוח יום" : `פתוח ${d} ימים`;
  };
  const dueStr = (dl: string) => {
    if (!dl) return "";
    const diff = Math.round((new Date(dl + "T00:00:00").getTime() - new Date(todayStr + "T00:00:00").getTime()) / DAY);
    return diff < 0 ? `דדליין עבר לפני ${-diff} ${-diff === 1 ? "יום" : "ימים"}` : diff === 0 ? "דדליין היום" : diff === 1 ? "דדליין מחר" : `דדליין בעוד ${diff} ימים`;
  };
  const byProject: Record<string, any[]> = {};
  for (const c of active) (byProject[c.project_id] = byProject[c.project_id] || []).push(c);
  const lines: string[] = [head];
  for (const pid of Object.keys(byProject)) {
    lines.push(`\nפרויקט: ${projName.get(pid) || "—"}`);
    for (const c of byProject[pid].slice(0, 40)) {
      const parts = [`• ${c.title || "ללא כותרת"}`];
      if (c.column_id && colTitle.get(c.column_id)) parts.push(`[${colTitle.get(c.column_id)}]`);
      const due = dueStr(c.deadline); if (due) parts.push(due);
      const age = ageStr(c.created_at); if (age) parts.push(age);
      if (c.priority && c.priority !== "regular") parts.push(c.priority === "critical" ? "קריטי" : "חשוב");
      const cs = commentsByCard.get(c.id) || [];
      if (cs.length) {
        const last = cs[cs.length - 1];
        parts.push(`${cs.length} תגובות (אחרונה — ${last.by_name}: ${String(last.text || "").replace(/\s+/g, " ").slice(0, 50)})`);
      }
      const as = attachByCard.get(c.id) || [];
      if (as.length) parts.push(`${as.length} קבצים${as.some((a: any) => a.name) ? ` (${as.map((a: any) => a.name).filter(Boolean).slice(0, 3).join(", ")})` : ""}`);
      lines.push(parts.join(" · "));
    }
  }
  return lines.join("\n");
}

// The calendar summary, deduped against materialized cards. An event the user
// already opened is a real card ("cal-<id>") with its own done-state — drop the raw
// copy so buno reads the card, never a stale "not done" event. Identical on web + WA.
export function calendarSummary(
  rawEvents: any[], cards: any[],
  opts: { scope?: "today" | "tomorrow" | "week"; scopeDay?: string; todayKey?: string; tomorrowKey?: string; limit?: number },
): { text: string; events: any[] } {
  const scope = opts.scope || "today";
  const linkedRefs = new Set(
    (cards || []).filter((c: any) => !c.archived && typeof c.origin?.ref === "string" && c.origin.ref.startsWith("cal-")).map((c: any) => c.origin.ref),
  );
  const dateOf = (e: any) => String(e.start || "").slice(0, 10);
  const deduped = (rawEvents || []).filter((e: any) => !linkedRefs.has("cal-" + e.id));
  const inScope = scope === "week" ? deduped : deduped.filter((e: any) => dateOf(e) === opts.scopeDay);
  const ordered = [...inScope].sort((a: any, b: any) => a.allDay === b.allDay ? String(a.start || "").localeCompare(String(b.start || "")) : (a.allDay ? 1 : -1)).slice(0, opts.limit || 40);
  const text = ordered.map((e: any) => {
    const day = dateOf(e);
    const label = opts.todayKey && day === opts.todayKey ? "היום" : opts.tomorrowKey && day === opts.tomorrowKey ? "מחר" : (scope === "week" ? day : "");
    const when = e.allDay ? "כל היום" : String(e.start || "").slice(11, 16);
    const who = (e.attendees || []).filter((a: any) => !a.self).map((a: any) => a.email).slice(0, 6).join(", ");
    return `• ${[label, when].filter(Boolean).join(" ")} · ${e.title}${who ? ` · עם: ${who}` : ""}${e.meetLink ? " · Meet" : ""}`;
  }).join("\n");
  return { text, events: ordered };
}
