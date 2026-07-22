import { useState } from "react";
import { Avatar } from "../ui/Avatar";

export function CommentBox({ value, onChange, onSend, people, placeholder }) {
  const [men, setMen] = useState(null);
  function handle(v) { onChange(v); const m = v.match(/@(\S*)$/); setMen(m ? { q: m[1] } : null); }
  const sugg = men ? (people || []).filter((p) => p && p.toLowerCase().includes(men.q.toLowerCase())).slice(0, 6) : [];
  function pick(name) { onChange(value.replace(/@(\S*)$/, "@" + name + " ")); setMen(null); }
  return (
    <div className="adk-combo" style={{ flex: 1 }}>
      <input className="adk-input" style={{ borderRadius: 20 }} value={value} placeholder={placeholder}
        onChange={(e) => handle(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !(men && sugg.length)) { e.preventDefault(); onSend(); } }}
        onBlur={() => setTimeout(() => setMen(null), 150)} />
      {men && sugg.length > 0 && (
        <div className="adk-combo-list">
          {sugg.map((s) => <div className="adk-combo-item" key={s} onMouseDown={() => pick(s)}><Avatar name={s} size={18} /> {s}</div>)}
        </div>
      )}
    </div>
  );
}
