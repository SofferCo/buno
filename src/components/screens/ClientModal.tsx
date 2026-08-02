import { useState, useRef, useEffect } from "react";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { SWATCHES } from "../../lib/constants";
import { uid } from "../../lib/id";
import { resizeImage } from "../../lib/image";
import { listInvites, createInvite, revokeInvite, setMemberRole, removeMember } from "../../data/invites";

const ROLE_HE: Record<string, string> = { owner: "בעלים", member: "חבר צוות", viewer: "צופה" };

function SharingSection({ sharing }: { sharing: any }) {
  const isOwner = sharing.role === "owner";
  const [roster, setRoster] = useState<any[]>(sharing.roster || []);
  const [invites, setInvites] = useState<any[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOwner) return;
    listInvites(sharing.supabase, sharing.projectId).then(setInvites).catch(() => {});
  }, [isOwner, sharing.projectId]);

  async function invite() {
    const e = email.trim(); if (!e || busy) return;
    setBusy(true); setErr(null); setLink(null);
    try {
      const { invite, link } = await createInvite(sharing.supabase, sharing.projectId, e, role, sharing.meId, sharing.origin);
      setInvites((p) => [invite, ...p]); setEmail(""); setLink(link);
    } catch (e: any) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) { try { await revokeInvite(sharing.supabase, id); setInvites((p) => p.filter((i) => i.id !== id)); } catch {} }
  async function changeRole(userId: string, r: string) { try { await setMemberRole(sharing.supabase, sharing.projectId, userId, r); setRoster((p) => p.map((m) => m.userId === userId ? { ...m, role: r } : m)); } catch {} }
  async function kick(userId: string) { if (!confirm("להסיר את החבר מהפרויקט?")) return; try { await removeMember(sharing.supabase, sharing.projectId, userId); setRoster((p) => p.filter((m) => m.userId !== userId)); } catch {} }
  function copy(l: string) { navigator.clipboard?.writeText(l).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }

  return (
    <div className="adk-field">
      <label>שיתוף הפרויקט</label>
      <div className="adk-share-roster">
        {roster.map((m) => (
          <div className="adk-share-row" key={m.userId}>
            {m.photo ? <img className="adk-share-av" src={m.photo} alt="" /> : <Avatar name={m.name || "?"} size={26} />}
            <span className="nm">{m.name || "משתמש"}{m.self && <em> · אתה</em>}</span>
            {isOwner && !m.self && m.role !== "owner" ? (
              <>
                <select className="adk-share-role" value={m.role} onChange={(e) => changeRole(m.userId, e.target.value)}>
                  <option value="member">חבר צוות</option>
                  <option value="viewer">צופה</option>
                </select>
                <button className="adk-share-x" title="הסר" onClick={() => kick(m.userId)}>×</button>
              </>
            ) : <span className="adk-share-badge">{ROLE_HE[m.role] || m.role}</span>}
          </div>
        ))}
      </div>

      {isOwner ? (<>
        <div className="adk-share-invite">
          <input className="adk-input" dir="ltr" value={email} placeholder="email@example.com"
            onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); invite(); } }} />
          <select className="adk-share-role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="member">חבר צוות</option>
            <option value="viewer">צופה</option>
          </select>
          <button className="adk-btn primary" disabled={busy} onClick={invite}>{busy ? "…" : "הזמן"}</button>
        </div>
        {err && <div className="adk-share-err">{err}</div>}
        {link && (
          <div className="adk-share-link">
            נשלחה הזמנה. שתף את הקישור: <span className="l" dir="ltr">{link}</span>
            <button onClick={() => copy(link)}>{copied ? "הועתק ✓" : "העתק"}</button>
          </div>
        )}
        {invites.length > 0 && (
          <div className="adk-share-pending">
            <div className="hd">הזמנות ממתינות</div>
            {invites.map((i) => (
              <div className="adk-share-row" key={i.id}>
                <span className="nm" dir="ltr">{i.email}</span>
                <span className="adk-share-badge">{ROLE_HE[i.role]}</span>
                <button className="adk-share-x" title="בטל הזמנה" onClick={() => { copy(`${sharing.origin}/?invite=${i.token}`); }}>🔗</button>
                <button className="adk-share-x" title="בטל הזמנה" onClick={() => revoke(i.id)}>×</button>
              </div>
            ))}
          </div>
        )}
        <div className="adk-share-hint">חבר צוות עורך תוכן ולא מזיז עמודות · צופה רואה בלבד. ההזמנה תקפה 14 יום ומקושרת לכתובת המייל.</div>
      </>) : (
        <div className="adk-share-hint">אתה {ROLE_HE[sharing.role] || sharing.role} בפרויקט הזה. רק הבעלים יכול להזמין ולנהל תפקידים.</div>
      )}
    </div>
  );
}

export function ClientModal({ client, onClose, onSave, onDelete, sharing }: any) {
  const [f, setF] = useState(client || { id: uid("cl"), name: "", color: SWATCHES[0], contact: "", email: "", notes: "", rate: "", members: [], logo: null, why: "" });
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
          <div className="adk-field"><label>למה הבורד הזה קיים? (המטרה — בונו מזכיר אותה כשמשימה נתקעת)</label><textarea className="adk-textarea" rows={2} value={f.why || ""} onChange={(e) => setF({ ...f, why: e.target.value })} placeholder="למשל: לבנות מותג שאנשים סומכים עליו" /></div>
          <div className="adk-field"><label>הערות</label><textarea className="adk-textarea" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="פרטים, תעריף, דגשים…" /></div>
          {sharing && <SharingSection sharing={sharing} />}
          <div className="adk-field"><label>שמות למוזכרים (@) והצעות מכותבים</label>
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
