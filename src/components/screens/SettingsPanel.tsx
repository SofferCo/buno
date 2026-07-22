import { useRef } from "react";
import { Icon } from "../ui/Icon";
import { resizeImage } from "../../lib/image";
import { initials, nameColor } from "../../lib/people";

export function SettingsPanel({ profile, account, onClose, onSetName, onSetPhoto, onSetAssistant, onSetPref, onSignOut }: any) {
  const photoRef = useRef<any>();
  const timeRound = (profile.settings && profile.settings.timeRound) || "ceil_hour";
  async function onPhoto(e) { const f = e.target.files?.[0]; if (!f) return; try { const d = await resizeImage(f, 256, "image/jpeg", 0.8); onSetPhoto(d); } catch {} }
  return (
    <div className="adk-page">
      <div className="adk-pcard">
        <div className="adk-pcard-head">
          <button className="adk-back" onClick={onClose} title="חזרה"><Icon name="arrowR" size={22} /></button>
          <div className="titleblk"><div><h2>הגדרות</h2><span>פרופיל · העוזר · העדפות</span></div></div>
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
          <p className="adk-block-title"><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="spark" size={15} /> העוזר הדיגיטלי · הרשאות</span></p>
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
        </div>
      </div>
    </div>
  );
}
