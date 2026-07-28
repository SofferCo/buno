// buno — read-only detail panel for a Google Calendar event, opened from the
// calendar or My Day. Deep like the native event: Meet join, your RSVP,
// reminders, attendees (with optional/RSVP), dial-in, description, and a link
// back to Google Calendar. A one-click "prep task" files a draft under the
// inferred project — the bridge from schedule to board.
import { Icon } from "../ui/Icon";
import { Avatar } from "../ui/Avatar";

const RESP: Record<string, { t: string; c: string }> = {
  accepted: { t: "אישר", c: "var(--accent-d)" },
  declined: { t: "סירב", c: "var(--rec)" },
  tentative: { t: "אולי", c: "var(--muted)" },
  needsAction: { t: "טרם ענה", c: "var(--faint)" },
};
const MY_STATUS: Record<string, string> = { accepted: "אישרת הגעה", declined: "סירבת", tentative: "סימנת אולי", needsAction: "טרם ענית" };

function reminderText(r: any): string {
  if (r === "default") return "תזכורת ברירת מחדל של היומן";
  if (!Array.isArray(r) || !r.length) return "";
  const one = (m: number) => m % 60 === 0 ? `${m / 60} שע׳` : `${m} דק׳`;
  return r.map((x: any) => `${x.method === "email" ? "מייל" : "התראה"} ${one(x.minutes)} לפני`).join(" · ");
}

export function EventPanel({ ev, project, onClose, onPrepTask }: any) {
  const start = ev.start ? new Date(ev.start) : null;
  const end = ev.end ? new Date(ev.end) : null;
  const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const dateLabel = start ? start.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" }) : "";
  const timeLabel = ev.allDay ? "כל היום" : (start && end ? `${hhmm(start)}–${hhmm(end)}` : start ? hhmm(start) : "");
  const rem = reminderText(ev.reminders);
  return (
    <>
      <div className="adk-scrim" onClick={onClose} />
      <div className="adk-panel adk-eventpanel">
        <div className="adk-panel-head">
          <div className="adk-ev-badge"><Icon name="calendar" size={15} /> אירוע יומן</div>
          {ev.myStatus && <span className={"adk-ev-mystatus " + ev.myStatus}>{MY_STATUS[ev.myStatus] || ""}</span>}
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
          {rem && <div className="adk-ev-row"><span className="lbl">תזכורת</span><span>{rem}</span></div>}
          {(ev.phone || []).length > 0 && (
            <div className="adk-ev-row"><span className="lbl">חיוג</span>
              <span dir="ltr" style={{ display: "flex", flexDirection: "column", gap: 2 }}>{ev.phone.map((p: any, i: number) => <a key={i} href={p.uri} style={{ color: "var(--accent-d)", fontWeight: 700 }}>{p.label}</a>)}</span>
            </div>
          )}

          {(ev.attendees || []).length > 0 && (
            <div className="adk-ev-attendees">
              <div className="adk-ev-sec">משתתפים · {ev.attendees.length}</div>
              {ev.attendees.map((a: any, i: number) => {
                const r = RESP[a.status] || RESP.needsAction;
                return (
                  <div className="adk-ev-att" key={i}>
                    <Avatar name={a.name || a.email} size={24} />
                    <div className="who"><b>{a.name || a.email.split("@")[0]}{a.self ? " (אתה)" : ""}{a.optional ? " · אופציונלי" : ""}</b><span dir="ltr">{a.email}</span></div>
                    <span className="resp" style={{ color: r.c }}>{a.organizer ? "מארגן" : r.t}</span>
                  </div>
                );
              })}
            </div>
          )}

          {ev.description && (
            <div className="adk-ev-desc"><div className="adk-ev-sec">תיאור</div><div className="txt" dangerouslySetInnerHTML={{ __html: linkify(ev.description) }} /></div>
          )}

          {ev.htmlLink && (
            <a className="adk-ev-open" href={ev.htmlLink} target="_blank" rel="noreferrer">פתח ב‑Google יומן ↗</a>
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

// escape then linkify URLs — gathered content is DATA; render it inert.
function linkify(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return esc.replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noreferrer noopener">${u}</a>`);
}
