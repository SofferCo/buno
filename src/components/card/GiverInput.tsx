import { useState } from "react";
import { Avatar } from "../ui/Avatar";

export function GiverInput({ value, onChange, suggestions, onPick, placeholder, bare }) {
  const [open, setOpen] = useState(false);
  const q = (value || "").trim().toLowerCase();
  const list = (suggestions || []).filter((s) => s && (!q || s.toLowerCase().includes(q)))
    .sort((a, b) => ((a.toLowerCase().startsWith(q) ? 0 : 1) - (b.toLowerCase().startsWith(q) ? 0 : 1)));
  const show = open && list.length > 0;
  const pick = (s) => { if (onPick) { onPick(s); onChange(""); } else { onChange(s); } setOpen(false); };
  return (
    <div className="adk-combo">
      <input className={"adk-input" + (bare ? " adk-bare-input" : "")} value={value} placeholder={placeholder || "שם / תפקיד / איש קשר"}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === "Enter" && onPick && value.trim()) { e.preventDefault(); onPick(value.trim()); onChange(""); setOpen(false); } }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 130)} />
      {show && (
        <div className="adk-combo-list">
          {list.slice(0, 6).map((s) => (
            <div key={s} className="adk-combo-item" onMouseDown={() => pick(s)}><Avatar name={s} size={18} /> {s}</div>
          ))}
        </div>
      )}
    </div>
  );
}
