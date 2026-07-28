import { AV_COLORS } from "./constants";

export function initials(n) { const w = (n || "?").trim().split(/\s+/).filter(Boolean); if (w.length >= 2) return (w[0][0] + w[1][0]).toUpperCase(); return (w[0] || "?").slice(0, 2).toUpperCase(); }

// the assistant is named buno; older cards were stamped "העוזר" — show buno.
export function creatorOf(c) { const v = c.creator ?? c.briefFrom ?? ""; return v === "העוזר" ? "buno" : v; }

export function ccOf(c) { return c.cc || []; }

export function peopleOf(c) { const r = []; const cr = creatorOf(c); if (cr) r.push(cr); ccOf(c).forEach((n) => { if (n && !r.includes(n)) r.push(n); }); return r; }

export function nameColor(n) { n = (n || "?"); let h = 5381; for (let i = 0; i < n.length; i++) h = (((h << 5) + h) + n.charCodeAt(i)) >>> 0; return AV_COLORS[h % AV_COLORS.length]; }
