// buno — a focused, Google-Drive-style share dialog. Same sharing CORE as before
// (invites.ts + roster/roles) but on its own, not buried inside the edit-client form.
import { useState, useEffect } from "react";
import { Avatar } from "../ui/Avatar";
import { supabase } from "../../lib/supabase";
import { listInvites, createInvite, revokeInvite, setMemberRole, removeMember } from "../../data/invites";

const ROLE_HE: Record<string, string> = { owner: "בעלים", member: "חבר צוות", viewer: "צופה" };

export function ShareModal({ boardName, sharing, onClose }: { boardName: string; sharing: any; onClose: () => void }) {
  const isOwner = sharing.role === "owner";
  const [roster, setRoster] = useState<any[]>(sharing.roster || []);
  const [invites, setInvites] = useState<any[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [copied, setCopied] = useState("");

  useEffect(() => { if (isOwner) listInvites(sharing.supabase, sharing.projectId).then(setInvites).catch(() => {}); }, [isOwner, sharing.projectId]);

  async function invite() {
    const e = email.trim(); if (!e || busy) return;
    setBusy(true); setErr(null);
    try {
      const { invite, link } = await createInvite(sharing.supabase, sharing.projectId, e, role, sharing.meId, sharing.origin);
      setInvites((p) => [invite, ...p]); setEmail(""); setLastLink(link);
      // fire the real invite email (best-effort — the copy-link works regardless).
      try { await supabase?.functions.invoke("invite-email", { body: { to: e, boardName, inviter: sharing.meName || "מישהו", link, role } }); } catch { /* email optional */ }
    } catch (e: any) { setErr(e.message || String(e)); } finally { setBusy(false); }
  }
  async function changeRole(userId: string, r: string) { try { await setMemberRole(sharing.supabase, sharing.projectId, userId, r); setRoster((p) => p.map((m) => m.userId === userId ? { ...m, role: r } : m)); } catch {} }
  async function kick(userId: string) { if (!confirm("להסיר את הגישה של החבר?")) return; try { await removeMember(sharing.supabase, sharing.projectId, userId); setRoster((p) => p.filter((m) => m.userId !== userId)); } catch {} }
  async function revoke(id: string) { try { await revokeInvite(sharing.supabase, id); setInvites((p) => p.filter((i) => i.id !== id)); } catch {} }
  function copyText(text: string, tag: string) { navigator.clipboard?.writeText(text).then(() => { setCopied(tag); setTimeout(() => setCopied(""), 1500); }); }

  const roleSel: any = { padding: "5px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink)", fontSize: 13, fontWeight: 600, cursor: "pointer" };

  return (
    <div className="adk-overlay" onClick={onClose} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface)", borderRadius: 18, width: "min(94vw, 460px)", maxHeight: "88vh", overflowY: "auto", padding: 22, boxShadow: "0 24px 60px rgba(0,0,0,.28)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <b style={{ fontSize: 18, flex: 1 }}>שיתוף ‘{boardName}’</b>
          <button className="adk-x" onClick={onClose}>×</button>
        </div>

        {isOwner && (
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <input className="adk-input" dir="ltr" placeholder="הוסף אנשים לפי אימייל" value={email} style={{ flex: 1 }}
              onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); invite(); } }} autoFocus />
            <select value={role} onChange={(e) => setRole(e.target.value)} style={roleSel}>
              <option value="member">חבר צוות</option>
              <option value="viewer">צופה</option>
            </select>
            <button className="adk-btn primary" disabled={busy || !email.trim()} onClick={invite}>{busy ? "…" : "הזמן"}</button>
          </div>
        )}
        {err && <div style={{ color: "var(--danger, #D9503A)", fontSize: 12.5, fontWeight: 600, margin: "4px 2px" }}>{err}</div>}

        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--faint)", letterSpacing: ".02em", margin: "14px 2px 8px" }}>בעלי גישה</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 260, overflowY: "auto" }}>
          {roster.map((m) => (
            <div key={m.userId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 2px" }}>
              {m.photo ? <img src={m.photo} alt="" style={{ width: 34, height: 34, borderRadius: "50%", objectFit: "cover" }} /> : <Avatar name={m.name || "?"} size={34} />}
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 14 }}>{m.name || "משתמש"}{m.self && " (אתה)"}</div>{m.email && <div dir="ltr" style={{ fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis" }}>{m.email}</div>}</div>
              {isOwner && !m.self && m.role !== "owner"
                ? <select value={m.role} onChange={(e) => e.target.value === "__remove" ? kick(m.userId) : changeRole(m.userId, e.target.value)} style={roleSel}>
                    <option value="member">חבר צוות</option>
                    <option value="viewer">צופה</option>
                    <option value="__remove">הסר גישה</option>
                  </select>
                : <span style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>{ROLE_HE[m.role] || m.role}</span>}
            </div>
          ))}
          {invites.map((i) => (
            <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 2px", opacity: .85 }}>
              <Avatar name={i.email} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}><div dir="ltr" style={{ fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis" }}>{i.email}</div><div style={{ fontSize: 12, color: "var(--muted)" }}>ממתין להצטרפות</div></div>
              {isOwner
                ? <select value={i.role} onChange={(e) => { if (e.target.value === "__revoke") revoke(i.id); else if (e.target.value === "__link") copyText(`${sharing.origin}/?invite=${i.token}`, i.id); }} style={roleSel}>
                    <option value={i.role}>{ROLE_HE[i.role]}</option>
                    <option value="__link">העתק קישור הזמנה</option>
                    <option value="__revoke">בטל הזמנה</option>
                  </select>
                : <span style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>{ROLE_HE[i.role]}</span>}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <div style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--surface-2, #EEF1F2)", display: "grid", placeItems: "center", fontSize: 15 }}>🔒</div>
          <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 14 }}>מוגבל</div><div style={{ fontSize: 12, color: "var(--muted)" }}>רק אנשים שהוזמנו יכולים לפתוח</div></div>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
          <div>{lastLink && <button className="adk-btn" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--ink)" }} onClick={() => copyText(lastLink, "link")}>{copied === "link" ? "הועתק ✓" : "🔗 העתק קישור הזמנה"}</button>}</div>
          <button className="adk-btn primary" onClick={onClose}>סיום</button>
        </div>
      </div>
    </div>
  );
}
