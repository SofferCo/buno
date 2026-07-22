import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

const KEY = "adk_board_v3";
const APREFIX = "adk_asset_";

const DEFAULT_COLUMNS = [
  { id: "col-brief", title: "בריף חדש" },
  { id: "col-doing", title: "בעבודה" },
  { id: "col-review", title: "לבדיקה / אישור" },
  { id: "col-done", title: "הושלם" },
];
const SWATCHES = ["#0E8F8C", "#3B6FE0", "#8E54C4", "#D9503A", "#C9821A", "#2E9E5B", "#455A64"];
const PRIORITY = {
  regular:   { label: "רגיל",  color: "#647079", soft: "#EEF1F2" },
  important: { label: "חשוב",  color: "#C9821A", soft: "#FBF0DC" },
  critical:  { label: "קריטי", color: "#D9503A", soft: "#FBE2DC" },
};
const PRI_ORDER = { critical: 0, important: 1, regular: 2 };

function uid(p) { return p + "-" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3); }
function initials(n) { const w = (n || "?").trim().split(/\s+/).filter(Boolean); if (w.length >= 2) return (w[0][0] + w[1][0]).toUpperCase(); return (w[0] || "?").slice(0, 2).toUpperCase(); }
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function daysUntil(ds) { if (!ds) return null; const d = new Date(ds + "T00:00:00"), t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((d - t) / 86400000); }
function deadlineInfo(ds) {
  const d = daysUntil(ds); if (d === null) return null;
  if (d < 0) return { text: `באיחור ${-d}ד`, tone: "over" };
  if (d === 0) return { text: "היום", tone: "today" };
  if (d === 1) return { text: "מחר", tone: "soon" };
  if (d <= 7) return { text: `בעוד ${d}ד`, tone: "soon" };
  const [, m, day] = ds.split("-"); return { text: `${+day}.${+m}`, tone: "far" };
}
function subHours(c) { return (c.subtasks || []).reduce((a, s) => a + (Number(s.hours) || 0), 0); }
function routineKind(c) { return c.routine === true ? "daily" : (c.routine || "none"); }
function flexDay(c) { return (c.routine === "weekly" || c.routine === "monthly") && (c.dayFlex ?? c.flex); }
function scheduleLabel(o) {
  const parts = []; const rk = o.routine || "none";
  if (rk !== "none") { parts.push({ daily: "יומי", weekly: "שבועי", monthly: "חודשי" }[rk]); if ((rk === "weekly" || rk === "monthly") && o.dayFlex) parts.push("יום גמיש"); }
  if (o.deadline && !((rk === "weekly" || rk === "monthly") && o.dayFlex)) { const dl = deadlineInfo(o.deadline); if (dl) parts.push(dl.text); }
  parts.push(o.time ? o.time : "שעה גמישה");
  return parts.join(" · ") || "—";
}
function creatorOf(c) { return c.creator ?? c.briefFrom ?? ""; }
function ccOf(c) { return c.cc || []; }
function peopleOf(c) { const r = []; const cr = creatorOf(c); if (cr) r.push(cr); ccOf(c).forEach((n) => { if (n && !r.includes(n)) r.push(n); }); return r; }
const AV_COLORS = ["#0E8F8C", "#8E54C4", "#3B6FE0", "#2E9E5B", "#C9821A", "#D9503A", "#16A085", "#6C7BE0", "#7A57D1", "#2E86C1", "#E67E22", "#CB4B7A", "#4FB0AD", "#5D6D7E"];
function nameColor(n) { n = (n || "?"); let h = 5381; for (let i = 0; i < n.length; i++) h = (((h << 5) + h) + n.charCodeAt(i)) >>> 0; return AV_COLORS[h % AV_COLORS.length]; }
function Avatar({ name, size = 24 }) { return <div className="adk-av" style={{ width: size, height: size, background: nameColor(name), fontSize: size * 0.4 }} title={name}>{initials(name)}</div>; }
function relTime(ts) { const s = Math.floor((Date.now() - ts) / 1000); if (s < 60) return "עכשיו"; if (s < 3600) return `לפני ${Math.floor(s / 60)} ד׳`; if (s < 86400) return `לפני ${Math.floor(s / 3600)} ש׳`; return fmtDate(ts); }
const ROUTINE_LABEL = { daily: "יומית", weekly: "שבועית", monthly: "חודשית" };
function addPeriod(ds, kind) {
  const d = new Date(ds + "T00:00:00");
  if (kind === "weekly") d.setDate(d.getDate() + 7);
  else if (kind === "monthly") d.setMonth(d.getMonth() + 1);
  else d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function cardSeconds(c, now) {
  let s = (c.timeSpent || 0) + subHours(c) * 3600;
  if (c.timerStart) s += Math.floor((now - c.timerStart) / 1000);
  return s;
}
function fmtShort(sec) { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); if (h > 0) return `${h}ש ${m}ד`; if (m > 0) return `${m}ד`; return `${sec}ש׳`; }
function fmtClock(sec) { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60, p = (n) => String(n).padStart(2, "0"); return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`; }

function readDataURL(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); }
function resizeImage(file, max, mime, q) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => { const img = new Image(); img.onload = () => {
      let { width, height } = img;
      if (width >= height && width > max) { height = Math.round(height * max / width); width = max; }
      else if (height > width && height > max) { width = Math.round(width * max / height); height = max; }
      const c = document.createElement("canvas"); c.width = width; c.height = height;
      c.getContext("2d").drawImage(img, 0, 0, width, height); resolve(c.toDataURL(mime, q));
    }; img.onerror = reject; img.src = fr.result; };
    fr.onerror = reject; fr.readAsDataURL(file);
  });
}

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Google+Sans:ital,wght@0,400..700;1,400..700&family=Assistant:wght@400;500;600;700;800&display=swap');
.adk,.adk *{box-sizing:border-box;font-family:'Google Sans','Assistant',system-ui,sans-serif;}
.adk{--canvas:#EEF1F2;--surface:#FFFFFF;--surface-2:#F7F9F9;--ink:#17282F;--muted:#647079;--faint:#93A0A6;--border:#E1E7E9;--accent:#0E8F8C;--accent-d:#0A6F6D;--accent-soft:#E1F1F0;--rec:#E8664A;--rec-soft:#FBE7E1;direction:rtl;background:var(--canvas);color:var(--ink);min-height:100vh;width:100%;-webkit-font-smoothing:antialiased;}
.adk-top{display:flex;align-items:center;gap:14px;padding:13px 20px;background:var(--surface);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:30;flex-wrap:wrap;}
.adk-stats{display:flex;gap:8px;flex-wrap:wrap;}
.adk-stat{background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:0 13px;height:40px;display:flex;flex-direction:column;justify-content:center;min-width:74px;}
.adk-stat b{font-size:14.5px;font-weight:800;line-height:1.05;}
.adk-stat small{font-size:10.5px;color:var(--muted);font-weight:600;line-height:1.1;}
.adk-day-btn{margin-inline-start:auto;border:1px solid var(--border);background:var(--surface-2);color:var(--ink);border-radius:11px;padding:0 15px;height:40px;font-weight:700;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:8px;font-family:inherit;transition:all .12s;}
.adk-day-btn:hover{border-color:var(--accent);color:var(--accent-d);}
.adk-day-btn .n{background:var(--accent);color:#fff;border-radius:20px;font-size:11px;padding:1px 7px;font-weight:800;}
.adk-cbadge{width:36px;height:36px;border-radius:9px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:14px;overflow:hidden;flex:none;}
.adk-cbadge img{width:100%;height:100%;object-fit:cover;}
.adk-csel{position:relative;}
.adk-csel-btn{display:flex;align-items:center;gap:10px;background:transparent;border:none;border-radius:12px;padding:6px 10px 6px 8px;cursor:pointer;font-family:inherit;width:286px;}
.adk-csel-btn:hover{background:var(--surface-2);}
.adk-csel-btn:hover{border-color:var(--accent);}
.adk-csel-btn .nm{font-weight:800;font-size:15px;text-align:right;}
.adk-csel-btn .sub{font-size:11.5px;color:var(--faint);font-weight:600;}
.adk-csel-btn .chev{margin-inline-start:auto;color:var(--muted);opacity:0;transition:opacity .12s;display:grid;place-items:center;}
.adk-csel-btn:hover .chev{opacity:1;}
.adk-drop{position:absolute;top:calc(100% + 6px);right:0;width:280px;background:#fff;border:1px solid var(--border);border-radius:13px;box-shadow:0 16px 40px rgba(23,40,47,.18);padding:6px;z-index:40;max-height:60vh;overflow-y:auto;}
.adk-drop-item{display:flex;align-items:center;gap:10px;padding:8px;border-radius:9px;cursor:pointer;}
.adk-drop-item:hover{background:var(--surface-2);}
.adk-drop-item.active{background:var(--accent-soft);}
.adk-drop-item .nm{font-weight:700;font-size:14px;}
.adk-drop-item .sub{font-size:11.5px;color:var(--faint);}
.adk-drop-item .cnt{margin-inline-start:auto;font-size:11.5px;color:var(--muted);font-weight:700;background:var(--surface-2);border-radius:20px;padding:1px 8px;}
.adk-drop-add{width:100%;text-align:right;border:none;background:transparent;color:var(--accent-d);font-weight:700;font-size:14px;padding:9px 8px;cursor:pointer;font-family:inherit;border-top:1px solid var(--border);margin-top:4px;}
.adk-drop-add:hover{background:var(--surface-2);}
.adk-drop-item .edit{border:none;background:transparent;color:var(--faint);cursor:pointer;font-size:13px;padding:2px 4px;border-radius:6px;}
.adk-drop-item .edit:hover{color:var(--ink);background:#fff;}
.adk-board{display:flex;gap:14px;padding:18px 20px 40px;align-items:flex-start;overflow-x:auto;min-height:calc(100vh - 66px);}
.adk-col{flex:0 0 286px;width:286px;background:var(--surface-2);border:1px solid var(--border);border-radius:14px;display:flex;flex-direction:column;max-height:calc(100vh - 108px);}
.adk-col.drop{outline:2px dashed var(--accent);outline-offset:-3px;background:var(--accent-soft);}
.adk-col-head{display:flex;align-items:center;gap:8px;padding:12px 13px 8px;}
.adk-col-title{font-weight:700;font-size:14.5px;border:none;background:transparent;color:var(--ink);padding:2px 4px;border-radius:6px;flex:1;min-width:0;font-family:inherit;}
.adk-col-title:focus{outline:none;background:#fff;box-shadow:0 0 0 2px var(--accent-soft);}
.adk-count{font-size:12px;color:var(--muted);font-weight:700;background:#fff;border:1px solid var(--border);border-radius:20px;padding:1px 8px;}
.adk-col-time{font-size:11.5px;color:var(--accent-d);font-weight:700;padding:0 17px 8px;margin-top:-2px;}
.adk-cards{padding:2px 9px 9px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:9px;min-height:8px;}
.adk-colmenu{border:none;background:transparent;color:var(--faint);cursor:pointer;padding:2px 5px;border-radius:6px;font-size:17px;line-height:1;}
.adk-colmenu:hover{background:#fff;color:var(--ink);}
.adk-card{background:var(--surface);border:1px solid var(--border);border-radius:11px;cursor:pointer;position:relative;transition:box-shadow .12s;box-shadow:0 1px 2px rgba(23,40,47,.04);overflow:hidden;}
.adk-card:hover{box-shadow:0 4px 14px rgba(23,40,47,.09);}
.adk-card.dragging{opacity:.4;}
.adk-card.rec{border-color:var(--rec);box-shadow:0 0 0 1px var(--rec);}
.adk-card-thumb{width:100%;height:112px;object-fit:cover;display:block;}
.adk-card-in{padding:11px 12px;}
.adk-card-title{font-weight:600;font-size:14px;line-height:1.35;margin:0 0 8px;word-break:break-word;}
.adk-card-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.adk-chip{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:700;background:var(--surface-2);border:1px solid var(--border);border-radius:7px;padding:2px 7px;color:var(--muted);}
.adk-chip.brief{background:var(--accent-soft);border-color:transparent;color:var(--accent-d);}
.adk-pri{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:800;border-radius:7px;padding:2px 8px;}
.adk-dl{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:700;border-radius:7px;padding:2px 7px;}
.adk-dl.over{background:var(--rec-soft);color:var(--rec);}
.adk-dl.today{background:#FBF0DC;color:#B9770F;}
.adk-dl.soon{background:var(--surface-2);color:var(--muted);}
.adk-dl.far{background:var(--surface-2);color:var(--faint);}
.adk-focus-star{color:#C9821A;font-size:12px;}
.adk-routine-tag{color:var(--accent-d);font-size:11px;}
.adk-card-foot{display:flex;align-items:center;gap:8px;margin-top:9px;}
.adk-time-badge{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--ink);}
.adk-time-badge.live{color:var(--rec);}
.adk-timer-btn{margin-inline-start:auto;border:none;border-radius:8px;width:30px;height:30px;display:grid;place-items:center;cursor:pointer;background:var(--accent-soft);color:var(--accent-d);transition:background .12s,transform .1s;}
.adk-timer-btn:hover{background:#cfe9e8;}
.adk-timer-btn.on{background:var(--rec);color:#fff;}
.adk-timer-btn:active{transform:scale(.92);}
.rec-dot{width:7px;height:7px;border-radius:50%;background:var(--rec);animation:adk-pulse 1.15s ease-in-out infinite;flex:none;}
@keyframes adk-pulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.35;transform:scale(.7);}}
.adk-add{margin:2px 9px 12px;border:1px dashed var(--border);background:transparent;color:var(--muted);border-radius:9px;padding:8px;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit;transition:all .12s;}
.adk-add:hover{border-color:var(--accent);color:var(--accent-d);background:var(--accent-soft);}
.adk-addcol{flex:1 1 0;min-width:0;max-width:286px;container-type:inline-size;}
.adk-addcol .plus{font-size:16px;}
@container (max-width:118px){.adk-addcol .lbl{display:none;}}
.adk-addcol button{width:100%;border:1px dashed var(--border);background:var(--surface-2);color:var(--muted);border-radius:14px;padding:14px;font-weight:700;cursor:pointer;font-family:inherit;font-size:14px;}
.adk-addcol button:hover{border-color:var(--accent);color:var(--accent-d);}
.adk-empty{text-align:center;color:var(--faint);font-size:12.5px;padding:14px 6px;font-weight:600;}
.adk-checkmini{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:700;color:var(--muted);}

/* right slide panel */
.adk-scrim{position:fixed;inset:0;background:rgba(23,40,47,.38);z-index:60;}
.adk-panel{position:fixed;top:0;bottom:0;right:0;width:552px;max-width:94vw;background:var(--surface);z-index:61;box-shadow:-24px 0 60px rgba(0,0,0,.22);display:flex;flex-direction:column;animation:adk-slideR .22s ease;}
@keyframes adk-slideR{from{transform:translateX(100%);}to{transform:translateX(0);}}
.adk-panel-head{display:flex;align-items:center;gap:10px;padding:15px 18px;border-bottom:1px solid var(--border);}
.adk-panel-body{flex:1;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:15px;}
.adk-panel-foot{display:flex;gap:8px;padding:13px 18px;border-top:1px solid var(--border);background:var(--surface-2);}
.adk-field label{display:block;font-size:12.5px;font-weight:700;color:var(--muted);margin-bottom:6px;}
.adk-input,.adk-textarea{width:100%;border:1px solid var(--border);border-radius:9px;padding:9px 11px;font-size:14px;font-family:inherit;color:var(--ink);background:var(--surface-2);resize:vertical;}
.adk-input:focus,.adk-textarea:focus{outline:none;border-color:var(--accent);background:#fff;box-shadow:0 0 0 3px var(--accent-soft);}
.adk-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.adk-pri-pick{display:flex;gap:6px;}
.adk-pri-pick button{flex:1;border:1px solid var(--border);background:var(--surface-2);border-radius:9px;padding:8px 4px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;color:var(--muted);}
.adk-x{border:1px solid var(--border);background:var(--surface-2);color:var(--muted);border-radius:7px;width:32px;height:32px;cursor:pointer;flex:none;font-size:15px;}
.adk-x:hover{background:var(--rec-soft);color:var(--rec);border-color:transparent;}
.adk-btn{border:none;border-radius:9px;padding:9px 16px;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit;}
.adk-btn.primary{background:var(--accent);color:#fff;}
.adk-btn.primary:hover{background:var(--accent-d);}
.adk-btn.danger{background:transparent;color:var(--rec);margin-inline-end:auto;}
.adk-btn.danger:hover{background:var(--rec-soft);}
/* stepper */
.adk-stepper{display:flex;align-items:center;gap:2px;}
.adk-stepper button{width:34px;height:34px;border:1px solid var(--border);background:var(--surface-2);color:var(--ink);font-size:18px;font-weight:700;cursor:pointer;display:grid;place-items:center;}
.adk-stepper button:first-child{border-radius:0 9px 9px 0;}
.adk-stepper button:last-child{border-radius:9px 0 0 9px;}
.adk-stepper .val{min-width:44px;height:34px;border-top:1px solid var(--border);border-bottom:1px solid var(--border);display:grid;place-items:center;font-weight:800;font-variant-numeric:tabular-nums;background:#fff;}
/* attachments */
.adk-att{border:1.5px dashed var(--border);border-radius:12px;background:var(--surface-2);padding:12px;}
.adk-att.over{border-color:var(--accent);background:var(--accent-soft);}
.adk-att-grid{display:flex;flex-wrap:wrap;gap:8px;}
.adk-att-img{width:70px;height:70px;border-radius:9px;object-fit:cover;border:1px solid var(--border);cursor:pointer;position:relative;}
.adk-att-item{position:relative;}
.adk-att-item .del{position:absolute;top:-6px;left:-6px;background:var(--ink);color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer;line-height:1;}
.adk-att-file{display:flex;align-items:center;gap:7px;background:#fff;border:1px solid var(--border);border-radius:9px;padding:8px 10px;font-size:12.5px;font-weight:700;color:var(--ink);text-decoration:none;max-width:180px;}
.adk-att-file span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.adk-att-plus{width:70px;height:70px;border-radius:9px;border:1px solid var(--border);background:#fff;color:var(--muted);font-size:26px;cursor:pointer;display:grid;place-items:center;}
.adk-att-plus:hover{border-color:var(--accent);color:var(--accent-d);}
.adk-att-hint{font-size:11.5px;color:var(--faint);font-weight:600;margin-top:8px;}
.adk-linkrow{display:flex;gap:6px;align-items:center;margin-top:6px;}
/* checklist / subtasks */
.adk-st{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
.adk-st .chk{width:20px;height:20px;border:2px solid var(--border);border-radius:6px;flex:none;cursor:pointer;display:grid;place-items:center;color:transparent;font-size:12px;}
.adk-st .chk.on{background:var(--accent);border-color:var(--accent);color:#fff;}
.adk-st input.txt{flex:1;border:1px solid transparent;background:transparent;border-radius:7px;padding:6px 8px;font-size:13.5px;font-family:inherit;color:var(--ink);}
.adk-st input.txt:focus{outline:none;background:var(--surface-2);border-color:var(--border);}
.adk-st input.txt.done{text-decoration:line-through;color:var(--faint);}
.adk-st .h{display:flex;align-items:center;gap:1px;}
.adk-st .h button{width:24px;height:26px;border:1px solid var(--border);background:var(--surface-2);cursor:pointer;font-weight:700;}
.adk-st .h button:first-child{border-radius:0 7px 7px 0;}
.adk-st .h button:last-child{border-radius:7px 0 0 7px;}
.adk-st .h .v{width:26px;height:26px;border-top:1px solid var(--border);border-bottom:1px solid var(--border);display:grid;place-items:center;font-size:12px;font-weight:800;background:#fff;}
.adk-st .del{border:none;background:transparent;color:var(--faint);cursor:pointer;font-size:15px;padding:2px 5px;}
.adk-st .del:hover{color:var(--rec);}
.adk-addline{border:none;background:transparent;color:var(--accent-d);font-weight:700;font-size:13px;cursor:pointer;padding:4px 0;font-family:inherit;}
.adk-toggle{display:flex;align-items:center;gap:10px;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;cursor:pointer;}
.adk-toggle.on{background:var(--accent-soft);border-color:#bfe2e0;}
.adk-toggle .sw{width:38px;height:22px;border-radius:20px;background:#cbd3d6;position:relative;transition:background .15s;flex:none;}
.adk-toggle.on .sw{background:var(--accent);}
.adk-toggle .sw::after{content:"";position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .15s;}
.adk-toggle.on .sw::after{transform:translateX(-16px);}
.adk-toggle .lb{font-weight:700;font-size:13.5px;}
.adk-toggle .lb small{display:block;font-weight:600;color:var(--muted);font-size:11.5px;}
.adk-overlay{position:fixed;inset:0;background:rgba(23,40,47,.42);z-index:50;display:flex;justify-content:center;align-items:flex-start;padding:38px 16px;overflow-y:auto;}
.adk-modal{background:var(--surface);width:100%;max-width:460px;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.28);overflow:hidden;}
.adk-modal-head{display:flex;align-items:center;padding:15px 18px;border-bottom:1px solid var(--border);gap:10px;}
.adk-modal-body{padding:18px;display:flex;flex-direction:column;gap:15px;max-height:70vh;overflow-y:auto;}
.adk-img-drop{border:1px dashed var(--border);border-radius:11px;background:var(--surface-2);padding:14px;text-align:center;color:var(--muted);font-weight:600;font-size:13px;cursor:pointer;}
.adk-img-drop:hover{border-color:var(--accent);color:var(--accent-d);}
.adk-img-prev{position:relative;border-radius:11px;overflow:hidden;border:1px solid var(--border);}
.adk-img-prev img{width:100%;max-height:120px;object-fit:contain;background:#fff;display:block;}
.adk-img-prev button{position:absolute;top:8px;left:8px;background:rgba(23,40,47,.75);color:#fff;border:none;border-radius:8px;padding:4px 10px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;}

/* my day (minimal) */
.adk-day-scrim{position:fixed;inset:0;background:rgba(23,40,47,.30);z-index:60;}
.adk-day{position:fixed;top:0;bottom:0;left:0;width:400px;max-width:92vw;background:var(--surface);z-index:61;box-shadow:24px 0 60px rgba(0,0,0,.18);display:flex;flex-direction:column;animation:adk-slideL .22s ease;}
@keyframes adk-slideL{from{transform:translateX(-100%);}to{transform:translateX(0);}}
.adk-day-head{padding:20px 22px 14px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;}
.adk-day-head h2{margin:0;font-size:20px;font-weight:800;letter-spacing:-.01em;}
.adk-day-head p{margin:4px 0 0;font-size:13px;color:var(--faint);font-weight:600;}
.adk-day-head .close{margin-inline-start:auto;background:var(--surface-2);border:1px solid var(--border);color:var(--muted);width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:16px;}
.adk-day-now{margin:14px 22px 0;background:var(--surface-2);border:1px solid var(--border);border-radius:11px;padding:11px 13px;display:flex;align-items:center;gap:10px;}
.adk-day-now .t{flex:1;}
.adk-day-now .t b{display:block;font-size:14px;font-weight:800;}
.adk-day-now .t small{font-size:12px;color:var(--muted);font-weight:600;}
.adk-day-now .clk{font-variant-numeric:tabular-nums;font-weight:800;color:var(--rec);font-size:16px;}
.adk-day-body{flex:1;overflow-y:auto;padding:8px 22px 30px;}
.adk-sec-h{font-size:11.5px;font-weight:800;color:var(--faint);text-transform:uppercase;letter-spacing:.05em;margin:18px 0 9px;}
.adk-dtask{display:flex;align-items:center;gap:10px;border:1px solid var(--border);border-radius:11px;padding:10px 12px;margin-bottom:8px;cursor:pointer;transition:box-shadow .12s;}
.adk-dtask:hover{box-shadow:0 3px 12px rgba(23,40,47,.07);}
.adk-dtask .chk{width:20px;height:20px;border:2px solid var(--border);border-radius:6px;flex:none;cursor:pointer;display:grid;place-items:center;color:transparent;font-size:12px;}
.adk-dtask .chk:hover{border-color:var(--accent);}
.adk-dtask .body{flex:1;min-width:0;}
.adk-dtask .ttl{font-weight:700;font-size:14px;line-height:1.3;}
.adk-dtask .sub{display:flex;align-items:center;gap:6px;margin-top:4px;flex-wrap:wrap;}
.adk-dtask .cbadge-s{width:18px;height:18px;border-radius:5px;overflow:hidden;display:grid;place-items:center;color:#fff;font-size:9px;font-weight:800;flex:none;}
.adk-dtask .cbadge-s img{width:100%;height:100%;object-fit:cover;}
.adk-dtask .cname{font-size:11.5px;color:var(--muted);font-weight:700;}
.adk-mini-timer{border:none;border-radius:8px;width:30px;height:30px;display:grid;place-items:center;cursor:pointer;background:var(--accent-soft);color:var(--accent-d);flex:none;}
.adk-mini-timer.on{background:var(--rec);color:#fff;}
.adk-day-empty{text-align:center;color:var(--faint);font-weight:700;padding:40px 10px;font-size:14px;}
.adk-cards::-webkit-scrollbar,.adk-board::-webkit-scrollbar,.adk-day-body::-webkit-scrollbar,.adk-panel-body::-webkit-scrollbar{height:9px;width:9px;}
.adk-cards::-webkit-scrollbar-thumb,.adk-board::-webkit-scrollbar-thumb,.adk-day-body::-webkit-scrollbar-thumb,.adk-panel-body::-webkit-scrollbar-thumb{background:#cfd6d8;border-radius:20px;}
/* redesigned panel */
.adk-phead{display:flex;flex-direction:column;gap:9px;padding:14px 18px 15px;border-bottom:1px solid var(--border);}
.adk-phead .ctx{display:flex;align-items:center;gap:8px;}
.adk-phead .ctx .nm{font-size:12.5px;font-weight:800;color:var(--muted);}
.adk-phead .ctx .clk{margin-inline-start:6px;display:flex;align-items:center;gap:5px;color:var(--rec);font-weight:800;font-size:12.5px;font-variant-numeric:tabular-nums;}
.adk-phead .ctx .adk-x{margin-inline-start:auto;}
.adk-ptitle{border:none;background:transparent;font-weight:800;font-size:19px;color:var(--ink);font-family:inherit;padding:2px 0;letter-spacing:-.01em;}
.adk-ptitle:focus{outline:none;}
.adk-ptitle::placeholder{color:var(--faint);}
.adk-props{display:flex;gap:10px;flex-wrap:wrap;}
.adk-prop{flex:1;min-width:150px;background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:9px 12px;}
.adk-prop>span.lb{display:block;font-size:10.5px;font-weight:800;color:var(--faint);text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px;}
.adk-prop input[type=date]{border:none;background:transparent;font-weight:700;font-size:13.5px;padding:0;width:100%;font-family:inherit;color:var(--ink);}
.adk-prop input[type=date]:focus{outline:none;}
.adk-prop .trow{display:flex;align-items:center;gap:7px;}
.adk-prop .sub{margin-top:6px;font-size:11.5px;color:var(--muted);font-weight:700;}
.adk-cell{display:flex;flex-direction:column;gap:7px;}
.adk-cell>label{font-size:11.5px;font-weight:700;color:var(--muted);}
.trow{display:flex;align-items:center;gap:8px;}
.adk-prichips{display:flex;gap:8px;}
.adk-prichip{border:1px solid var(--border);background:var(--surface-2);border-radius:20px;padding:8px 18px;font-weight:700;font-size:13px;cursor:pointer;color:var(--muted);font-family:inherit;transition:all .12s;}
.adk-prichip:hover{border-color:var(--faint);}
.adk-hr{height:1px;background:var(--border);border:none;margin:4px 0;opacity:.8;}
.adk-foot-check{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;color:var(--faint);cursor:pointer;user-select:none;}
.adk-foot-check .box{width:16px;height:16px;border:1.5px solid var(--border);border-radius:5px;display:grid;place-items:center;color:transparent;font-size:10px;flex:none;}
.adk-foot-check:hover{color:var(--muted);}
.adk-foot-check.on{color:var(--accent-d);font-weight:700;}
.adk-foot-check.on .box{background:var(--accent);border-color:var(--accent);color:#fff;}
.adk-stepper.sm button{width:36px;height:38px;font-size:17px;}
.adk-stepper.sm .val{min-width:40px;height:38px;font-size:15px;}
.adk-combo{position:relative;}
.adk-combo-list{position:absolute;top:calc(100% + 4px);right:0;left:0;background:#fff;border:1px solid var(--border);border-radius:10px;box-shadow:0 12px 30px rgba(23,40,47,.14);z-index:6;overflow:hidden;}
.adk-combo-item{padding:9px 12px;font-size:13.5px;font-weight:600;cursor:pointer;color:var(--ink);}
.adk-combo-item:hover{background:var(--accent-soft);color:var(--accent-d);}
.adk-combo-item{display:flex;align-items:center;gap:8px;}
.adk-tagbox{display:flex;flex-wrap:wrap;align-items:center;gap:6px;border:1px solid var(--border);border-radius:11px;background:var(--surface-2);padding:6px 8px;}
.adk-tagbox:focus-within{border-color:var(--accent);background:#fff;box-shadow:0 0 0 3px var(--accent-soft);}
.adk-tagbox .adk-combo{flex:1;min-width:110px;}
.adk-bare-input{border:none !important;background:transparent !important;box-shadow:none !important;padding:6px 4px !important;}
.adk-mention{color:var(--accent-d);font-weight:800;}
.adk-ro{border:1px solid var(--border);background:var(--surface-2);border-radius:11px;padding:10px 12px;font-size:13.5px;font-weight:700;color:var(--ink);}
.adk-pending-note{font-size:12px;font-weight:700;color:#8a5a12;background:#FBF0DC;border:1px solid #EAD3A0;border-radius:8px;padding:6px 10px;margin-top:8px;}
.adk-inline-link{border:none;background:transparent;color:#8a5a12;text-decoration:underline;font-weight:800;cursor:pointer;font-family:inherit;font-size:12px;margin-inline-start:6px;}
.adk-trail-toggle{display:flex;align-items:center;gap:6px;border:none;background:transparent;color:var(--muted);font-weight:800;font-size:12.5px;cursor:pointer;font-family:inherit;padding:2px 0;}
.adk-trail-toggle:hover{color:var(--accent-d);}
.adk-trail-toggle .chev{color:var(--faint);font-size:10px;}
.adk-trail{display:flex;flex-direction:column;gap:8px;margin-top:6px;padding-inline-start:2px;}
.adk-trail-row{display:flex;align-items:center;gap:8px;}
.adk-trail-txt{flex:1;font-size:12.5px;color:var(--ink);}
.adk-trail-txt b{font-weight:800;}
.adk-trail-time{font-size:11px;color:var(--faint);font-weight:600;}
.adk-req{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#FBF0DC;border:1px solid #EAD3A0;border-radius:12px;padding:11px 14px;margin-bottom:14px;}
.adk-req-txt{flex:1;display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#8a5a12;}
.adk-req-txt b{color:var(--ink);}
.adk-req-txt span{color:var(--muted);font-weight:600;}
.adk-req-act{display:flex;gap:7px;}
.adk-req-act button{border:none;border-radius:9px;padding:7px 15px;font-weight:800;font-size:13px;cursor:pointer;font-family:inherit;}
.adk-req-act .ok{background:var(--accent);color:#fff;}
.adk-req-act .ok:hover{background:var(--accent-d);}
.adk-req-act .no{background:#fff;border:1px solid var(--border);color:var(--muted);}
.adk-req-act .no:hover{color:var(--rec);border-color:var(--rec);}
.adk-st.ghost .chk{opacity:.4;cursor:default;}
.adk-st.ghost .txt::placeholder{color:var(--faint);}
/* people + avatars */
.adk-av{border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:800;flex:none;overflow:hidden;}
.adk-av.more{background:var(--muted);color:#fff;font-size:10px;font-weight:800;display:grid;place-items:center;border-radius:50%;}
.adk-avstack{display:flex;flex-direction:row-reverse;align-items:center;}
.adk-avstack > *{margin-inline-start:-7px;box-shadow:0 0 0 2px #fff;}
.adk-avstack > *:last-child{margin-inline-start:0;}
.adk-cc{display:flex;flex-wrap:wrap;gap:6px;}
.adk-cc-chip{display:inline-flex;align-items:center;gap:6px;background:var(--surface-2);border:1px solid var(--border);border-radius:20px;padding:3px 5px 3px 10px;font-size:12.5px;font-weight:700;}
.adk-cc-chip.locked{background:var(--accent-soft);border-color:transparent;color:var(--accent-d);padding:3px 12px 3px 5px;}
.adk-cc-chip button{border:none;background:transparent;color:var(--faint);cursor:pointer;font-size:15px;line-height:1;padding:0 2px;}
.adk-cc-chip button:hover{color:var(--rec);}
.adk-meta-s{display:inline-flex;align-items:center;gap:5px;}
/* comments — light + threaded */
.adk-thread{display:flex;flex-direction:column;gap:12px;margin:4px 0 6px;}
.adk-cmt{display:flex;gap:8px;align-items:flex-start;}
.adk-cmt-b{flex:1;min-width:0;}
.adk-cmt-line{font-size:13.5px;line-height:1.5;color:var(--ink);}
.adk-cmt-line b{font-weight:800;}
.adk-cmt-line .t{font-size:11px;color:var(--faint);font-weight:600;margin-inline-start:4px;}
.adk-cmt-reply{border:none;background:transparent;color:var(--muted);font-weight:700;font-size:11.5px;cursor:pointer;font-family:inherit;padding:2px 0;}
.adk-cmt-reply:hover{color:var(--accent-d);}
.adk-cmt.reply{margin-top:9px;padding-inline-start:12px;border-inline-start:2px solid var(--border);}
.adk-cmt-compose{margin-top:4px;}
.adk-cmt-replying{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);font-weight:700;background:var(--surface-2);border-radius:8px;padding:5px 10px;margin-bottom:6px;}
.adk-cmt-replying button{margin-inline-start:auto;border:none;background:transparent;color:var(--faint);cursor:pointer;font-size:14px;}
.adk-cmt-input{display:flex;align-items:center;gap:8px;}
.adk-cmt-input .adk-input{flex:1;border-radius:20px;}
.adk-cmt-send{width:34px;height:34px;flex:none;border:none;border-radius:50%;background:var(--accent);color:#fff;cursor:pointer;display:grid;place-items:center;}
.adk-cmt-send:hover{background:var(--accent-d);}
/* date picker */
.adk-dp{position:relative;}
.adk-dp-trigger{display:flex;align-items:center;gap:8px;width:100%;border:1px solid var(--border);border-radius:9px;padding:9px 11px;background:var(--surface-2);cursor:pointer;font-size:14px;font-weight:700;color:var(--ink);font-family:inherit;}
.adk-dp-trigger:hover{border-color:var(--accent);}
.adk-dp-trigger.empty{color:var(--faint);font-weight:600;}
.adk-dp-trigger .cal{margin-inline-start:auto;font-size:13px;opacity:.7;}
.adk-dp-pop{position:absolute;top:calc(100% + 6px);right:0;background:#fff;border:1px solid var(--border);border-radius:13px;box-shadow:0 16px 40px rgba(23,40,47,.2);padding:12px;z-index:8;width:262px;}
.adk-dp-head{display:flex;align-items:center;margin-bottom:10px;}
.adk-dp-head .my{font-weight:800;font-size:14px;flex:1;text-align:center;}
.adk-dp-head button{width:28px;height:28px;border:1px solid var(--border);background:var(--surface-2);border-radius:8px;cursor:pointer;color:var(--ink);font-size:15px;line-height:1;}
.adk-dp-head button:hover{border-color:var(--accent);color:var(--accent-d);}
.adk-dp-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;}
.adk-dp-wd{text-align:center;font-size:11px;font-weight:800;color:var(--faint);padding:4px 0;}
.adk-dp-day{height:32px;display:grid;place-items:center;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;color:var(--ink);border:1.5px solid transparent;}
.adk-dp-day:hover{background:var(--surface-2);}
.adk-dp-day.today{border-color:var(--border);}
.adk-dp-day.sel{background:var(--accent);color:#fff;border-color:var(--accent);}
.adk-dp-day.blank{cursor:default;}
.adk-dp-day.muted{opacity:.45;}
.adk-dp-foot{display:flex;justify-content:space-between;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);}
.adk-dp-foot button{border:none;background:transparent;color:var(--accent-d);font-weight:800;font-size:13px;cursor:pointer;font-family:inherit;}
.adk-dp-foot button.clear{color:var(--muted);}
.adk-sp-row{display:flex;align-items:center;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border);}
.adk-sp-lbl{font-size:12.5px;font-weight:700;color:var(--muted);}
.adk-sp-clr{border:none;background:transparent;color:var(--muted);font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;}
.adk-sp-sec{font-size:11px;font-weight:800;color:var(--faint);text-transform:uppercase;letter-spacing:.05em;margin:12px 0 7px;}
.adk-sp-chips{display:flex;gap:5px;}
.adk-sp-chips button{flex:1;border:1px solid var(--border);background:var(--surface-2);border-radius:8px;padding:7px 4px;font-weight:700;font-size:12.5px;cursor:pointer;font-family:inherit;color:var(--muted);}
.adk-sp-chips button.on{background:var(--accent-soft);border-color:#bfe2e0;color:var(--accent-d);}
.adk-sp-hint{font-size:11px;color:var(--faint);font-weight:600;margin-top:7px;line-height:1.4;}
.adk-kmenu.up{top:auto;bottom:calc(100% + 6px);left:auto;right:0;}
/* kebab */
.adk-kebab{position:relative;}
.adk-rchip{display:inline-flex;align-items:center;font-size:11px;font-weight:800;color:var(--accent-d);background:var(--accent-soft);border-radius:7px;padding:2px 8px;}
.adk-kmenu{position:absolute;top:calc(100% + 6px);left:0;background:#fff;border:1px solid var(--border);border-radius:12px;box-shadow:0 16px 40px rgba(23,40,47,.2);padding:8px;z-index:8;width:190px;max-width:calc(100vw - 36px);}
.adk-kmenu-lbl{font-size:11px;font-weight:800;color:var(--faint);text-transform:uppercase;letter-spacing:.05em;padding:4px 8px 6px;}
.adk-kmenu-routine{display:flex;flex-direction:column;gap:3px;}
.adk-kmenu-routine button{border:none;background:transparent;border-radius:8px;padding:8px 10px;font-weight:700;font-size:13.5px;cursor:pointer;font-family:inherit;color:var(--ink);text-align:right;display:flex;align-items:center;gap:8px;}
.adk-kmenu-routine button:hover{background:var(--surface-2);}
.adk-kmenu-routine button.on{background:var(--accent-soft);color:var(--accent-d);}
.adk-kmenu-routine button.on::before{content:"✓";font-size:12px;}
.adk-kmenu-routine button:not(.on)::before{content:"";width:12px;}
.adk-kmenu-div{height:1px;background:var(--border);margin:8px 2px;}
.adk-kmenu-del{width:100%;text-align:right;border:none;background:transparent;color:var(--rec);font-weight:700;font-size:13.5px;cursor:pointer;font-family:inherit;padding:8px 10px;border-radius:8px;}
.adk-kmenu-del:hover{background:var(--rec-soft);}
.adk-flags{display:flex;gap:8px;}
.adk-flag{flex:1;display:flex;align-items:center;gap:8px;border:1px solid var(--border);background:var(--surface-2);border-radius:11px;padding:10px 12px;cursor:pointer;font-weight:700;font-size:13px;color:var(--muted);transition:all .12s;}
.adk-flag .ic{font-size:15px;line-height:1;opacity:.6;}
.adk-flag.on{background:var(--accent-soft);border-color:#bfe2e0;color:var(--accent-d);}
.adk-flag.on .ic{opacity:1;}
.adk-flag.on.amber{background:#FBF0DC;border-color:#EAD3A0;color:#B9770F;}
.adk-sect{display:flex;align-items:center;gap:10px;margin:6px 0 -3px;}
.adk-sect b{font-size:11px;font-weight:800;color:var(--faint);text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;}
.adk-sect .ln{flex:1;height:1px;background:var(--border);}
.adk-group{display:flex;flex-direction:column;gap:13px;}
.adk-brief{border:1px solid var(--border);border-radius:12px;background:var(--surface-2);overflow:hidden;transition:box-shadow .12s,border-color .12s;}
.adk-brief.over{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft);}
.adk-brief-text{width:100%;border:none;background:transparent;padding:12px 13px;font-size:14px;line-height:1.5;font-family:inherit;color:var(--ink);resize:vertical;min-height:82px;}
.adk-brief-text:focus{outline:none;}
.adk-brief-text::placeholder{color:var(--faint);}
.adk-brief-atts{display:flex;flex-direction:column;gap:8px;padding:0 13px 10px;}
.adk-brief-bar{display:flex;align-items:center;gap:2px;padding:6px 8px;border-top:1px solid var(--border);background:#fff;}
.adk-brief-bar button{border:none;background:transparent;color:var(--muted);font-weight:700;font-size:12.5px;cursor:pointer;font-family:inherit;padding:5px 9px;border-radius:8px;}
.adk-brief-bar button:hover{background:var(--surface-2);color:var(--accent-d);}
.adk-brief-bar .hint{margin-inline-start:auto;font-size:11px;color:var(--faint);font-weight:600;padding-inline-end:4px;}
/* archive */
.adk-arch{position:fixed;top:0;bottom:0;right:0;width:560px;max-width:96vw;background:var(--surface);z-index:51;box-shadow:-24px 0 60px rgba(0,0,0,.22);display:flex;flex-direction:column;animation:adk-slideR .22s ease;}
.adk-arch-head{display:flex;align-items:center;gap:10px;padding:15px 18px;border-bottom:1px solid var(--border);}
.adk-arch-head h2{margin:0;font-size:18px;font-weight:800;flex:1;letter-spacing:-.01em;}
.adk-arch-filters{padding:13px 18px;border-bottom:1px solid var(--border);background:var(--surface-2);display:flex;flex-direction:column;gap:10px;}
.adk-arch-search{width:100%;border:1px solid var(--border);border-radius:9px;padding:9px 12px;font-size:14px;font-family:inherit;background:#fff;color:var(--ink);}
.adk-arch-search:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft);}
.adk-fset{display:flex;gap:7px;flex-wrap:wrap;align-items:center;}
.adk-fsel{border:1px solid var(--border);border-radius:8px;padding:7px 10px;font-size:13px;font-weight:700;font-family:inherit;background:#fff;color:var(--ink);}
.adk-fchip{border:1px solid var(--border);background:#fff;border-radius:20px;padding:5px 12px;font-size:12.5px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit;}
.adk-fchip.on{background:var(--ink);color:#fff;border-color:var(--ink);}
.adk-arch-sum{padding:9px 18px;font-size:12.5px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border);}
.adk-arch-body{flex:1;overflow-y:auto;padding:10px 18px 30px;}
.adk-arow{display:flex;gap:10px;align-items:center;border:1px solid var(--border);border-radius:11px;padding:11px 12px;margin-bottom:8px;transition:box-shadow .12s;}
.adk-arow:hover{box-shadow:0 3px 12px rgba(23,40,47,.07);}
.adk-arow .main{flex:1;min-width:0;cursor:pointer;}
.adk-arow .t{font-weight:700;font-size:14px;word-break:break-word;}
.adk-arow .m{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:5px;}
.adk-rbadge{font-size:11px;font-weight:800;border-radius:6px;padding:2px 7px;}
.adk-rbadge.done{background:var(--accent-soft);color:var(--accent-d);}
.adk-rbadge.deleted{background:var(--rec-soft);color:var(--rec);}
.adk-rbadge.client{background:#FBF0DC;color:#B9770F;}
.adk-meta-s{font-size:11.5px;color:var(--muted);font-weight:700;}
.adk-arow .acts{display:flex;gap:6px;flex:none;}
.adk-arow .acts button{border:1px solid var(--border);background:var(--surface-2);border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:14px;}
.adk-arow .acts button.restore:hover{background:var(--accent-soft);color:var(--accent-d);border-color:transparent;}
.adk-arow .acts button.del:hover{background:var(--rec-soft);border-color:transparent;}
.adk-arch-empty{text-align:center;color:var(--faint);font-weight:700;padding:40px 10px;}
/* full-page report */
.adk-page{position:fixed;inset:0;z-index:55;background:var(--canvas);overflow:hidden;padding:66px 68px 0 0;}
.adk-pcard{max-width:none;margin:0;background:#fff;border:1px solid var(--border);border-left:none;border-bottom:none;border-radius:0;border-top-right-radius:46px;box-shadow:0 0 30px rgba(23,40,47,.06);overflow-y:auto;height:100%;}
.adk-pcard-head{display:flex;align-items:center;gap:10px;padding:22px 28px;border-top-right-radius:46px;}
.adk-pcard-head .adk-back{border:none;background:transparent;color:var(--muted);cursor:pointer;padding:0 2px;display:grid;place-items:center;}
.adk-pcard-head .adk-back:hover{color:var(--accent-d);}
.adk-pcard-head .titleblk{display:flex;align-items:center;gap:12px;}
.adk-pcard-head .titleblk h2{margin:0;font-size:20px;font-weight:800;letter-spacing:-.01em;}
.adk-pcard-head .titleblk span{display:block;font-size:12.5px;color:var(--faint);font-weight:600;margin-top:2px;}
.adk-pcard-head .sp{flex:1;}
.adk-pcard-head select{border:1px solid var(--border);border-radius:10px;padding:9px 14px;font-weight:700;font-family:inherit;font-size:13.5px;background:var(--surface-2);color:var(--ink);}
.adk-pcard-head .btn{border:1px solid var(--border);background:var(--surface-2);border-radius:10px;padding:9px 14px;font-weight:700;font-size:13.5px;cursor:pointer;font-family:inherit;color:var(--ink);display:inline-flex;align-items:center;gap:7px;}
.adk-pcard-head .btn:hover{border-color:var(--accent);color:var(--accent-d);}
.adk-kpistrip{display:flex;border-top:1px solid var(--border);border-bottom:1px solid var(--border);}
.adk-kcell{flex:1;padding:20px 26px;border-inline-end:1px solid var(--border);}
.adk-kcell:last-child{border-inline-end:none;}
.adk-kcell b{font-size:30px;font-weight:800;letter-spacing:-.02em;line-height:1;display:flex;align-items:baseline;gap:4px;}
.adk-kcell b small{font-size:14px;font-weight:700;color:var(--muted);}
.adk-kcell span{display:block;font-size:12.5px;color:var(--muted);font-weight:700;margin-top:9px;}
.adk-kcell.billable{background:var(--accent-soft);}
.adk-kcell.billable b{color:var(--accent-d);}
.adk-kcell.billable span{color:var(--accent-d);}
.adk-billnote{padding:10px 28px;font-size:12px;font-weight:700;color:#8a5a12;background:#FBF0DC;border-bottom:1px solid #EAD3A0;}
/* calendar */
.adk-cal-seg{display:flex;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:3px;}
.adk-cal-seg button{border:none;background:transparent;font-family:inherit;font-weight:800;font-size:13px;color:var(--muted);cursor:pointer;padding:6px 14px;border-radius:7px;}
.adk-cal-seg button.on{background:#fff;color:var(--accent-d);box-shadow:0 1px 2px rgba(23,40,47,.08);}
.adk-cal-nav{display:flex;align-items:center;gap:4px;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:3px;}
.adk-cal-nav button{border:none;background:transparent;font-family:inherit;font-weight:800;font-size:15px;color:var(--muted);cursor:pointer;width:34px;height:32px;border-radius:7px;}
.adk-cal-nav button:hover{background:#fff;color:var(--accent-d);}
.adk-cal-nav .mid{width:auto;padding:0 14px;font-size:13.5px;color:var(--ink);}
.adk-cal-layout{display:flex;gap:0;align-items:stretch;height:100%;background:#fff;border:1px solid var(--border);border-left:none;border-bottom:none;border-top-right-radius:46px;overflow:hidden;box-shadow:0 0 30px rgba(23,40,47,.06);}
.adk-back{border:none;background:transparent;color:var(--muted);font-size:26px;font-weight:400;line-height:1;cursor:pointer;padding:0 4px;font-family:inherit;display:grid;place-items:center;}
.adk-linkopen{display:grid;place-items:center;width:30px;height:30px;flex:none;border:1px solid var(--border);border-radius:8px;background:var(--surface-2);color:var(--accent-d);text-decoration:none;font-size:14px;}
.adk-linkopen:hover{border-color:var(--accent);background:var(--accent-soft);}
/* assistant chat */
.adk-fab{position:fixed;left:24px;bottom:24px;width:56px;height:56px;border-radius:50%;border:none;background:linear-gradient(135deg,#8E54C4,#5a3a9c);color:#fff;display:grid;place-items:center;cursor:pointer;box-shadow:0 8px 24px rgba(90,58,156,.4);z-index:56;transition:transform .12s;}
.adk-fab:hover{transform:scale(1.06);}
.adk-chat{position:fixed;top:0;bottom:0;left:0;width:400px;max-width:92vw;background:var(--surface);z-index:61;box-shadow:24px 0 60px rgba(0,0,0,.22);display:flex;flex-direction:column;animation:adk-slideL .22s ease;}
@keyframes adk-slideL{from{transform:translateX(-100%);}to{transform:translateX(0);}}
.adk-chat-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border);}
.adk-chat-id{display:flex;align-items:center;gap:10px;}
.adk-chat-av{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#8E54C4,#5a3a9c);color:#fff;display:grid;place-items:center;flex:none;}
.adk-chat-av.sm{width:24px;height:24px;border-radius:7px;}
.adk-chat-id b{font-size:14.5px;font-weight:800;display:block;}
.adk-chat-id span{font-size:11.5px;color:var(--muted);font-weight:700;}
.adk-chat-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;}
.adk-msg{display:flex;gap:8px;align-items:flex-end;max-width:88%;}
.adk-msg.me{align-self:flex-start;flex-direction:row-reverse;}
.adk-msg.twin{align-self:flex-end;}
.adk-bubble{background:var(--surface-2);border:1px solid var(--border);border-radius:14px;padding:9px 13px;font-size:13.5px;line-height:1.5;font-weight:500;}
.adk-msg.twin .adk-bubble{border-top-right-radius:4px;}
.adk-msg.me .adk-bubble{background:var(--accent);color:#fff;border-color:transparent;border-top-left-radius:4px;}
.adk-bubble.typing{display:flex;gap:4px;padding:12px 14px;}
.adk-bubble.typing span{width:6px;height:6px;border-radius:50%;background:var(--faint);animation:adk-blink 1s infinite;}
.adk-bubble.typing span:nth-child(2){animation-delay:.2s;}
.adk-bubble.typing span:nth-child(3){animation-delay:.4s;}
@keyframes adk-blink{0%,60%,100%{opacity:.3;}30%{opacity:1;}}
.adk-chat-sugg{display:flex;gap:6px;flex-wrap:wrap;padding:8px 14px;border-top:1px solid var(--border);}
.adk-chat-sugg button{border:1px solid var(--border);background:var(--surface-2);border-radius:16px;padding:5px 11px;font-size:11.5px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit;}
.adk-chat-sugg button:hover{border-color:var(--accent);color:var(--accent-d);}
.adk-chat-input{display:flex;align-items:center;gap:8px;padding:12px 14px;border-top:1px solid var(--border);}
.adk-chat-input input{flex:1;border:1px solid var(--border);border-radius:20px;padding:9px 14px;font-size:14px;font-family:inherit;color:var(--ink);background:var(--surface-2);}
.adk-chat-input input:focus{outline:none;border-color:var(--accent);}
.adk-conn{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:9px 14px;border-bottom:1px solid var(--border);background:var(--surface-2);}
.adk-conn-lbl{font-size:11.5px;font-weight:700;color:var(--muted);}
.adk-conn-chip{display:inline-flex;align-items:center;gap:5px;background:#FBF0DC;border:1px solid #EAD3A0;color:#8a5a12;border-radius:20px;padding:2px 9px;font-size:11px;font-weight:700;}
.adk-conn-chip .d{width:6px;height:6px;border-radius:50%;background:#C9821A;}
.adk-conn-chip.real{background:var(--accent-soft);border-color:#bfe2e0;color:var(--accent-d);}
.adk-conn-chip.real .d{background:var(--accent);}
.adk-attach{width:36px;height:36px;flex:none;border:1px solid var(--border);border-radius:50%;background:var(--surface-2);color:var(--muted);cursor:pointer;display:grid;place-items:center;}
.adk-attach:hover{border-color:var(--accent);color:var(--accent-d);}
.adk-chat-wa{display:flex;align-items:center;justify-content:center;gap:6px;padding:8px 14px 12px;font-size:11px;font-weight:700;color:var(--muted);}
/* assistant draft banner (card) */
.adk-draft-banner{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#FBF0DC;border:1px solid #EAD3A0;border-radius:12px;padding:11px 14px;margin-bottom:14px;}
.adk-draft-txt{flex:1;display:flex;align-items:center;gap:6px;font-size:13px;font-weight:800;color:#8a5a12;}
.adk-card.draft{border-color:#EAD3A0;background:linear-gradient(0deg,#fffdf8,#fffdf8);box-shadow:0 0 0 1px #f0e0bb inset;}
/* assistant settings */
.adk-asst-set{display:flex;flex-direction:column;gap:10px;}
.adk-asst-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid var(--border);}
.adk-asst-row:last-of-type{border-bottom:none;}
.adk-asst-info{flex:1;min-width:160px;}
.adk-asst-info b{font-size:14px;font-weight:800;display:block;}
.adk-asst-info span{font-size:12px;color:var(--muted);font-weight:600;}
.adk-asst-seg{display:flex;gap:6px;align-items:center;flex-wrap:wrap;}
.adk-asst-seg .lvl{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);background:var(--surface-2);border-radius:9px;padding:7px 13px;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit;}
.adk-asst-seg .lvl .dot{width:8px;height:8px;border-radius:50%;background:var(--faint);}
.adk-asst-seg .lvl.suggest.on{border-color:#3B6FE0;color:#2a56c0;background:#eef3fd;}
.adk-asst-seg .lvl.suggest.on .dot{background:#3B6FE0;}
.adk-asst-seg .lvl.draft.on{border-color:#C9821A;color:#8a5a12;background:#FBF0DC;}
.adk-asst-seg .lvl.draft.on .dot{background:#C9821A;}
.adk-asst-seg .lvl.act.on{border-color:var(--accent);color:var(--accent-d);background:var(--accent-soft);}
.adk-asst-seg .lvl.act.on .dot{background:var(--accent);}
.adk-asst-lock{font-size:11px;color:var(--faint);font-weight:700;}
.adk-asst-legend{display:flex;gap:16px;flex-wrap:wrap;margin-top:6px;font-size:11.5px;font-weight:700;color:var(--muted);}
.adk-asst-legend span{display:inline-flex;align-items:center;gap:6px;}
.adk-asst-legend .d{width:9px;height:9px;border-radius:50%;}
.adk-asst-legend .d.s{background:#3B6FE0;}.adk-asst-legend .d.d{background:#C9821A;}.adk-asst-legend .d.a{background:var(--accent);}
.adk-back:hover{color:var(--accent-d);}
.adk-pcard.cal{flex:1;min-width:0;background:transparent;border:none;border-radius:0;box-shadow:none;overflow-y:auto;height:100%;}
.adk-cal-main{min-width:0;}
.adk-cal-side.out{width:236px;flex:none;background:var(--surface-2);border:none;border-right:1px solid var(--border);border-radius:0;display:flex;flex-direction:column;gap:14px;padding:16px 14px;}
.adk-cal-side.out .adk-cal-filter{border:none;background:transparent;padding:4px 6px;}
.adk-cal-side.out .adk-cal-today{background:#fff;border:1px solid var(--border);border-radius:16px;padding:16px;flex:none;}
.adk-cal-split{display:grid;grid-template-columns:1fr 264px;gap:0;}
.adk-cal{padding:14px 20px 14px;min-width:0;}
.adk-cal-side{border-inline-start:1px solid var(--border);background:var(--surface-2);border-bottom-left-radius:18px;display:flex;flex-direction:column;}
.adk-cal-filter{padding:16px 18px;border-bottom:1px solid var(--border);}
.adk-cal-side-t{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);margin-bottom:9px;}
.adk-cal-chk{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:var(--ink);padding:5px 0;cursor:pointer;}
.adk-cal-chk input{width:15px;height:15px;cursor:pointer;}
.adk-cal-chk .sw{width:10px;height:10px;border-radius:3px;flex:none;}
/* week view */
.adk-wk{padding:12px 16px 16px;min-width:0;display:flex;flex-direction:column;}
.adk-wk-grid{display:grid;grid-template-columns:56px repeat(7,1fr);}
.adk-wk-gut{font-size:11px;font-weight:700;color:var(--faint);display:flex;align-items:center;justify-content:center;}
.adk-wk-dh{text-align:center;padding:6px 0 8px;}
.adk-wk-dh span{display:block;font-size:11px;font-weight:800;color:var(--muted);}
.adk-wk-dh b{display:inline-flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;width:30px;height:30px;margin-top:3px;}
.adk-wk-dh.today b{background:var(--accent);color:#fff;border-radius:50%;}
.adk-wk-allday{border-top:1px solid var(--border);border-bottom:1px solid var(--border);min-height:32px;}
.adk-wk-adcol{border-inline-start:1px solid var(--border);padding:4px;display:flex;flex-direction:column;gap:3px;}
.adk-wk-chip{font-size:10.5px;font-weight:600;border-radius:5px;padding:2px 7px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.adk-wk-chip.demo{background:#FBF0DC !important;color:#8a5a12;border:1px solid #EAD3A0;}
.adk-wk-scroll{max-height:calc(100vh - 320px);overflow-y:auto;margin-top:0;}
.adk-wk-body{position:relative;}
.adk-wk-gut-col{display:flex;flex-direction:column;}
.adk-wk-hr{position:relative;}
.adk-wk-hr span{position:absolute;top:-7px;inset-inline-end:8px;font-size:10.5px;font-weight:700;color:var(--faint);}
.adk-wk-daycol{position:relative;border-inline-start:1px solid var(--border);}
.adk-wk-slot{border-bottom:1px solid #eef1f0;}
.adk-wk-ev{position:absolute;inset-inline:3px;border-radius:6px;font-size:10.5px;font-weight:600;padding:3px 7px;cursor:pointer;overflow:hidden;line-height:1.35;}
.adk-wk-ev b{font-weight:800;}
.adk-wk-ev.demo{background:repeating-linear-gradient(45deg,#F7EBD2,#F7EBD2 6px,#F1E1BE 6px,#F1E1BE 12px) !important;color:#8a5a12;border-inline-start:3px solid #C9821A;}
.adk-wk-now{position:absolute;inset-inline:0;height:2px;background:var(--rec);z-index:3;}
.adk-wk-now::before{content:"";position:absolute;inset-inline-start:-3px;top:-3px;width:8px;height:8px;border-radius:50%;background:var(--rec);}
.adk-cal-wd{display:grid;grid-template-columns:repeat(7,1fr);gap:7px;margin-bottom:7px;}
.adk-cal.g .adk-cal-wd{gap:0;margin-bottom:0;border-bottom:1px solid var(--border);}
.adk-cal.g .adk-cal-wd div{text-align:start;padding:6px 8px;font-size:11px;}
.adk-cal-grid.g{display:grid;grid-template-columns:repeat(7,1fr);gap:0;grid-auto-rows:1fr;}
.adk-cal-cell.g{aspect-ratio:auto;background:transparent;border:none;border-inline-start:1px solid var(--border);border-bottom:1px solid var(--border);border-radius:0;min-height:96px;padding:4px 5px 8px;gap:2px;}
.adk-cal-cell.g:nth-child(7n+1){border-inline-start:none;}
.adk-cal-cell.g.blank{border-inline-start:1px solid var(--border);}
.adk-cal-num.g{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;font-size:12px;font-weight:700;color:var(--muted);align-self:flex-start;}
.adk-cal-num.g.today{background:var(--accent);color:#fff;border-radius:50%;font-weight:800;}
.adk-cal-items.g{gap:1px;}
.adk-cal-row{display:flex;align-items:center;gap:6px;padding:2px 5px;border-radius:5px;font-size:11.5px;font-weight:600;color:var(--ink);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.adk-cal-row:hover{background:var(--surface-2);}
.adk-cal-row .dot{width:7px;height:7px;border-radius:50%;flex:none;}
.adk-cal-row b{font-weight:700;color:var(--muted);}
.adk-cal-row .tx{overflow:hidden;text-overflow:ellipsis;}
.adk-cal-row.demo{color:#8a5a12;}
.adk-cal-cell.g.today{background:rgba(20,160,150,.05);}
.adk-cal-wd div{text-align:center;font-size:12px;font-weight:800;color:var(--muted);}
.adk-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:7px;}
.adk-cal-cell{aspect-ratio:1/1;background:var(--surface-2);border:1px solid var(--border);border-radius:11px;padding:6px 7px;display:flex;flex-direction:column;gap:4px;overflow:hidden;}
.adk-cal-cell.blank{background:transparent;border:none;}
.adk-cal-cell.today{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft) inset;}
.adk-cal-num{font-size:12px;font-weight:800;color:var(--ink);flex:none;}
.adk-cal-cell.today .adk-cal-num{color:var(--accent-d);}
.adk-cal-items{display:flex;flex-direction:column;gap:3px;overflow:hidden;}
.adk-cal-task{display:flex;align-items:center;gap:4px;background:#fff;border:1px solid var(--border);border-radius:6px;padding:2px 5px;font-size:10.5px;font-weight:700;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.adk-cal-task:hover{border-color:var(--accent);}
.adk-cal-task .dot{width:6px;height:6px;border-radius:50%;flex:none;}
.adk-cal-task b{color:var(--accent-d);}
.adk-cal-demo{background:#FBF0DC;border:1px solid #EAD3A0;border-radius:6px;padding:2px 5px;font-size:10.5px;font-weight:700;color:#8a5a12;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.adk-cal-demo b{color:#B9770F;}
.adk-cal-more{font-size:10px;font-weight:800;color:var(--faint);}
.adk-cal-legend{display:flex;gap:18px;flex-wrap:wrap;padding:14px 6px 10px;font-size:12px;font-weight:700;color:var(--muted);}
.adk-cal-legend span{display:inline-flex;align-items:center;gap:6px;}
.adk-cal-legend .sw{width:11px;height:11px;border-radius:3px;}
.adk-cal-today{padding:16px 18px;display:flex;flex-direction:column;min-height:0;flex:1;}
.adk-cal-today-head{display:flex;align-items:center;gap:12px;margin-bottom:16px;}
.adk-cal-today-head .dnum{width:46px;height:46px;border-radius:12px;background:var(--accent);color:#fff;font-size:22px;font-weight:800;display:grid;place-items:center;flex:none;}
.adk-cal-today-head .dl{font-size:15px;font-weight:800;color:var(--ink);}
.adk-cal-today-head .ds{font-size:12px;font-weight:700;color:var(--muted);}
.adk-cal-agenda{display:flex;flex-direction:column;gap:2px;overflow-y:auto;}
.adk-agenda-row{display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid var(--border);cursor:pointer;}
.adk-agenda-row:last-child{border-bottom:none;}
.adk-agenda-row:hover{background:#fff;border-radius:8px;}
.adk-agenda-row .tm{font-size:12px;font-weight:800;color:var(--muted);width:42px;flex:none;font-variant-numeric:tabular-nums;}
.adk-agenda-row .bar{width:3px;align-self:stretch;border-radius:2px;flex:none;min-height:18px;}
.adk-agenda-row .ttl{font-size:13px;font-weight:700;color:var(--ink);display:flex;flex-direction:column;gap:1px;}
.adk-agenda-row .cl{font-size:11px;font-weight:600;color:var(--faint);}
.adk-agenda-row.demo .ttl{color:#8a5a12;}
.adk-cal-empty{text-align:center;color:var(--faint);font-weight:700;font-size:13px;padding:30px 0;}
.adk-pcard-body{display:grid;grid-template-columns:1fr 1.35fr;}
.adk-panel-block{padding:24px 28px;}
.adk-panel-block+.adk-panel-block{border-inline-start:1px solid var(--border);}
.adk-block-title{font-size:14px;font-weight:800;margin:0 0 18px;}
.adk-barchart{height:230px;display:flex;align-items:flex-end;gap:6px;}
.adk-bc-col{flex:1;display:flex;flex-direction:column;align-items:center;gap:7px;height:100%;justify-content:flex-end;}
.adk-bc-track{width:100%;flex:1;display:flex;align-items:flex-end;justify-content:center;}
.adk-bc-bar{width:66%;max-width:28px;background:var(--accent);border-radius:5px 5px 0 0;min-height:2px;transition:height .3s;}
.adk-bc-bar.hl{background:var(--accent-d);}
.adk-bc-x{font-size:10px;color:var(--faint);font-weight:700;white-space:nowrap;}
.adk-pcard-foot{padding:24px 28px;border-top:1px solid var(--border);}
/* client portal */
.adk-portal{max-width:1180px;}
.adk-portal-top{display:flex;align-items:center;gap:12px;padding:20px 28px;}
.adk-portal-brand{display:flex;align-items:center;gap:12px;}
.adk-portal-brand h2{margin:0;font-size:20px;font-weight:800;letter-spacing:-.01em;}
.adk-portal-brand span{display:block;font-size:12.5px;color:var(--faint);font-weight:700;margin-top:2px;}
.adk-portal-top .sp{flex:1;}
.adk-portal-login{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:var(--muted);}
.adk-portal-top .btn{border:1px solid var(--border);background:var(--surface-2);border-radius:10px;padding:9px 14px;font-weight:700;font-size:13.5px;cursor:pointer;font-family:inherit;color:var(--ink);}
.adk-portal-top .btn:hover{border-color:var(--accent);color:var(--accent-d);}
.adk-portal-banner{display:flex;align-items:center;gap:10px;padding:11px 28px;background:#FBF0DC;border-top:1px solid #EAD3A0;border-bottom:1px solid #EAD3A0;font-size:13px;font-weight:700;color:#8a5a12;}
.adk-portal-tools{display:flex;align-items:center;gap:12px;padding:18px 28px 6px;}
.adk-portal-search{flex:1;max-width:340px;display:flex;align-items:center;gap:8px;border:1px solid var(--border);border-radius:10px;padding:9px 12px;background:var(--surface-2);color:var(--muted);}
.adk-portal-search input{border:none;background:transparent;flex:1;font-size:14px;font-family:inherit;color:var(--ink);}
.adk-portal-search input:focus{outline:none;}
.adk-portal-brief{margin-inline-start:auto;display:flex;align-items:center;gap:7px;border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:10px;padding:9px 15px;font-weight:800;font-size:13.5px;cursor:pointer;font-family:inherit;}
.adk-portal-brief:hover{background:var(--accent-d);}
.adk-portal-brief .adk-demo{background:rgba(255,255,255,.2);border-color:transparent;color:#fff;}
.adk-portal-brief .adk-demo::before{background:#fff;}
.adk-portal-board{display:flex;gap:14px;padding:16px 28px 30px;overflow-x:auto;}
.adk-pcol{flex:0 0 260px;width:260px;background:var(--surface-2);border:1px solid var(--border);border-radius:14px;}
.adk-pcol-head{display:flex;align-items:center;justify-content:space-between;padding:13px 15px 9px;font-weight:800;font-size:14px;}
.adk-pcol-head span{font-size:12px;color:var(--muted);font-weight:700;background:#fff;border:1px solid var(--border);border-radius:20px;padding:1px 8px;}
.adk-pcol-list{padding:2px 10px 12px;display:flex;flex-direction:column;gap:9px;}
.adk-pcol-empty{text-align:center;color:var(--faint);font-size:13px;padding:10px 0;font-weight:700;}
.adk-ptask{background:#fff;border:1px solid var(--border);border-radius:11px;overflow:hidden;cursor:pointer;transition:box-shadow .12s;box-shadow:0 1px 2px rgba(23,40,47,.04);}
.adk-ptask:hover{box-shadow:0 4px 14px rgba(23,40,47,.09);}
.adk-ptask-thumb{width:100%;height:96px;object-fit:cover;display:block;}
.adk-ptask-in{padding:10px 12px;}
.adk-ptask-title{font-weight:700;font-size:13.5px;line-height:1.35;margin-bottom:8px;}
.adk-ptask-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.adk-ptask-time{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:800;color:var(--accent-d);}
/* self avatar + dashboards */
.adk-self{width:38px;height:38px;border-radius:50%;border:2px solid var(--border);background:var(--muted);color:#fff;font-weight:800;font-size:13px;cursor:pointer;overflow:hidden;display:grid;place-items:center;padding:0;flex:none;}
.adk-icon-btn{position:relative;width:40px;height:40px;display:grid;place-items:center;border:1px solid var(--border);background:var(--surface-2);border-radius:10px;color:var(--ink);cursor:pointer;flex:none;}
.adk-icon-btn:hover{border-color:var(--accent);color:var(--accent-d);}
.adk-icon-btn::after{content:attr(data-label);position:absolute;top:calc(100% + 7px);inset-inline-start:50%;transform:translateX(50%) translateY(-4px);background:var(--ink);color:#fff;font-size:11.5px;font-weight:700;padding:4px 9px;border-radius:7px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .12s,transform .12s;z-index:45;}
.adk-icon-btn:hover::after{opacity:1;transform:translateX(50%) translateY(0);}
.ic-badge{position:absolute;top:-5px;inset-inline-start:-5px;min-width:16px;height:16px;padding:0 4px;background:var(--muted);color:#fff;font-size:10px;font-weight:800;border-radius:9px;display:grid;place-items:center;border:2px solid var(--surface);}
/* frame layout */
.adk{padding:66px 68px 0 0;height:100vh;overflow:hidden;}
.adk-shell{background:var(--surface);border:1px solid var(--border);border-left:none;border-bottom:none;border-radius:0;border-top-right-radius:46px;overflow:hidden;box-shadow:0 0 30px rgba(23,40,47,.06);height:100%;display:flex;flex-direction:column;}
.adk-top{position:static;border-top-right-radius:46px;border-bottom:none;}
.adk-day-wrap{padding:20px 28px 40px;max-width:820px;}
.adk-pcard.day{overflow:hidden;display:flex;flex-direction:column;}
.adk-pcard.day .adk-pcard-head{flex:none;}
.adk-day2{display:grid;grid-template-columns:minmax(360px,2fr) minmax(240px,1fr);align-items:stretch;flex:1;min-height:0;}
.adk-day2-tasks{padding:22px 26px 40px;min-width:0;overflow-y:auto;}
.adk-day2-brief{display:flex;flex-direction:column;border-left:1px solid var(--border);background:transparent;padding:0;}
.adk-brief2-scroll{flex:1;overflow-y:auto;padding:40px 44px;}
.adk-brief2-tag{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:var(--muted);margin-bottom:18px;}
.adk-brief2-av{width:24px;height:24px;border-radius:7px;background:linear-gradient(135deg,#8E54C4,#5a3a9c);color:#fff;display:grid;place-items:center;flex:none;}
.adk-brief2-hl{font-size:28px;font-weight:800;line-height:1.4;color:var(--ink);letter-spacing:-.015em;max-width:580px;}
.adk-brief2-hl .clay{color:#C6613F;}
.adk-brief2-line{font-size:15px;color:var(--muted);font-weight:600;line-height:1.7;margin-top:16px;max-width:580px;}
.adk-brief2-now{display:flex;align-items:center;gap:8px;margin-top:20px;padding-top:16px;border-top:1px solid var(--border);font-size:12.5px;font-weight:700;color:var(--rec);}
.adk-tl-head{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);margin:0 0 8px;}
.adk-tl-head.up{margin-top:22px;padding-top:16px;border-top:1px solid var(--border);}
.adk-tl-row{display:flex;align-items:flex-start;gap:12px;padding:11px 8px;border-radius:11px;cursor:pointer;}
.adk-tl-row:hover{background:var(--surface-2);}
.adk-tl-time{width:52px;flex:none;text-align:start;font-size:13.5px;font-weight:800;color:var(--ink);padding-top:1px;font-variant-numeric:tabular-nums;}
.adk-tl-time.flex{color:var(--faint);font-weight:700;font-size:12px;}
.adk-tl-dot{width:9px;height:9px;border-radius:50%;flex:none;margin-top:6px;}
.adk-tl-dot.over{box-shadow:0 0 0 3px var(--rec-soft);}
.adk-tl-body{flex:1;min-width:0;}
.adk-tl-body .ttl{font-size:14px;font-weight:700;color:var(--ink);line-height:1.35;}
.adk-tl-body .meta{display:flex;align-items:center;gap:8px;margin-top:3px;font-size:12px;color:var(--muted);flex-wrap:wrap;}
.adk-tl-body .cname{font-weight:600;}
@media(max-width:720px){.adk-day2{grid-template-columns:1fr;}.adk-day2-brief{border-left:none;border-bottom:1px solid var(--border);}}
.adk-day-ask{display:flex;align-items:center;gap:10px;padding:14px 24px;border-top:1px solid var(--border);background:var(--surface);flex:none;}
.adk-day-ask-av{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#8E54C4,#5a3a9c);color:#fff;display:grid;place-items:center;flex:none;}
.adk-day-ask input{flex:1;border:1px solid var(--border);border-radius:22px;padding:11px 16px;font-size:14.5px;font-family:inherit;color:var(--ink);background:var(--surface-2);}
.adk-day-ask input:focus{outline:none;border-color:var(--accent);}
.adk-day-sun{width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,#F6C560,#E89A3C);color:#fff;display:grid;place-items:center;flex:none;}
.adk-day-sun.sm{width:30px;height:30px;border-radius:8px;}
.adk-day-group{margin-bottom:18px;}
.adk-sec-h.g-over{color:var(--rec);}
.adk-drop-item.special{background:linear-gradient(135deg,#FFF7E8,#f3f0fb);}
.adk-drop-item.special:hover{background:linear-gradient(135deg,#fdefd0,#ece6f7);}
.adk-drop-sep{height:1px;background:var(--border);margin:4px 8px;}
.adk-board{flex:1;min-height:0;overflow-y:hidden;}
.adk-shell .adk-col{max-height:calc(100vh - 156px);}
.adk-float-av{position:fixed;top:15px;left:22px;z-index:56;width:36px;height:36px;border-radius:50%;border:none;box-shadow:none;color:#fff;font-weight:800;font-size:12.5px;overflow:hidden;display:grid;place-items:center;cursor:pointer;padding:0;}
.adk-float-av img{width:100%;height:100%;object-fit:cover;}
.adk-rail.bare{position:fixed;top:50%;right:16px;transform:translateY(-50%);z-index:56;display:flex;flex-direction:column;gap:6px;background:transparent;border:none;box-shadow:none;padding:0;}
.adk-rail-btn{position:relative;width:40px;height:40px;border:none;background:transparent;border-radius:12px;color:var(--muted);display:grid;place-items:center;cursor:pointer;}
.adk-rail-btn:hover{background:#fff;color:var(--accent-d);box-shadow:0 2px 10px rgba(23,40,47,.1);}
.adk-rail-btn::after{content:attr(data-label);position:absolute;right:calc(100% + 8px);top:50%;transform:translateY(-50%);background:var(--ink);color:#fff;font-size:11.5px;font-weight:700;padding:4px 9px;border-radius:7px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .12s;}
.adk-rail-btn:hover::after{opacity:1;}
.adk-rail-btn .ic-badge{top:-1px;inset-inline-start:-1px;border-color:var(--canvas);}
.adk-float-gear.bare{position:fixed;bottom:20px;right:16px;z-index:56;width:40px;height:40px;border-radius:12px;border:none;background:transparent;color:var(--muted);display:grid;place-items:center;cursor:pointer;box-shadow:none;}
.adk-float-gear.bare:hover{background:#fff;color:var(--accent-d);box-shadow:0 2px 10px rgba(23,40,47,.1);}
.adk-float-bell{position:fixed;top:15px;left:70px;z-index:56;width:36px;height:36px;border-radius:50%;border:none;background:transparent;color:var(--muted);display:grid;place-items:center;cursor:pointer;padding:0;}
.adk-float-bell:hover{background:#fff;color:var(--accent-d);box-shadow:0 2px 10px rgba(23,40,47,.1);}
.adk-float-bell .ic-badge{background:var(--rec);border-color:var(--canvas);top:-2px;inset-inline-start:-2px;}
.adk-notif-scrim{position:fixed;inset:0;z-index:57;}
.adk-notif{position:fixed;top:52px;left:22px;z-index:58;width:340px;max-width:calc(100vw - 44px);max-height:70vh;background:#fff;border:1px solid var(--border);border-radius:16px;box-shadow:0 16px 44px rgba(23,40,47,.18);display:flex;flex-direction:column;overflow:hidden;animation:adk-pop .16s ease;}
@keyframes adk-pop{from{opacity:0;transform:translateY(-6px);}to{opacity:1;transform:translateY(0);}}
.adk-notif-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border);}
.adk-notif-head b{font-size:15px;font-weight:800;}
.adk-notif-head button{border:none;background:transparent;color:var(--accent-d);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;}
.adk-notif-list{overflow-y:auto;padding:6px;}
.adk-notif-empty{padding:28px 16px;text-align:center;color:var(--faint);font-weight:600;font-size:13px;}
.adk-notif-item{display:flex;gap:10px;width:100%;text-align:start;border:none;background:transparent;border-radius:10px;padding:10px;cursor:pointer;font-family:inherit;align-items:flex-start;}
.adk-notif-item:hover{background:var(--surface-2);}
.adk-notif-item.unread{background:var(--accent-soft);}
.adk-notif-item.unread:hover{background:#d3ebe9;}
.adk-notif-dot{width:8px;height:8px;border-radius:50%;margin-top:5px;flex:none;background:var(--muted);}
.adk-notif-dot.draft{background:#C9821A;}
.adk-notif-dot.request{background:#C9821A;}
.adk-notif-dot.mention{background:#8E54C4;}
.adk-notif-dot.comment{background:var(--accent);}
.adk-notif-body{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1;}
.adk-notif-body .t{font-size:12.5px;font-weight:700;color:var(--ink);}
.adk-notif-body .t em{font-style:normal;color:var(--muted);font-weight:600;}
.adk-notif-body .s{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.adk-notif-body .tm{font-size:11px;color:var(--faint);font-weight:600;}
.adk-self img{width:100%;height:100%;object-fit:cover;}
.adk-self:hover{border-color:var(--accent);}
.adk-demo{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:800;color:#B9770F;background:#FBF0DC;border:1px solid #EAD3A0;border-radius:20px;padding:2px 9px;letter-spacing:.02em;vertical-align:middle;}
.adk-demo::before{content:"";width:6px;height:6px;border-radius:50%;background:#C9821A;}
.adk-rep{position:fixed;top:0;bottom:0;right:0;width:700px;max-width:98vw;background:var(--surface);z-index:51;box-shadow:-24px 0 60px rgba(0,0,0,.22);display:flex;flex-direction:column;animation:adk-slideR .22s ease;}
.adk-rep-head{display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid var(--border);}
.adk-rep-head h2{margin:0;font-size:18px;font-weight:800;flex:1;letter-spacing:-.01em;}
.adk-rep-head select{border:1px solid var(--border);border-radius:8px;padding:7px 10px;font-weight:700;font-family:inherit;font-size:13px;background:#fff;color:var(--ink);}
.adk-rep-head .print{border:1px solid var(--border);background:var(--surface-2);border-radius:8px;padding:7px 12px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;color:var(--ink);}
.adk-rep-head .print:hover{border-color:var(--accent);color:var(--accent-d);}
.adk-rep-body{flex:1;overflow-y:auto;padding:20px;}
.adk-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:24px;}
.adk-kpi{background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:13px 14px;}
.adk-kpi b{display:block;font-size:22px;font-weight:800;line-height:1.15;letter-spacing:-.02em;}
.adk-kpi small{font-size:11.5px;color:var(--muted);font-weight:700;}
.adk-rep-sec{font-size:13px;font-weight:800;color:var(--ink);margin:0 0 12px;}
.adk-bar{display:flex;align-items:center;gap:10px;margin-bottom:9px;}
.adk-bar .lb{width:150px;font-size:13px;font-weight:700;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.adk-bar .track{flex:1;height:22px;background:var(--surface-2);border-radius:6px;overflow:hidden;}
.adk-bar .fill{height:100%;border-radius:6px;background:var(--accent);transition:width .3s;}
.adk-bar .val{width:80px;text-align:left;font-size:12.5px;font-weight:800;color:var(--muted);flex:none;font-variant-numeric:tabular-nums;}
.adk-reptable{width:100%;border-collapse:collapse;margin-top:4px;}
.adk-reptable th{font-size:11px;color:var(--faint);text-transform:uppercase;letter-spacing:.04em;text-align:right;padding:7px 8px;border-bottom:1px solid var(--border);font-weight:800;}
.adk-reptable td{font-size:13px;padding:9px 8px;border-bottom:1px solid var(--border);font-weight:600;}
.adk-reptable tbody tr{cursor:pointer;}
.adk-reptable tbody tr:hover td{background:var(--surface-2);}
.adk-donut{width:170px;height:170px;border-radius:50%;flex:none;position:relative;}
.adk-donut::after{content:"";position:absolute;inset:28px;background:var(--surface);border-radius:50%;}
.adk-legend{display:flex;flex-direction:column;gap:9px;flex:1;min-width:180px;}
.adk-leg{display:flex;align-items:center;gap:9px;font-size:13.5px;font-weight:700;}
.adk-leg .sw{width:12px;height:12px;border-radius:3px;flex:none;}
.adk-leg .pct{margin-inline-start:auto;color:var(--muted);font-variant-numeric:tabular-nums;font-size:12.5px;}
@media print{
  body{background:#fff;}
  .adk-top,.adk-board,.adk-scrim,.adk-day,.adk-day-scrim,.adk-panel,.adk-arch,.adk-overlay{display:none !important;}
  .adk-page{position:static;background:#fff;padding:0;overflow:visible;}
  .adk-pcard{box-shadow:none;max-width:none;border-radius:0;}
  .adk-rep{position:static;width:100%;max-width:none;box-shadow:none;animation:none;height:auto;}
  .adk-rep-head .adk-x,.adk-rep-head .print,.adk-rep-head select,.adk-pcard-head .btn,.adk-pcard-head select{display:none !important;}
  .adk-rep-body{overflow:visible;}
  .adk-bc-bar,.adk-donut,.adk-leg .sw,.adk-kpi,.adk-kcell{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
}
`;

function Badge({ client, size = 36 }) {
  return <div className="adk-cbadge" style={{ width: size, height: size, background: client?.color || "#647079", fontSize: size * 0.4 }}>
    {client?.logo ? <img src={client.logo} alt="" /> : (client?.home ? "🏠" : initials(client?.name))}
  </div>;
}

function DemoTag({ text = "הדגמה" }) { return <span className="adk-demo">{text}</span>; }

function Icon({ name, size = 18 }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round", style: { flex: "none" } };
  const shapes = {
    chart: <><path d="M4 4v15a1 1 0 0 0 1 1h15" /><path d="M7.5 14.5l3.5-3.5 3 3 5-5.5" /></>,
    archive: <><rect x="3.5" y="4" width="17" height="4.2" rx="1.4" /><path d="M5.2 8.2v10.3a1.5 1.5 0 0 0 1.5 1.5h10.6a1.5 1.5 0 0 0 1.5-1.5V8.2" /><path d="M10 12h4" /></>,
    sun: <><circle cx="12" cy="12" r="3.6" /><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" /></>,
    printer: <><path d="M6.5 9V3.5h11V9" /><rect x="6.5" y="14" width="11" height="6.5" rx="1" /><path d="M6.5 17.5H5A2 2 0 0 1 3 15.5v-3A2 2 0 0 1 5 10.5h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-1.5" /></>,
    eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    comment: <><path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4 19l1-4.2A7.5 7.5 0 1 1 20 11.5Z" /></>,
    users: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 19a5.5 5.5 0 0 0-3-4.9" /></>,
    calendar: <><rect x="3.5" y="4.5" width="17" height="16" rx="2.5" /><path d="M3.5 9h17M8 3v3M16 3v3" /></>,
    arrowL: <><path d="M19 12H5M11 6l-6 6 6 6" /></>,
    arrowR: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    arrowUp: <><path d="M12 19V5M6 11l6-6 6 6" /></>,
    spark: <><path d="M12 3.5l1.7 5.3 5.3 1.7-5.3 1.7L12 17.5l-1.7-5.3L5 10.5l5.3-1.7z" /></>,
    gear: <><circle cx="12" cy="12" r="3.1" /><path d="M19.4 12c0-.4 0-.8-.1-1.2l2-1.5-2-3.5-2.3 1a7.2 7.2 0 0 0-2.1-1.2L14.5 3h-4l-.4 2.6a7.2 7.2 0 0 0-2.1 1.2l-2.3-1-2 3.5 2 1.5c-.1.4-.1.8-.1 1.2s0 .8.1 1.2l-2 1.5 2 3.5 2.3-1a7.2 7.2 0 0 0 2.1 1.2l.4 2.6h4l.4-2.6a7.2 7.2 0 0 0 2.1-1.2l2.3 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2Z" /></>,
    bell: <><path d="M18 8.4a6 6 0 1 0-12 0c0 6.6-2.6 8.4-2.6 8.4h17.2S18 15 18 8.4" /><path d="M13.7 20.5a2 2 0 0 1-3.4 0" /></>,
    chevD: <><path d="M6 9.5l6 6 6-6" /></>,
  };
  return <svg {...p}>{shapes[name]}</svg>;
}

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [clients, setClients] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [cards, setCards] = useState({});
  const [order, setOrder] = useState({});
  const [assets, setAssets] = useState({});
  const [lastReset, setLastReset] = useState(todayStr());
  const [now, setNow] = useState(Date.now());
  const [editing, setEditing] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [dropCol, setDropCol] = useState(null);
  const [clientMenu, setClientMenu] = useState(false);
  const [clientEdit, setClientEdit] = useState(null);
  const [dayOpen, setDayOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [dashOpen, setDashOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifSeen, setNotifSeen] = useState(() => Date.now() - 6 * 3600e3);
  function openPage(name) {
    setDayOpen(name === "day"); setArchiveOpen(name === "archive"); setReportOpen(name === "report");
    setDashOpen(name === "dash"); setSettingsOpen(name === "settings"); setCalOpen(name === "cal");
  }
  const notifs = useMemo(() => {
    const out = [];
    Object.values(cards).forEach((c) => {
      if (c.archived) return;
      const cn = clients.find((x) => x.id === c.clientId)?.name || "";
      if (c.draft) out.push({ id: "d" + c.id, type: "draft", at: c.draft.at || c.createdAt, cardId: c.id, title: c.title || "משימה", client: cn, text: "טיוטת העוזר ממתינה לאישור" });
      if (c.proposed) out.push({ id: "p" + c.id, type: "request", at: c.proposed.at || c.createdAt, cardId: c.id, title: c.title || "משימה", client: cn, text: `בקשת תזמון מ${c.proposed.by || "לקוח"}` });
      (c.comments || []).forEach((cm) => {
        const mention = /@\S/.test(cm.text || "");
        out.push({ id: "c" + cm.id, type: mention ? "mention" : "comment", at: cm.at || c.createdAt, cardId: c.id, title: c.title || "משימה", client: cn, text: `${cm.by}: ${(cm.text || "").replace(/\s+/g, " ").slice(0, 44)}` });
      });
    });
    return out.sort((a, b) => b.at - a.at).slice(0, 30);
  }, [cards, clients]);
  const unreadCount = notifs.filter((n) => n.at > notifSeen).length;
  const [chatOpen, setChatOpen] = useState(false);
  const [chatSeed, setChatSeed] = useState(null);
  const [viewer, setViewer] = useState(false);
  const [viewerQ, setViewerQ] = useState("");
  const [profile, setProfile] = useState({ name: "", photo: null, assistant: { cards: "draft", calendar: "draft", outbound: "suggest" } });
  const asstLevel = (k) => (profile.assistant && profile.assistant[k]) || "suggest";

  useEffect(() => { const el = document.createElement("style"); el.textContent = STYLES; document.head.appendChild(el); return () => el.remove(); }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(KEY);
        if (res && res.value) {
          const b = JSON.parse(res.value);
          const cl = b.clients || []; const cds = b.cards || {}; let ord = b.order || {};
          // routine daily reset
          const t = todayStr();
          if ((b.lastReset || "") !== t) {
            const no = {}; Object.keys(ord).forEach((k) => (no[k] = [...ord[k]]));
            Object.values(cds).forEach((c) => {
              const kind = routineKind(c);
              if (kind !== "none") {
                let dl = c.deadline || t; let changed = false, guard = 0;
                while (dl < t && guard < 500) { dl = addPeriod(dl, kind); changed = true; guard++; }
                if (!c.deadline) { dl = t; changed = true; }
                const inDone = no["col-done"] && no["col-done"].includes(c.id);
                if (changed || inDone) {
                  cds[c.id] = { ...c, routine: kind, deadline: dl, subtasks: (c.subtasks || []).map((s) => ({ ...s, done: false })) };
                  if (inDone) {
                    no["col-done"] = no["col-done"].filter((x) => x !== c.id);
                    const tgt = (c.activeColumn && no[c.activeColumn]) ? c.activeColumn : "col-doing";
                    (no[tgt] = no[tgt] || []).push(c.id);
                  }
                }
              }
            });
            ord = no; setLastReset(t);
          } else setLastReset(t);
          setClients(cl); setCurrentId(b.currentId || cl[0]?.id); setColumns(b.columns || DEFAULT_COLUMNS);
          if (b.profile) setProfile(b.profile);
          setCards(cds); setOrder(ord);
          if (!cl.length) seed();
        } else seed();
      } catch { seed(); }
      // load assets
      try {
        const lst = await window.storage.list(APREFIX);
        const keys = (lst && lst.keys) || [];
        const entries = await Promise.all(keys.map(async (k) => {
          const key = typeof k === "string" ? k : k.key;
          try { const r = await window.storage.get(key); return [key.replace(APREFIX, ""), r?.value]; } catch { return null; }
        }));
        const map = {}; entries.forEach((e) => { if (e && e[1]) map[e[0]] = e[1]; }); setAssets(map);
      } catch {}
      setLoaded(true);
    })();
    function seed() {
      const air = { id: uid("cl"), name: "Air Doctor", color: "#0E8F8C", contact: "", email: "", notes: "", logo: null };
      const home = { id: uid("cl"), name: "אישי / בית", color: "#8E54C4", home: true, contact: "", email: "", notes: "", logo: null };
      setClients([air, home]); setCurrentId(air.id);
      const o = {}; DEFAULT_COLUMNS.forEach((c) => (o[c.id] = [])); setOrder(o);
    }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    (async () => { try { await window.storage.set(KEY, JSON.stringify({ clients, currentId, columns, cards, order, lastReset, profile })); } catch (e) {} })();
  }, [clients, currentId, columns, cards, order, lastReset, profile, loaded]);

  const running = Object.values(cards).some((c) => c.timerStart);
  useEffect(() => { if (!running) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [running]);

  const updateCard = useCallback((id, patch) => setCards((p) => ({ ...p, [id]: { ...p[id], ...patch } })), []);
  // every assistant-initiated action passes through here; the app (not the prompt) enforces the matrix
  function assistantAction(kind, payload = {}) {
    const cat = /event|calendar/.test(kind) ? "calendar" : (/send|email|outbound/.test(kind) ? "outbound" : "cards");
    const level = asstLevel(cat); // suggest | draft | act
    if (kind === "create_card") {
      const colId = payload.colId || (columns.find((c) => c.id === "col-brief") || columns[0])?.id;
      if (!colId) return null;
      const id = uid("card");
      const draft = level === "act" ? null : { by: "העוזר", at: Date.now(), level };
      setCards((p) => ({ ...p, [id]: { id, clientId: payload.clientId || currentId, title: payload.title || "", creator: "העוזר", cc: [], comments: [], attachments: [], subtasks: payload.subtasks || [], description: payload.description || "", deadline: payload.deadline || todayStr(), priority: payload.priority || "regular", routine: "none", dayFlex: false, time: payload.time || "", activeColumn: colId, timeSpent: 0, timerStart: null, createdAt: Date.now(), origin: payload.origin || { type: "chat", ref: "chat-" + id }, draft } }));
      setOrder((p) => ({ ...p, [colId]: [...(p[colId] || []), id] }));
      return id;
    }
    return null;
  }
  // sweep: assistant drafts unresolved for 7+ days quietly expire (soft-remove)
  useEffect(() => {
    const WEEK = 7 * 864e5, t = Date.now();
    const stale = Object.values(cards).filter((c) => c.draft && !c.archived && (t - c.draft.at) > WEEK);
    if (stale.length) setCards((p) => { const n = { ...p }; stale.forEach((c) => { n[c.id] = { ...n[c.id], archived: true, archivedAt: t, removedBy: "assistant" }; }); return n; });
  }, []); // eslint-disable-line
  const editWithTrail = useCallback((id, patch, by) => setCards((p) => {
    const c = p[id]; if (!c) return p;
    const FIELD_LABEL = { title: "כותרת", description: "תיאור", cc: "אנשים", subtasks: "צ׳קליסט", comments: "תגובה", attachments: "קבצים", proposed: "הצעת תזמון", priority: "עדיפות", deadline: "תזמון", time: "שעה", routine: "חזרתיות" };
    const key = Object.keys(patch).find((k) => FIELD_LABEL[k]) || Object.keys(patch)[0];
    const label = FIELD_LABEL[key] || key;
    const t = Date.now(); const hist = c.history ? [...c.history] : [];
    const last = hist[hist.length - 1];
    if (last && last.by === by && last.field === key && (t - last.at) < 240000) hist[hist.length - 1] = { ...last, at: t };
    else hist.push({ id: uid("h"), by, field: key, label, at: t });
    return { ...p, [id]: { ...c, ...patch, history: hist } };
  }), []);
  const cardColumn = useMemo(() => { const m = {}; Object.keys(order).forEach((col) => order[col].forEach((id) => (m[id] = col))); return m; }, [order]);

  function addCard(colId, asCreator) {
    const id = uid("card");
    setCards((p) => ({ ...p, [id]: { id, clientId: currentId, title: "", creator: (asCreator || profile.name || "אני"), cc: [], comments: [], attachments: [], subtasks: [], description: "", deadline: todayStr(), priority: "regular", routine: "none", dayFlex: false, time: "", activeColumn: colId, timeSpent: 0, timerStart: null, createdAt: Date.now() } }));
    setOrder((p) => ({ ...p, [colId]: [...(p[colId] || []), id] }));
    setEditing(id);
  }
  function deleteCard(id, by = "owner") { // soft: move to archive, recoverable
    setCards((p) => ({ ...p, [id]: { ...p[id], archived: true, archivedAt: Date.now(), removedBy: by, timerStart: null } }));
    setOrder((p) => { const n = {}; Object.keys(p).forEach((k) => (n[k] = p[k].filter((x) => x !== id))); return n; });
    setEditing(null);
  }
  function restoreCard(id) {
    const c = cards[id]; const cols = columns.map((x) => x.id);
    let tgt = c?.activeColumn;
    if (!tgt || !cols.includes(tgt) || tgt === "col-done") tgt = cols.find((x) => x !== "col-done") || cols[0];
    setCards((p) => ({ ...p, [id]: { ...p[id], archived: false, removedBy: undefined } }));
    setOrder((p) => { const n = {}; Object.keys(p).forEach((k) => (n[k] = p[k].filter((x) => x !== id))); (n[tgt] = n[tgt] || []).push(id); return n; });
  }
  function hardDelete(id) { // permanent
    const c = cards[id]; (c?.attachments || []).forEach((a) => { if (a.type !== "link") window.storage.delete(APREFIX + a.id).catch(() => {}); });
    setOrder((p) => { const n = {}; Object.keys(p).forEach((k) => (n[k] = p[k].filter((x) => x !== id))); return n; });
    setCards((p) => { const n = { ...p }; delete n[id]; return n; });
  }
  function toggleTimer(id) {
    setCards((prev) => {
      const next = { ...prev }, ts = Date.now(), card = next[id];
      if (card.timerStart) next[id] = { ...card, timeSpent: (card.timeSpent || 0) + Math.floor((ts - card.timerStart) / 1000), timerStart: null };
      else { Object.keys(next).forEach((k) => { if (next[k].timerStart) next[k] = { ...next[k], timeSpent: (next[k].timeSpent || 0) + Math.floor((ts - next[k].timerStart) / 1000), timerStart: null }; }); next[id] = { ...next[id], timerStart: ts }; }
      return next;
    });
    setNow(Date.now());
  }
  function moveCard(id, toCol, beforeId = null) {
    setCards((p) => (p[id] && toCol !== "col-done" ? { ...p, [id]: { ...p[id], activeColumn: toCol } } : p));
    setOrder((prev) => {
      const n = {}; Object.keys(prev).forEach((k) => (n[k] = prev[k].filter((x) => x !== id)));
      if (!n[toCol]) n[toCol] = [];
      if (beforeId && n[toCol].includes(beforeId)) n[toCol].splice(n[toCol].indexOf(beforeId), 0, id); else n[toCol].push(id);
      return n;
    });
  }
  function renameCol(id, title) { setColumns((p) => p.map((c) => (c.id === id ? { ...c, title } : c))); }
  function addColumn() { const id = uid("col"); setColumns((p) => [...p, { id, title: "עמודה חדשה" }]); setOrder((p) => ({ ...p, [id]: [] })); }
  function deleteColumn(id) { setColumns((p) => p.filter((c) => c.id !== id)); setOrder((p) => { const n = { ...p }; delete n[id]; return n; }); }

  async function addFiles(cardId, fileList) {
    for (const file of Array.from(fileList)) {
      const isImg = file.type.startsWith("image/");
      let dataUrl;
      try { dataUrl = isImg ? await resizeImage(file, 1000, "image/jpeg", 0.72) : await readDataURL(file); } catch { continue; }
      if (dataUrl.length > 4600000) { continue; }
      const attId = uid("att");
      try { await window.storage.set(APREFIX + attId, dataUrl); } catch (e) {}
      setAssets((p) => ({ ...p, [attId]: dataUrl }));
      setCards((p) => ({ ...p, [cardId]: { ...p[cardId], attachments: [...(p[cardId].attachments || []), { id: attId, type: isImg ? "image" : "file", name: file.name, mime: file.type }] } }));
    }
  }
  function addLink(cardId) { const attId = uid("att"); setCards((p) => ({ ...p, [cardId]: { ...p[cardId], attachments: [...(p[cardId].attachments || []), { id: attId, type: "link", name: "", url: "" }] } })); }
  function updateAtt(cardId, attId, patch) { setCards((p) => ({ ...p, [cardId]: { ...p[cardId], attachments: p[cardId].attachments.map((a) => (a.id === attId ? { ...a, ...patch } : a)) } })); }
  function removeAtt(cardId, attId) { const a = cards[cardId]?.attachments?.find((x) => x.id === attId); if (a && a.type !== "link") window.storage.delete(APREFIX + attId).catch(() => {}); setAssets((p) => { const n = { ...p }; delete n[attId]; return n; }); setCards((p) => ({ ...p, [cardId]: { ...p[cardId], attachments: p[cardId].attachments.filter((x) => x.id !== attId) } })); }

  function saveClient(c) { setClients((p) => { const i = p.findIndex((x) => x.id === c.id); if (i === -1) return [...p, c]; const n = [...p]; n[i] = c; return n; }); if (!currentId) setCurrentId(c.id); setClientEdit(null); }
  function deleteClient(id) {
    const ids = Object.values(cards).filter((c) => c.clientId === id).map((c) => c.id);
    setCards((p) => { const n = { ...p }; ids.forEach((x) => delete n[x]); return n; });
    setOrder((p) => { const n = {}; Object.keys(p).forEach((k) => (n[k] = p[k].filter((x) => !ids.includes(x)))); return n; });
    setClients((p) => p.filter((c) => c.id !== id)); setClientEdit(null); setClientMenu(false);
    if (currentId === id) setCurrentId(clients.filter((c) => c.id !== id)[0]?.id || null);
  }

  if (!loaded) return <div className="adk" style={{ display: "grid", placeItems: "center", height: "100vh" }}><div style={{ color: "var(--muted)", fontWeight: 600 }}>טוען את הלוח…</div></div>;

  const current = clients.find((c) => c.id === currentId);
  const clientCards = (id) => Object.values(cards).filter((c) => c.clientId === id);
  const curCards = clientCards(currentId);
  const openCount = curCards.filter((c) => !c.archived && cardColumn[c.id] !== "col-done").length;
  const curTime = curCards.reduce((a, c) => a + cardSeconds(c, now), 0);
  const archiveList = curCards.filter((c) => c.archived || cardColumn[c.id] === "col-done")
    .map((c) => ({ ...c, reason: c.archived ? (c.removedBy === "client" ? "client" : "deleted") : "done", when: c.archivedAt || c.createdAt }))
    .sort((a, b) => b.when - a.when);

  const dayTasks = Object.values(cards).filter((c) => !c.archived && cardColumn[c.id] !== "col-done").map((c) => ({ card: c, d: daysUntil(c.deadline) }));
  const planWindow = (c) => c.routine === "monthly" ? 31 : 7;
  const inPlan = (t) => { if (t.d === null) return false; if (flexDay(t.card)) return t.d <= planWindow(t.card); return t.d <= 0; };
  const byTime = (a, b) => { const ta = a.card.time || "99:99", tb = b.card.time || "99:99"; return ta < tb ? -1 : ta > tb ? 1 : 0; };
  const planTasks = dayTasks.filter(inPlan).sort((a, b) => byTime(a, b) || (PRI_ORDER[a.card.priority] - PRI_ORDER[b.card.priority]) || ((a.d ?? 99) - (b.d ?? 99)));
  const upcoming = dayTasks.filter((t) => !inPlan(t) && t.d !== null && t.d >= 1 && t.d <= 7).sort((a, b) => a.d - b.d);
  const runningCard = Object.values(cards).find((c) => c.timerStart);
  const firstImage = (c) => { const a = (c.attachments || []).find((x) => x.type === "image"); return a ? assets[a.id] : null; };

  return (
    <div className="adk">
      <div className="adk-shell">
      <div className="adk-top">
        {viewer ? (<>
          <div className="adk-csel-btn" style={{ cursor: "default", minWidth: 0, background: "transparent", border: "none", padding: "6px 4px" }}>
            <Badge client={current} />
            <div><div className="nm">{current?.name}</div><div className="sub">פרויקט · תצוגת לקוח</div></div>
          </div>
          <div className="adk-portal-search" style={{ maxWidth: 300 }}>
            <Icon name="search" size={16} />
            <input value={viewerQ} onChange={(e) => setViewerQ(e.target.value)} placeholder="חיפוש משימה…" />
          </div>
          <div style={{ marginInlineStart: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <button className="adk-portal-brief" onClick={() => { const col = columns.find((c) => c.id === "col-brief") || columns[0]; if (col) addCard(col.id, current?.contact || (current?.members && current.members[0]) || "לקוח"); }}><Icon name="plus" size={16} /> בריף חדש</button>
            <DemoTag text="תצוגת לקוח · הדגמה" />
            <button className="adk-day-btn" style={{ margin: 0 }} onClick={() => { setViewer(false); setViewerQ(""); }}>יציאה</button>
          </div>
        </>) : (<>
        <div className="adk-csel">
          <div className="adk-csel-btn" onClick={() => setClientMenu((v) => !v)}>
            <Badge client={current} />
            <div><div className="nm">{current?.name || "בחר לקוח"}</div><div className="sub">{clientCards(currentId).length} משימות</div></div>
            <span className="chev"><Icon name="chevD" size={16} /></span>
          </div>
          {clientMenu && (<>
            <div style={{ position: "fixed", inset: 0, zIndex: 39 }} onClick={() => setClientMenu(false)} />
            <div className="adk-drop">
              <div className="adk-drop-item special" onClick={() => { setClientMenu(false); openPage("day"); }}>
                <div className="adk-day-sun sm"><Icon name="sun" size={17} /></div>
                <div><div className="nm">היום שלי</div><div className="sub">מבט־על · כל הלקוחות</div></div>
                {planTasks.length > 0 && <span className="cnt">{planTasks.length}</span>}
              </div>
              <div className="adk-drop-sep" />
              {clients.map((c) => (
                <div key={c.id} className={"adk-drop-item" + (c.id === currentId ? " active" : "")} onClick={() => { setCurrentId(c.id); setClientMenu(false); }}>
                  <Badge client={c} size={30} />
                  <div><div className="nm">{c.name}</div>{c.contact && <div className="sub">{c.contact}</div>}</div>
                  <span className="cnt">{clientCards(c.id).length}</span>
                  <button className="edit" title="ערוך" onClick={(e) => { e.stopPropagation(); setClientEdit(c); setClientMenu(false); }}>✎</button>
                </div>
              ))}
              <button className="adk-drop-add" onClick={() => { setClientEdit("new"); setClientMenu(false); }}>+ הוסף לקוח</button>
            </div>
          </>)}
        </div>
        <div className="adk-stats" style={{ marginInlineStart: "auto" }}>
          <div className="adk-stat"><b>{openCount}</b><small>משימות</small></div>
          <div className="adk-stat"><b>{(() => { const m = (profile.settings && profile.settings.timeRound) || "ceil_hour"; if (m === "exact") return fmtShort(curTime); if (m === "decimal") return (curTime / 3600).toFixed(1); return curTime > 0 ? Math.ceil(curTime / 3600) : 0; })()}</b><small>שעות</small></div>
          {running && <div className="adk-stat" style={{ background: "var(--rec-soft)", borderColor: "transparent" }}><b style={{ color: "var(--rec)", display: "flex", alignItems: "center", gap: 6 }}><span className="rec-dot" />מוקלט</b><small style={{ color: "var(--rec)" }}>טיימר פעיל</small></div>}
          <button className="adk-icon-btn" data-label="דוח" onClick={() => openPage("report")}><Icon name="chart" /></button>
          <button className="adk-icon-btn" data-label="ארכיון" onClick={() => openPage("archive")}><Icon name="archive" />{archiveList.length > 0 && <span className="ic-badge">{archiveList.length}</span>}</button>
          <button className="adk-icon-btn" data-label="תצוגת לקוח" onClick={() => setViewer(true)}><Icon name="eye" /></button>
        </div>
        </>)}
      </div>

      {!viewer && (<>
        <button className="adk-float-av" style={{ background: nameColor(profile.name || "אני") }} title="הדשבורד שלי" onClick={() => openPage("dash")}>
          {profile.photo ? <img src={profile.photo} alt="" /> : <span>{profile.name ? initials(profile.name) : "אני"}</span>}
        </button>
        <button className="adk-float-bell" title="התראות" onClick={() => { setNotifOpen((v) => { const nv = !v; if (nv) setNotifSeen(Date.now()); return nv; }); }}>
          <Icon name="bell" size={19} />{unreadCount > 0 && <span className="ic-badge">{unreadCount}</span>}
        </button>
        {notifOpen && (<>
          <div className="adk-notif-scrim" onClick={() => setNotifOpen(false)} />
          <div className="adk-notif">
            <div className="adk-notif-head"><b>התראות</b>{notifs.length > 0 && <button onClick={() => { setNotifSeen(Date.now()); }}>סמן הכל כנקרא</button>}</div>
            <div className="adk-notif-list">
              {notifs.length === 0 && <div className="adk-notif-empty">אין תנועות חדשות ✦</div>}
              {notifs.map((n) => (
                <button key={n.id} className={"adk-notif-item" + (n.at > notifSeen ? " unread" : "")} onClick={() => { setNotifOpen(false); openPage(null); setEditing(n.cardId); }}>
                  <span className={"adk-notif-dot " + n.type} />
                  <span className="adk-notif-body">
                    <span className="t">{n.type === "draft" ? "טיוטת עוזר" : n.type === "request" ? "בקשת תזמון" : n.type === "mention" ? "תויגת" : "תגובה"} · <b>{n.title}</b>{n.client && <em> · {n.client}</em>}</span>
                    <span className="s">{n.text}</span>
                    <span className="tm">{relTime(n.at)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>)}
        <div className="adk-rail bare">
          <button className="adk-rail-btn" data-label="היום שלי" onClick={() => openPage("day")}><Icon name="sun" />{planTasks.length > 0 && <span className="ic-badge">{planTasks.length}</span>}</button>
          <button className="adk-rail-btn" data-label="יומן" onClick={() => openPage("cal")}><Icon name="calendar" /></button>
          <button className="adk-rail-btn" data-label="דשבורד" onClick={() => openPage("dash")}><Icon name="chart" /></button>
        </div>
        <button className="adk-float-gear bare" data-label="הגדרות" onClick={() => openPage("settings")}><Icon name="gear" size={20} /></button>
      </>)}

      <BoardView columns={columns} order={order} cards={cards} clientId={currentId} assets={assets} now={now} viewer={viewer}
        filter={viewer && viewerQ.trim() ? ((c) => (c.title + " " + (c.description || "")).toLowerCase().includes(viewerQ.trim().toLowerCase())) : undefined}
        dnd={{ dragId, setDragId, dropCol, setDropCol, moveCard }}
        onOpenCard={(id) => setEditing(id)} onToggleTimer={toggleTimer} onAddCard={addCard}
        onRenameCol={renameCol} onDeleteColumn={deleteColumn} onAddColumn={addColumn} />
      </div>

      {editing && cards[editing] && (<>
        <div className="adk-scrim" onClick={() => setEditing(null)} />
        <CardPanel card={cards[editing]} now={now} assets={assets} client={clients.find((c) => c.id === cards[editing].clientId)}
          giverSuggestions={Array.from(new Set([
            ...((clients.find((c) => c.id === cards[editing].clientId)?.members) || []),
            ...Object.values(cards).filter((c) => c.clientId === cards[editing].clientId).flatMap((c) => peopleOf(c)),
          ].map((s) => (s || "").trim()).filter(Boolean)))}
          profileName={viewer ? (current?.contact || (current?.members && current.members[0]) || "לקוח") : (profile.name || "אני")}
          viewer={viewer}
          onClose={() => setEditing(null)} onChange={viewer ? ((p) => editWithTrail(editing, p, current?.contact || (current?.members && current.members[0]) || "לקוח")) : ((p) => updateCard(editing, p))} onDelete={() => deleteCard(editing, viewer ? "client" : "owner")}
          onToggleTimer={() => toggleTimer(editing)} onAddFiles={(fl) => addFiles(editing, fl)} onAddLink={() => addLink(editing)}
          onUpdateAtt={(aid, p) => updateAtt(editing, aid, p)} onRemoveAtt={(aid) => removeAtt(editing, aid)} />
      </>)}

      {clientEdit && <ClientModal client={clientEdit === "new" ? null : clientEdit} onClose={() => setClientEdit(null)} onSave={saveClient} onDelete={deleteClient} />}

      {dayOpen && (
        <MyDay planTasks={planTasks} upcoming={upcoming} clients={clients} now={now} runningCard={runningCard}
          profileName={profile.name}
          pending={{ drafts: notifs.filter((n) => n.type === "draft").length, requests: notifs.filter((n) => n.type === "request").length }}
          onAsk={(question) => { setChatSeed(question); setChatOpen(true); }}
          onClose={() => setDayOpen(false)}
          onOpenCard={(id) => { const c = cards[id]; if (c) { setCurrentId(c.clientId); openPage(null); setEditing(id); } }}
          onToggleTimer={toggleTimer} onDone={(id) => moveCard(id, "col-done")} />
      )}

      {archiveOpen && (<>
        <div className="adk-scrim" onClick={() => setArchiveOpen(false)} />
        <ArchivePanel items={archiveList} client={current} now={now}
          onClose={() => setArchiveOpen(false)}
          onOpen={(id) => { setArchiveOpen(false); setEditing(id); }}
          onRestore={restoreCard}
          onHardDelete={hardDelete} />
      </>)}

      {reportOpen && (
        <ReportPanel client={current} cards={curCards} cardColumn={cardColumn} now={now} onClose={() => setReportOpen(false)} onOpen={(id) => { setReportOpen(false); setEditing(id); }} />
      )}


      {calOpen && (
        <CalendarPanel clients={clients} cards={cards} now={now}
          onClose={() => setCalOpen(false)}
          onOpen={(id) => setEditing(id)} />
      )}

      {!chatOpen && !viewer && <button className="adk-fab" onClick={() => setChatOpen(true)} title="העוזר שלי"><Icon name="spark" size={24} /></button>}

      {chatOpen && <ChatPanel onClose={() => { setChatOpen(false); setChatSeed(null); }} seed={chatSeed} onSeedUsed={() => setChatSeed(null)} onAction={assistantAction} asstLevel={asstLevel} answer={(q) => {
        const s = q.toLowerCase();
        const nonArch = Object.values(cards).filter((c) => !c.archived);
        const monthKey = ymOf(Date.now());
        const monthSec = nonArch.filter((c) => ymOf(c.createdAt) === monthKey).reduce((a, c) => a + cardSeconds(c, now), 0);
        const perClient = clients.map((cl) => ({ cl, sec: Object.values(cards).filter((c) => c.clientId === cl.id && !c.archived).reduce((a, c) => a + cardSeconds(c, now), 0), rate: Number(cl.rate) || 0 }));
        if (s.includes("שעות") && s.includes("חודש")) return `החודש נצברו ${Math.ceil(monthSec / 3600)} שעות עבודה על פני ${perClient.filter((p) => p.sec > 0).length} לקוחות.`;
        if (s.includes("רווחי") || s.includes("רווח")) { const p = perClient.map((x) => ({ ...x, rev: (x.sec / 3600) * x.rate })).filter((x) => x.rev > 0).sort((a, b) => b.rev - a.rev); return p.length ? `הלקוח הכי רווחי הוא ${p[0].cl.name} — הכנסה משוערת ${fmtMoney(p[0].rev)} (${Math.ceil(p[0].sec / 3600)} שעות × ₪${p[0].rate}).` : "עדיין אין תעריפים מוגדרים ללקוחות, אז אי אפשר לחשב רווחיות. הוסף תעריף שעתי בכרטיס הלקוח."; }
        if (s.includes("דחוף") || s.includes("היום")) { if (!planTasks.length) return "אין משימות דחופות להיום — נקי! ✦"; const top = planTasks.slice(0, 5).map((t) => `• ${t.card.title || "משימה"}${t.card.time ? ` · ${t.card.time}` : ""}`).join("\n"); return `יש ${planTasks.length} משימות בתוכנית של היום:\n${top}`; }
        if (s.includes("כמה") && s.includes("משימ")) { const open = nonArch.filter((c) => cardColumn[c.id] !== "col-done").length; return `יש ${open} משימות פתוחות כרגע על פני כל הלקוחות.`; }
        if (s.includes("לקוח") && s.includes("שעות")) { const p = perClient.filter((x) => x.sec > 0).sort((a, b) => b.sec - a.sec); return p.length ? "שעות לפי לקוח:\n" + p.map((x) => `• ${x.cl.name}: ${Math.ceil(x.sec / 3600)} שעות`).join("\n") : "אין עדיין שעות רשומות."; }
        return "אני עדיין בהדגמה — בגרסה המחוברת (עם שרת) אענה בשפה חופשית, אזכור שיחות, ואצוף גם בוואטסאפ. בינתיים נסה: \"כמה שעות עבדתי החודש?\", \"מי הלקוח הכי רווחי?\", \"מה דחוף היום?\"";
      }} />}

      {settingsOpen && (
        <SettingsPanel profile={profile}
          onClose={() => setSettingsOpen(false)}
          onSetName={(name) => setProfile((p) => ({ ...p, name }))}
          onSetPhoto={(photo) => setProfile((p) => ({ ...p, photo }))}
          onSetAssistant={(k, v) => setProfile((p) => ({ ...p, assistant: { ...(p.assistant || {}), [k]: v } }))}
          onSetPref={(k, v) => setProfile((p) => ({ ...p, settings: { ...(p.settings || {}), [k]: v } }))} />
      )}

      {dashOpen && (
        <PersonalDashboard clients={clients} cards={cards} cardColumn={cardColumn} now={now} profile={profile}
          onClose={() => setDashOpen(false)}
          onSetPhoto={(photo) => setProfile((p) => ({ ...p, photo }))}
          onSetName={(name) => setProfile((p) => ({ ...p, name }))}
          onSetAssistant={(k, v) => setProfile((p) => ({ ...p, assistant: { ...(p.assistant || {}), [k]: v } }))}
          onOpenClient={(id) => { setCurrentId(id); setDashOpen(false); }} />
      )}
    </div>
  );
}

const HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const HE_WD = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
function SchedulePicker({ deadline, routine, dayFlex, time, onChange }) {
  const [open, setOpen] = useState(false);
  const base = deadline ? new Date(deadline + "T00:00:00") : new Date();
  const [vy, setVy] = useState(base.getFullYear());
  const [vm, setVm] = useState(base.getMonth());
  useEffect(() => { if (open) { const b = deadline ? new Date(deadline + "T00:00:00") : new Date(); setVy(b.getFullYear()); setVm(b.getMonth()); } }, [open]);
  const pad = (n) => String(n).padStart(2, "0");
  const mk = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const first = new Date(vy, vm, 1).getDay();
  const dim = new Date(vy, vm + 1, 0).getDate();
  const today = todayStr();
  const rk = routine || "none";
  const dayAxis = rk === "weekly" || rk === "monthly"; // day flexibility only meaningful here
  const df = dayAxis && dayFlex;
  function prev() { if (vm === 0) { setVm(11); setVy(vy - 1); } else setVm(vm - 1); }
  function next() { if (vm === 11) { setVm(0); setVy(vy + 1); } else setVm(vm + 1); }
  const label = (() => {
    if (!deadline && rk === "none" && !time) return "בחר מתי";
    const parts = [];
    if (rk !== "none") {
      parts.push({ daily: "יומי", weekly: "שבועי", monthly: "חודשי" }[rk]);
      if (dayAxis) parts.push(df ? "יום גמיש" : (deadline ? (() => { const [, m, d] = deadline.split("-"); return `${+d}.${+m}`; })() : "יום קבוע"));
    } else if (deadline) { const [, m, d] = deadline.split("-"); parts.push(`${+d}.${+m}`); }
    parts.push(time ? time : "שעה גמישה");
    return parts.join(" · ");
  })();
  return (
    <div className="adk-dp">
      <div className={"adk-dp-trigger" + (label === "בחר מתי" ? " empty" : "")} onClick={() => setOpen((o) => !o)}>
        {rk !== "none" && <span style={{ color: "var(--accent-d)" }}>↻</span>}{label}<span className="cal">📅</span>
      </div>
      {open && (<>
        <div style={{ position: "fixed", inset: 0, zIndex: 7 }} onClick={() => setOpen(false)} />
        <div className="adk-dp-pop">
          <div className="adk-dp-head">
            <button onClick={prev}>›</button>
            <span className="my">{HE_MONTHS[vm]} {vy}</span>
            <button onClick={next}>‹</button>
          </div>
          <div className="adk-dp-grid">
            {HE_WD.map((w) => <div className="adk-dp-wd" key={w}>{w}</div>)}
            {Array.from({ length: first }).map((_, i) => <div className="adk-dp-day blank" key={"b" + i} />)}
            {Array.from({ length: dim }).map((_, i) => {
              const d = i + 1; const ds = mk(vy, vm, d);
              return <div key={d} className={"adk-dp-day" + (ds === deadline ? " sel" : "") + (ds === today ? " today" : "") + (df ? " muted" : "")} onClick={() => onChange({ deadline: ds })}>{d}</div>;
            })}
          </div>

          <div className="adk-sp-sec">חזרתיות</div>
          <div className="adk-sp-chips">
            {[["none", "ללא"], ["daily", "יומי"], ["weekly", "שבועי"], ["monthly", "חודשי"]].map(([k, l]) => (
              <button key={k} className={rk === k ? "on" : ""} onClick={() => onChange({ routine: k })}>{l}</button>
            ))}
          </div>

          {dayAxis && (<>
            <div className="adk-sp-sec">יום</div>
            <div className="adk-sp-chips two">
              <button className={!df ? "on" : ""} onClick={() => onChange({ dayFlex: false })}>יום קבוע</button>
              <button className={df ? "on" : ""} onClick={() => onChange({ dayFlex: true })}>גמיש</button>
            </div>
            <div className="adk-sp-hint">{df ? `כלשהו בתוך ה${rk === "monthly" ? "חודש" : "שבוע"} — יופיע בכל יום עד שיושלם.` : "ביום שנבחר בלוח."}</div>
          </>)}

          <div className="adk-sp-sec">שעה</div>
          <div className="adk-sp-chips two">
            <button className={time ? "on" : ""} onClick={() => onChange({ time: time || "09:00" })}>שעה מסוימת</button>
            <button className={!time ? "on" : ""} onClick={() => onChange({ time: "" })}>גמיש</button>
          </div>
          {time && (
            <div className="adk-sp-row">
              <span className="adk-sp-lbl">בשעה</span>
              <input className="adk-input" style={{ padding: "6px 9px", fontSize: 13, width: 120 }} type="time" value={time} onChange={(e) => onChange({ time: e.target.value })} />
            </div>
          )}

          <div className="adk-dp-foot">
            <button className="clear" onClick={() => { onChange({ deadline: "", time: "", dayFlex: false }); setOpen(false); }}>נקה</button>
            <button onClick={() => setOpen(false)}>סגור</button>
          </div>
        </div>
      </>)}
    </div>
  );
}

function renderMentions(text) {
  return String(text).split(/(\s+)/).map((tok, i) => (tok.startsWith("@") && tok.length > 1) ? <span key={i} className="adk-mention">{tok}</span> : tok);
}
function CommentBox({ value, onChange, onSend, people, placeholder }) {
  const [men, setMen] = useState(null);
  function handle(v) { onChange(v); const m = v.match(/@(\S*)$/); setMen(m ? { q: m[1] } : null); }
  const sugg = men ? (people || []).filter((p) => p && p.toLowerCase().includes(men.q.toLowerCase())).slice(0, 6) : [];
  function pick(name) { onChange(value.replace(/@(\S*)$/, "@" + name + " ")); setMen(null); }
  return (
    <div className="adk-combo" style={{ flex: 1 }}>
      <input className="adk-input" style={{ borderRadius: 20 }} value={value} placeholder={placeholder}
        onChange={(e) => handle(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !(men && sugg.length)) { e.preventDefault(); onSend(); } }}
        onBlur={() => setTimeout(() => setMen(null), 150)} />
      {men && sugg.length > 0 && (
        <div className="adk-combo-list">
          {sugg.map((s) => <div className="adk-combo-item" key={s} onMouseDown={() => pick(s)}><Avatar name={s} size={18} /> {s}</div>)}
        </div>
      )}
    </div>
  );
}

function GiverInput({ value, onChange, suggestions, onPick, placeholder, bare }) {
  const [open, setOpen] = useState(false);
  const q = (value || "").trim().toLowerCase();
  const list = (suggestions || []).filter((s) => s && (!q || s.toLowerCase().includes(q)))
    .sort((a, b) => ((a.toLowerCase().startsWith(q) ? 0 : 1) - (b.toLowerCase().startsWith(q) ? 0 : 1)));
  const show = open && list.length > 0;
  const pick = (s) => { if (onPick) { onPick(s); onChange(""); } else { onChange(s); } setOpen(false); };
  return (
    <div className="adk-combo">
      <input className={"adk-input" + (bare ? " adk-bare-input" : "")} value={value} placeholder={placeholder || "שם / תפקיד / איש קשר"}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === "Enter" && onPick && value.trim()) { e.preventDefault(); onPick(value.trim()); onChange(""); setOpen(false); } }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 130)} />
      {show && (
        <div className="adk-combo-list">
          {list.slice(0, 6).map((s) => (
            <div key={s} className="adk-combo-item" onMouseDown={() => pick(s)}><Avatar name={s} size={18} /> {s}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stepper({ value, onChange, step = 1, min = 0, sm = false }) {
  return (
    <div className={"adk-stepper" + (sm ? " sm" : "")}>
      <button onClick={() => onChange(Math.max(min, value - step))}>−</button>
      <div className="val">{value}</div>
      <button onClick={() => onChange(value + step)}>+</button>
    </div>
  );
}

function MyDay({ planTasks, upcoming, clients, now, runningCard, pending, profileName, onAsk, onClose, onOpenCard, onToggleTimer, onDone }) {
  const clientOf = (id) => clients.find((c) => c.id === id);
  const [q, setQ] = useState("");
  function ask() { const t = q.trim(); if (!t) return; onAsk(t); setQ(""); }
  const dateLabel = new Date().toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
  // chronological: timed tasks by time first, then day-flex / untimed
  const chrono = [...planTasks].sort((a, b) => {
    const ta = a.card.time || "", tb = b.card.time || "";
    if (ta && tb) return ta.localeCompare(tb);
    if (ta) return -1; if (tb) return 1; return 0;
  });
  const overdue = planTasks.filter((t) => deadlineInfo(t.card.deadline)?.tone === "over").length;
  const firstTimed = chrono.find((t) => t.card.time);
  const top = planTasks[0]?.card;

  // brief — voice: observe & hand over. no command / scold / apology / padding / emoji.
  const dayClass = planTasks.length >= 5 ? "יום עמוס" : planTasks.length <= 1 ? "יום פתוח" : "יום רגיל";
  let headline;
  if (planTasks.length === 0) headline = "שום דבר לא מחכה לך הבוקר.";
  else if (overdue > 0) headline = `${overdue === 1 ? "משימה אחת חצתה" : `${overdue} משימות חצו`} את הזמן שנקבע.`;
  else if (top) headline = <>היום נשען על <span className="clay">"{top.title || "משימה"}"</span>.</>;
  else headline = `${dayClass}, ${planTasks.length} על השולחן.`;
  const briefLines = [];
  if (firstTimed) { const cn = clientOf(firstTimed.card.clientId)?.name; briefLines.push(`הראשון בתור: "${firstTimed.card.title || "משימה"}" ב־${firstTimed.card.time}${cn ? ` · ${cn}` : ""}.`); }
  if (pending?.requests) briefLines.push(`${pending.requests === 1 ? "בקשת תזמון אחת" : `${pending.requests} בקשות תזמון`} בתיבה.`);
  if (pending?.drafts) briefLines.push(`${pending.drafts === 1 ? "טיוטה אחת" : `${pending.drafts} טיוטות`} מהעוזר ממתינות למבט.`);

  const TLRow = ({ t }) => {
    const c = t.card, cl = clientOf(c.clientId), pri = PRIORITY[c.priority], dl = deadlineInfo(c.deadline), isRun = !!c.timerStart, timed = !!c.time && !flexDay(c);
    return (
      <div className="adk-tl-row" onClick={() => onOpenCard(c.id)}>
        <div className={"adk-tl-time" + (timed ? "" : " flex")}>{timed ? c.time : "גמיש"}</div>
        <div className={"adk-tl-dot" + (dl?.tone === "over" ? " over" : "")} style={{ background: cl?.color || "var(--muted)" }} />
        <div className="adk-tl-body">
          <div className="ttl">{routineKind(c) !== "none" && "↻ "}{c.title || "ללא כותרת"}</div>
          <div className="meta">
            <span className="cname">{cl?.name}</span>
            {c.priority !== "regular" && <span className="adk-pri" style={{ background: pri.soft, color: pri.color }}>{pri.label}</span>}
            {dl && dl.tone === "over" && <span className="adk-dl over">{dl.text}</span>}
          </div>
        </div>
        <button className={"adk-mini-timer" + (isRun ? " on" : "")} onClick={(e) => { e.stopPropagation(); onToggleTimer(c.id); }}>{isRun ? "■" : "▶"}</button>
      </div>
    );
  };

  return (
    <div className="adk-page">
      <div className="adk-pcard day">
        <div className="adk-pcard-head">
          <button className="adk-back" onClick={onClose} title="חזרה"><Icon name="arrowR" size={22} /></button>
          <div className="titleblk"><div className="adk-day-sun"><Icon name="sun" size={20} /></div><div><h2>היום שלי</h2><span>{dateLabel}</span></div></div>
        </div>

        <div className="adk-day2">
          <aside className="adk-day2-brief">
            <div className="adk-brief2-scroll">
              <div className="adk-brief2-tag"><span className="adk-brief2-av"><Icon name="spark" size={13} /></span> העוזר שלך <DemoTag /></div>
              <div className="adk-brief2-hl">{headline}</div>
              {briefLines.map((l, i) => <div key={i} className="adk-brief2-line">{l}</div>)}
              {runningCard && <div className="adk-brief2-now"><span className="rec-dot" /> טיימר פעיל · {runningCard.title || "משימה"} · {fmtClock(cardSeconds(runningCard, now))}</div>}
            </div>
            <div className="adk-day-ask">
              <button className="adk-attach" title="העלה קובץ (הדגמה)" onClick={() => onAsk("📎 קובץ")}><Icon name="plus" size={18} /></button>
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") ask(); }} placeholder="שאל את הכפיל על היום שלך…" />
              <button className="adk-cmt-send" onClick={ask} title="שלח"><Icon name="arrowUp" size={17} /></button>
            </div>
          </aside>

          <div className="adk-day2-tasks">
            {chrono.length === 0 && <div className="adk-day-empty">אין משימות בתוכנית של היום.</div>}
            {chrono.length > 0 && <div className="adk-tl-head">סדר היום</div>}
            {chrono.map((t) => <TLRow key={t.card.id} t={t} />)}
            {upcoming.length > 0 && (<>
              <div className="adk-tl-head up">בקרוב · 7 ימים</div>
              {upcoming.map((t) => <TLRow key={t.card.id} t={t} />)}
            </>)}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScheduleNegotiation({ card, me, allowFresh, onApply, onPropose, onCancel }) {
  const [countering, setCountering] = useState(false);
  const p = card.proposed;
  const base = p || { deadline: card.deadline, routine: routineKind(card), dayFlex: !!(card.dayFlex ?? card.flex), time: card.time || "" };
  const showPicker = countering || (!p && allowFresh);
  return (
    <div>
      {p && p.by === me && (
        <div className="adk-pending-note">⏳ הצעתך ({scheduleLabel(p)}) ממתינה לאישור הצד השני <button className="adk-inline-link" onClick={onCancel}>ביטול</button></div>
      )}
      {p && p.by !== me && (
        <div className="adk-req">
          <div className="adk-req-txt"><Icon name="clock" size={15} /> {p.by} מציע: <b>{scheduleLabel(p)}</b></div>
          <div className="adk-req-act">
            <button className="ok" onClick={() => onApply(p)}>אשר</button>
            <button className="no" onClick={() => setCountering((c) => !c)}>הצע זמן אחר</button>
          </div>
        </div>
      )}
      {showPicker && (
        <div style={{ marginTop: p ? 8 : 0 }}>
          <SchedulePicker deadline={base.deadline} routine={base.routine} dayFlex={base.dayFlex} time={base.time}
            onChange={(patch) => onPropose({ ...base, ...patch })} />
          <div className="adk-sp-hint">{p ? "העריכה תישלח כהצעה חדשה לצד השני." : "שינוי תאריך יישלח כבקשה לאישור מנהל המשימה."}</div>
        </div>
      )}
    </div>
  );
}

function CardPanel({ card, now, assets, client, giverSuggestions, profileName, viewer, onClose, onChange, onDelete, onToggleTimer, onAddFiles, onAddLink, onUpdateAtt, onRemoveAtt }) {
  const isRun = !!card.timerStart, secs = cardSeconds(card, now);
  const directHours = Math.round((card.timeSpent || 0) / 3600);
  const subTotal = subHours(card);
  const fileRef = useRef(); const [over, setOver] = useState(false); const [keb, setKeb] = useState(false);
  const [ccInput, setCcInput] = useState(""); const [commentInput, setCommentInput] = useState(""); const [replyTo, setReplyTo] = useState(null); const [trailOpen, setTrailOpen] = useState(false);
  const creator = creatorOf(card); const cc = ccOf(card); const comments = card.comments || [];
  const mentionPeople = Array.from(new Set([creator, ...cc, ...((client?.members) || [])].map((s) => (s || "").trim()).filter(Boolean)));
  function addCc(n) { n = (n || "").trim(); if (!n || n === creator || cc.includes(n)) return; onChange({ cc: [...cc, n] }); }
  function removeCc(n) { onChange({ cc: cc.filter((x) => x !== n) }); }
  function addComment() { const t = commentInput.trim(); if (!t) return; onChange({ comments: [...comments, { id: uid("cm"), by: profileName, text: t, at: Date.now(), parentId: replyTo ? replyTo.id : null }] }); setCommentInput(""); setReplyTo(null); }
  const rkind = routineKind(card);
  const st = card.subtasks || []; const [ghost, setGhost] = useState("");
  const files = (card.attachments || []).filter((a) => a.type !== "link");
  const links = (card.attachments || []).filter((a) => a.type === "link");
  function updSt(id, patch) { onChange({ subtasks: st.map((s) => (s.id === id ? { ...s, ...patch } : s)) }); }
  function addSt(text = "") { onChange({ subtasks: [...st, { id: uid("st"), text, done: false, hours: 0 }] }); }
  return (
    <div className="adk-panel">
      <div className="adk-phead">
        <div className="ctx">
          <Badge client={client} size={22} />
          <span className="nm">{client?.name}</span>
          {rkind !== "none" && <span className="adk-rchip">↻ {ROUTINE_LABEL[rkind]}</span>}
          {isRun && <span className="clk"><span className="rec-dot" />{fmtClock(secs)}</span>}
          <button className="adk-x" style={{ marginInlineStart: "auto" }} onClick={onClose}>×</button>
        </div>
        <input className="adk-ptitle" value={card.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="שם המשימה" autoFocus={!card.title} />
      </div>

      <div className="adk-panel-body">
        {card.draft && !viewer && (
          <div className="adk-draft-banner">
            <div className="adk-draft-txt"><Icon name="spark" size={15} /> {card.draft.level === "suggest" ? "העוזר מציע את הכרטיס הזה" : "טיוטת העוזר — ממתינה לאישורך"}</div>
            <div className="adk-req-act">
              <button className="ok" onClick={() => onChange({ draft: undefined, creator: profileName })}>אשר</button>
              <button className="no" onClick={onDelete}>דחה</button>
            </div>
          </div>
        )}
        {viewer ? (
          <div className="adk-cell">
            <label>מתי</label>
            <ScheduleNegotiation card={card} me={profileName} allowFresh
              onApply={(p) => onChange({ deadline: p.deadline, routine: p.routine, dayFlex: p.dayFlex, time: p.time, proposed: undefined })}
              onPropose={(o) => onChange({ proposed: { deadline: o.deadline, routine: o.routine, dayFlex: o.dayFlex, time: o.time, by: profileName, at: Date.now() } })}
              onCancel={() => onChange({ proposed: undefined })} />
          </div>
        ) : (<>
          {card.proposed && (
            <div style={{ marginBottom: 14 }}>
              <ScheduleNegotiation card={card} me={profileName}
                onApply={(p) => onChange({ deadline: p.deadline, routine: p.routine, dayFlex: p.dayFlex, time: p.time, proposed: undefined })}
                onPropose={(o) => onChange({ proposed: { deadline: o.deadline, routine: o.routine, dayFlex: o.dayFlex, time: o.time, by: profileName, at: Date.now() } })}
                onCancel={() => onChange({ proposed: undefined })} />
            </div>
          )}
          <div className="adk-grid2">
            <div className="adk-cell">
              <label>מתי</label>
              <SchedulePicker deadline={card.deadline} routine={rkind} dayFlex={!!(card.dayFlex ?? card.flex)} time={card.time || ""} onChange={onChange} />
            </div>
            <div className="adk-cell">
              <label>זמן · שעות</label>
              <div className="trow">
                <Stepper sm value={directHours} onChange={(v) => onChange({ timeSpent: v * 3600 })} />
                <button className={"adk-timer-btn" + (isRun ? " on" : "")} style={{ position: "static", margin: 0, width: 38, height: 38, borderRadius: "50%" }} onClick={onToggleTimer} title={isRun ? "עצור" : "התחל"}>{isRun ? "■" : "▶"}</button>
              </div>
            </div>
          </div>
        </>)}
        {!viewer && subTotal > 0 && <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700, marginTop: -6 }}>+ {subTotal}ש בתת־משימות · סה״כ {fmtShort(secs)}</div>}

        <div className="adk-cell">
          <label>חשיבות</label>
          {viewer
            ? <div><span className="adk-prichip on" style={{ background: PRIORITY[card.priority].soft, color: PRIORITY[card.priority].color, borderColor: PRIORITY[card.priority].color }}>{PRIORITY[card.priority].label}</span></div>
            : <div className="adk-prichips">{Object.entries(PRIORITY).map(([k, v]) => <button key={k} className={"adk-prichip" + (card.priority === k ? " on" : "")} onClick={() => onChange({ priority: k })} style={card.priority === k ? { background: v.soft, color: v.color, borderColor: v.color } : {}}>{v.label}</button>)}</div>}
        </div>

        <div className="adk-hr" />

        <div className="adk-group">

          <div className="adk-field"><label>אנשים</label>
            <div className="adk-tagbox">
              {creator && <span className="adk-cc-chip locked" title="יוצר — פתח/ה את המשימה"><Avatar name={creator} size={18} /> {creator}</span>}
              {cc.map((n) => (
                <span className="adk-cc-chip" key={n}><Avatar name={n} size={18} /> {n} <button onClick={() => removeCc(n)}>×</button></span>
              ))}
              <GiverInput bare value={ccInput} onChange={setCcInput} onPick={addCc} suggestions={giverSuggestions.filter((s) => s !== creator && !cc.includes(s))} placeholder="+ הוסף אדם" />
            </div>
          </div>

          <div className="adk-field"><label>תוכן הבריף</label>
            <input ref={fileRef} type="file" accept="*/*" multiple style={{ display: "none" }} onChange={(e) => { onAddFiles(e.target.files); e.target.value = ""; }} />
            <div className={"adk-brief" + (over ? " over" : "")}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files?.length) onAddFiles(e.dataTransfer.files); }}>
              <textarea className="adk-brief-text" rows={4} value={card.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="כתוב את הבריף כאן, גרור קבצים או הוסף לינקים…" />
              {(files.length > 0 || links.length > 0) && (
                <div className="adk-brief-atts">
                  {files.length > 0 && (
                    <div className="adk-att-grid">
                      {files.map((a) => (
                        <div className="adk-att-item" key={a.id}>
                          <button className="del" onClick={() => onRemoveAtt(a.id)}>×</button>
                          {a.type === "image" && assets[a.id]
                            ? <img className="adk-att-img" src={assets[a.id]} alt="" onClick={() => window.open(assets[a.id], "_blank")} />
                            : <a className="adk-att-file" href={assets[a.id] || "#"} download={a.name} target="_blank" rel="noreferrer">📄 <span>{a.name}</span></a>}
                        </div>
                      ))}
                    </div>
                  )}
                  {links.map((a) => { const href = a.url ? (/^https?:\/\//i.test(a.url.trim()) ? a.url.trim() : "https://" + a.url.trim()) : ""; return (
                    <div className="adk-linkrow" key={a.id}>
                      <input className="adk-input" style={{ flex: "0 0 32%", padding: "7px 9px", fontSize: 13 }} value={a.name} onChange={(e) => onUpdateAtt(a.id, { name: e.target.value })} placeholder="שם" />
                      <input className="adk-input" style={{ padding: "7px 9px", fontSize: 13 }} value={a.url} onChange={(e) => onUpdateAtt(a.id, { url: e.target.value })} placeholder="https://" dir="ltr" />
                      {href && <a className="adk-linkopen" href={href} target="_blank" rel="noreferrer" title="פתח בכרטיסייה חדשה">↗</a>}
                      <button className="adk-x" onClick={() => onRemoveAtt(a.id)}>×</button>
                    </div>
                  ); })}
                </div>
              )}
              <div className="adk-brief-bar">
                <button onClick={() => fileRef.current.click()}>＋ קובץ / תמונה</button>
                <button onClick={onAddLink}>🔗 לינק</button>
                <span className="hint">או גרור לכאן</span>
              </div>
            </div>
          </div>
        </div>

        {/* breakdown group */}
        <div className="adk-hr" />
        <div className="adk-cell" style={{ gap: 3 }}>
          {st.map((s) => (
            <div className="adk-st" key={s.id}>
              <div className={"chk" + (s.done ? " on" : "")} onClick={() => updSt(s.id, { done: !s.done })}>✓</div>
              <input className={"txt" + (s.done ? " done" : "")} value={s.text} onChange={(e) => updSt(s.id, { text: e.target.value })} placeholder="משימה…" />
              <div className="h" title="שעות">
                <button onClick={() => updSt(s.id, { hours: Math.max(0, (Number(s.hours) || 0) - 1) })}>−</button>
                <div className="v">{Number(s.hours) || 0}</div>
                <button onClick={() => updSt(s.id, { hours: (Number(s.hours) || 0) + 1 })}>+</button>
              </div>
              <button className="del" onClick={() => onChange({ subtasks: st.filter((x) => x.id !== s.id) })}>×</button>
            </div>
          ))}
          <div className="adk-st ghost">
            <div className="chk" />
            <input className="txt" value={ghost} placeholder="כתוב כאן משימות לביצוע…"
              onChange={(e) => setGhost(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && ghost.trim()) { e.preventDefault(); addSt(ghost.trim()); setGhost(""); } }}
              onBlur={() => { if (ghost.trim()) { addSt(ghost.trim()); setGhost(""); } }} />
          </div>
        </div>

        <div className="adk-hr" />
        <div className="adk-cell" style={{ gap: 4 }}>
          <label>תגובות {comments.length > 0 ? `· ${comments.length}` : ""}</label>
          <div className="adk-thread">
            {comments.filter((c) => !c.parentId).map((cm) => (
              <div className="adk-cmt" key={cm.id}>
                <Avatar name={cm.by} size={22} />
                <div className="adk-cmt-b">
                  <div className="adk-cmt-line"><b>{cm.by}</b> {renderMentions(cm.text)} <span className="t">{relTime(cm.at)}</span></div>
                  <button className="adk-cmt-reply" onClick={() => setReplyTo(cm)}>השב</button>
                  {comments.filter((r) => r.parentId === cm.id).map((r) => (
                    <div className="adk-cmt reply" key={r.id}>
                      <Avatar name={r.by} size={20} />
                      <div className="adk-cmt-b"><div className="adk-cmt-line"><b>{r.by}</b> {renderMentions(r.text)} <span className="t">{relTime(r.at)}</span></div></div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {comments.length === 0 && <div style={{ fontSize: 12.5, color: "var(--faint)", fontWeight: 600, padding: "4px 0" }}>אין תגובות עדיין</div>}
          </div>
          <div className="adk-cmt-compose">
            {replyTo && <div className="adk-cmt-replying">משיב ל־<b>{replyTo.by}</b><button onClick={() => setReplyTo(null)}>×</button></div>}
            <div className="adk-cmt-input">
              <Avatar name={profileName} size={22} />
              <CommentBox value={commentInput} onChange={setCommentInput} onSend={addComment} people={mentionPeople} placeholder={replyTo ? "כתוב תשובה…  (@ לתיוג)" : "כתוב תגובה…  (@ לתיוג)"} />
              <button className="adk-cmt-send" onClick={addComment} title="שלח"><Icon name="arrowUp" size={17} /></button>
            </div>
          </div>
        </div>

        {(card.history || []).length > 0 && (
          <>
            <div className="adk-hr" />
            <div className="adk-cell" style={{ gap: 6 }}>
              <button className="adk-trail-toggle" onClick={() => setTrailOpen((v) => !v)}>
                <Icon name="clock" size={14} /> שובל עריכה · {card.history.length} <span className="chev">{trailOpen ? "▾" : "◂"}</span>
              </button>
              {trailOpen && (
                <div className="adk-trail">
                  {[...card.history].reverse().map((h) => (
                    <div className="adk-trail-row" key={h.id}>
                      <Avatar name={h.by} size={20} />
                      <span className="adk-trail-txt"><b>{h.by}</b> ערך/ה · {h.label}</span>
                      <span className="adk-trail-time">{relTime(h.at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="adk-panel-foot">
        <div className="adk-kebab">
          <button className="adk-x" onClick={() => setKeb((v) => !v)} title="עוד">⋮</button>
          {keb && (<>
            <div style={{ position: "fixed", inset: 0, zIndex: 7 }} onClick={() => setKeb(false)} />
            <div className="adk-kmenu up">
              <button className="adk-kmenu-del" onClick={() => { setKeb(false); onDelete(); }}>{viewer ? "הסר מהפרויקט" : "מחק משימה"}</button>
            </div>
          </>)}
        </div>
        <button className="adk-btn primary" style={{ marginInlineStart: "auto" }} onClick={onClose}>שמור וסגור</button>
      </div>
    </div>
  );
}

function fmtDate(ts) { const d = new Date(ts); return `${d.getDate()}.${d.getMonth() + 1}.${String(d.getFullYear()).slice(2)}`; }
function ymOf(ts) { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function ymLabel(k) { if (k === "all") return "כל הזמן"; const [y, m] = k.split("-"); return new Date(+y, +m - 1, 1).toLocaleDateString("he-IL", { month: "long", year: "numeric" }); }
function fmtHours(sec) { return (Math.round(sec / 360) / 10).toString(); }
function fmtMoney(n) { return "₪" + Math.round(n).toLocaleString("he-IL"); }

const DONUT_COLORS = ["#0E8F8C", "#8E54C4", "#3B6FE0", "#2E9E5B", "#C9821A", "#D9503A", "#4FB0AD", "#6C7BE0", "#7BC77A", "#E0A24F", "#455A64"];
function last12Months() {
  const out = []; const d0 = new Date(); d0.setDate(1);
  for (let i = 11; i >= 0; i--) { const d = new Date(d0.getFullYear(), d0.getMonth() - i, 1); out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); }
  return out;
}

function BoardView({ columns, order, cards, clientId, assets, now, viewer, filter, dnd, onOpenCard, onToggleTimer, onAddCard, onRenameCol, onDeleteColumn, onAddColumn }) {
  const firstImage = (c) => { const a = (c.attachments || []).find((x) => x.type === "image"); return a ? assets[a.id] : null; };
  const d = dnd || {};
  return (
    <div className="adk-board">
      {columns.map((col) => {
        const ids = (order[col.id] || []).filter((id) => cards[id] && cards[id].clientId === clientId && !cards[id].archived && (!filter || filter(cards[id])));
        const colTime = ids.reduce((a, id) => a + cardSeconds(cards[id], now), 0);
        return (
          <div key={col.id} className={"adk-col" + (!viewer && d.dropCol === col.id ? " drop" : "")}
            onDragOver={viewer ? undefined : (e) => { e.preventDefault(); d.setDropCol(col.id); }}
            onDragLeave={viewer ? undefined : (e) => { if (e.currentTarget === e.target) d.setDropCol(null); }}
            onDrop={viewer ? undefined : (e) => { e.preventDefault(); if (d.dragId) d.moveCard(d.dragId, col.id); d.setDropCol(null); d.setDragId(null); }}>
            <div className="adk-col-head">
              {viewer
                ? <span className="adk-col-title" style={{ fontWeight: 700, padding: "2px 4px" }}>{col.title}</span>
                : <input className="adk-col-title" value={col.title} onChange={(e) => onRenameCol(col.id, e.target.value)} spellCheck={false} />}
              <span className="adk-count">{ids.length}</span>
              {!viewer && (order[col.id] || []).length === 0 && <button className="adk-colmenu" title="מחק עמודה ריקה" onClick={() => onDeleteColumn(col.id)}>×</button>}
            </div>
            {colTime > 0 && <div className="adk-col-time">⏱ {fmtShort(colTime)} בעמודה</div>}
            <div className="adk-cards">
              {ids.length === 0 && <div className="adk-empty">{viewer ? "—" : "גרור לכאן משימות"}</div>}
              {ids.map((id) => {
                const card = cards[id]; const secs = cardSeconds(card, now); const isRun = !!card.timerStart;
                const dl = deadlineInfo(card.deadline); const pri = PRIORITY[card.priority]; const thumb = firstImage(card);
                const st = card.subtasks || []; const done = st.filter((s) => s.done).length;
                return (
                  <div key={id} className={"adk-card" + (!viewer && d.dragId === id ? " dragging" : "") + (isRun ? " rec" : "") + (card.draft ? " draft" : "")}
                    draggable={!viewer}
                    onDragStart={viewer ? undefined : () => d.setDragId(id)}
                    onDragEnd={viewer ? undefined : () => { d.setDragId(null); d.setDropCol(null); }}
                    onDragOver={viewer ? undefined : (e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={viewer ? undefined : (e) => { e.preventDefault(); e.stopPropagation(); if (d.dragId && d.dragId !== id) d.moveCard(d.dragId, col.id, id); d.setDragId(null); d.setDropCol(null); }}
                    onClick={() => onOpenCard(id)}>
                    {thumb && <img className="adk-card-thumb" src={thumb} alt="" />}
                    <div className="adk-card-in">
                      <p className="adk-card-title">{routineKind(card) !== "none" && <span className="adk-routine-tag">↻ </span>}{card.title || "ללא כותרת"}</p>
                      <div className="adk-card-meta">
                        {card.priority !== "regular" && <span className="adk-pri" style={{ background: pri.soft, color: pri.color }}>● {pri.label}</span>}
                        {dl && <span className={"adk-dl " + dl.tone}>📅 {flexDay(card) ? "יום גמיש" : dl.text}</span>}
                        {card.time && <span className="adk-dl soon">🕐 {card.time}</span>}
                        {st.length > 0 && <span className="adk-checkmini">☑ {done}/{st.length}</span>}
                        {(card.comments || []).length > 0 && <span className="adk-checkmini"><Icon name="comment" size={13} /> {card.comments.length}</span>}
                        {card.proposed && <span className="adk-checkmini" style={{ background: "#FBF0DC", color: "#B9770F" }} title="בקשת לקוח ממתינה לאישור">⏳ בקשה</span>}
                        {card.draft && <span className="adk-checkmini" style={{ background: "#FBF0DC", color: "#B9770F" }} title="טיוטת העוזר"><Icon name="spark" size={12} /> טיוטה</span>}
                      </div>
                      <div className="adk-card-foot">
                        {peopleOf(card).length > 0 && (
                          <div className="adk-avstack">
                            {peopleOf(card).slice(0, 3).map((n, i) => <Avatar key={i} name={n} size={22} />)}
                            {peopleOf(card).length > 3 && <div className="adk-av more" style={{ width: 22, height: 22 }}>+{peopleOf(card).length - 3}</div>}
                          </div>
                        )}
                        <span className={"adk-time-badge" + (isRun ? " live" : "")} style={{ marginInlineStart: peopleOf(card).length ? 0 : "auto" }}>{isRun ? <span className="rec-dot" /> : "⏱"} {isRun ? fmtClock(secs) : fmtShort(secs)}</span>
                        {!viewer && <button className={"adk-timer-btn" + (isRun ? " on" : "")} title={isRun ? "עצור" : "התחל"} onClick={(e) => { e.stopPropagation(); onToggleTimer(id); }}>{isRun ? "■" : "▶"}</button>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {!viewer && <button className="adk-add" onClick={() => onAddCard(col.id)}>+ משימה</button>}
          </div>
        );
      })}
      {!viewer && <div className="adk-addcol"><button onClick={onAddColumn}><span className="plus">+</span><span className="lbl"> עמודה</span></button></div>}
    </div>
  );
}

function ReportPanel({ client, cards, cardColumn, now, onClose, onOpen }) {
  const seq = last12Months();
  const [period, setPeriod] = useState("12m");
  const inScope = period === "12m" ? cards.filter((c) => seq.includes(ymOf(c.createdAt))) : cards.filter((c) => ymOf(c.createdAt) === period);
  const isBillable = (c) => !c.archived || c.removedBy === "client";
  const workedSec = inScope.filter((c) => !c.archived).reduce((a, c) => a + cardSeconds(c, now), 0);
  const billableSec = inScope.filter(isBillable).reduce((a, c) => a + cardSeconds(c, now), 0);
  const rate = Number(client?.rate) || 0;
  const revenue = (billableSec / 3600) * rate;
  const byGiver = {};
  inScope.filter((c) => !c.archived).forEach((c) => { const g = creatorOf(c).trim() || "—"; (byGiver[g] = byGiver[g] || { count: 0, sec: 0 }); byGiver[g].count++; byGiver[g].sec += cardSeconds(c, now); });
  const givers = Object.entries(byGiver).map(([k, v]) => ({ name: k, ...v })).sort((a, b) => b.sec - a.sec);
  const distinctGivers = givers.filter((g) => g.name !== "—").length;
  const gDenom = givers.reduce((a, g) => a + g.sec, 0) || 1;
  let gacc = 0;
  const gStops = givers.map((g, i) => { const from = (gacc / gDenom) * 360; gacc += g.sec; const to = (gacc / gDenom) * 360; return `${DONUT_COLORS[i % DONUT_COLORS.length]} ${from}deg ${to}deg`; }).join(", ");
  const monthly = seq.map((k) => ({ k, sec: cards.filter((c) => ymOf(c.createdAt) === k && !c.archived).reduce((a, c) => a + cardSeconds(c, now), 0) }));
  const maxM = Math.max(1, ...monthly.map((m) => m.sec));
  const listed = [...inScope].sort((a, b) => cardSeconds(b, now) - cardSeconds(a, now));
  const statusOf = (c) => c.archived ? (c.removedBy === "client" ? "הוסר ע״י הלקוח" : "נמחק") : (cardColumn[c.id] === "col-done" ? "הושלם" : "פעיל");
  const rangeLabel = period === "12m" ? `${ymLabel(seq[0])} – ${ymLabel(seq[11])}` : ymLabel(period);
  return (
    <div className="adk-page">
      <div className="adk-pcard">
        <div className="adk-pcard-head">
          <button className="adk-back" onClick={onClose} title="חזרה"><Icon name="arrowR" size={22} /></button>
          <div className="titleblk">
            <Badge client={client} size={34} />
            <div><h2>דוח · {client?.name}</h2><span>{rangeLabel}</span></div>
          </div>
          <div className="sp" />
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="12m">12 חודשים אחרונים</option>
            {[...seq].reverse().map((m) => <option key={m} value={m}>{ymLabel(m)}</option>)}
          </select>
          <button className="btn" onClick={() => window.print()}><Icon name="printer" /> הדפסה</button>
        </div>

        <div className="adk-kpistrip">
          <div className="adk-kcell"><b>{fmtHours(workedSec)}<small>שע׳</small></b><span>שעות עבודה</span></div>
          <div className="adk-kcell billable"><b>{fmtHours(billableSec)}<small>שע׳</small></b><span>שעות לחיוב</span></div>
          <div className="adk-kcell"><b>{inScope.filter((c) => !c.archived).length}</b><span>משימות</span></div>
          <div className="adk-kcell"><b>{distinctGivers}</b><span>נותני בריף</span></div>
          {rate > 0 && <div className="adk-kcell"><b>{fmtMoney(revenue)}</b><span>לחיוב משוער</span></div>}
        </div>
        {billableSec > workedSec && <div className="adk-billnote">שעות לחיוב כוללות גם משימות שהוסרו ע״י הלקוח — השעות עליהן נשמרות ונכנסות לחשבונית.</div>}

        <div className="adk-pcard-body">
          <div className="adk-panel-block">
            <p className="adk-block-title">פילוח שעות לפי נותן בריף</p>
            {givers.length === 0 ? <div className="adk-arch-empty">אין נתונים בתקופה זו</div> : (
              <div style={{ display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap" }}>
                <div className="adk-donut" style={{ backgroundImage: `conic-gradient(${gStops})` }} />
                <div className="adk-legend">
                  {givers.map((g, i) => (
                    <div className="adk-leg" key={g.name}>
                      <span className="sw" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                      {g.name}
                      <span className="pct">{Math.round((g.sec / gDenom) * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="adk-panel-block">
            <p className="adk-block-title">שעות עבודה לפי חודש</p>
            <div className="adk-barchart">
              {monthly.map((m) => (
                <div className="adk-bc-col" key={m.k} title={`${fmtHours(m.sec)} שעות`}>
                  <div className="adk-bc-track"><div className={"adk-bc-bar" + (period === m.k ? " hl" : "")} style={{ height: `${(m.sec / maxM) * 100}%` }} /></div>
                  <div className="adk-bc-x">{m.k.slice(5)}/{m.k.slice(2, 4)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="adk-pcard-foot">
          <p className="adk-block-title">כל המשימות בתקופה</p>
          <table className="adk-reptable">
            <thead><tr><th>משימה</th><th>נותן בריף</th><th>סטטוס</th><th>שעות</th></tr></thead>
            <tbody>
              {listed.map((c) => (
                <tr key={c.id} onClick={() => onOpen(c.id)}>
                  <td>{c.title || "ללא כותרת"}</td><td>{creatorOf(c) || "—"}</td><td>{statusOf(c)}</td><td>{fmtHours(cardSeconds(c, now))}</td>
                </tr>
              ))}
              {listed.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--faint)", padding: 24 }}>אין משימות בתקופה זו</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ChatPanel({ onClose, answer, onAction, asstLevel, seed, onSeedUsed }) {
  const [msgs, setMsgs] = useState([{ by: "twin", text: "היי טל 👋 אני הכפיל הדיגיטלי שלך — אותה ישות פה ובוואטסאפ. אפשר לשאול על השעות, הלקוחות, ומה דחוף היום." }]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const boxRef = useRef();
  const seededRef = useRef(false);
  const suggestions = ["כמה שעות עבדתי החודש?", "מי הלקוח הכי רווחי?", "מה דחוף היום?", "פתח לי טיוטת משימה"];
  const connectors = [{ n: "לוח", real: true }, { n: "יומן", real: false }, { n: "וואטסאפ", real: false }, { n: "דרייב", real: false }, { n: "מייל", real: false }];
  function send(q) {
    const text = (q ?? input).trim(); if (!text || typing) return;
    // demo: assistant proposes a card via the permission gate
    if (/טיוטת? משימה|צור.*משימה|פתח.*משימה/.test(text) && onAction) {
      setMsgs((m) => [...m, { by: "me", text }]); setInput(""); setTyping(true);
      setTimeout(() => {
        onAction("create_card", { title: "לבדוק בריף חדש מהלקוח", description: "נוצר ע״י העוזר מתוך השיחה (הדגמה).", origin: { type: "chat", ref: "chat-demo-" + Date.now() } });
        const lvl = asstLevel ? asstLevel("cards") : "draft";
        const word = lvl === "act" ? "יצרתי משימה" : lvl === "suggest" ? "הצעתי משימה" : "פתחתי טיוטת משימה";
        setMsgs((m) => [...m, { by: "twin", text: `${word} על הלוח: "לבדוק בריף חדש מהלקוח". ${lvl === "act" ? "" : "היא ממתינה לאישורך — אפשר לאשר או לדחות בכרטיס."}` }]);
        setTyping(false);
      }, 550);
      return;
    }
    setMsgs((m) => [...m, { by: "me", text }]); setInput(""); setTyping(true);
    const reply = answer(text);
    setTimeout(() => { setMsgs((m) => [...m, { by: "twin", text: reply }]); setTyping(false); }, 480);
  }
  function attachDemo() {
    if (typing) return;
    setMsgs((m) => [...m, { by: "me", text: "📎 בריף_לקוח.pdf" }]); setTyping(true);
    setTimeout(() => { setMsgs((m) => [...m, { by: "twin", text: "קיבלתי את הקובץ. בגרסה המחוברת אנתח את הבריף ואפתח ממנו משימה תחת הלקוח המתאים — עם כותרת, דגשים וקבצים מצורפים. (הדגמה)" }]); setTyping(false); }, 650);
  }
  useEffect(() => { if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight; }, [msgs, typing]);
  useEffect(() => { if (seed && !seededRef.current) { seededRef.current = true; send(seed); onSeedUsed && onSeedUsed(); } }, [seed]); // eslint-disable-line
  return (
    <>
      <div className="adk-scrim" onClick={onClose} />
      <div className="adk-chat">
        <div className="adk-chat-head">
          <div className="adk-chat-id"><div className="adk-chat-av"><Icon name="spark" size={18} /></div><div><b>העוזר שלי</b><span>כפיל דיגיטלי · אחד בכל הדלתות</span></div></div>
          <div className="sp" style={{ flex: 1 }} />
          <button className="adk-x" onClick={onClose}>×</button>
        </div>
        <div className="adk-conn">
          <span className="adk-conn-lbl">מחובר ל־</span>
          {connectors.map((c) => (
            <span key={c.n} className={"adk-conn-chip" + (c.real ? " real" : "")} title={c.real ? "מחובר (אמיתי)" : "יחובר בגרסת השרת"}><span className="d" />{c.n}</span>
          ))}
          <DemoTag />
        </div>
        <div className="adk-chat-body" ref={boxRef}>
          {msgs.map((m, i) => (
            <div key={i} className={"adk-msg " + m.by}>
              {m.by === "twin" && <div className="adk-chat-av sm"><Icon name="spark" size={13} /></div>}
              <div className="adk-bubble">{m.text.split("\n").map((l, k) => <div key={k}>{l}</div>)}</div>
            </div>
          ))}
          {typing && <div className="adk-msg twin"><div className="adk-chat-av sm"><Icon name="spark" size={13} /></div><div className="adk-bubble typing"><span /><span /><span /></div></div>}
        </div>
        <div className="adk-chat-sugg">{suggestions.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}</div>
        <div className="adk-chat-input">
          <button className="adk-attach" onClick={attachDemo} title="העלה קובץ (הדגמה)"><Icon name="plus" size={18} /></button>
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder="שאל את הכפיל…" />
          <button className="adk-cmt-send" onClick={() => send()} title="שלח"><Icon name="arrowUp" size={17} /></button>
        </div>
        <div className="adk-chat-wa"><Icon name="comment" size={12} /> השיחה מסונכרנת עם וואטסאפ <DemoTag /></div>
      </div>
    </>
  );
}

function CalendarPanel({ clients, cards, now, onClose, onOpen }) {
  const base = new Date();
  const [view, setView] = useState("month");
  const [vy, setVy] = useState(base.getFullYear());
  const [vm, setVm] = useState(base.getMonth());
  const [weekAnchor, setWeekAnchor] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [hidden, setHidden] = useState(() => new Set());
  const [showDemo, setShowDemo] = useState(true);
  const pad = (n) => String(n).padStart(2, "0");
  const mk = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const dstr = (dt) => mk(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const first = new Date(vy, vm, 1).getDay();
  const dim = new Date(vy, vm + 1, 0).getDate();
  const today = todayStr();
  const colorOf = (cid) => clients.find((c) => c.id === cid)?.color || "var(--muted)";
  const nameOf = (cid) => clients.find((c) => c.id === cid)?.name || "";
  const visible = (c) => !hidden.has(c.clientId);
  const toggleClient = (id) => setHidden((h) => { const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // real tasks by concrete deadline day (skip day-flexible + archived + hidden clients)
  const tasksByDay = {};
  Object.values(cards).forEach((c) => { if (c.archived || flexDay(c) || !c.deadline || !visible(c)) return; (tasksByDay[c.deadline] = tasksByDay[c.deadline] || []).push(c); });
  Object.values(tasksByDay).forEach((arr) => arr.sort((a, b) => (a.time || "99").localeCompare(b.time || "99")));
  const off = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dstr(d); };
  const demoEventsAll = { [off(1)]: [{ t: "פגישת צוות · Google", time: "10:00" }], [off(2)]: [{ t: "בדיקת רופא · מייל", time: "16:30" }], [off(5)]: [{ t: "דדליין ספק · מייל" }] };
  const demoEvents = showDemo ? demoEventsAll : {};

  function prevM() { if (vm === 0) { setVm(11); setVy(vy - 1); } else setVm(vm - 1); }
  function nextM() { if (vm === 11) { setVm(0); setVy(vy + 1); } else setVm(vm + 1); }
  function goThisMonth() { setVy(base.getFullYear()); setVm(base.getMonth()); }
  function shiftWeek(n) { setWeekAnchor((d) => { const x = new Date(d); x.setDate(x.getDate() + n * 7); return x; }); }
  function goThisWeek() { const d = new Date(); d.setHours(0, 0, 0, 0); setWeekAnchor(d); }

  // week days (Sunday-based)
  const ws = new Date(weekAnchor); ws.setDate(ws.getDate() - ws.getDay());
  const weekDays = Array.from({ length: 7 }).map((_, i) => { const d = new Date(ws); d.setDate(ws.getDate() + i); return d; });
  const HOURS = Array.from({ length: 14 }).map((_, i) => i + 7); // 7..20
  const hourH = 46;
  const nowD = new Date(now);
  const nowMin = nowD.getHours() * 60 + nowD.getMinutes();
  const parseHM = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? (+m[1]) * 60 + (+m[2]) : null; };

  const td = new Date();
  const todayItems = [
    ...(tasksByDay[today] || []).map((c) => ({ kind: "task", time: c.time || "", title: c.title || "משימה", card: c })),
    ...(demoEvents[today] || []).map((e) => ({ kind: "demo", time: e.time || "", title: e.t })),
  ].sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));

  const weekTitle = (() => { const a = weekDays[0], b = weekDays[6]; return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${HE_MONTHS[a.getMonth()]}` : `${a.getDate()} ${HE_MONTHS[a.getMonth()]} – ${b.getDate()} ${HE_MONTHS[b.getMonth()]}`; })();

  return (
    <div className="adk-page">
      <div className="adk-cal-layout">
        <div className="adk-pcard cal">
          <div className="adk-pcard-head">
            <button className="adk-back" onClick={onClose} title="חזרה"><Icon name="arrowR" size={24} /></button>
            <div className="titleblk">
              <div><h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>יומן <DemoTag text="סנכרון בהדגמה" /></h2><span>{view === "month" ? `${HE_MONTHS[vm]} ${vy}` : weekTitle}</span></div>
            </div>
            <div className="sp" />
            <div className="adk-cal-seg">
              <button className={view === "month" ? "on" : ""} onClick={() => setView("month")}>חודש</button>
              <button className={view === "week" ? "on" : ""} onClick={() => setView("week")}>שבוע</button>
            </div>
            <div className="adk-cal-nav">
              <button onClick={() => (view === "month" ? nextM() : shiftWeek(1))} title="הבא">‹</button>
              <button className="mid" onClick={() => (view === "month" ? goThisMonth() : goThisWeek())}>{view === "month" ? HE_MONTHS[vm] : "השבוע"}</button>
              <button onClick={() => (view === "month" ? prevM() : shiftWeek(-1))} title="הקודם">›</button>
            </div>
          </div>

          <div className="adk-cal-main">
          {view === "month" ? (
            <div className="adk-cal g">
              <div className="adk-cal-wd">{HE_WD.map((w) => <div key={w}>{w}</div>)}</div>
              <div className="adk-cal-grid g">
                {Array.from({ length: first }).map((_, i) => <div className="adk-cal-cell blank" key={"b" + i} />)}
                {Array.from({ length: dim }).map((_, i) => {
                  const d = i + 1; const ds = mk(vy, vm, d);
                  const tasks = tasksByDay[ds] || []; const evs = demoEvents[ds] || [];
                  const items = [...tasks.map((c) => ({ kind: "task", c })), ...evs.map((e) => ({ kind: "demo", e }))];
                  return (
                    <div className={"adk-cal-cell g" + (ds === today ? " today" : "")} key={d}>
                      <div className={"adk-cal-num g" + (ds === today ? " today" : "")}>{d}</div>
                      <div className="adk-cal-items g">
                        {items.slice(0, 4).map((it, k) => it.kind === "task"
                          ? <div className="adk-cal-row" key={k} onClick={() => onOpen(it.c.id)} title={`${it.c.title || "משימה"} · ${nameOf(it.c.clientId)}`}><span className="dot" style={{ background: colorOf(it.c.clientId) }} />{it.c.time && <b>{it.c.time} </b>}<span className="tx">{it.c.title || "משימה"}</span></div>
                          : <div className="adk-cal-row demo" key={k} title="אירוע מסונכרן (הדגמה)"><span className="dot" style={{ background: "#C9821A" }} />{it.e.time && <b>{it.e.time} </b>}<span className="tx">{it.e.t}</span></div>
                        )}
                        {items.length > 4 && <div className="adk-cal-more">{items.length - 4}+ נוספים</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="adk-wk">
              <div className="adk-wk-grid adk-wk-head">
                <div className="adk-wk-gut" />
                {weekDays.map((d, i) => <div key={i} className={"adk-wk-dh" + (dstr(d) === today ? " today" : "")}><span>{HE_WD[d.getDay()]}</span><b>{d.getDate()}</b></div>)}
              </div>
              <div className="adk-wk-grid adk-wk-allday">
                <div className="adk-wk-gut">כל היום</div>
                {weekDays.map((d, i) => {
                  const ds = dstr(d);
                  const ad = [...(tasksByDay[ds] || []).filter((c) => !parseHM(c.time)).map((c) => ({ kind: "task", c })), ...(demoEvents[ds] || []).filter((e) => !parseHM(e.time)).map((e) => ({ kind: "demo", e }))];
                  return <div key={i} className="adk-wk-adcol">{ad.map((it, k) => it.kind === "task"
                    ? <div className="adk-wk-chip" key={k} onClick={() => onOpen(it.c.id)} style={{ background: colorOf(it.c.clientId) + "22", borderInlineStart: `3px solid ${colorOf(it.c.clientId)}`, color: "var(--ink)" }}>{it.c.title || "משימה"}</div>
                    : <div className="adk-wk-chip demo" key={k}>{it.e.t}</div>)}</div>;
                })}
              </div>
              <div className="adk-wk-scroll">
                <div className="adk-wk-grid adk-wk-body" style={{ height: HOURS.length * hourH }}>
                  <div className="adk-wk-gut-col">{HOURS.map((h) => <div key={h} className="adk-wk-hr" style={{ height: hourH }}><span>{pad(h)}:00</span></div>)}</div>
                  {weekDays.map((d, i) => {
                    const ds = dstr(d); const isToday = ds === today;
                    const timed = (tasksByDay[ds] || []).filter((c) => parseHM(c.time) != null);
                    const dEv = (demoEvents[ds] || []).filter((e) => parseHM(e.time) != null);
                    return (
                      <div key={i} className="adk-wk-daycol">
                        {HOURS.map((h) => <div key={h} className="adk-wk-slot" style={{ height: hourH }} />)}
                        {timed.map((c) => { const mn = parseHM(c.time); const top = ((mn - 7 * 60) / 60) * hourH; const cl = colorOf(c.clientId); return top < 0 || top > HOURS.length * hourH ? null : (
                          <div key={c.id} className="adk-wk-ev" style={{ top, height: hourH - 6, background: cl + "22", borderInlineStart: `3px solid ${cl}`, color: "var(--ink)" }} onClick={() => onOpen(c.id)} title={`${c.title} · ${nameOf(c.clientId)}`}>
                            <b style={{ color: cl }}>{c.time}</b> {c.title || "משימה"}
                          </div>
                        ); })}
                        {dEv.map((e, k) => { const mn = parseHM(e.time); const top = ((mn - 7 * 60) / 60) * hourH; return top < 0 || top > HOURS.length * hourH ? null : (
                          <div key={"d" + k} className="adk-wk-ev demo" style={{ top, height: hourH - 6 }} title="אירוע מסונכרן (הדגמה)"><b>{e.time}</b> {e.t}</div>
                        ); })}
                        {isToday && nowMin >= 7 * 60 && nowMin <= 20 * 60 && <div className="adk-wk-now" style={{ top: ((nowMin - 7 * 60) / 60) * hourH }} />}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          </div>
        </div>

        <div className="adk-cal-side out">
          <div className="adk-cal-filter">
            <div className="adk-cal-side-t">לקוחות</div>
            {clients.map((c) => (
              <label key={c.id} className="adk-cal-chk">
                <input type="checkbox" checked={!hidden.has(c.id)} onChange={() => toggleClient(c.id)} style={{ accentColor: c.color }} />
                <span className="sw" style={{ background: c.color }} />{c.name}
              </label>
            ))}
            <div className="adk-cal-side-t" style={{ marginTop: 14 }}>מקורות</div>
            <label className="adk-cal-chk">
              <input type="checkbox" checked={showDemo} onChange={() => setShowDemo((v) => !v)} style={{ accentColor: "#C9821A" }} />
              <span className="sw" style={{ background: "#C9821A" }} />יומן/מייל <DemoTag />
            </label>
          </div>

          {view === "month" && (
            <div className="adk-cal-today">
              <div className="adk-cal-today-head">
                <div className="dnum">{td.getDate()}</div>
                <div><div className="dl">{["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"][td.getDay()]}</div><div className="ds">{HE_MONTHS[td.getMonth()]}</div></div>
              </div>
              <div className="adk-cal-agenda">
                {todayItems.length === 0 && <div className="adk-cal-empty">אין משימות להיום ✦</div>}
                {todayItems.map((it, k) => (
                  <div className={"adk-agenda-row" + (it.kind === "demo" ? " demo" : "")} key={k} onClick={it.card ? () => onOpen(it.card.id) : undefined}>
                    <div className="tm">{it.time || "—"}</div>
                    <div className="bar" style={{ background: it.kind === "task" ? colorOf(it.card.clientId) : "#C9821A" }} />
                    <div className="ttl">{it.title}{it.kind === "task" && <span className="cl">{nameOf(it.card.clientId)}</span>}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({ profile, onClose, onSetName, onSetPhoto, onSetAssistant, onSetPref }) {
  const photoRef = useRef();
  const timeRound = (profile.settings && profile.settings.timeRound) || "ceil_hour";
  async function onPhoto(e) { const f = e.target.files?.[0]; if (!f) return; try { const d = await resizeImage(f, 256, "image/jpeg", 0.8); onSetPhoto(d); } catch {} }
  return (
    <div className="adk-page">
      <div className="adk-pcard">
        <div className="adk-pcard-head">
          <button className="adk-back" onClick={onClose} title="חזרה"><Icon name="arrowR" size={22} /></button>
          <div className="titleblk"><div><h2>הגדרות</h2><span>פרופיל · העוזר · העדפות</span></div></div>
          <div className="sp" />
        </div>

        <div className="adk-pcard-foot">
          <p className="adk-block-title">פרופיל</p>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <input ref={photoRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPhoto} />
            <button className="adk-self" style={{ width: 56, height: 56, border: "2px solid var(--border)", background: nameColor(profile.name || "אני") }} onClick={() => photoRef.current.click()} title="החלף תמונה">
              {profile.photo ? <img src={profile.photo} alt="" /> : <span style={{ fontSize: 17 }}>{profile.name ? initials(profile.name) : "אני"}</span>}
            </button>
            <div className="adk-field" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
              <label>שם מלא</label>
              <input className="adk-input" value={profile.name} onChange={(e) => onSetName(e.target.value)} placeholder="השם שלך" />
            </div>
          </div>
        </div>

        <div className="adk-pcard-foot">
          <p className="adk-block-title"><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="spark" size={15} /> העוזר הדיגיטלי · הרשאות</span></p>
          <div className="adk-asst-set">
            {[["cards", "משימות", "יצירה ועריכה של כרטיסים"], ["calendar", "יומן", "אירועים וטיוטות תזמון"], ["outbound", "שליחה החוצה", "מיילים/הודעות בשמך"]].map(([k, label, desc]) => {
              const val = (profile.assistant && profile.assistant[k]) || "suggest";
              const opts = k === "outbound" ? [["suggest", "מציע"]] : [["suggest", "מציע"], ["draft", "טיוטה"], ["act", "פועל"]];
              return (
                <div className="adk-asst-row" key={k}>
                  <div className="adk-asst-info"><b>{label}</b><span>{desc}</span></div>
                  <div className="adk-asst-seg">
                    {opts.map(([v, l]) => (
                      <button key={v} className={"lvl " + v + (val === v ? " on" : "")} onClick={() => onSetAssistant(k, v)}><span className="dot" />{l}</button>
                    ))}
                    {k === "outbound" && <span className="adk-asst-lock">נעול · לעולם לא אוטומטי</span>}
                  </div>
                </div>
              );
            })}
            <div className="adk-asst-legend"><span><span className="d s" />מציע: מראה ולא נוגע</span><span><span className="d d" />טיוטה: יוצר וממתין לאישור</span><span><span className="d a" />פועל: מבצע ישירות (הפיך)</span></div>
          </div>
        </div>

        <div className="adk-pcard-foot">
          <p className="adk-block-title">העדפות</p>
          <div className="adk-asst-row" style={{ borderBottom: "none" }}>
            <div className="adk-asst-info"><b>חישוב זמן</b><span>איך מוצג הזמן שנצבר על משימות</span></div>
            <div className="adk-asst-seg">
              {[["ceil_hour", "שעה שלמה"], ["decimal", "עשרוני"], ["exact", "מדויק"]].map(([v, l]) => (
                <button key={v} className={"lvl act" + (timeRound === v ? " on" : "")} onClick={() => onSetPref("timeRound", v)}><span className="dot" />{l}</button>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--faint)", fontWeight: 600 }}>עבודה נמדדת כערך, לא כדקות — לכן ברירת המחדל מעגלת כלפי מעלה לשעה שלמה.</div>
        </div>
      </div>
    </div>
  );
}

function PersonalDashboard({ clients, cards, cardColumn, now, profile, onClose, onSetPhoto, onSetName, onSetAssistant, onOpenClient }) {
  const photoRef = useRef();
  const seq = last12Months();
  const [period, setPeriod] = useState("12m");
  const inScope = (c) => period === "12m" ? seq.includes(ymOf(c.createdAt)) : ymOf(c.createdAt) === period;
  const per = clients.map((cl) => {
    const cs = Object.values(cards).filter((c) => c.clientId === cl.id && inScope(c));
    const sec = cs.reduce((a, c) => a + cardSeconds(c, now), 0);
    const rate = Number(cl.rate) || 0;
    return { cl, sec, count: cs.length, rate, revenue: (sec / 3600) * rate };
  }).filter((p) => p.sec > 0 || p.count > 0);
  const totalSec = per.reduce((a, p) => a + p.sec, 0);
  const totalRev = per.reduce((a, p) => a + p.revenue, 0);
  const byHours = [...per].sort((a, b) => b.sec - a.sec);
  const mostBusy = byHours[0];
  const mostProfit = [...per].filter((p) => p.rate > 0).sort((a, b) => b.revenue - a.revenue)[0];
  const denom = totalSec || 1;
  let acc = 0;
  const stops = byHours.map((p) => { const from = (acc / denom) * 360; acc += p.sec; const to = (acc / denom) * 360; return `${p.cl.color} ${from}deg ${to}deg`; }).join(", ");
  const monthly = seq.map((k) => ({ k, sec: Object.values(cards).filter((c) => ymOf(c.createdAt) === k).reduce((a, c) => a + cardSeconds(c, now), 0) }));
  const maxM = Math.max(1, ...monthly.map((m) => m.sec));
  const rangeLabel = period === "12m" ? `${ymLabel(seq[0])} – ${ymLabel(seq[11])}` : ymLabel(period);
  async function onPhoto(e) { const f = e.target.files?.[0]; if (!f) return; try { const d = await resizeImage(f, 256, "image/jpeg", 0.8); onSetPhoto(d); } catch {} }
  return (
    <div className="adk-page">
      <div className="adk-pcard">
        <div className="adk-pcard-head">
          <button className="adk-back" onClick={onClose} title="חזרה"><Icon name="arrowR" size={22} /></button>
          <div className="titleblk">
            <input ref={photoRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPhoto} />
            <button className="adk-self" style={{ width: 40, height: 40, border: "2px solid var(--border)", background: nameColor(profile.name || "אני") }} onClick={() => photoRef.current.click()} title="החלף תמונה">
              {profile.photo ? <img src={profile.photo} alt="" /> : <span>{profile.name ? initials(profile.name) : "אני"}</span>}
            </button>
            <div><h2>הדשבורד שלי</h2><span>{rangeLabel}</span></div>
          </div>
          <div className="sp" />
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="12m">12 חודשים אחרונים</option>
            {[...seq].reverse().map((m) => <option key={m} value={m}>{ymLabel(m)}</option>)}
          </select>
          <button className="btn" onClick={() => window.print()}><Icon name="printer" /> הדפסה</button>
        </div>

        <div className="adk-kpistrip">
          <div className="adk-kcell"><b>{fmtHours(totalSec)}<small>שע׳</small></b><span>שעות סה״כ</span></div>
          <div className="adk-kcell"><b>{per.length}</b><span>לקוחות פעילים</span></div>
          {totalRev > 0 && <div className="adk-kcell"><b>{fmtMoney(totalRev)}</b><span>הכנסה משוערת</span></div>}
          <div className="adk-kcell"><b style={{ fontSize: 20 }}>{mostBusy?.cl.name || "—"}</b><span>הכי הרבה עבודה</span></div>
        </div>

        <div className="adk-pcard-body">
          <div className="adk-panel-block">
            <p className="adk-block-title">חלוקת הזמן בין הלקוחות</p>
            {per.length === 0 ? <div className="adk-arch-empty">עדיין אין נתונים</div> : (
              <div style={{ display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap" }}>
                <div className="adk-donut" style={{ backgroundImage: `conic-gradient(${stops})` }} />
                <div className="adk-legend">
                  {byHours.map((p) => (
                    <div className="adk-leg" key={p.cl.id}>
                      <span className="sw" style={{ background: p.cl.color }} />
                      {p.cl.name}
                      <span className="pct">{Math.round((p.sec / denom) * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {mostProfit && (
              <div style={{ background: "var(--accent-soft)", border: "1px solid #bfe2e0", borderRadius: 12, padding: "12px 15px", marginTop: 20 }}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--accent-d)", textTransform: "uppercase", letterSpacing: ".05em" }}>הלקוח הכי רווחי</div>
                <div style={{ fontSize: 16, fontWeight: 800, marginTop: 3 }}>{mostProfit.cl.name} · {fmtMoney(mostProfit.revenue)} <span style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>({fmtHours(mostProfit.sec)}ש × ₪{mostProfit.rate})</span></div>
              </div>
            )}
          </div>
          <div className="adk-panel-block">
            <p className="adk-block-title">שעות עבודה לפי חודש (כל הלקוחות)</p>
            <div className="adk-barchart">
              {monthly.map((m) => (
                <div className="adk-bc-col" key={m.k} title={`${fmtHours(m.sec)} שעות`}>
                  <div className="adk-bc-track"><div className={"adk-bc-bar" + (period === m.k ? " hl" : "")} style={{ height: `${(m.sec / maxM) * 100}%` }} /></div>
                  <div className="adk-bc-x">{m.k.slice(5)}/{m.k.slice(2, 4)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="adk-pcard-foot">
          <p className="adk-block-title">לפי לקוח</p>
          <table className="adk-reptable">
            <thead><tr><th>לקוח</th><th>משימות</th><th>שעות</th><th>נתח</th><th>הכנסה</th></tr></thead>
            <tbody>
              {byHours.map((p) => (
                <tr key={p.cl.id} onClick={() => onOpenClient(p.cl.id)}>
                  <td>{p.cl.name}</td><td>{p.count}</td><td>{fmtHours(p.sec)}</td><td>{Math.round((p.sec / denom) * 100)}%</td><td>{p.rate > 0 ? fmtMoney(p.revenue) : "—"}</td>
                </tr>
              ))}
              {byHours.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--faint)", padding: 24 }}>אין נתונים בתקופה זו</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ArchivePanel({ items, client, now, onClose, onOpen, onRestore, onHardDelete }) {
  const [q, setQ] = useState("");
  const [giver, setGiver] = useState("all");
  const [pri, setPri] = useState("all");
  const [reason, setReason] = useState("all");
  const givers = Array.from(new Set(items.flatMap((c) => peopleOf(c)).filter(Boolean)));
  const filtered = items.filter((c) => {
    if (reason === "done" && c.reason !== "done") return false;
    if (reason === "removed" && !(c.reason === "deleted" || c.reason === "client")) return false;
    if (pri !== "all" && c.priority !== pri) return false;
    if (giver !== "all" && !peopleOf(c).includes(giver)) return false;
    if (q.trim()) { const t = (c.title + " " + (c.description || "") + " " + peopleOf(c).join(" ")).toLowerCase(); if (!t.includes(q.trim().toLowerCase())) return false; }
    return true;
  });
  const totalTime = filtered.reduce((a, c) => a + cardSeconds(c, now), 0);
  return (
    <div className="adk-arch">
      <div className="adk-arch-head">
        <Badge client={client} size={26} />
        <h2>ארכיון · {client?.name}</h2>
        <button className="adk-x" onClick={onClose}>×</button>
      </div>
      <div className="adk-arch-filters">
        <input className="adk-arch-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 חיפוש לפי שם, תיאור או נותן בריף…" />
        <div className="adk-fset">
          <select className="adk-fsel" value={giver} onChange={(e) => setGiver(e.target.value)}>
            <option value="all">כל הבריפים</option>
            {givers.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <span className="adk-fchip" style={{ cursor: "default", background: "transparent", border: "none", color: "var(--faint)" }}>חשיבות:</span>
          {[["all", "הכל"], ["critical", "קריטי"], ["important", "חשוב"], ["regular", "רגיל"]].map(([k, l]) => (
            <button key={k} className={"adk-fchip" + (pri === k ? " on" : "")} onClick={() => setPri(k)}>{l}</button>
          ))}
          <span className="adk-fchip" style={{ cursor: "default", background: "transparent", border: "none", color: "var(--faint)" }}>סטטוס:</span>
          {[["all", "הכל"], ["done", "הושלם"], ["removed", "הוסר"]].map(([k, l]) => (
            <button key={k} className={"adk-fchip" + (reason === k ? " on" : "")} onClick={() => setReason(k)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="adk-arch-sum">{filtered.length} משימות · סה״כ {fmtShort(totalTime)}</div>
      <div className="adk-arch-body">
        {filtered.length === 0 && <div className="adk-arch-empty">אין פריטים תואמים</div>}
        {filtered.map((c) => {
          const pr = PRIORITY[c.priority];
          return (
            <div className="adk-arow" key={c.id}>
              <div className="main" onClick={() => onOpen(c.id)}>
                <div className="t">{c.title || "ללא כותרת"}</div>
                <div className="m">
                  <span className={"adk-rbadge " + c.reason}>{c.reason === "done" ? "הושלם" : c.reason === "client" ? "הוסר ע״י הלקוח" : "נמחק"}</span>
                  {c.priority !== "regular" && <span className="adk-pri" style={{ background: pr.soft, color: pr.color }}>{pr.label}</span>}
                  {creatorOf(c) && <span className="adk-meta-s"><Avatar name={creatorOf(c)} size={16} /> {creatorOf(c)}</span>}
                  <span className="adk-meta-s">⏱ {fmtShort(cardSeconds(c, now))}</span>
                  <span className="adk-meta-s">📅 {fmtDate(c.when)}</span>
                </div>
              </div>
              <div className="acts">
                <button className="restore" title="שחזר ללוח" onClick={() => onRestore(c.id)}>↩</button>
                <button className="del" title="מחק לצמיתות" onClick={() => { if (confirm("למחוק לצמיתות? לא ניתן לשחזר.")) onHardDelete(c.id); }}>🗑</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ClientModal({ client, onClose, onSave, onDelete }) {
  const [f, setF] = useState(client || { id: uid("cl"), name: "", color: SWATCHES[0], contact: "", email: "", notes: "", rate: "", members: [], logo: null });
  const [memberInput, setMemberInput] = useState("");
  const members = f.members || [];
  function addMember() { const n = memberInput.trim(); if (!n || members.includes(n)) return; setF({ ...f, members: [...members, n] }); setMemberInput(""); }
  const fileRef = useRef();
  async function onLogo(e) { const file = e.target.files?.[0]; if (!file) return; try { const d = await resizeImage(file, 128, "image/png", 0.9); setF((p) => ({ ...p, logo: d })); } catch {} }
  return (
    <div className="adk-overlay" onClick={onClose}>
      <div className="adk-modal" onClick={(e) => e.stopPropagation()}>
        <div className="adk-modal-head"><Badge client={f} size={32} /><b style={{ fontSize: 16, flex: 1 }}>{client ? "עריכת לקוח" : "לקוח חדש"}</b><button className="adk-x" onClick={onClose}>×</button></div>
        <div className="adk-modal-body">
          <div className="adk-field"><label>שם הלקוח</label><input className="adk-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="שם החברה / הפרויקט" /></div>
          <div className="adk-field"><label>לוגו</label>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onLogo} />
            {f.logo ? <div className="adk-img-prev"><img src={f.logo} alt="" /><button onClick={() => setF({ ...f, logo: null })}>הסר</button></div> : <div className="adk-img-drop" onClick={() => fileRef.current.click()}>📎 העלה לוגו</div>}
          </div>
          <div className="adk-field"><label>צבע (כשאין לוגו)</label>
            <div style={{ display: "flex", gap: 8 }}>{SWATCHES.map((s) => <div key={s} onClick={() => setF({ ...f, color: s })} style={{ width: 28, height: 28, borderRadius: 8, background: s, cursor: "pointer", boxShadow: f.color === s ? "0 0 0 3px #fff, 0 0 0 5px " + s : "none" }} />)}</div>
          </div>
          <div className="adk-grid2">
            <div className="adk-field"><label>איש קשר</label><input className="adk-input" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} placeholder="שם" /></div>
            <div className="adk-field"><label>אימייל / טלפון</label><input className="adk-input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} dir="ltr" /></div>
          </div>
          <div className="adk-field"><label>תעריף שעתי (₪) — לחישוב רווחיות בדשבורד</label><input className="adk-input" type="number" min="0" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="למשל 250" /></div>
          <div className="adk-field"><label>הערות</label><textarea className="adk-textarea" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="פרטים, תעריף, דגשים…" /></div>
          <div className="adk-field"><label>אנשי הפרויקט / מוזמנים</label>
            {members.length > 0 && (
              <div className="adk-cc" style={{ marginBottom: 8 }}>
                {members.map((n) => (
                  <span className="adk-cc-chip" key={n}><Avatar name={n} size={18} /> {n} <button onClick={() => setF({ ...f, members: members.filter((x) => x !== n) })}>×</button></span>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <input className="adk-input" value={memberInput} onChange={(e) => setMemberInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMember(); } }} placeholder="שם — Enter להוספה" />
              <button className="adk-btn" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--ink)" }} onClick={addMember}>הוסף</button>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--faint)", fontWeight: 600, marginTop: 6 }}>אלה האנשים שיהיו זמינים כמכותבים ולהזמנה לפורטל.</div>
          </div>
        </div>
        <div className="adk-modal-foot" style={{ display: "flex", gap: 8, padding: "13px 18px", borderTop: "1px solid var(--border)", background: "var(--surface-2)" }}>
          {client && !client.home && <button className="adk-btn danger" onClick={() => { if (confirm("למחוק את הלקוח וכל המשימות שלו?")) onDelete(client.id); }}>מחק לקוח</button>}
          <button className="adk-btn primary" onClick={() => f.name.trim() && onSave(f)}>שמור</button>
        </div>
      </div>
    </div>
  );
}
