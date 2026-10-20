import { AV_COLORS } from "./constants";

export function initials(n) { const w = (n || "?").trim().split(/\s+/).filter(Boolean); if (w.length >= 2) return (w[0][0] + w[1][0]).toUpperCase(); return (w[0] || "?").slice(0, 2).toUpperCase(); }

// the assistant is named buno; older cards were stamped "העוזר" — show buno.
export function creatorOf(c) { const v = c.creator ?? c.briefFrom ?? ""; return v === "העוזר" ? "buno" : v; }

// The brief-GIVER — a real person/contact. buno is a TOOL, never a giver, so a
// buno-stamped (or empty) card has NO giver ("" → shown as "ללא שיוך"), never buno.
export function briefGiverOf(c) { const g = String(creatorOf(c) || "").trim(); return (!g || g === "buno" || g === "העוזר") ? "" : g; }

export function ccOf(c) { return c.cc || []; }

// "לורן - תיקונים…", "תמונות למאור": the user names the brief-giver IN the title
// but the card is stamped with themself as creator. Given the known people
// (contacts, board members, names already on cards), return the one the title
// names — longest match first, whole-word, case-insensitive; a Hebrew prefix
// letter (ל/מ/ש/ו/ב/ה) before the name is allowed ("למאור" → מאור). "" if none.
export function inferGiversFromTitle(title: any, names: any[], selfName: any = ""): string[] {
  const t = String(title || "").trim(); if (!t) return [];
  const self = String(selfName || "").trim().toLowerCase();
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cands: string[] = Array.from(new Set<string>((names || []).map((n: any) => String(n || "").trim()).filter((n) => n.length >= 2 && n !== "buno" && n !== "העוזר" && n.toLowerCase() !== self)));
  // whole word (Hebrew/Latin), optional single Hebrew prefix letter ("למאור" → מאור)
  const at = (needle: string): number => { const m = new RegExp(`(^|[^\\p{L}\\p{N}])(?:[למשובהכ])?(${esc(needle)})(?=$|[^\\p{L}\\p{N}])`, "iu").exec(t); return m ? m.index + m[1].length : -1; };
  const hits: { n: string; i: number }[] = [];
  for (const n of cands) {
    let i = at(n);
    const first = n.split(/\s+/)[0];           // "Lauren Stuttaford" named as "Lauren"
    if (i < 0 && first.length >= 3 && first !== n) i = at(first);
    if (i >= 0) hits.push({ n, i });
  }
  // several people in one title → ALL of them, in the order mentioned; two names
  // at the same spot (a first name and the full name) → keep the longer one.
  hits.sort((a, b) => a.i - b.i || b.n.length - a.n.length);
  const out: string[] = []; let lastAt = -1;
  for (const h of hits) { if (h.i === lastAt) continue; out.push(h.n); lastAt = h.i; }
  return out;
}
export function inferGiverFromTitle(title: any, names: any[], selfName: any = ""): string {
  return inferGiversFromTitle(title, names, selfName)[0] || "";
}

// buno is the CREATOR in metadata only — it must never show as an assignee/person.
// Real human creators still appear; assignees come from cc.
export function peopleOf(c) { const r = []; const cr = creatorOf(c); if (cr && cr !== "buno") r.push(cr); ccOf(c).forEach((n) => { const nm = n === "העוזר" ? "buno" : n; if (nm && nm !== "buno" && !r.includes(nm)) r.push(nm); }); return r; }

export function nameColor(n) { n = (n || "?"); let h = 5381; for (let i = 0; i < n.length; i++) h = (((h << 5) + h) + n.charCodeAt(i)) >>> 0; return AV_COLORS[h % AV_COLORS.length]; }
