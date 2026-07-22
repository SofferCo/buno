import { useState } from "react";
import { SchedulePicker } from "./SchedulePicker";
import { Icon } from "../ui/Icon";
import { routineKind, scheduleLabel } from "../../lib/date";

export function ScheduleNegotiation({ card, me, allowFresh, onApply, onPropose, onCancel }: any) {
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
