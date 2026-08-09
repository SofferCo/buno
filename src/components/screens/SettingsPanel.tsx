import { useRef, useState, useEffect } from "react";
import { Icon } from "../ui/Icon";
import { resizeImage } from "../../lib/image";
import { initials, nameColor } from "../../lib/people";
import { listIntegrations, connectGoogle, disconnectGoogle, scanGmail, hasGmailScope } from "../../data/integrations";
import { useT, LANGS } from "../../lib/i18n";

export function SettingsPanel({ profile, account, onClose, onSetName, onSetPhoto, onSetAssistant, onSetPref, onSignOut, cloud, onScanned }: any) {
  const photoRef = useRef<any>();
  const [cat, setCat] = useState<"profile" | "assistant" | "connections" | "prefs">("profile");
  const { t } = useT();
  const theme = (profile.settings && profile.settings.theme) || "system";
  const lang = (profile.settings && profile.settings.lang) || "he";
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
          <button className="adk-back" onClick={onClose} title={t("common.back")}><Icon name="arrowR" size={22} /></button>
          <div className="titleblk"><div><h2>{t("settings.title")}</h2><span>{t("settings.subtitle")}</span></div></div>
          <div className="sp" />
        </div>

        <div className="adk-set-tabs">
          {([["profile", t("settings.tab.profile")], ["assistant", t("settings.tab.assistant")], ...(cloud ? [["connections", t("settings.tab.connections")]] : []), ["prefs", t("settings.tab.prefs")]] as any).map(([k, label]: any) => (
            <button key={k} className={"adk-set-tab" + (cat === k ? " on" : "")} onClick={() => setCat(k)}>{label}</button>
          ))}
        </div>

        {cat === "profile" && (
        <div className="adk-pcard-foot">
          <p className="adk-block-title">{t("settings.profile")}</p>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <input ref={photoRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPhoto} />
            <button className="adk-self" style={{ width: 56, height: 56, border: "2px solid var(--border)", background: nameColor(profile.name || "אני") }} onClick={() => photoRef.current.click()} title={t("settings.changePhoto")}>
              {profile.photo ? <img src={profile.photo} alt="" /> : <span style={{ fontSize: 17 }}>{profile.name ? initials(profile.name) : "אני"}</span>}
            </button>
            <div className="adk-field" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
              <label>{t("settings.fullName")}</label>
              <input className="adk-input" dir="auto" value={profile.name} onChange={(e) => onSetName(e.target.value)} placeholder={t("settings.namePlaceholder")} />
            </div>
            {onSignOut && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginInlineStart: "auto" }}>
                {account && <span style={{ fontSize: 12.5, color: "var(--faint)", fontWeight: 600, direction: "ltr" }}>{account}</span>}
                <button className="adk-btn danger" style={{ margin: 0 }} onClick={onSignOut}>{t("settings.signOut")}</button>
              </div>
            )}
          </div>
          <div className="adk-asst-row" style={{ borderBottom: "none", marginTop: 4 }}>
            <div className="adk-asst-info"><b>{t("settings.theme")}</b><span>{t("settings.themeDesc")}</span></div>
            <div className="adk-asst-seg">
              {[["light", t("settings.theme.light")], ["dark", t("settings.theme.dark")], ["system", t("settings.theme.system")]].map(([v, l]) => (
                <button key={v} className={"lvl act" + (theme === v ? " on" : "")} onClick={() => onSetPref("theme", v)}><span className="dot" />{l}</button>
              ))}
            </div>
          </div>
          <div className="adk-asst-row" style={{ borderBottom: "none" }}>
            <div className="adk-asst-info"><b>{t("settings.lang")}</b><span>{t("settings.langDesc")}</span></div>
            <div className="adk-asst-seg">
              {LANGS.map((L) => (
                <button key={L.code} className={"lvl act" + (lang === L.code ? " on" : "")} onClick={() => onSetPref("lang", L.code)}><span className="dot" />{L.name}</button>
              ))}
            </div>
          </div>
        </div>
        )}

        {cat === "assistant" && (
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
        )}

        {cat === "connections" && cloud && (
          <div className="adk-pcard-foot" style={{ borderBottom: "1px solid var(--border)" }}>
            <p className="adk-block-title"><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="calendar" size={15} /> חיבורים</span></p>
            <div className="adk-asst-row" style={{ borderBottom: "none" }}>
              <div className="adk-asst-info">
                <b>Google — יומן ומייל</b>
                <span>{gcal?.status === "connected" ? `מחובר${gcal.external_id ? ` · ${gcal.external_id}` : ""}${gmailReady ? " · יומן + מייל" : " · יומן"}` : gcal?.status === "error" ? "החיבור פג — התחבר מחדש" : "קורא את היומן והמייל ל‑”היום שלי” ולזיהוי משימות — ויכול לעזור לנהל פגישות (דחייה/תזמון/ביטול), באישורך"}</span>
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
            <div style={{ fontSize: 11.5, color: "var(--faint)", fontWeight: 600, marginTop: 6 }}>היומן — קריאה וניהול בעזרתך (דחייה/תזמון/ביטול, תמיד באישור). המייל — קריאה בלבד, לחודש האחרון, ורק דפוסים שמתאימים ל‑buno. הגישה מאובטחת בשרת — הדפדפן לא רואה טוקנים.</div>
          </div>
        )}

        {cat === "prefs" && (
        <div className="adk-pcard-foot">
          <p className="adk-block-title">{t("settings.prefs")}</p>
          <div className="adk-asst-row" style={{ borderBottom: "none" }}>
            <div className="adk-asst-info"><b>{t("settings.timeRound")}</b><span>{t("settings.timeRoundDesc")}</span></div>
            <div className="adk-asst-seg">
              {["ceil_hour", "decimal", "exact"].map((v) => (
                <button key={v} className={"lvl act" + (timeRound === v ? " on" : "")} onClick={() => onSetPref("timeRound", v)}><span className="dot" />{t("settings.timeRound." + v)}</button>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--faint)", fontWeight: 600 }}>{t("settings.timeRoundNote")}</div>
          <div className="adk-asst-row" style={{ borderBottom: "none" }}>
            <div className="adk-asst-info"><b>{t("settings.capacity")}</b><span>{t("settings.capacityDesc")}</span></div>
            <div className="adk-asst-seg">
              <button className="lvl" onClick={() => onSetPref("dailyCapacity", Math.max(1, capacity - 1))}>−</button>
              <b style={{ minWidth: 44, textAlign: "center" }}>{capacity} {t("settings.hoursShort")}</b>
              <button className="lvl" onClick={() => onSetPref("dailyCapacity", Math.min(16, capacity + 1))}>+</button>
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
