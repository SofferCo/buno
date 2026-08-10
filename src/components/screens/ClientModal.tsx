import { useState, useRef, useEffect } from "react";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { SWATCHES } from "../../lib/constants";
import { uid } from "../../lib/id";
import { resizeImage } from "../../lib/image";
import { useT } from "../../lib/i18n";
import { listInvites, createInvite, revokeInvite, setMemberRole, removeMember } from "../../data/invites";

function SharingSection({ sharing }: { sharing: any }) {
  const { t } = useT();
  const roleLabel = (r: string) => t("role." + r, r);
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
  async function kick(userId: string) { if (!confirm(t("share.kickConfirm"))) return; try { await removeMember(sharing.supabase, sharing.projectId, userId); setRoster((p) => p.filter((m) => m.userId !== userId)); } catch {} }
  function copy(l: string) { navigator.clipboard?.writeText(l).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }

  return (
    <div className="adk-field">
      <label>{t("share.title")}</label>
      <div className="adk-share-roster">
        {roster.map((m) => (
          <div className="adk-share-row" key={m.userId}>
            {m.photo ? <img className="adk-share-av" src={m.photo} alt="" /> : <Avatar name={m.name || "?"} size={26} />}
            <span className="nm">{m.name || t("share.user")}{m.self && <em> · {t("share.you")}</em>}</span>
            {isOwner && !m.self && m.role !== "owner" ? (
              <>
                <select className="adk-share-role" value={m.role} onChange={(e) => changeRole(m.userId, e.target.value)}>
                  <option value="member">{t("role.member")}</option>
                  <option value="viewer">{t("role.viewer")}</option>
                </select>
                <button className="adk-share-x" title={t("common.remove")} onClick={() => kick(m.userId)}>×</button>
              </>
            ) : <span className="adk-share-badge">{roleLabel(m.role)}</span>}
          </div>
        ))}
      </div>

      {isOwner ? (<>
        <div className="adk-share-invite">
          <input className="adk-input" dir="ltr" value={email} placeholder={t("share.emailPh")}
            onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); invite(); } }} />
          <select className="adk-share-role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="member">{t("role.member")}</option>
            <option value="viewer">{t("role.viewer")}</option>
          </select>
          <button className="adk-btn primary" disabled={busy} onClick={invite}>{busy ? "…" : t("share.invite")}</button>
        </div>
        {err && <div className="adk-share-err">{err}</div>}
        {link && (
          <div className="adk-share-link">
            {t("share.sent")} <span className="l" dir="ltr">{link}</span>
            <button onClick={() => copy(link)}>{copied ? t("common.copied") : t("common.copy")}</button>
          </div>
        )}
        {invites.length > 0 && (
          <div className="adk-share-pending">
            <div className="hd">{t("share.pending")}</div>
            {invites.map((i) => (
              <div className="adk-share-row" key={i.id}>
                <span className="nm" dir="ltr">{i.email}</span>
                <span className="adk-share-badge">{roleLabel(i.role)}</span>
                <button className="adk-share-x" title={t("share.cancelInvite")} onClick={() => { copy(`${sharing.origin}/?invite=${i.token}`); }}>🔗</button>
                <button className="adk-share-x" title={t("share.cancelInvite")} onClick={() => revoke(i.id)}>×</button>
              </div>
            ))}
          </div>
        )}
        <div className="adk-share-hint">{t("share.hint")}</div>
      </>) : (
        <div className="adk-share-hint">{roleLabel(sharing.role)}</div>
      )}
    </div>
  );
}

