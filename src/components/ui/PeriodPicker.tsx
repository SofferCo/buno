// A small styled period dropdown (month / quarter / year / a specific month) —
// replaces the native <select> so the OPEN state matches the app, not the OS menu.
import { useState } from "react";
import { Icon } from "./Icon";
import { ymLabel } from "../../lib/date";

export function periodLabel(value: string) {
  if (value.startsWith("d:")) return new Date(value.slice(2) + "T00:00:00").toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
  return value === "day" ? "היום" : value === "yesterday" ? "אתמול" : value === "week" ? "השבוע" : value === "month" ? "החודש" : value === "quarter" ? "רבעון (3 חודשים)" : value === "12m" ? "שנה (12 חודשים)" : ymLabel(value);
}

export function PeriodPicker({ value, onChange, seq }: { value: string; onChange: (v: string) => void; seq: string[] }) {
  const [open, setOpen] = useState(false);
  const pick = (v: string) => { onChange(v); setOpen(false); };
  const Item = ({ v, label }: { v: string; label: string }) => (
    <button className="adk-period-item" data-on={value === v ? "1" : undefined} onClick={() => pick(v)}>{label}{value === v && <span className="chk">✓</span>}</button>
  );
  return (
    <div style={{ position: "relative" }}>
      <button className="adk-period-trigger" onClick={() => setOpen((o) => !o)}>
        {periodLabel(value)}<Icon name="chevD" size={15} />
      </button>
      {open && (<>
        <div style={{ position: "fixed", inset: 0, zIndex: 49 }} onClick={() => setOpen(false)} />
        <div className="adk-period-menu">
          <Item v="day" label="היום" />
          <Item v="yesterday" label="אתמול" />
          <Item v="week" label="השבוע" />
          <Item v="month" label="החודש" />
          <Item v="quarter" label="רבעון (3 חודשים)" />
          <Item v="12m" label="שנה (12 חודשים)" />
          <div className="adk-period-sep" />
          {[...seq].reverse().map((m) => <Item key={m} v={m} label={ymLabel(m)} />)}
        </div>
      </>)}
    </div>
  );
}
