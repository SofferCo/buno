// buno — the DATA layer of the day brief (buno-reliability-pack §2, extended
// from "actions" to "measurements"). Every quantitative claim buno can make —
// counts, the one core task, the day-load word — is COMPUTED here, in code, from
// real fields. The model receives these fields and may only phrase/interpret
// them: a number or a load descriptor that isn't in a field DOES NOT EXIST. Same
// discipline as tool results (a claim needs backing) — here the claim is a
// measurement. Thresholds (≥3 events = busy) live in code, never in the model.
//
// Wave A surfaces only signals that are an EXACT pure-compute over data both
// chat doors already load (cards, cols, today's events) — nothing here needs a
// new query, so no number can ever contradict the board. Richer signals that
// need extra data (per-client hours, almost-closed, awaited replies) are Wave B.
const DAY_MS = 864e5;

export type CoreTask = { title: string; reason: string };

export type DayFacts = {
  date: string;
  eventsToday: number | null;                    // null = calendar not read this turn → unknown, omit
  firstEvent: { title: string; time: string } | null;
  invitesPending: number;                        // today's events still needing your RSVP
  morningFree: boolean | null;                   // no timed event before 12:00 (null when events unknown)
  tasksToday: number;                            // alive WORK cards planned for today
  noEstimate: number;                            // of tasksToday, how many lack an estimate
  overdue: number;                               // alive WORK cards past their deadline
  deadlinesThisWeek: number;                     // alive WORK cards due in the next 1–7 days
  coreTask: CoreTask | null;                     // the ONE thing: top priority, then earliest deadline
  stuckCards: number;                            // alive cards with no activity ≥3 days
  waitingCards: number;
  draftsPending: number;
  dayLoad: "light" | "normal" | "busy" | null;   // null when eventsToday is unknown
};

const isDoneCol = (col: any) => !!(col && (col.is_done || col.key === "col-done"));
function daysUntil(deadline: string | null, todayStr: string): number | null {
  if (!deadline) return null;
  return Math.round((new Date(deadline + "T00:00:00").getTime() - new Date(todayStr + "T00:00:00").getTime()) / DAY_MS);
}
const flexDay = (c: any) => (c.routine === "weekly" || c.routine === "monthly") && !!c.day_flex;
function inPlanToday(c: any, todayStr: string): boolean {
  const d = daysUntil(c.deadline, todayStr);
  if (d === null) return false;
  if (flexDay(c)) return d <= (c.routine === "monthly" ? 31 : 7);
  return d <= 0;
}
function lastActivityMs(c: any): number {
  return Math.max(new Date(c.column_changed_at || c.created_at).getTime(), new Date(c.created_at).getTime());
}
const PRIORITY_RANK: Record<string, number> = { critical: 0, important: 1, regular: 2 };
const startHour = (e: any) => e.allDay ? -1 : Number(String(e.start || "").slice(11, 13) || "99");

