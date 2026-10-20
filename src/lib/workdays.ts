// buno — Israeli workdays. A workday is Sun–Thu that is not a public holiday
// (יום שבתון). Holidays are found on the HEBREW calendar via Intl (built into
// every modern browser — no API, no table to maintain), so Tishrei 1 is Rosh
// Hashana in any year. Erev Pesach / Erev Yom Kippur are counted as days OFF
// (practically nobody works them); chol-hamoed days are counted as WORKdays.
const heb = new Intl.DateTimeFormat("en-u-ca-hebrew", { month: "long", day: "numeric" });
function hebrew(d: Date): { month: string; day: number } {
  let month = "", day = 0;
  for (const p of heb.formatToParts(d)) { if (p.type === "month") month = p.value; if (p.type === "day") day = Number(p.value); }
  return { month, day };
}
const M = (s: string) => s.replace(/\s+/g, " ").trim();
// fixed Hebrew-date holidays (month name as ICU prints it)
const FIXED: Record<string, string> = {
  "Tishri 1": "ראש השנה", "Tishri 2": "ראש השנה", "Tishri 9": "ערב יום כיפור", "Tishri 10": "יום כיפור",
  "Tishri 15": "סוכות", "Tishri 22": "שמחת תורה",
  "Nisan 14": "ערב פסח", "Nisan 15": "פסח", "Nisan 21": "שביעי של פסח",
  "Sivan 6": "שבועות",
};
export function holidayName(d: Date): string | null {
  const { month, day } = hebrew(d);
  const key = M(`${month} ${day}`);
  if (FIXED[key]) return FIXED[key];
  // Yom HaAtzmaut: 5 Iyar, moved to Thu when it falls Fri/Sat, to Tue when Mon.
  if (month === "Iyar") {
    const dow = d.getDay();
    if (day === 5 && dow !== 5 && dow !== 6 && dow !== 1) return "יום העצמאות";
    if (day === 4 && dow === 4) return "יום העצמאות";        // 5 Iyar is Friday
    if (day === 3 && dow === 4) return "יום העצמאות";        // 5 Iyar is Saturday
    if (day === 6 && dow === 2) return "יום העצמאות";        // 5 Iyar is Monday
  }
  return null;
}
export function isWorkday(d: Date): boolean { const dow = d.getDay(); return dow !== 5 && dow !== 6 && !holidayName(d); }
// workdays of a "YYYY-MM" month, optionally only up to a day of month (inclusive);
// also returns the holidays that fell on weekdays (the ones that actually cost a day).
export function monthWorkdays(ym: string, upToDay?: number): { count: number; holidays: { day: number; name: string }[] } {
  const [y, m] = ym.split("-").map(Number); const last = upToDay ?? new Date(y, m, 0).getDate();
  let count = 0; const holidays: { day: number; name: string }[] = [];
  for (let day = 1; day <= last; day++) {
    const d = new Date(y, m - 1, day); const dow = d.getDay();
    if (dow === 5 || dow === 6) continue;
    const h = holidayName(d); if (h) { holidays.push({ day, name: h }); continue; }
    count++;
  }
  return { count, holidays };
}
