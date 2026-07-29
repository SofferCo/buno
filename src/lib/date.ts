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
