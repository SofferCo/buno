import { useRef, useEffect } from "react";
import { Icon } from "../ui/Icon";
import { PRIORITY } from "../../lib/constants";
import { deadlineInfo, flexDay, routineKind } from "../../lib/date";
import { fmtClock, fmtModeHours } from "../../lib/format";
import { cardSeconds, sumHours } from "../../lib/time";

export function MyDay({ planTasks, upcoming, completedToday = [], addedToday = [], clients, now, runningCard, pending, profileName, events, roundMode = "ceil_hour", capacity = 6, onOpenEvent, onClose, onOpenCard, onToggleTimer, onDone, onDefer }: any) {
  const clientOf = (id) => clients.find((c) => c.id === id);
  const nowRef = useRef<HTMLDivElement>(null);
  // the day opens centered on the "now" line — the timeline that fills up.
  useEffect(() => { nowRef.current?.scrollIntoView({ block: "center", behavior: "auto" }); }, []);
  const today = new Date();
  const dateLabel = today.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
  const timeLabel = new Date(now).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  const pad = (n: number) => String(n).padStart(2, "0");
  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  // today's real Google Calendar events → timeline items
  const eventItems = ((events && events[todayKey]) || []).map((e: any, i: number) => ({ kind: "event", id: "ev" + i, time: e.time || "", title: e.t, location: e.location, ev: e.ev, projectId: e.projectId, raw: e }));
  // overdue tasks are pulled out to their own top section ("חצו את הזמן"), not
  // scattered through the chronological order.
  const overdueTasks = planTasks.filter((t: any) => deadlineInfo(t.card.deadline)?.tone === "over");
  const planRest = planTasks.filter((t: any) => deadlineInfo(t.card.deadline)?.tone !== "over");
  // chronological: timed items by time, then untimed. Tasks + calendar events merged.
  const taskItems = planRest.map((t: any) => ({ kind: "task", id: t.card.id, time: (t.card.time && !flexDay(t.card)) ? t.card.time : "", t }));
  // tasks completed today become dimmed "done" items on the timeline, placed at
  // their completion time (so they sit above the now-line — the day that filled up).
  const fmtHM = (ms: number) => { try { return new Date(ms).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
  const doneItems = completedToday.map((d: any) => ({ kind: "done", id: "done-" + d.card.id, time: fmtHM(d.at), t: d }));
  const chrono = [...taskItems, ...eventItems, ...doneItems].sort((a, b) => {
    const ta = a.time || "", tb = b.time || "";
    if (ta && tb) return ta.localeCompare(tb);
    if (ta) return -1; if (tb) return 1; return 0;
  });
  const overdue = planTasks.filter((t) => deadlineInfo(t.card.deadline)?.tone === "over").length;
  const firstTimed = chrono.find((x) => x.time);
  const top = planTasks[0]?.card;

  // brief — voice: observe & hand over. no command / scold / apology / padding / emoji.
  const dayClass = planTasks.length >= 5 ? "יום עמוס" : planTasks.length <= 1 ? "יום פתוח" : "יום רגיל";
  let headline;
  if (planTasks.length === 0) headline = completedToday.length ? <>יופי — כבר סגרת היום <span className="clay">{completedToday.length === 1 ? "משימה אחת" : `${completedToday.length} משימות`}</span>.</> : "שום דבר לא מחכה לך הבוקר.";
  else if (overdue > 0) headline = `${overdue === 1 ? "משימה אחת חצתה" : `${overdue} משימות חצו`} את הזמן שנקבע.`;
  else if (top) headline = <>היום נשען על <span className="clay">"{top.title || "משימה"}"</span>.</>;
  else headline = `${dayClass}, ${planTasks.length} על השולחן.`;
  const briefLines = [];
  if (firstTimed) {
    if (firstTimed.kind === "event") briefLines.push(`הראשון בתור: ${firstTimed.title} ב־${firstTimed.time} (יומן).`);
    else { const cn = clientOf(firstTimed.t.card.clientId)?.name; briefLines.push(`הראשון בתור: "${firstTimed.t.card.title || "משימה"}" ב־${firstTimed.time}${cn ? ` · ${cn}` : ""}.`); }
  }
  if (pending?.requests) briefLines.push(`${pending.requests === 1 ? "בקשת תזמון אחת" : `${pending.requests} בקשות תזמון`} בתיבה.`);
  if (pending?.drafts) briefLines.push(`${pending.drafts === 1 ? "טיוטה אחת" : `${pending.drafts} טיוטות`} מבונו ממתינות למבט.`);
  // הרא האצ'י בו (P1.7): מעל 80% מהקיבולת היומית — לציין שהיום צפוף (אותה בדיקה כמו ב־sweep)
  const planHours = sumHours(planTasks.map((t: any) => t.card), now, roundMode);
  if (capacity && planHours > 0.8 * capacity) briefLines.push(`היום מתוכנן ל־${fmtModeHours(planHours, roundMode)} שעות מתוך ${capacity} — צפוף. יש משהו שיכול לחכות למחר?`);
  // (ב) the day's win leads the brief — "סגרת היום X".
  if (completedToday.length) briefLines.unshift(`✓ סגרת היום ${completedToday.length === 1 ? "משימה אחת" : `${completedToday.length} משימות`}.`);

  // a calendar event row — opens the event panel; colored by inferred project
  const EventRow = ({ e, dim }: any) => {
    const proj = e.projectId ? clientOf(e.projectId) : null;
    return (
      <div className="adk-tl-row adk-tl-event" style={dim ? { opacity: 0.5 } : undefined} onClick={() => onOpenEvent?.(e.raw || e)}>
        <div className={"adk-tl-time" + (e.time ? "" : " flex")}>{e.time || "כל היום"}</div>
        <div className="adk-tl-dot" style={{ background: proj?.color || "#C6613F" }} />
        <div className="adk-tl-body">
          <div className="ttl">{e.title}</div>
          <div className="meta"><span className="cname">{proj ? proj.name : "יומן"}{e.location ? ` · ${e.location}` : ""}</span></div>
        </div>
      </div>
    );
  };

  const TLRow = ({ t, dim }: any) => {
    const c = t.card, cl = clientOf(c.clientId), pri = PRIORITY[c.priority], dl = deadlineInfo(c.deadline), isRun = !!c.timerStart, timed = !!c.time && !flexDay(c);
    return (
      <div className="adk-tl-row" style={dim ? { opacity: 0.5 } : undefined} onClick={() => onOpenCard(c.id)}>
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
        <div className="adk-tl-actions">
          {onDone && <button className="qa done" title="בוצע" onClick={(e) => { e.stopPropagation(); onDone(c.id); }}>✓</button>}
          {onDefer && <button className="qa" title="דחה למחר" onClick={(e) => { e.stopPropagation(); onDefer(c.id); }}>→מחר</button>}
          <button className={"adk-mini-timer" + (isRun ? " on" : "")} onClick={(e) => { e.stopPropagation(); onToggleTimer(c.id); }}>{isRun ? "■" : "▶"}</button>
        </div>
      </div>
    );
  };

  // a dimmed, checked row for something completed today — the day filling up.
  const DoneRow = ({ d, time }: any) => {
    const c = d.card, cl = clientOf(c.clientId);
    return (
      <div className="adk-tl-row" style={{ opacity: 0.55 }} onClick={() => onOpenCard(c.id)}>
        <div className="adk-tl-time">{time}</div>
        <div className="adk-tl-dot" style={{ background: cl?.color || "var(--muted)" }} />
        <div className="adk-tl-body">
          <div className="ttl" style={{ textDecoration: "line-through", textDecorationColor: "var(--faint)" }}><span style={{ color: "var(--accent, #0E8F8C)", textDecoration: "none" }}>✓ </span>{c.title || "ללא כותרת"}</div>
          <div className="meta"><span className="cname">{cl?.name}</span></div>
        </div>
      </div>
    );
  };

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
            {overdueTasks.length === 0 && chrono.length === 0 && addedToday.length === 0 && <div className="adk-day-empty">אין משימות או אירועים בתוכנית של היום.</div>}
            {overdueTasks.length > 0 && (<>
              <div className="adk-tl-head over">חצו את הזמן</div>
              {overdueTasks.map((t: any) => <TLRow key={t.card.id} t={t} />)}
            </>)}
            {chrono.length > 0 && <div className="adk-tl-head">סדר היום</div>}
            {(() => {
              // the timeline that fills up: done + already-passed items render dimmed
              // ABOVE the "now" line; what's left renders below in full colour. The
              // line is placed just before the first item still ahead of the clock.
              const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes();
              const parse = (t: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? (+m[1]) * 60 + (+m[2]) : null; };
              let placed = false;
              const out: any[] = [];
              for (const x of chrono) {
                const tmin = parse(x.time);
                if (!placed && tmin !== null && tmin > nowMin) { placed = true; out.push(<div key="nowline" ref={nowRef} className="adk-tl-now"><span className="lbl">עכשיו · {timeLabel}</span><span className="ln" /><span className="dot" /></div>); }
                const past = x.kind === "done" || (tmin !== null && tmin <= nowMin);
                out.push(x.kind === "done" ? <DoneRow key={x.id} d={x.t} time={x.time} /> : x.kind === "event" ? <EventRow key={x.id} e={x} dim={past} /> : <TLRow key={x.id} t={x.t} dim={past} />);
              }
              return out;
            })()}
            {addedToday.length > 0 && (<>
              <div className="adk-tl-head">נוספו היום</div>
              {addedToday.map((t: any) => <TLRow key={t.card.id} t={t} />)}
            </>)}
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
