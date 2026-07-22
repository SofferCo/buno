import { useState } from "react";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { PRIORITY } from "../../lib/constants";
import { fmtDate, fmtShort } from "../../lib/format";
import { creatorOf, peopleOf } from "../../lib/people";
import { cardSeconds } from "../../lib/time";

export function ArchivePanel({ items, client, now, onClose, onOpen, onRestore, onHardDelete }) {
  const [q, setQ] = useState("");
  const [giver, setGiver] = useState("all");
  const [pri, setPri] = useState("all");
  const [reason, setReason] = useState("all");
  const givers: string[] = Array.from(new Set(items.flatMap((c) => peopleOf(c)).filter(Boolean)));
  const filtered = items.filter((c) => {
    if (reason === "done" && c.reason !== "done") return false;
    if (reason === "removed" && !(c.reason === "deleted" || c.reason === "client")) return false;
    if (pri !== "all" && c.priority !== pri) return false;
    if (giver !== "all" && !peopleOf(c).includes(giver)) return false;
    if (q.trim()) { const t = (c.title + " " + (c.description || "") + " " + peopleOf(c).join(" ")).toLowerCase(); if (!t.includes(q.trim().toLowerCase())) return false; }
    return true;
  });
  const totalTime = filtered.reduce((a, c) => a + cardSeconds(c, now), 0);
  return (
    <div className="adk-arch">
      <div className="adk-arch-head">
        <Badge client={client} size={26} />
        <h2>ארכיון · {client?.name}</h2>
        <button className="adk-x" onClick={onClose}>×</button>
      </div>
      <div className="adk-arch-filters">
        <input className="adk-arch-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 חיפוש לפי שם, תיאור או נותן בריף…" />
        <div className="adk-fset">
          <select className="adk-fsel" value={giver} onChange={(e) => setGiver(e.target.value)}>
            <option value="all">כל הבריפים</option>
            {givers.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <span className="adk-fchip" style={{ cursor: "default", background: "transparent", border: "none", color: "var(--faint)" }}>חשיבות:</span>
          {[["all", "הכל"], ["critical", "קריטי"], ["important", "חשוב"], ["regular", "רגיל"]].map(([k, l]) => (
            <button key={k} className={"adk-fchip" + (pri === k ? " on" : "")} onClick={() => setPri(k)}>{l}</button>
          ))}
          <span className="adk-fchip" style={{ cursor: "default", background: "transparent", border: "none", color: "var(--faint)" }}>סטטוס:</span>
          {[["all", "הכל"], ["done", "הושלם"], ["removed", "הוסר"]].map(([k, l]) => (
            <button key={k} className={"adk-fchip" + (reason === k ? " on" : "")} onClick={() => setReason(k)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="adk-arch-sum">{filtered.length} משימות · סה״כ {fmtShort(totalTime)}</div>
      <div className="adk-arch-body">
        {filtered.length === 0 && <div className="adk-arch-empty">אין פריטים תואמים</div>}
        {filtered.map((c) => {
          const pr = PRIORITY[c.priority];
          return (
            <div className="adk-arow" key={c.id}>
              <div className="main" onClick={() => onOpen(c.id)}>
                <div className="t">{c.title || "ללא כותרת"}</div>
                <div className="m">
                  <span className={"adk-rbadge " + c.reason}>{c.reason === "done" ? "הושלם" : c.reason === "client" ? "הוסר ע״י הלקוח" : "נמחק"}</span>
                  {c.priority !== "regular" && <span className="adk-pri" style={{ background: pr.soft, color: pr.color }}>{pr.label}</span>}
                  {creatorOf(c) && <span className="adk-meta-s"><Avatar name={creatorOf(c)} size={16} /> {creatorOf(c)}</span>}
                  <span className="adk-meta-s">⏱ {fmtShort(cardSeconds(c, now))}</span>
                  <span className="adk-meta-s">📅 {fmtDate(c.when)}</span>
                </div>
              </div>
              <div className="acts">
                <button className="restore" title="שחזר ללוח" onClick={() => onRestore(c.id)}>↩</button>
                <button className="del" title="מחק לצמיתות" onClick={() => { if (confirm("למחוק לצמיתות? לא ניתן לשחזר.")) onHardDelete(c.id); }}>🗑</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
