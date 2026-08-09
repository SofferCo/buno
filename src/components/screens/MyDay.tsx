import { useRef, useEffect } from "react";
import { Icon } from "../ui/Icon";
import { PRIORITY } from "../../lib/constants";
import { deadlineInfo, flexDay, routineKind } from "../../lib/date";
import { fmtClock, fmtModeHours } from "../../lib/format";
import { cardSeconds, sumHours } from "../../lib/time";

// full-word lateness from the DEADLINE (never created_at, never "7ד"):
// days late if the deadline day is behind today, else "today but the hour passed".
function lateLabel(card: any, now: number): string {
  const dl = card?.deadline;
  const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  if (dl) {
    const days = Math.round((startOfDay(now) - startOfDay(Date.parse(dl + "T00:00:00"))) / 86400000);
    if (days >= 1) return `באיחור ${days === 1 ? "יום" : days === 2 ? "יומיים" : days + " ימים"}`;
  }
  // same-day, timed, hour passed
  if (card?.time && /^\d/.test(card.time)) {
    const [h, m] = card.time.split(":").map(Number);
    const evMs = (() => { const d = new Date(now); d.setHours(h, m || 0, 0, 0); return d.getTime(); })();
    const hrs = Math.floor((now - evMs) / 3600e3);
    if (hrs >= 1) return `באיחור ${hrs === 1 ? "שעה" : hrs === 2 ? "שעתיים" : hrs + " שעות"}`;
    return "באיחור";
  }
  return "באיחור";
}

