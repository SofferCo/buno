import { useState, useRef } from "react";
import { Icon } from "../ui/Icon";
import { last12Months, ymLabel, ymOf } from "../../lib/date";
import { fmtHours, fmtMoney } from "../../lib/format";
import { resizeImage } from "../../lib/image";
import { initials, nameColor } from "../../lib/people";
import { cardSeconds } from "../../lib/time";

export function PersonalDashboard({ clients, cards, cardColumn, now, profile, onClose, onSetPhoto, onSetName, onSetAssistant, onOpenClient }) {
  const photoRef = useRef<any>();
  const seq = last12Months();
  const [period, setPeriod] = useState("12m");
  const inScope = (c: any) => period === "12m" ? seq.includes(ymOf(c.createdAt)) : ymOf(c.createdAt) === period;
  const per = clients.map((cl) => {
    const cs: any[] = Object.values(cards).filter((c: any) => c.clientId === cl.id && inScope(c));
    const sec = cs.reduce((a: number, c) => a + cardSeconds(c, now), 0);
    const rate = Number(cl.rate) || 0;
    return { cl, sec, count: cs.length, rate, revenue: (sec / 3600) * rate };
  }).filter((p) => p.sec > 0 || p.count > 0);
  const totalSec = per.reduce((a, p) => a + p.sec, 0);
  const totalRev = per.reduce((a, p) => a + p.revenue, 0);
  const byHours = [...per].sort((a, b) => b.sec - a.sec);
  const mostBusy = byHours[0];
  const mostProfit = [...per].filter((p) => p.rate > 0).sort((a, b) => b.revenue - a.revenue)[0];
  const denom = totalSec || 1;
  let acc = 0;
  const stops = byHours.map((p) => { const from = (acc / denom) * 360; acc += p.sec; const to = (acc / denom) * 360; return `${p.cl.color} ${from}deg ${to}deg`; }).join(", ");
  const monthly = seq.map((k) => ({ k, sec: (Object.values(cards) as any[]).filter((c: any) => ymOf(c.createdAt) === k).reduce((a: number, c) => a + cardSeconds(c, now), 0) }));
  const maxM = Math.max(1, ...monthly.map((m) => m.sec));
  const rangeLabel = period === "12m" ? `${ymLabel(seq[0])} – ${ymLabel(seq[11])}` : ymLabel(period);
  async function onPhoto(e) { const f = e.target.files?.[0]; if (!f) return; try { const d = await resizeImage(f, 256, "image/jpeg", 0.8); onSetPhoto(d); } catch {} }
  return (
    <div className="adk-page">
      <div className="adk-pcard">
        <div className="adk-pcard-head">
          <button className="adk-back" onClick={onClose} title="חזרה"><Icon name="arrowR" size={22} /></button>
          <div className="titleblk">
            <input ref={photoRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPhoto} />
            <button className="adk-self" style={{ width: 40, height: 40, border: "2px solid var(--border)", background: nameColor(profile.name || "אני") }} onClick={() => photoRef.current.click()} title="החלף תמונה">
              {profile.photo ? <img src={profile.photo} alt="" /> : <span>{profile.name ? initials(profile.name) : "אני"}</span>}
            </button>
            <div><h2>הדשבורד שלי</h2><span>{rangeLabel}</span></div>
          </div>
          <div className="sp" />
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="12m">12 חודשים אחרונים</option>
            {[...seq].reverse().map((m) => <option key={m} value={m}>{ymLabel(m)}</option>)}
          </select>
          <button className="btn" onClick={() => window.print()}><Icon name="printer" /> הדפסה</button>
        </div>

        <div className="adk-kpistrip">
          <div className="adk-kcell"><b>{fmtHours(totalSec)}<small>שע׳</small></b><span>שעות סה״כ</span></div>
          <div className="adk-kcell"><b>{per.length}</b><span>לקוחות פעילים</span></div>
          {totalRev > 0 && <div className="adk-kcell"><b>{fmtMoney(totalRev)}</b><span>הכנסה משוערת</span></div>}
          <div className="adk-kcell"><b style={{ fontSize: 20 }}>{mostBusy?.cl.name || "—"}</b><span>הכי הרבה עבודה</span></div>
        </div>

        <div className="adk-pcard-body">
          <div className="adk-panel-block">
            <p className="adk-block-title">חלוקת הזמן בין הלקוחות</p>
            {per.length === 0 ? <div className="adk-arch-empty">עדיין אין נתונים</div> : (
              <div style={{ display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap" }}>
                <div className="adk-donut" style={{ backgroundImage: `conic-gradient(${stops})` }} />
                <div className="adk-legend">
                  {byHours.map((p) => (
                    <div className="adk-leg" key={p.cl.id}>
                      <span className="sw" style={{ background: p.cl.color }} />
                      {p.cl.name}
                      <span className="pct">{Math.round((p.sec / denom) * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {mostProfit && (
              <div style={{ background: "var(--accent-soft)", border: "1px solid #bfe2e0", borderRadius: 12, padding: "12px 15px", marginTop: 20 }}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--accent-d)", textTransform: "uppercase", letterSpacing: ".05em" }}>הלקוח הכי רווחי</div>
                <div style={{ fontSize: 16, fontWeight: 800, marginTop: 3 }}>{mostProfit.cl.name} · {fmtMoney(mostProfit.revenue)} <span style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>({fmtHours(mostProfit.sec)}ש × ₪{mostProfit.rate})</span></div>
              </div>
            )}
          </div>
          <div className="adk-panel-block">
            <p className="adk-block-title">שעות עבודה לפי חודש (כל הלקוחות)</p>
            <div className="adk-barchart">
              {monthly.map((m) => (
                <div className="adk-bc-col" key={m.k} title={`${fmtHours(m.sec)} שעות`}>
                  <div className="adk-bc-track"><div className={"adk-bc-bar" + (period === m.k ? " hl" : "")} style={{ height: `${(m.sec / maxM) * 100}%` }} /></div>
                  <div className="adk-bc-x">{m.k.slice(5)}/{m.k.slice(2, 4)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="adk-pcard-foot">
          <p className="adk-block-title">לפי לקוח</p>
          <table className="adk-reptable">
            <thead><tr><th>לקוח</th><th>משימות</th><th>שעות</th><th>נתח</th><th>הכנסה</th></tr></thead>
            <tbody>
              {byHours.map((p) => (
                <tr key={p.cl.id} onClick={() => onOpenClient(p.cl.id)}>
                  <td>{p.cl.name}</td><td>{p.count}</td><td>{fmtHours(p.sec)}</td><td>{Math.round((p.sec / denom) * 100)}%</td><td>{p.rate > 0 ? fmtMoney(p.revenue) : "—"}</td>
                </tr>
              ))}
              {byHours.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--faint)", padding: 24 }}>אין נתונים בתקופה זו</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
