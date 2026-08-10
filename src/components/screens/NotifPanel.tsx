// Notifications — one scannable row per event: avatar (project, or person ringed in the
// project colour), a title that says WHAT happened, a status chip for the TYPE, a description
// only when it carries new info, relative time, and hover actions. Grouped by day, 5 then
// "show more", unread above read. Asymmetry over four shades of grey.
import { useState } from "react";
import { Badge } from "../ui/Badge";
import { Avatar } from "../ui/Avatar";
import { relTime } from "../../lib/date";

const HEAD = ["היום", "אתמול", "השבוע", "קודם"];
function bucketOf(at: number, now: number) {
  const startOf = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const diff = Math.round((startOf(now) - startOf(at)) / 864e5);
  return diff <= 0 ? "היום" : diff === 1 ? "אתמול" : diff <= 7 ? "השבוע" : "קודם";
}

export function NotifPanel({ notifs, notifSeen, now, onApprove, onReject, onOpen, onMarkAll, onClose }: any) {
  const [expanded, setExpanded] = useState(false);
  const nowMs = now || 0;
  const isUnread = (n: any) => n.at > notifSeen;
  // bucket order, then unread-first, then newest-first
  const ordered = [...notifs].sort((a, b) => {
    const ba = HEAD.indexOf(bucketOf(a.at, nowMs)), bb = HEAD.indexOf(bucketOf(b.at, nowMs));
    if (ba !== bb) return ba - bb;
    const ua = isUnread(a) ? 0 : 1, ub = isUnread(b) ? 0 : 1;
    if (ua !== ub) return ua - ub;
    return b.at - a.at;
  });
  const shown = expanded ? ordered : ordered.slice(0, 5);

  const rows: any[] = [];
  let lastBucket = "";
  for (const n of shown) {
    const b = bucketOf(n.at, nowMs);
    if (b !== lastBucket) { rows.push(<div className="adk-notif-group" key={"g" + b}>{b}</div>); lastBucket = b; }
    const unread = isUnread(n);
    const canApprove = n.type === "draft" && n.complete;
    rows.push(
      <div key={n.id} className={"adk-notif-item" + (unread ? " unread" : "")}>
        <button className="adk-notif-open" onClick={() => onOpen(n.cardId)}>
          {n.person
            ? <span className="adk-notif-av person" style={n.color ? { boxShadow: `0 0 0 2px ${n.color}` } : undefined}><Avatar name={n.person} size={30} /></span>
            : <span className="adk-notif-av"><Badge client={{ color: n.color, name: n.client }} size={30} /></span>}
          <span className="adk-notif-body">
            <span className="adk-notif-top">
              <b className="adk-notif-title">{n.title}</b>
              <span className={"adk-notif-chip" + (n.type === "draft" ? " pending" : "")}>{n.status}</span>
            </span>
            {n.desc && <span className="adk-notif-desc">{n.desc}</span>}
            <span className="adk-notif-time">{relTime(n.at)}</span>
          </span>
        </button>
        <div className="adk-notif-acts">
          {canApprove && <button className="ok" onClick={() => onApprove(n.cardId)}>אשר</button>}
          {(n.type === "draft" || n.type === "request") && <button className="no" onClick={() => onReject(n.cardId)}>דחה</button>}
          <button className="open" onClick={() => onOpen(n.cardId)}>פתח</button>
        </div>
      </div>,
    );
  }

  return (
    <div className="adk-notif">
      <div className="adk-notif-head"><b>התראות</b>{notifs.length > 0 && <button onClick={onMarkAll}>סמן הכל כנקרא</button>}</div>
      <div className="adk-notif-list">
        {notifs.length === 0 && <div className="adk-notif-empty">אין תנועות חדשות ✦</div>}
        {rows}
        {!expanded && ordered.length > 5 && <button className="adk-notif-more" onClick={() => setExpanded(true)}>הצג עוד ({ordered.length - 5})</button>}
      </div>
    </div>
  );
}
