export function fmtShort(sec) { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); if (h > 0) return `${h}ש ${m}ד`; if (m > 0) return `${m}ד`; return `${sec}ש׳`; }

export function fmtClock(sec) { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60, p = (n) => String(n).padStart(2, "0"); return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`; }

export function fmtDate(ts) { const d = new Date(ts); return `${d.getDate()}.${d.getMonth() + 1}.${String(d.getFullYear()).slice(2)}`; }

export function fmtHours(sec) { return (Math.round(sec / 360) / 10).toString(); }

export function fmtMoney(n) { return "₪" + Math.round(n).toLocaleString("he-IL"); }