// events === null → calendar unread this turn; eventsToday/dayLoad/invites/
// morningFree stay unknown (their lines are never written). [] means read + empty.
export function computeDayFacts(input: {
  cards: any[]; cols: any[]; todayStr: string; nowMs: number;
  events: { title?: string; start?: string; allDay?: boolean; myStatus?: string | null }[] | null;
}): DayFacts {
  const { cards, cols, todayStr, nowMs, events } = input;
  const colById = new Map(cols.map((c: any) => [c.id, c]));
  const alive = (c: any) => !c.archived && !c.draft && !isDoneCol(colById.get(c.column_id));
  const hasTitle = (c: any) => !!String(c.title || "").trim();
  const work = (c: any) => c.card_type !== "waiting";

  const planned = cards.filter((c) => alive(c) && work(c) && hasTitle(c) && inPlanToday(c, todayStr));
  const noEstimate = planned.filter((c) => !(Number(c.estimate_hours) > 0)).length;
  const aliveWork = cards.filter((c) => alive(c) && work(c) && hasTitle(c));
  const overdue = aliveWork.filter((c) => { const d = daysUntil(c.deadline, todayStr); return d !== null && d < 0 && !flexDay(c); }).length;
  const deadlinesThisWeek = aliveWork.filter((c) => { const d = daysUntil(c.deadline, todayStr); return d !== null && d >= 1 && d <= 7; }).length;
  const stuck = cards.filter((c) => alive(c) && work(c) && hasTitle(c) && (nowMs - lastActivityMs(c)) / DAY_MS >= 3).length;
  const waiting = cards.filter((c) => alive(c) && c.card_type === "waiting" && hasTitle(c)).length;
  const drafts = cards.filter((c) => c.draft && !c.archived && hasTitle(c)).length;

  // the ONE core task: top priority (critical→important→regular), then the earliest
  // deadline. Consistent with the product's "priority first, then deadline" rule.
  const core = [...planned].sort((a, b) => {
    const pr = (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
    if (pr) return pr;
    const da = daysUntil(a.deadline, todayStr), db = daysUntil(b.deadline, todayStr);
    return (da === null ? 9999 : da) - (db === null ? 9999 : db);
  })[0] || null;
  let coreTask: CoreTask | null = null;
  if (core) {
    const d = daysUntil(core.deadline, todayStr);
    const reason = d !== null && d < 0 ? "באיחור" : d === 0 ? "דדליין היום"
      : core.priority === "critical" ? "קריטי" : core.priority === "important" ? "חשוב" : "הבא בתור";
    coreTask = { title: String(core.title), reason };
  }

  const timed = (events || []).filter((e) => !e.allDay).sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")));
  const eventsToday = events === null ? null : events.length;
  const firstEvent = timed.length ? { title: String(timed[0].title || ""), time: String(timed[0].start || "").slice(11, 16) } : null;
  const invitesPending = events === null ? 0 : events.filter((e) => e.myStatus === "needsAction").length;
  const morningFree = events === null ? null : !timed.some((e) => { const h = startHour(e); return h >= 0 && h < 12; });
  const dayLoad = eventsToday === null ? null : eventsToday >= 3 ? "busy" : eventsToday === 0 ? "light" : "normal";

  return { date: todayStr, eventsToday, firstEvent, invitesPending, morningFree, tasksToday: planned.length, noEstimate, overdue, deadlinesThisWeek, coreTask, stuckCards: stuck, waitingCards: waiting, draftsPending: drafts, dayLoad };
}

// Render the facts as a prompt block. A line whose backing field is empty/unknown
// is simply not emitted — so the model literally cannot read a fact that isn't there.
export function renderDayFacts(f: DayFacts): string {
  const load = f.dayLoad === "busy" ? "עמוס" : f.dayLoad === "light" ? "פנוי" : f.dayLoad === "normal" ? "רגיל" : null;
  const L: string[] = [`תאריך: ${f.date}`];
  if (f.eventsToday !== null) L.push(`אירועים ביומן היום: ${f.eventsToday}`);
  if (f.firstEvent) L.push(`פגישה ראשונה: ${f.firstEvent.title}${f.firstEvent.time ? ` ב־${f.firstEvent.time}` : ""}`);
  if (f.invitesPending > 0) L.push(`הזמנות שממתינות לתשובתך: ${f.invitesPending}`);
  if (f.morningFree === true) L.push(`הבוקר פנוי מפגישות (אין אירוע לפני 12:00)`);
  L.push(`משימות בתוכנית להיום: ${f.tasksToday}`);
  if (f.tasksToday > 0) L.push(`מתוכן בלי הערכת זמן: ${f.noEstimate}`);
  if (f.coreTask) L.push(`הליבה של היום (הדבר האחד): "${f.coreTask.title}" — ${f.coreTask.reason}`);
  if (f.overdue > 0) L.push(`משימות באיחור (עבר הדדליין): ${f.overdue}`);
  if (f.deadlinesThisWeek > 0) L.push(`דדליינים בשבוע הקרוב: ${f.deadlinesThisWeek}`);
  L.push(`משימות תקועות (≥3 ימים ללא תזוזה): ${f.stuckCards}`);
  if (f.waitingCards > 0) L.push(`משימות בהמתנה: ${f.waitingCards}`);
  if (f.draftsPending > 0) L.push(`טיוטות שממתינות לאישור: ${f.draftsPending}`);
  if (load) L.push(`עומס היום: ${load}`);
  return `=== עובדות היום · מחושב בקוד · המקור היחיד למספרים, לליבה ולתיאור העומס (DATA) ===
${L.join("\n")}
=== סוף עובדות היום ===
כל מספר, ספירה, "הליבה של היום", או תיאור עומס (עמוס/רגיל/פנוי) בתשובה — אך ורק מהשדות שכאן. אל תספור את הלוח בעצמך, אל תעריך, ואל תשחזר פורמט של בריף עם מספרים שאינם כאן. שורה שנשענת על שדה שלא קיים למעלה — לא נכתבת. מותר ורצוי לפרש עובדה שכן קיימת בחום אנושי ("פגישה אחת — הבוקר פנוי לעבודה עמוקה").`;
}
