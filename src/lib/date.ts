import { fmtDate } from "./format";

export function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

export function daysUntil(ds) { if (!ds) return null; const d = new Date(ds + "T00:00:00"), t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((d.getTime() - t.getTime()) / 86400000); }

export function deadlineInfo(ds) {
  const d = daysUntil(ds); if (d === null) return null;
  if (d < 0) return { text: `באיחור ${-d} ${-d === 1 ? "יום" : "ימים"}`, tone: "over" };
  if (d === 0) return { text: "היום", tone: "today" };
  if (d === 1) return { text: "מחר", tone: "soon" };
  if (d <= 7) return { text: `בעוד ${d} ${d === 1 ? "יום" : "ימים"}`, tone: "soon" };
  const [, m, day] = ds.split("-"); return { text: `${+day}.${+m}`, tone: "far" };
}

export function routineKind(c) { return c.routine === true ? "daily" : (c.routine || "none"); }

export function flexDay(c) { return (c.routine === "weekly" || c.routine === "monthly") && (c.dayFlex ?? c.flex); }

export function scheduleLabel(o) {
  const parts = []; const rk = o.routine || "none";
  if (rk !== "none") { parts.push({ daily: "יומי", weekly: "שבועי", monthly: "חודשי" }[rk]); if ((rk === "weekly" || rk === "monthly") && o.dayFlex) parts.push("יום גמיש"); }
  if (o.deadline && !((rk === "weekly" || rk === "monthly") && o.dayFlex)) { const dl = deadlineInfo(o.deadline); if (dl) parts.push(dl.text); }
  parts.push(o.time ? o.time : "שעה גמישה");
  return parts.join(" · ") || "—";
}

export function relTime(ts) { const s = Math.floor((Date.now() - ts) / 1000); if (s < 60) return "עכשיו"; if (s < 3600) return `לפני ${Math.floor(s / 60)} ד׳`; if (s < 86400) return `לפני ${Math.floor(s / 3600)} ש׳`; return fmtDate(ts); }

export function addPeriod(ds, kind) {
  const d = new Date(ds + "T00:00:00");
  if (kind === "weekly") d.setDate(d.getDate() + 7);
  else if (kind === "monthly") d.setMonth(d.getMonth() + 1);
  else d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ymOf(ts) { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }

export function ymLabel(k) { if (k === "all") return "כל הזמן"; const [y, m] = k.split("-"); return new Date(+y, +m - 1, 1).toLocaleDateString("he-IL", { month: "long", year: "numeric" }); }

export function last12Months() {
  const out = []; const d0 = new Date(); d0.setDate(1);
  for (let i = 11; i >= 0; i--) { const d = new Date(d0.getFullYear(), d0.getMonth() - i, 1); out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); }
  return out;
}

// ---- sub-month periods: "today" and "this week" (Sun–Sat) --------------------
// The dashboards bucket by MONTH; these give the finer day-level range so the same
// data can be scoped to a single day or the running week. Billing follows the
// DEADLINE date (the day the user controls), else creation — matching billYm.
export const DAY_MS = 86400000;
export const startOfDayMs = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
export function billDayMs(c: any): number {
  const d = c?.deadline ? new Date(String(c.deadline) + "T00:00:00") : new Date(c.createdAt);
  d.setHours(0, 0, 0, 0); return d.getTime();
}
// a day-level period → its [fromMs, toMs] inclusive day span; null for month periods.
export function dayRange(period: string, now: number): { fromMs: number; toMs: number } | null {
  const t = startOfDayMs(now);
  if (period === "day") return { fromMs: t, toMs: t + DAY_MS - 1 };
  if (period === "week") { const from = t - new Date(t).getDay() * DAY_MS; return { fromMs: from, toMs: from + 7 * DAY_MS - 1 }; }
  return null;
}
// the day-midnight timestamps inside a range, oldest → newest (bar-chart buckets).
export function rangeDays(fromMs: number, toMs: number): number[] {
  const out: number[] = []; for (let m = startOfDayMs(fromMs); m <= toMs; m += DAY_MS) out.push(m); return out;
}
// short bar label for a day bucket: weekday letter + d/m, e.g. "א׳ 20/8".
export function dayShort(ms: number): string {
  const d = new Date(ms); const wd = d.toLocaleDateString("he-IL", { weekday: "narrow" });
  return `${wd} ${d.getDate()}/${d.getMonth() + 1}`;
}
// header range label for a day period.
export function dayRangeLabel(period: string, now: number): string {
  const r = dayRange(period, now); if (!r) return "";
  const fmt = (ms: number) => new Date(ms).toLocaleDateString("he-IL", { day: "numeric", month: "long" });
  return period === "day" ? new Date(r.fromMs).toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : `${fmt(r.fromMs)} – ${fmt(r.toMs)}`;
}