export function MyDay({ planTasks, upcoming, completedToday = [], clients, now, runningCard, pending, events, roundMode = "ceil_hour", capacity = 6, onOpenEvent, onClose, onOpenCard, onToggleTimer, onDone, onDefer }: any) {
  const clientOf = (id: any) => clients.find((c: any) => c.id === id);
  const nowRef = useRef<HTMLDivElement>(null);
  useEffect(() => { nowRef.current?.scrollIntoView({ block: "center", behavior: "auto" }); }, []);
  const today = new Date();
  const dateLabel = today.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
  const timeLabel = new Date(now).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  const pad = (n: number) => String(n).padStart(2, "0");
  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const fmtHM = (ms: number) => { try { return new Date(ms).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };

  // today's calendar events → timeline items
  const eventItems = ((events && events[todayKey]) || []).map((e: any, i: number) => ({ kind: "event", id: "ev" + i, time: e.time || "", title: e.t, location: e.location, ev: e.ev, projectId: e.projectId, raw: e }));
  // split open tasks: overdue ("crossed the time") vs the rest of today.
  const overdueTasks = planTasks.filter((t: any) => deadlineInfo(t.card.deadline)?.tone === "over");
  const planRest = planTasks.filter((t: any) => deadlineInfo(t.card.deadline)?.tone !== "over");
  const taskItems = planRest.map((t: any) => ({ kind: "task", id: t.card.id, time: (t.card.time && !flexDay(t.card)) ? t.card.time : "", t }));
  // today's open items (tasks + events), chronological — the live "order of the day".
  const ahead = [...taskItems, ...eventItems].sort((a: any, b: any) => {
    const ta = a.time || "", tb = b.time || "";
    if (ta && tb) return ta.localeCompare(tb);
    if (ta) return -1; if (tb) return 1; return 0;
  });
  // completed today → the green "closed" block at the very top (chosen: above the now-line).
  const doneSorted = [...completedToday].sort((a: any, b: any) => (a.at || 0) - (b.at || 0));

  // next up = first OPEN item whose time is still ahead of the clock (never a past/done one).
  const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes();
  const parseMin = (t: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? (+m[1]) * 60 + (+m[2]) : null; };
  const firstUp = ahead.find((x: any) => { const p = parseMin(x.time); return p !== null && p >= nowMin; });

  // ---- brief (buno) — observe & hand over; celebrate progress; never scold ----
  const openCount = planTasks.length;
  const doneCount = completedToday.length;
  const byProj: Record<string, number> = {};
  planTasks.forEach((t: any) => { const id = t.card.clientId; if (id) byProj[id] = (byProj[id] || 0) + 1; });
  let domId: string | null = null, domN = 0;
  Object.entries(byProj).forEach(([id, n]) => { if (n > domN) { domN = n; domId = id; } });
  const domName = domId ? clientOf(domId)?.name : null;
  const top = planTasks[0]?.card;
  let headline: any;
  if (openCount === 0) headline = doneCount ? "סגרת את כל מה שתכננת." : "שום דבר לא מחכה לך היום.";
  else if (openCount >= 5) headline = `יום עמוס: ${openCount} משימות.`;
  else if (domName && domN >= Math.ceil(openCount / 2) && openCount >= 2) headline = <>היום נשען על <span className="clay">"{domName}"</span>.</>;
  else if (top) headline = <>היום נשען על <span className="clay">"{top.title || "משימה"}"</span>.</>;
  else headline = `${openCount} ${openCount === 1 ? "משימה" : "משימות"} על השולחן.`;

  const briefLines: any[] = [];
  if (doneCount) briefLines.push(`✓ סגרת היום ${doneCount === 1 ? "משימה אחת" : `${doneCount} משימות`}.`);
  if (firstUp) {
    if (firstUp.kind === "event") briefLines.push(`הראשון בתור: ${firstUp.title} ב־${firstUp.time} (יומן).`);
    else { const cn = clientOf(firstUp.t.card.clientId)?.name; briefLines.push(`הראשון בתור: "${firstUp.t.card.title || "משימה"}" ב־${firstUp.time}${cn ? ` · ${cn}` : ""}.`); }
  }
  if (pending?.requests) briefLines.push(`${pending.requests === 1 ? "בקשת תזמון אחת" : `${pending.requests} בקשות תזמון`} בתיבה.`);
  if (pending?.drafts) briefLines.push(`${pending.drafts === 1 ? "טיוטה אחת" : `${pending.drafts} טיוטות`} מבונו ממתינות למבט.`);
  const planHours = sumHours(planTasks.map((t: any) => t.card), now, roundMode);
  if (capacity && planHours > 0.8 * capacity) briefLines.push(`היום מתוכנן ל־${fmtModeHours(planHours, roundMode)} שעות מתוך ${capacity} — צפוף. יש משהו שיכול לחכות למחר?`);

  // ---- rows (each carries a rail node; the spine is a per-row ::before) --------
  const EventRow = ({ e }: any) => {
    const proj = e.projectId ? clientOf(e.projectId) : null;
    return (
      <div className="adk-tl-row" onClick={() => onOpenEvent?.(e.raw || e)}>
        <div className={"adk-tl-time" + (e.time ? "" : " flex")}>{e.time || "כל היום"}</div>
        <div className="adk-tl-rail"><span className="adk-tl-node" /></div>
        <div className="adk-tl-body">
          <div className="ttl">{e.title}</div>
          <div className="meta"><span className="bdot" style={{ background: proj?.color || "#C6613F" }} /><span className="cname">{proj ? proj.name : "יומן"}{e.location ? ` · ${e.location}` : ""}</span></div>
        </div>
      </div>
    );
  };

  const TLRow = ({ t }: any) => {
    const c = t.card, cl = clientOf(c.clientId), pri = PRIORITY[c.priority], over = deadlineInfo(c.deadline)?.tone === "over", isRun = !!c.timerStart, timed = !!c.time && !flexDay(c);
    return (
      <div className="adk-tl-row" onClick={() => onOpenCard(c.id)}>
        <div className={"adk-tl-time" + (timed ? "" : " flex")}>{timed ? c.time : "גמיש"}</div>
        <div className="adk-tl-rail"><span className={"adk-tl-node" + (over ? " over" : "")} /></div>
        <div className="adk-tl-body">
          <div className="ttl">{routineKind(c) !== "none" && "↻ "}{c.title || "ללא כותרת"}</div>
          <div className="meta">
            <span className="bdot" style={{ background: cl?.color || "var(--muted)" }} /><span className="cname">{cl?.name}</span>
            {c.priority !== "regular" && <span className="adk-pri" style={{ background: pri.soft, color: pri.color }}>{pri.label}</span>}
            {over && <span className="adk-dl over">{lateLabel(c, now)}</span>}
          </div>
        </div>
        <div className="adk-tl-actions">
          {onDone && <button className="qa done" title="בוצע" onClick={(e) => { e.stopPropagation(); onDone(c.id); }}>✓ בוצע</button>}
          {onDefer && <button className="qa" title="דחה למחר" onClick={(e) => { e.stopPropagation(); onDefer(c.id); }}>→ מחר</button>}
          <button className={"adk-mini-timer" + (isRun ? " on" : "")} onClick={(e) => { e.stopPropagation(); onToggleTimer(c.id); }}>{isRun ? "■" : "▶"}</button>
        </div>
      </div>
    );
  };

  // completed today — full-readable (no strike, no dim), green ✓ node on the rail.
  const DoneRow = ({ d }: any) => {
    const c = d.card, cl = clientOf(c.clientId);
    return (
      <div className="adk-tl-row done" onClick={() => onOpenCard(c.id)}>
        <div className="adk-tl-time">{fmtHM(d.at)}</div>
        <div className="adk-tl-rail"><span className="adk-tl-node done">✓</span></div>
        <div className="adk-tl-body">
          <div className="ttl">{c.title || "ללא כותרת"}</div>
          <div className="meta"><span className="bdot" style={{ background: cl?.color || "var(--muted)" }} /><span className="cname">{cl?.name}</span></div>
        </div>
      </div>
    );
  };

  const nothing = doneSorted.length === 0 && overdueTasks.length === 0 && ahead.length === 0 && upcoming.length === 0;

  return (
    <div className="adk-page">
      <div className="adk-pcard day">
        <div className="adk-pcard-head">
          <button className="adk-back" onClick={onClose} title="חזרה"><Icon name="arrowR" size={22} /></button>
          <div className="titleblk"><div className="adk-day-sun"><Icon name="sun" size={20} /></div><div><h2>היום שלי</h2><span>{dateLabel} · {timeLabel}</span></div></div>
        </div>

        <div className="adk-day2">
          <aside className="adk-day2-brief">
            <div className="adk-brief2-scroll">
              <div className="adk-brief2-tag"><span className="adk-brief2-av"><Icon name="sun" size={13} /></span> buno</div>
              <div className="adk-brief2-hl">{headline}</div>
              {briefLines.map((l, i) => <div key={i} className="adk-brief2-line">{l}</div>)}
              {runningCard && <div className="adk-brief2-now"><span className="rec-dot" /> טיימר פעיל · {runningCard.title || "משימה"} · {fmtClock(cardSeconds(runningCard, now))}</div>}
            </div>
          </aside>

          <div className="adk-day2-tasks">
            {nothing && <div className="adk-day-empty">אין משימות או אירועים בתוכנית של היום.</div>}

            {/* 1 — what closed today (green block, at the top) */}
            {doneSorted.length > 0 && (<>
              <div className="adk-tl-head done">נסגרו היום · {doneSorted.length}</div>
              <div className="adk-tl-donegroup">
                {doneSorted.map((d: any) => <DoneRow key={"done-" + d.card.id} d={d} />)}
              </div>
            </>)}

            {/* 2 — the now-line: a Marker mark that leaves the rail and stops (no full-width cross) */}
            {!nothing && (
              <div className="adk-tl-nowrow" ref={nowRef}>
                <div className="adk-tl-time" />
                <div className="adk-tl-rail"><span className="adk-tl-nownode" /></div>
                <div className="adk-tl-nowbody"><span className="ln" /><span className="lbl">עכשיו · {timeLabel}</span></div>
              </div>
            )}

            {/* 3 — what crossed the time (open, late), full-word tags */}
            {overdueTasks.length > 0 && (<>
              <div className="adk-tl-head over">חצו את הזמן</div>
              {overdueTasks.map((t: any) => <TLRow key={t.card.id} t={t} />)}
            </>)}

            {/* 4 — the rest of today, chronological */}
            {ahead.length > 0 && (<>
              <div className="adk-tl-head">סדר היום</div>
              {ahead.map((x: any) => x.kind === "event" ? <EventRow key={x.id} e={x} /> : <TLRow key={x.id} t={x.t} />)}
            </>)}

            {/* 5 — the look ahead */}
            {upcoming.length > 0 && (<>
              <div className="adk-tl-head up">בקרוב · 7 ימים</div>
              {upcoming.map((t: any) => <TLRow key={t.card.id} t={t} />)}
            </>)}
          </div>
        </div>
      </div>
    </div>
  );
}
