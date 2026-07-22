import { useState, useEffect } from "react";
import { HE_MONTHS, HE_WD } from "../../lib/constants";
import { todayStr } from "../../lib/date";

export function SchedulePicker({ deadline, routine, dayFlex, time, onChange }) {
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
