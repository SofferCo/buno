// buno — read-only detail panel for a Google Calendar event, opened from the
// calendar or My Day. Shows time, the inferred project, attendees (with
// response), the Meet link, and description. A one-click "prep task" files a
// draft under the inferred project — the bridge from schedule to board.
import { Icon } from "../ui/Icon";
import { Avatar } from "../ui/Avatar";

const RESP: Record<string, { t: string; c: string }> = {
  accepted: { t: "אישר", c: "var(--accent-d)" },
  declined: { t: "סירב", c: "var(--rec)" },
  tentative: { t: "אולי", c: "var(--muted)" },
  needsAction: { t: "טרם ענה", c: "var(--faint)" },
};

export function EventPanel({ ev, project, onClose, onPrepTask }: any) {
  const start = ev.start ? new Date(ev.start) : null;
  const end = ev.end ? new Date(ev.end) : null;
  const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const dateLabel = start ? start.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" }) : "";
  const timeLabel = ev.allDay ? "כל היום" : (start && end ? `${hhmm(start)}–${hhmm(end)}` : start ? hhmm(start) : "");
  return (
    <>
      <div className="adk-scrim" onClick={onClose} />
      <div className="adk-panel adk-eventpanel">
        <div className="adk-panel-head">
          <div className="adk-ev-badge"><Icon name="calendar" size={15} /> אירוע יומן</div>
          <div style={{ flex: 1 }} />
          <button className="adk-x" onClick={onClose}>×</button>
        </div>
        <div className="adk-panel-body">
          <h2 className="adk-ev-title">{ev.title}</h2>
          <div className="adk-ev-when">{dateLabel} · {timeLabel}{ev.recurring ? " · חוזר" : ""}</div>

          <div className="adk-ev-row">
            <span className="lbl">פרויקט</span>
            {project
              ? <span className="adk-ev-proj"><span className="dot" style={{ background: project.color }} />{project.name}</span>
              : <span className="adk-ev-proj none">לא זוהה — אפשר לשייך ידנית</span>}
          </div>

          {ev.meetLink && (
            <a className="adk-ev-join" href={ev.meetLink} target="_blank" rel="noreferrer"><Icon name="calendar" size={15} /> הצטרף ל‑Google Meet</a>
          )}
          {ev.location && !ev.meetLink && <div className="adk-ev-row"><span className="lbl">מיקום</span><span>{ev.location}</span></div>}

          {(ev.attendees || []).length > 0 && (
            <div className="adk-ev-attendees">
              <div className="adk-ev-sec">משתתפים</div>
              {ev.attendees.map((a: any, i: number) => {
                const r = RESP[a.status] || RESP.needsAction;
                return (
                  <div className="adk-ev-att" key={i}>
                    <Avatar name={a.name || a.email} size={24} />
                    <div className="who"><b>{a.name || a.email.split("@")[0]}{a.self ? " (אתה)" : ""}</b><span dir="ltr">{a.email}</span></div>
                    <span className="resp" style={{ color: r.c }}>{a.organizer ? "מארגן" : r.t}</span>
                  </div>
                );
              })}
            </div>
          )}

          {ev.description && (
            <div className="adk-ev-desc"><div className="adk-ev-sec">תיאור</div><div className="txt">{ev.description}</div></div>
          )}
        </div>
        {project && (
          <div className="adk-panel-foot">
            <button className="adk-btn primary" onClick={() => onPrepTask(ev, project)}>צור משימת הכנה תחת {project.name}</button>
          </div>
        )}
      </div>
    </>
  );
}
