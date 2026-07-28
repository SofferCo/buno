export function subHours(c): number { return (c.subtasks || []).reduce((a, s) => a + (Number(s.hours) || 0), 0); }

export function cardSeconds(c, now): number {
  let s = (c.timeSpent || 0) + subHours(c) * 3600;
  if (c.timerStart) s += Math.floor((now - c.timerStart) / 1000);
  return s;
}

// timeRound is a SYSTEM principle, not a display option: it governs every
// time→value computation (board stat, billable hours, revenue), not just how a
// number is printed. In "ceil_hour" each card is rounded UP to whole hours
// BEFORE it is summed or multiplied by a rate (3 cards of 20m = 3 billable
// hours). "decimal"/"exact" bill by the actual time. Because the same per-card
// rule feeds both the header stat and the invoice, the two never disagree.
export function cardHours(sec: number, mode: string): number {
  const h = sec / 3600;
  return mode === "ceil_hour" ? (sec > 0 ? Math.ceil(h) : 0) : h;
}

export function sumHours(cards: any[], now: number, mode: string): number {
  return (cards || []).reduce((a, c) => a + cardHours(cardSeconds(c, now), mode), 0);
}
