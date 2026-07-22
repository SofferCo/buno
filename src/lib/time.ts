export function subHours(c): number { return (c.subtasks || []).reduce((a, s) => a + (Number(s.hours) || 0), 0); }

export function cardSeconds(c, now): number {
  let s = (c.timeSpent || 0) + subHours(c) * 3600;
  if (c.timerStart) s += Math.floor((now - c.timerStart) / 1000);
  return s;
}
