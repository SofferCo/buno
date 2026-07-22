import { useState, useRef } from "react";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { SWATCHES } from "../../lib/constants";
import { uid } from "../../lib/id";
import { resizeImage } from "../../lib/image";

export function ClientModal({ client, onClose, onSave, onDelete }) {
  const [f, setF] = useState(client || { id: uid("cl"), name: "", color: SWATCHES[0], contact: "", email: "", notes: "", rate: "", members: [], logo: null });
  const [memberInput, setMemberInput] = useState("");
  const members = f.members || [];
  function addMember() { const n = memberInput.trim(); if (!n || members.includes(n)) return; setF({ ...f, members: [...members, n] }); setMemberInput(""); }
  const fileRef = useRef<any>();
  async function onLogo(e) { const file = e.target.files?.[0]; if (!file) return; try { const d = await resizeImage(file, 128, "image/png", 0.9); setF((p) => ({ ...p, logo: d })); } catch {} }
  return (
    <div className="adk-overlay" onClick={onClose}>
      <div className="adk-modal" onClick={(e) => e.stopPropagation()}>
        <div className="adk-modal-head"><Badge client={f} size={32} /><b style={{ fontSize: 16, flex: 1 }}>{client ? "עריכת לקוח" : "לקוח חדש"}</b><button className="adk-x" onClick={onClose}>×</button></div>
        <div className="adk-modal-body">
          <div className="adk-field"><label>שם הלקוח</label><input className="adk-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="שם החברה / הפרויקט" /></div>
          <div className="adk-field"><label>לוגו</label>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onLogo} />
            {f.logo ? <div className="adk-img-prev"><img src={f.logo} alt="" /><button onClick={() => setF({ ...f, logo: null })}>הסר</button></div> : <div className="adk-img-drop" onClick={() => fileRef.current.click()}>📎 העלה לוגו</div>}
          </div>
          <div className="adk-field"><label>צבע (כשאין לוגו)</label>
            <div style={{ display: "flex", gap: 8 }}>{SWATCHES.map((s) => <div key={s} onClick={() => setF({ ...f, color: s })} style={{ width: 28, height: 28, borderRadius: 8, background: s, cursor: "pointer", boxShadow: f.color === s ? "0 0 0 3px #fff, 0 0 0 5px " + s : "none" }} />)}</div>
          </div>
          <div className="adk-grid2">
            <div className="adk-field"><label>איש קשר</label><input className="adk-input" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} placeholder="שם" /></div>
            <div className="adk-field"><label>אימייל / טלפון</label><input className="adk-input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} dir="ltr" /></div>
          </div>
          <div className="adk-field"><label>תעריף שעתי (₪) — לחישוב רווחיות בדשבורד</label><input className="adk-input" type="number" min="0" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="למשל 250" /></div>
          <div className="adk-field"><label>הערות</label><textarea className="adk-textarea" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="פרטים, תעריף, דגשים…" /></div>
          <div className="adk-field"><label>אנשי הפרויקט / מוזמנים</label>
            {members.length > 0 && (
              <div className="adk-cc" style={{ marginBottom: 8 }}>
                {members.map((n) => (
                  <span className="adk-cc-chip" key={n}><Avatar name={n} size={18} /> {n} <button onClick={() => setF({ ...f, members: members.filter((x) => x !== n) })}>×</button></span>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <input className="adk-input" value={memberInput} onChange={(e) => setMemberInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMember(); } }} placeholder="שם — Enter להוספה" />
              <button className="adk-btn" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--ink)" }} onClick={addMember}>הוסף</button>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--faint)", fontWeight: 600, marginTop: 6 }}>אלה האנשים שיהיו זמינים כמכותבים ולהזמנה לפורטל.</div>
          </div>
        </div>
        <div className="adk-modal-foot" style={{ display: "flex", gap: 8, padding: "13px 18px", borderTop: "1px solid var(--border)", background: "var(--surface-2)" }}>
          {client && !client.home && <button className="adk-btn danger" onClick={() => { if (confirm("למחוק את הלקוח וכל המשימות שלו?")) onDelete(client.id); }}>מחק לקוח</button>}
          <button className="adk-btn primary" onClick={() => f.name.trim() && onSave(f)}>שמור</button>
        </div>
      </div>
    </div>
  );
}
