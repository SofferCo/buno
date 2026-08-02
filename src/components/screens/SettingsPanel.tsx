import { useRef, useState, useEffect } from "react";
import { Icon } from "../ui/Icon";
import { resizeImage } from "../../lib/image";
import { initials, nameColor } from "../../lib/people";
import { listIntegrations, connectGoogle, disconnectGoogle, scanGmail, hasGmailScope } from "../../data/integrations";

export function SettingsPanel({ profile, account, onClose, onSetName, onSetPhoto, onSetAssistant, onSetPref, onSignOut, cloud, onScanned }: any) {
  const photoRef = useRef<any>();
  const timeRound = (profile.settings && profile.settings.timeRound) || "ceil_hour";
  const capacity = Number(profile.settings && profile.settings.dailyCapacity) || 6;
  const [integ, setInteg] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const gcal = integ.find((i) => i.kind === "gcal");
  const gmailReady = hasGmailScope(gcal);
  useEffect(() => { if (cloud) listIntegrations().then(setInteg).catch(() => {}); }, [cloud]);
  async function connect() { setBusy(true); try { await connectGoogle(); } catch { setBusy(false); } }
  async function disconnect() { if (!confirm("לנתק את Google (יומן + מייל)?")) return; await disconnectGoogle(); setInteg((p) => p.filter((i) => i.kind !== "gcal")); }
  async function scan() {
    if (scanning) return;
    setScanning(true); setScanMsg(null);
    try {
      const r = await scanGmail();
      const n = r.created?.length || 0;
      setScanMsg(n > 0 ? `נוצרו ${n} טיוטות מהמייל — ממתינות לאישורך בלוח.` : "לא נמצאו פריטים חדשים שדורשים משימה.");
      if (n > 0) onScanned?.();
    } catch { setScanMsg("הסריקה נכשלה — נסה שוב."); }
    finally { setScanning(false); }
  }
  async function onPhoto(e) { const f = e.target.files?.[0]; if (!f) return; try { const d = await resizeImage(f, 256, "image/jpeg", 0.8); onSetPhoto(d); } catch {} }
  return (
    <div className="adk-page">
      <div className="adk-pcard">
        <div className="adk-pcard-head">
          <button className="adk-back" onClick={onClose} title="חזרה"><Icon name="arrowR" size={22} /></button>
          <div className="titleblk"><div><h2>הגדרות</h2><span>פרופיל · העוזר · חיבורים · העדפות</span></div></div>
          <div className="sp" />
        </div>

        <div className="adk-pcard-foot">
          <p className="adk-block-title">פרופיל</p>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <input ref={photoRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPhoto} />
            <button className="adk-self" style={{ width: 56, height: 56, border: "2px solid var(--border)", background: nameColor(profile.name || "אני") }} onClick={() => photoRef.current.click()} title="החלף תמונה">
              {profile.photo ? <img src={profile.photo} alt="" /> : <span style={{ fontSize: 17 }}>{profile.name ? initials(profile.name) : "אני"}</span>}
            </button>
            <div className="adk-field" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
              <label>שם מלא</label>
              <input className="adk-input" value={profile.name} onChange={(e) => onSetName(e.target.value)} placeholder="השם שלך" />
            </div>
            {onSignOut && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginInlineStart: "auto" }}>
                {account && <span style={{ fontSize: 12.5, color: "var(--faint)", fontWeight: 600, direction: "ltr" }}>{account}</span>}
                <button className="adk-btn danger" style={{ margin: 0 }} onClick={onSignOut}>התנתק</button>
              </div>
            )}
          </div>
        </div>

        <div className="adk-pcard-foot">
          <p className="adk-block-title"><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="sun" size={15} /> העוזר הדיגיטלי · הרשאות</span></p>
          <div className="adk-asst-set">
            {[["cards", "משימות", "יצירה ועריכה של כרטיסים"], ["calendar", "יומן", "אירועים וטיוטות תזמון"], ["outbound", "שליחה החוצה", "מיילים/הודעות בשמך"]].map(([k, label, desc]) => {
              const val = (profile.assistant && profile.assistant[k]) || "suggest";
              const opts = k === "outbound" ? [["suggest", "מציע"]] : [["suggest", "מציע"], ["draft", "טיוטה"], ["act", "פועל"]];
              return (
                <div className="adk-asst-row" key={k}>
                  <div className="adk-asst-info"><b>{label}</b><span>{desc}</span></div>
                  <div className="adk-asst-seg">
                    {opts.map(([v, l]) => (
                      <button key={v} className={"lvl " + v + (val === v ? " on" : "")} onClick={() => onSetAssistant(k, v)}><span className="dot" />{l}</button>
                    ))}
                    {k === "outbound" && <span className="adk-asst-lock">נעול · לעולם לא אוטומטי</span>}
                  </div>
                </div>
              );
            })}
            <div className="adk-asst-legend"><span><span className="d s" />מציע: מראה ולא נוגע</span><span><span className="d d" />טיוטה: יוצר וממתין לאישור</span><span><span className="d a" />פועל: מבצע ישירות (הפיך)</span></div>
          </div>
        </div>

        {cloud && (
          <div className="adk-pcard-foot" style={{ borderBottom: "1px solid var(--border)" }}>
            <p className="adk-block-title"><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="calendar" size={15} /> חיבורים</span></p>
            <div className="adk-asst-row" style={{ borderBottom: "none" }}>
              <div className="adk-asst-info">
                <b>Google — יומן ומייל</b>
                <span>{gcal?.status === "connected" ? `מחובר${gcal.external_id ? ` · ${gcal.external_id}` : ""}${gmailReady ? " · יומן + מייל" : " · יומן"}` : gcal?.status === "error" ? "החיבור פג — התחבר מחדש" : "קריאת אירועים ומייל ל‑”היום שלי”, ללוח־השנה, ולזיהוי משימות"}</span>
              </div>
              {gcal?.status === "connected"
                ? <button className="adk-btn danger" style={{ margin: 0 }} onClick={disconnect}>נתק</button>
                : <button className="adk-btn primary" disabled={busy} onClick={connect}>{busy ? "מפנה…" : "התחבר"}</button>}
            </div>
            {gcal?.status === "connected" && !gmailReady && (
              <div className="adk-asst-row" style={{ borderBottom: "none" }}>
                <div className="adk-asst-info"><b>הוסף גישת מייל</b><span>כדי שבונו יזהה משימות מהמייל — התחבר מחדש ואשר גם את המייל</span></div>
                <button className="adk-btn primary" disabled={busy} onClick={connect}>{busy ? "מפנה…" : "הוסף מייל"}</button>
              </div>
            )}
            {gcal?.status === "connected" && gmailReady && (
              <div className="adk-asst-row" style={{ borderBottom: "none" }}>
                <div className="adk-asst-info"><b>סריקת מייל — חודש אחרון</b><span>בונו יעבור על המייל של 30 הימים האחרונים ויציע טיוטות משימות לאישורך</span></div>
                <button className="adk-btn primary" disabled={scanning} onClick={scan}>{scanning ? "סורק…" : "סרוק"}</button>
              </div>
            )}
            {scanMsg && <div style={{ fontSize: 12.5, color: "var(--accent-d)", fontWeight: 700, marginTop: 2 }}>{scanMsg}</div>}
            <div style={{ fontSize: 11.5, color: "var(--faint)", fontWeight: 600, marginTop: 6 }}>קריאה בלבד. הגישה מאובטחת בשרת — הדפדפן לא רואה טוקנים. המייל נסרק רק לחודש האחרון, ורק דפוסים שמתאימים ל‑buno.</div>
          </div>
        )}

        <div className="adk-pcard-foot">
          <p className="adk-block-title">העדפות</p>
          <div className="adk-asst-row" style={{ borderBottom: "none" }}>
            <div className="adk-asst-info"><b>חישוב זמן</b><span>איך מוצג הזמן שנצבר על משימות</span></div>
            <div className="adk-asst-seg">
              {[["ceil_hour", "שעה שלמה"], ["decimal", "עשרוני"], ["exact", "מדויק"]].map(([v, l]) => (
                <button key={v} className={"lvl act" + (timeRound === v ? " on" : "")} onClick={() => onSetPref("timeRound", v)}><span className="dot" />{l}</button>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--faint)", fontWeight: 600 }}>עבודה נמדדת כערך, לא כדקות — לכן ברירת המחדל מעגלת כלפי מעלה לשעה שלמה.</div>
          <div className="adk-asst-row" style={{ borderBottom: "none" }}>
            <div className="adk-asst-info"><b>קיבולת יומית</b><span>מעל 80% מהיום — בונו יציין שהיום צפוף</span></div>
            <div className="adk-asst-seg">
              <button className="lvl" onClick={() => onSetPref("dailyCapacity", Math.max(1, capacity - 1))}>−</button>
              <b style={{ minWidth: 44, textAlign: "center" }}>{capacity} ש׳</b>
              <button className="lvl" onClick={() => onSetPref("dailyCapacity", Math.min(16, capacity + 1))}>+</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
