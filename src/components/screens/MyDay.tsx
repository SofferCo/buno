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

export function MyDay({ planTasks, upcoming, completedToday = [], clients, now, runningCard, pending, events, roundMode = "ceil_hour", capacity = 6, onOpenEvent, onClose, onOpenCard, onToggleTimer, onDone, onDefer, onReopen, linkedEventIds, ritualActive = false, ritualOrganizeDone = false, onRitualDone, onRitualReopen, onBriefOpen }: any) {
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
  // an event that's already been materialised into a linked card shows as that
  // card (a task), not twice — skip its raw calendar entry here.
  const eventItems = ((events && events[todayKey]) || [])
    .filter((e: any) => !(linkedEventIds && e.ev?.id && linkedEventIds.has(e.ev.id)))
    .map((e: any, i: number) => ({ kind: "event", id: "ev" + i, time: e.time || "", title: e.t, location: e.location, ev: e.ev, projectId: e.projectId, raw: e }));
  // "crossed the time" is only meaningful for items that HAVE a time — a flexible
  // task (no clock) can't be late, so it's never overdue and never tagged; it just
  // sinks to the bottom of the day (below).
  const isTimed = (c: any) => !!c.time && !flexDay(c);
  const isOverdue = (c: any) => isTimed(c) && deadlineInfo(c.deadline)?.tone === "over";
  const overdueTasks = planTasks.filter((t: any) => isOverdue(t.card));
  const planRest = planTasks.filter((t: any) => !isOverdue(t.card));
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
  // buno reads the CLOCK and the day so far, not just the counts. The same board at
  // 08:00 and at 23:00 deserves a different word: morning plans, evening winds down.
  const nowH = new Date(now).getHours();
  const morning = nowH < 12;
  const late = nowH >= 21;               // wind-down hours — celebrate, never pressure
  const productive = doneCount >= 4;     // a day that already went well
  let headline: any;
  if (openCount === 0) headline = doneCount ? "סגרת את כל מה שתכננת." : "שום דבר לא מחכה לך היום.";
  else if (late && productive) headline = "יום פורה. כל הכבוד.";
  else if (late) headline = "ערב — מחר יום חדש.";
  // lead with what the day is ABOUT (the dominant project / the top task), not an
  // alarmist raw count — "יום עמוס: 5 משימות" read as noise, not insight.
  else if (domName && domN >= Math.ceil(openCount / 2) && openCount >= 2) headline = <>היום נשען על <span className="clay">"{domName}"</span>.</>;
  else if (top) headline = <>היום נשען על <span className="clay">"{top.title || "משימה"}"</span>.</>;
  else headline = `${openCount} ${openCount === 1 ? "משימה" : "משימות"} על השולחן.`;

  const briefLines: any[] = [];
  if (doneCount) briefLines.push(`✓ סגרת היום ${doneCount === 1 ? "משימה אחת" : `${doneCount} משימות`}.`);
  // "next up" and draft-nudges belong to a day that's still ahead — not to the wind-down.
  if (!late && firstUp) {
    if (firstUp.kind === "event") briefLines.push(`הראשון בתור: ${firstUp.title} ב־${firstUp.time} (יומן).`);
    else { const cn = clientOf(firstUp.t.card.clientId)?.name; briefLines.push(`הראשון בתור: "${firstUp.t.card.title || "משימה"}" ב־${firstUp.time}${cn ? ` · ${cn}` : ""}.`); }
  }
  if (!late && pending?.requests) briefLines.push(`${pending.requests === 1 ? "בקשת תזמון אחת" : `${pending.requests} בקשות תזמון`} בתיבה.`);
  if (!late && pending?.drafts) briefLines.push(`${pending.drafts === 1 ? "טיוטה אחת" : `${pending.drafts} טיוטות`} מבונו ממתינות למבט.`);
  const planHours = sumHours(planTasks.map((t: any) => t.card), now, roundMode);
  // the "crowded — what can wait?" nudge is only actionable in the MORNING. It must
  // never fire in the evening, when the day is already behind you.
  if (morning && capacity && planHours > 0.8 * capacity) briefLines.push(`היום מתוכנן ל־${fmtModeHours(planHours, roundMode)} שעות מתוך ${capacity} — צפוף. יש משהו שיכול לחכות למחר?`);
  else if (late && openCount > 0 && productive) briefLines.push(`נשארו ${openCount === 1 ? "עוד דבר קטן אחד" : `${openCount} דברים קטנים`} — אם יש כוח; אחרת, ערב טוב.`);
  else if (late && openCount > 0) briefLines.push(`${openCount} עדיין פתוחות — בלי לחץ, מחר יום חדש.`);

  // ---- rows (each carries a rail node; the spine is a per-row ::before) --------
  const EventRow = ({ e }: any) => {
    const proj = e.projectId ? clientOf(e.projectId) : null;
    return (
      <div className="adk-tl-row" onClick={() => onOpenEvent?.(e.raw || e)}>
        <span className="adk-tl-rail"><span className="adk-tl-node" /></span>
        <div className={"adk-tl-time" + (e.time ? "" : " flex")}>{e.time || "כל היום"}</div>
        <div className="adk-tl-body">
          <div className="ttl">{e.title}</div>
          <div className="meta"><span className="bdot" style={{ background: proj?.color || "#C6613F" }} /><span className="cname">{proj ? proj.name : "יומן"}{e.location ? ` · ${e.location}` : ""}</span></div>
        </div>
      </div>
    );
  };

  const TLRow = ({ t }: any) => {
    const c = t.card, cl = clientOf(c.clientId), pri = PRIORITY[c.priority], over = isOverdue(c), isRun = !!c.timerStart, timed = isTimed(c);
    return (
      <div className="adk-tl-row" onClick={() => onOpenCard(c.id)}>
        <button className="adk-tl-rail" title="סמן כבוצע" onClick={(e) => { e.stopPropagation(); onDone?.(c.id); }}><span className={"adk-tl-node" + (over ? " over" : "")} /></button>
        <div className={"adk-tl-time" + (timed ? "" : " flex")}>{timed ? c.time : "גמיש"}</div>
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
        <button className="adk-tl-rail" title="החזר לפתוח" onClick={(e) => { e.stopPropagation(); onReopen?.(c.id); }}><span className="adk-tl-node done">✓</span></button>
        <div className="adk-tl-time">{fmtHM(d.at)}</div>
        <div className="adk-tl-body">
          <div className="ttl">{c.title || "ללא כותרת"}</div>
          <div className="meta"><span className="bdot" style={{ background: cl?.color || "var(--muted)" }} /><span className="cname">{cl?.name}</span></div>
        </div>
      </div>
    );
  };

  // ---- ritual rows (My-Day only, virtual): the morning-brief pair ------------
  // "בריף בוקר" is born already-done — an endowed-progress win for showing up.
  // "לסדר את משימות היום" stays in the user's hands: one tap on the rail node.
  // the brief card IS the chat brief — clicking it opens the brief in the chat.
  const BriefRitualRow = () => (
    <div className="adk-tl-row done ritual" title="פתח את הבריף בצ'אט" onClick={() => onBriefOpen?.()} style={{ cursor: "pointer" }}>
      <span className="adk-tl-rail"><span className="adk-tl-node done">✓</span></span>
      <div className="adk-tl-time flex">בוקר</div>
      <div className="adk-tl-body">
        <div className="ttl">בריף בוקר</div>
        <div className="meta"><span className="bdot" style={{ background: "var(--marker)" }} /><span className="cname">ריטואל · buno</span></div>
      </div>
      <div className="adk-tl-actions"><span className="qa" style={{ display: "inline-flex" }}>פתח בריף →</span></div>
    </div>
  );
  const OrganizeDoneRow = () => (
    <div className="adk-tl-row done ritual">
      <button className="adk-tl-rail" title="החזר לפתוח" onClick={(e) => { e.stopPropagation(); onRitualReopen?.(); }}><span className="adk-tl-node done">✓</span></button>
      <div className="adk-tl-time flex">ריטואל</div>
      <div className="adk-tl-body">
        <div className="ttl">לסדר את משימות היום</div>
        <div className="meta"><span className="bdot" style={{ background: "var(--marker)" }} /><span className="cname">ריטואל יומי</span></div>
      </div>
    </div>
  );
  const OrganizeOpenRow = () => (
    <div className="adk-tl-row ritual">
      <button className="adk-tl-rail" title="סמן כבוצע" onClick={(e) => { e.stopPropagation(); onRitualDone?.(); }}><span className="adk-tl-node" /></button>
      <div className="adk-tl-time flex">ריטואל</div>
      <div className="adk-tl-body">
        <div className="ttl">לסדר את משימות היום</div>
        <div className="meta"><span className="bdot" style={{ background: "var(--marker)" }} /><span className="cname">ריטואל יומי · בשליטתך</span></div>
      </div>
      <div className="adk-tl-actions"><button className="qa done" title="בוצע" onClick={(e) => { e.stopPropagation(); onRitualDone?.(); }}>✓ בוצע</button></div>
    </div>
  );

  const NowRow = () => (
    <div className="adk-tl-nowrow" ref={nowRef} title={`עכשיו · ${timeLabel}`}>
      <span className="adk-tl-rail"><span className="adk-tl-node now" /></span>
      <span className="adk-tl-nowline" />
      <span className="adk-tl-nowlbl">עכשיו · {timeLabel}</span>
    </div>
  );
  // the ahead list carries the now-mark at its chronological spot (before the first
  // item still ahead of the clock; at the end if everything today already passed).
  const aheadRows: any[] = [];
  let nowPlaced = false;
  for (const x of ahead) {
    const p = parseMin(x.time);
    // the now-mark sits above everything still ahead — a future-timed item OR a
    // flexible (no-time) one; only a timed item whose hour already passed stays above it.
    if (!nowPlaced && (p === null || p >= nowMin)) { nowPlaced = true; aheadRows.push(<NowRow key="now" />); }
    aheadRows.push(x.kind === "event" ? <EventRow key={x.id} e={x} /> : <TLRow key={x.id} t={x.t} />);
  }
  if (!nowPlaced) aheadRows.push(<NowRow key="now" />);

  // ritual rows count as "closed today" (brief always; organize when done)
  const ritualClosedCount = ritualActive ? (1 + (ritualOrganizeDone ? 1 : 0)) : 0;
  const ritualOpen = ritualActive && !ritualOrganizeDone;
  const hasToday = doneSorted.length > 0 || ritualActive || overdueTasks.length > 0 || ahead.length > 0;
  const nothing = !hasToday && upcoming.length === 0;

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

            {!nothing && (
              <div className="adk-tl">
                <span className="adk-tl-spine" />
                {/* 1 — DONE at the very top: everything above the now-line is handled.
                    The morning-brief ritual leads it — an endowed-progress head-start. */}
                {(doneSorted.length > 0 || ritualActive) && (<>
                  <div className="adk-tl-head">נסגרו היום · {doneSorted.length + ritualClosedCount}</div>
                  <div className="adk-tl-donegroup">
                    {ritualActive && <BriefRitualRow />}
                    {ritualActive && ritualOrganizeDone && <OrganizeDoneRow />}
                    {doneSorted.map((d: any) => <DoneRow key={"done-" + d.card.id} d={d} />)}
                  </div>
                </>)}
                {/* 2 — overdue: first among the actionable, but BELOW done */}
                {overdueTasks.length > 0 && (<>
                  <div className="adk-tl-head">חצו את הזמן</div>
                  {overdueTasks.map((t: any) => <TLRow key={t.card.id} t={t} />)}
                </>)}
                {/* 3 — the now-line, then the rest of today: timed first, flexible last.
                    The "organize the day" ritual leads the actionable list when still open. */}
                {(ahead.length > 0 || ritualOpen) && <div className="adk-tl-head">סדר היום</div>}
                {ritualOpen && <OrganizeOpenRow />}
                {aheadRows}
                {/* 4 — the look ahead */}
                {upcoming.length > 0 && (<>
                  {hasToday && <div className="adk-tl-div" />}
                  <div className="adk-tl-head">בקרוב · 7 ימים</div>
                  {upcoming.map((t: any) => <TLRow key={t.card.id} t={t} />)}
                </>)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
