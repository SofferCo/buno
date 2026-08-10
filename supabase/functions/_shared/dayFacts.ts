// buno — the DATA layer of the day brief (buno-reliability-pack §2, extended
// from "actions" to "measurements"). Every quantitative claim buno can make —
// counts, and the day-load word — is COMPUTED here, in code, from real fields.
// The model receives these fields and may only phrase/interpret them: a number
// or a load descriptor that isn't in a field DOES NOT EXIST. This is the same
// discipline as tool results (a claim needs backing) — only here the claim is a
// measurement, not an action. The thresholds (≥3 events = busy) live in code,
// never in the model's head.
const DAY_MS = 864e5;

export type DayFacts = {
  date: string;
  eventsToday: number | null;                    // null = calendar not read this turn → unknown, omit
  firstEvent: { title: string; time: string } | null;
  tasksToday: number;                            // alive WORK cards planned for today
  noEstimate: number;                            // of tasksToday, how many lack an estimate
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

// events === null means the calendar wasn't read this turn → eventsToday/dayLoad
// stay unknown (and their lines are never written). An empty array means it WAS
// read and there are zero events today (a real, assertable fact: "פנוי").
export function computeDayFacts(
  cards: any[], cols: any[], todayStr: string, nowMs: number,
  events: { title?: string; start?: string; allDay?: boolean }[] | null,
): DayFacts {
  const colById = new Map(cols.map((c: any) => [c.id, c]));
  const alive = (c: any) => !c.archived && !c.draft && !isDoneCol(colById.get(c.column_id));
  const hasTitle = (c: any) => !!String(c.title || "").trim();

  const planned = cards.filter((c) => alive(c) && c.card_type !== "waiting" && hasTitle(c) && inPlanToday(c, todayStr));
  const noEstimate = planned.filter((c) => !(Number(c.estimate_hours) > 0)).length;
  const stuck = cards.filter((c) => alive(c) && hasTitle(c) && c.card_type !== "waiting" && (nowMs - lastActivityMs(c)) / DAY_MS >= 3).length;
  const waiting = cards.filter((c) => alive(c) && c.card_type === "waiting" && hasTitle(c)).length;
  const drafts = cards.filter((c) => c.draft && !c.archived && hasTitle(c)).length;

  const timed = (events || []).filter((e) => !e.allDay).sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")));
  const eventsToday = events === null ? null : events.length;
  const firstEvent = timed.length ? { title: String(timed[0].title || ""), time: String(timed[0].start || "").slice(11, 16) } : null;
  const dayLoad = eventsToday === null ? null : eventsToday >= 3 ? "busy" : eventsToday === 0 ? "light" : "normal";

  return { date: todayStr, eventsToday, firstEvent, tasksToday: planned.length, noEstimate, stuckCards: stuck, waitingCards: waiting, draftsPending: drafts, dayLoad };
}

// Render the facts as a prompt block. A line whose backing field is empty/unknown
// is simply not emitted — so the model literally cannot read a fact that isn't there.
export function renderDayFacts(f: DayFacts): string {
  const load = f.dayLoad === "busy" ? "עמוס" : f.dayLoad === "light" ? "פנוי" : f.dayLoad === "normal" ? "רגיל" : null;
  const L: string[] = [`תאריך: ${f.date}`];
  if (f.eventsToday !== null) L.push(`אירועים ביומן היום: ${f.eventsToday}`);
  if (f.firstEvent) L.push(`פגישה ראשונה: ${f.firstEvent.title}${f.firstEvent.time ? ` ב־${f.firstEvent.time}` : ""}`);
  L.push(`משימות בתוכנית להיום: ${f.tasksToday}`);
  if (f.tasksToday > 0) L.push(`מתוכן בלי הערכת זמן: ${f.noEstimate}`);
  L.push(`משימות תקועות (≥3 ימים ללא תזוזה): ${f.stuckCards}`);
  if (f.waitingCards > 0) L.push(`משימות בהמתנה: ${f.waitingCards}`);
  if (f.draftsPending > 0) L.push(`טיוטות שממתינות לאישור: ${f.draftsPending}`);
  if (load) L.push(`עומס היום: ${load}`);
  return `=== עובדות היום · מחושב בקוד · המקור היחיד למספרים ולתיאור העומס (DATA) ===
${L.join("\n")}
=== סוף עובדות היום ===
כל מספר, ספירה או תיאור עומס (עמוס/רגיל/פנוי) בתשובה — אך ורק מהשדות שכאן. אל תספור את הלוח בעצמך, אל תעריך, ואל תשחזר פורמט של בריף עם מספרים שאינם כאן. שורה שנשענת על שדה שלא קיים למעלה — לא נכתבת. מותר ורצוי לפרש עובדה שכן קיימת בחום אנושי ("פגישה אחת — הבוקר פנוי לעבודה").`;
}