export function ClientModal({ client, onClose, onSave, onDelete, sharing }: any) {
  const { t } = useT();
  const [f, setF] = useState(client || { id: uid("cl"), name: "", color: SWATCHES[0], contact: "", email: "", notes: "", rate: "", members: [], logo: null, why: "" });
  const [memberInput, setMemberInput] = useState("");
  const [showColors, setShowColors] = useState(false);
  const members = f.members || [];
  function addMember() { const n = memberInput.trim(); if (!n || members.includes(n)) return; setF({ ...f, members: [...members, n] }); setMemberInput(""); }
  const fileRef = useRef<any>();
  async function onLogo(e) { const file = e.target.files?.[0]; if (!file) return; try { const d = await resizeImage(file, 128, "image/png", 0.9); setF((p) => ({ ...p, logo: d })); } catch {} }
  return (
    <div className="adk-overlay" onClick={onClose}>
      <div className="adk-modal" onClick={(e) => e.stopPropagation()}>
        <div className="adk-modal-head"><Badge client={f} size={32} /><b style={{ fontSize: 16, flex: 1 }}>{client ? t("client.edit") : t("client.new")}</b><button className="adk-x" onClick={onClose}>×</button></div>
        <div className="adk-modal-body">
          <div className="adk-field"><label>{t("client.name")}</label><input className="adk-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t("client.namePh")} /></div>
          <div className="adk-field"><label>{t("client.logo")}</label>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onLogo} />
            {f.logo ? <div className="adk-img-prev"><img src={f.logo} alt="" /><button onClick={() => setF({ ...f, logo: null })}>{t("common.remove")}</button></div> : <div className="adk-img-drop" onClick={() => fileRef.current.click()}>📎 {t("client.uploadLogo")}</div>}
          </div>
          <div className="adk-field"><label>{t("client.color")}</label>
            <div style={{ position: "relative", display: "flex", gap: 8, alignItems: "center" }}>
              {SWATCHES.slice(0, 7).map((s) => <button type="button" key={s} onClick={() => setF({ ...f, color: s })} style={{ width: 28, height: 28, borderRadius: 8, background: s, cursor: "pointer", border: "none", padding: 0, boxShadow: f.color === s ? "0 0 0 3px var(--surface), 0 0 0 5px " + s : "none" }} />)}
              {/* "+" opens the fuller palette (no OS colour dialog) */}
              <button type="button" onClick={() => setShowColors((v) => !v)} title={t("client.moreColors")} style={{ width: 28, height: 28, borderRadius: 8, cursor: "pointer", display: "grid", placeItems: "center", background: !SWATCHES.slice(0, 7).includes(f.color) ? f.color : "var(--surface-2)", border: "1px solid var(--border)", padding: 0, boxShadow: !SWATCHES.slice(0, 7).includes(f.color) ? "0 0 0 3px var(--surface), 0 0 0 5px " + f.color : "none" }}>
                <span style={{ fontSize: 15, fontWeight: 800, lineHeight: 1, color: !SWATCHES.slice(0, 7).includes(f.color) ? "#fff" : "var(--muted)" }}>+</span>
              </button>
              {showColors && (<>
                <div style={{ position: "fixed", inset: 0, zIndex: 39 }} onClick={() => setShowColors(false)} />
                <div style={{ position: "absolute", top: "calc(100% + 8px)", insetInlineStart: 0, zIndex: 40, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, padding: 10, display: "grid", gridTemplateColumns: "repeat(7, 28px)", gap: 8, boxShadow: "0 14px 34px rgba(0,0,0,.25)" }}>
                  {SWATCHES.map((s) => <button type="button" key={s} onClick={() => { setF({ ...f, color: s }); setShowColors(false); }} style={{ width: 28, height: 28, borderRadius: 8, background: s, cursor: "pointer", border: "none", padding: 0, boxShadow: f.color === s ? "0 0 0 3px var(--surface-2), 0 0 0 5px " + s : "none" }} />)}
                </div>
              </>)}
            </div>
          </div>
          <div className="adk-grid2">
            <div className="adk-field"><label>{t("client.contact")}</label><input className="adk-input" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} placeholder={t("client.contactPh")} /></div>
            <div className="adk-field"><label>{t("client.emailPhone")}</label><input className="adk-input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} dir="ltr" /></div>
          </div>
          <div className="adk-field"><label>{t("client.rate")}</label><input className="adk-input" type="number" min="0" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder={t("client.ratePh")} /></div>
          <div className="adk-field"><label>{t("client.why")}</label><textarea className="adk-textarea" rows={2} value={f.why || ""} onChange={(e) => setF({ ...f, why: e.target.value })} placeholder={t("client.whyPh")} /></div>
          <div className="adk-field"><label>{t("client.notes")}</label><textarea className="adk-textarea" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder={t("client.notesPh")} /></div>
          <div className="adk-field"><label>{t("client.mentions")}</label>
            {members.length > 0 && (
              <div className="adk-cc" style={{ marginBottom: 8 }}>
                {members.map((n) => (
                  <span className="adk-cc-chip" key={n}><Avatar name={n} size={18} /> {n} <button onClick={() => setF({ ...f, members: members.filter((x) => x !== n) })}>×</button></span>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <input className="adk-input" value={memberInput} onChange={(e) => setMemberInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMember(); } }} placeholder={t("client.mentionPh")} />
              <button className="adk-btn" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--ink)" }} onClick={addMember}>{t("common.add")}</button>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--faint)", fontWeight: 600, marginTop: 6 }}>{t("client.mentionsHint")}</div>
          </div>
        </div>
        <div className="adk-modal-foot" style={{ display: "flex", gap: 8, padding: "13px 18px", borderTop: "1px solid var(--border)", background: "var(--surface-2)" }}>
          {client && !client.home && <button className="adk-btn danger" onClick={() => { if (confirm(t("client.deleteConfirm"))) onDelete(client.id); }}>{t("client.delete")}</button>}
          <button className="adk-btn primary" onClick={() => f.name.trim() && onSave(f)}>{t("common.save")}</button>
        </div>
      </div>
    </div>
  );
}
