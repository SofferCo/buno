import { useState } from "react";
import { Icon } from "../ui/Icon";
import { PRIORITY } from "../../lib/constants";
import { deadlineInfo, flexDay, routineKind } from "../../lib/date";
import { fmtClock, fmtModeHours } from "../../lib/format";
import { cardSeconds, sumHours } from "../../lib/time";

export function MyDay({ planTasks, upcoming, clients, now, runningCard, pending, profileName, events, roundMode = "ceil_hour", capacity = 6, onOpenEvent, onAsk, onClose, onOpenCard, onToggleTimer, onDone }: any) {
  const clientOf = (id) => clients.find((c) => c.id === id);
  const [q, setQ] = useState("");
  function ask() { const t = q.trim(); if (!t) return; onAsk(t); setQ(""); }
  const today = new Date();
  const dateLabel = today.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
  const pad = (n: number) => String(n).padStart(2, "0");
  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  // today's real Google Calendar events → timeline items
  const eventItems = ((events && events[todayKey]) || []).map((e: any, i: number) => ({ kind: "event", id: "ev" + i, time: e.time || "", title: e.t, location: e.location, ev: e.ev, projectId: e.projectId, raw: e }));
  // chronological: timed items by time, then untimed. Tasks + calendar events merged.
  const taskItems = planTasks.map((t: any) => ({ kind: "task", id: t.card.id, time: (t.card.time && !flexDay(t.card)) ? t.card.time : "", t }));
  const chrono = [...taskItems, ...eventItems].sort((a, b) => {
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
  if (planTasks.length === 0) headline = "שום דבר לא מחכה לך הבוקר.";
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

  // a calendar event row — opens the event panel; colored by inferred project
  const EventRow = ({ e }: any) => {
    const proj = e.projectId ? clientOf(e.projectId) : null;
    return (
      <div className="adk-tl-row adk-tl-event" onClick={() => onOpenEvent?.(e.raw || e)}>
        <div className={"adk-tl-time" + (e.time ? "" : " flex")}>{e.time || "כל היום"}</div>
        <div className="adk-tl-dot" style={{ background: proj?.color || "#C6613F" }} />
        <div className="adk-tl-body">
          <div className="ttl">{e.title}</div>
          <div className="meta"><span className="cname">{proj ? proj.name : "יומן"}{e.location ? ` · ${e.location}` : ""}</span></div>
        </div>
      </div>
    );
  };

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
              <div className="adk-brief2-tag"><span className="adk-brief2-av"><Icon name="spark" size={13} /></span> buno</div>
              <div className="adk-brief2-hl">{headline}</div>
              {briefLines.map((l, i) => <div key={i} className="adk-brief2-line">{l}</div>)}
              {runningCard && <div className="adk-brief2-now"><span className="rec-dot" /> טיימר פעיל · {runningCard.title || "משימה"} · {fmtClock(cardSeconds(runningCard, now))}</div>}
            </div>
            <div className="adk-day-ask">
              <button className="adk-attach" title="העלה קובץ (הדגמה)" onClick={() => onAsk("📎 קובץ")}><Icon name="plus" size={18} /></button>
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") ask(); }} placeholder="שאל את בונו על היום שלך…" />
              <button className="adk-cmt-send" onClick={ask} title="שלח"><Icon name="arrowUp" size={17} /></button>
            </div>
          </aside>

          <div className="adk-day2-tasks">
            {chrono.length === 0 && <div className="adk-day-empty">אין משימות או אירועים בתוכנית של היום.</div>}
            {chrono.length > 0 && <div className="adk-tl-head">סדר היום</div>}
            {chrono.map((x) => x.kind === "event" ? <EventRow key={x.id} e={x} /> : <TLRow key={x.id} t={x.t} />)}
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
