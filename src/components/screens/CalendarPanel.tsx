import { useState } from "react";
import { DemoTag } from "../ui/DemoTag";
import { Icon } from "../ui/Icon";
import { HE_MONTHS, HE_WD } from "../../lib/constants";
import { flexDay, todayStr } from "../../lib/date";

export function CalendarPanel({ clients, cards, now, onClose, onOpen, onOpenEvent, events }: any) {
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
  const tasksByDay: Record<string, any[]> = {};
  Object.values(cards).forEach((c: any) => { if (c.archived || flexDay(c) || !c.deadline || !visible(c)) return; (tasksByDay[c.deadline] = tasksByDay[c.deadline] || []).push(c); });
  Object.values(tasksByDay).forEach((arr) => arr.sort((a, b) => (a.time || "99").localeCompare(b.time || "99")));
  const off = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dstr(d); };
  // Real Google Calendar events (keyed by YYYY-MM-DD) take over once connected;
  // otherwise fall back to the labelled demo placeholders.
  const realEvents = events && Object.keys(events).length > 0;
  const eventsAreDemo = !realEvents;
  const demoEventsAll: Record<string, { t: string; time?: string }[]> = { [off(1)]: [{ t: "פגישת צוות · Google", time: "10:00" }], [off(2)]: [{ t: "בדיקת רופא · מייל", time: "16:30" }], [off(5)]: [{ t: "דדליין ספק · מייל" }] };
  const demoEvents = realEvents ? events : (showDemo ? demoEventsAll : {});

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
  const todayItems: any[] = [
    ...(tasksByDay[today] || []).map((c) => ({ kind: "task", time: c.time || "", title: c.title || "משימה", card: c })),
    ...(demoEvents[today] || []).map((e) => ({ kind: "demo", time: e.time || "", title: e.t, e })),
  ].sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));

  const weekTitle = (() => { const a = weekDays[0], b = weekDays[6]; return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${HE_MONTHS[a.getMonth()]}` : `${a.getDate()} ${HE_MONTHS[a.getMonth()]} – ${b.getDate()} ${HE_MONTHS[b.getMonth()]}`; })();

  return (
    <div className="adk-page">
      <div className="adk-cal-layout">
        <div className="adk-pcard cal">
          <div className="adk-pcard-head">
            <button className="adk-back" onClick={onClose} title="חזרה"><Icon name="arrowR" size={24} /></button>
            <div className="titleblk">
              <div><h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>יומן {eventsAreDemo ? <DemoTag text="סנכרון בהדגמה" /> : <span style={{ fontSize: 11, color: "var(--accent-d)", fontWeight: 700 }}>· Google</span>}</h2><span>{view === "month" ? `${HE_MONTHS[vm]} ${vy}` : weekTitle}</span></div>
            </div>
            <div className="sp" />
            <div className="adk-cal-seg">
              <button className={view === "month" ? "on" : ""} onClick={() => setView("month")}>חודש</button>
              <button className={view === "week" ? "on" : ""} onClick={() => setView("week")}>שבוע</button>
            </div>
            <div className="adk-cal-nav">
              {/* RTL: previous on the right (‹), next on the left (›) */}
              <button onClick={() => (view === "month" ? prevM() : shiftWeek(-1))} title="הקודם">‹</button>
              <button className="mid" onClick={() => (view === "month" ? goThisMonth() : goThisWeek())}>{view === "month" ? HE_MONTHS[vm] : "השבוע"}</button>
              <button onClick={() => (view === "month" ? nextM() : shiftWeek(1))} title="הבא">›</button>
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
                  const items: any[] = [...tasks.map((c) => ({ kind: "task", c })), ...evs.map((e) => ({ kind: "demo", e }))];
                  return (
                    <div className={"adk-cal-cell g" + (ds === today ? " today" : "")} key={d}>
                      <div className={"adk-cal-num g" + (ds === today ? " today" : "")}>{d}</div>
                      <div className="adk-cal-items g">
                        {items.slice(0, 4).map((it, k) => it.kind === "task"
                          ? <div className="adk-cal-row" key={k} onClick={() => onOpen(it.c.id)} title={`${it.c.title || "משימה"} · ${nameOf(it.c.clientId)}`}><span className="dot" style={{ background: colorOf(it.c.clientId) }} />{it.c.time && <b>{it.c.time} </b>}<span className="tx">{it.c.title || "משימה"}</span></div>
                          : <div className={"adk-cal-row demo" + (eventsAreDemo ? "" : " ev")} key={k} onClick={(e) => { if (!eventsAreDemo) { e.stopPropagation(); onOpenEvent?.(it.e); } }} title={(eventsAreDemo ? "אירוע (הדגמה)" : "אירוע מהיומן") + (it.e.location ? " · " + it.e.location : "")}><span className="dot" style={{ background: (it.e.projectId && colorOf(it.e.projectId)) || "#C9821A" }} />{it.e.time && <b>{it.e.time} </b>}<span className="tx">{it.e.t}</span></div>
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
                  const ad: any[] = [...(tasksByDay[ds] || []).filter((c) => !parseHM(c.time)).map((c) => ({ kind: "task", c })), ...(demoEvents[ds] || []).filter((e) => !parseHM(e.time)).map((e) => ({ kind: "demo", e }))];
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
                          <div key={"d" + k} className="adk-wk-ev demo" style={{ top, height: hourH - 6, cursor: eventsAreDemo ? "default" : "pointer", ...(e.projectId && colorOf(e.projectId) ? { background: colorOf(e.projectId) + "22", borderInlineStart: `3px solid ${colorOf(e.projectId)}` } : {}) }} onClick={() => { if (!eventsAreDemo) onOpenEvent?.(e); }} title={eventsAreDemo ? "אירוע מסונכרן (הדגמה)" : "אירוע מהיומן"}><b>{e.time}</b> {e.t}</div>
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
            {eventsAreDemo && (<>
              <div className="adk-cal-side-t" style={{ marginTop: 14 }}>מקורות</div>
              <label className="adk-cal-chk">
                <input type="checkbox" checked={showDemo} onChange={() => setShowDemo((v) => !v)} style={{ accentColor: "#C9821A" }} />
                <span className="sw" style={{ background: "#C9821A" }} />יומן/מייל <DemoTag />
              </label>
            </>)}
            {!eventsAreDemo && (<>
              <div className="adk-cal-side-t" style={{ marginTop: 14 }}>מקורות</div>
              <div className="adk-cal-chk" style={{ cursor: "default" }}><span className="sw" style={{ background: "#0E8F8C" }} />Google — יומן</div>
            </>)}
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
                  <div className={"adk-agenda-row" + (it.kind === "demo" ? " demo" : "")} key={k} onClick={it.card ? () => onOpen(it.card.id) : (!eventsAreDemo && it.e ? () => onOpenEvent?.(it.e) : undefined)}>
                    <div className="tm">{it.time || "—"}</div>
                    <div className="bar" style={{ background: it.kind === "task" ? colorOf(it.card.clientId) : ((it.e?.projectId && colorOf(it.e.projectId)) || "#C9821A") }} />
                    <div className="ttl">{it.title}{it.kind === "task" && <span className="cl">{nameOf(it.card.clientId)}</span>}{it.kind === "demo" && it.e?.projectId && <span className="cl">{nameOf(it.e.projectId)}</span>}</div>
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
