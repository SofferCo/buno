import { useState, useRef } from "react";
import { Icon } from "../ui/Icon";
import { PeriodPicker } from "../ui/PeriodPicker";
import { last12Months, ymLabel, ymOf } from "../../lib/date";
import { fmtHours, fmtMoney } from "../../lib/format";
import { resizeImage } from "../../lib/image";
import { initials, nameColor } from "../../lib/people";
import { cardSeconds } from "../../lib/time";

export function PersonalDashboard({ clients, cards, cardColumn, now, profile, onClose, onSetPhoto, onSetName, onSetAssistant, onOpenClient, onShareClient }: any) {
  const photoRef = useRef<any>();
  const seq = last12Months();               // 12 "YYYY-MM" keys, oldest → newest
  const curYm = ymOf(now);
  const [period, setPeriod] = useState("month");   // default: the current month

  // which months the current period spans
  const months = period === "quarter" ? seq.slice(-3) : period === "12m" ? seq : period === "month" ? [curYm] : [period];
  const scopeSet = new Set(months);
  const single = months.length === 1;      // a single month → break the bar chart into DAYS
  // billing month follows the DEADLINE (the date the user controls), else creation.
  const billYm = (c: any) => (c.deadline ? String(c.deadline).slice(0, 7) : ymOf(c.createdAt));
  const billDay = (c: any) => { const d = c.deadline ? new Date(String(c.deadline) + "T00:00:00") : new Date(c.createdAt); return d.getDate(); };
  const daysInMonth = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(y, m, 0).getDate(); };
  // deleted / archived tasks never count toward hours or billing.
  const live = (Object.values(cards) as any[]).filter((c: any) => !c.archived);
  const inScope = (c: any) => scopeSet.has(billYm(c));
  const scoped = live.filter(inScope);

  const per = clients.map((cl: any) => {
    const cs = scoped.filter((c: any) => c.clientId === cl.id);
    const sec = cs.reduce((a: number, c: any) => a + cardSeconds(c, now), 0);
    const rate = Number(cl.rate) || 0;
    return { cl, sec, count: cs.length, rate, revenue: (sec / 3600) * rate };
  }).filter((p: any) => p.sec > 0 || p.count > 0);
  const totalSec = per.reduce((a: number, p: any) => a + p.sec, 0);
  const totalRev = per.reduce((a: number, p: any) => a + p.revenue, 0);
  const byHours = [...per].sort((a, b) => b.sec - a.sec);
  const mostBusy = byHours[0];
  const mostProfit = [...per].filter((p) => p.rate > 0).sort((a, b) => b.revenue - a.revenue)[0];
  const denom = totalSec || 1;

  // donut as SVG arcs so each client segment carries its own hover label
  const R = 54, C = 2 * Math.PI * R;
  let cum = 0;
  const arcs = byHours.filter((p) => p.sec > 0).map((p) => { const frac = p.sec / denom; const seg = { p, frac, off: cum }; cum += frac; return seg; });

  // stacked bar chart: buckets are DAYS for a single month, else the months in scope.
  // A single CURRENT month shows only the elapsed days + 2 (e.g. on the 9th → 1..11);
  // a past month shows all its days. Rendered left→right (1 on the left).
  const dayLimit = months[0] === curYm ? Math.min(daysInMonth(months[0]), new Date(now).getDate() + 2) : daysInMonth(months[0]);
  const buckets: (number | string)[] = single ? Array.from({ length: dayLimit }, (_, i) => i + 1) : months;
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const showTip = (e: any, text: string) => setTip({ x: e.clientX, y: e.clientY, text });
  const bucketData = buckets.map((bk) => {
    const inB = single ? scoped.filter((c) => billDay(c) === bk) : scoped.filter((c) => billYm(c) === bk);
    const segs = clients.map((cl: any) => ({ cl, sec: inB.filter((c: any) => c.clientId === cl.id).reduce((a: number, c: any) => a + cardSeconds(c, now), 0) })).filter((s: any) => s.sec > 0);
    return { bk, segs, total: segs.reduce((a: number, s: any) => a + s.sec, 0) };
  });
  const maxB = Math.max(1, ...bucketData.map((b) => b.total));

  const scopeLabel = period === "month" ? "החודש" : period === "quarter" ? "ברבעון האחרון" : period === "12m" ? "ב־12 החודשים האחרונים" : `ב${ymLabel(period)}`;
  const rangeLabel = period === "month" ? ymLabel(curYm) : period === "quarter" ? `${ymLabel(months[0])} – ${ymLabel(months[2])}` : period === "12m" ? `${ymLabel(seq[0])} – ${ymLabel(seq[11])}` : ymLabel(period);
  async function onPhoto(e: any) { const f = e.target.files?.[0]; if (!f) return; try { const d = await resizeImage(f, 256, "image/jpeg", 0.8); onSetPhoto(d); } catch { /* ignore */ } }

  return (
    <div className="adk-page">
      <div className="adk-pcard" style={{ display: "flex", flexDirection: "column" }}>
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
          <PeriodPicker value={period} onChange={setPeriod} seq={seq} />
          <button className="btn" onClick={() => window.print()}><Icon name="printer" /> הדפסה</button>
        </div>

        <div className="adk-kpistrip">
          <div className="adk-kcell"><b>{fmtHours(totalSec)}<small>שע׳</small></b><span>שעות סה״כ</span></div>
          <div className="adk-kcell"><b>{per.length}</b><span>פרוייקטים פעילים</span></div>
          {totalRev > 0 && <div className="adk-kcell"><b>{fmtMoney(totalRev)}</b><span>הכנסה משוערת</span></div>}
          <div className="adk-kcell"><b style={{ fontSize: 20 }}>{mostBusy?.cl.name || "—"}</b><span>הכי הרבה עבודה</span></div>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div className="adk-pcard-body">
            <div className="adk-panel-block">
              <p className="adk-block-title">חלוקת הזמן בין הפרוייקטים</p>
              {per.length === 0 ? <div className="adk-arch-empty">עדיין אין נתונים {scopeLabel}</div> : (
                <div style={{ display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap" }}>
                  <svg width="150" height="150" viewBox="0 0 140 140" style={{ flex: "none" }}>
                    <circle cx="70" cy="70" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="16" />
                    <g transform="rotate(-90 70 70)">
                      {arcs.map((a) => (
                        <circle key={a.p.cl.id} cx="70" cy="70" r={R} fill="none" stroke={a.p.cl.color} strokeWidth="16"
                          strokeDasharray={`${a.frac * C} ${C}`} strokeDashoffset={`${-a.off * C}`} style={{ cursor: "pointer" }}
                          onMouseMove={(e) => showTip(e, `${a.p.cl.name} · ${Math.round(a.frac * 100)}% · ${fmtHours(a.p.sec)} שע׳`)} onMouseLeave={() => setTip(null)} />
                      ))}
                    </g>
                  </svg>
                  <div className="adk-legend">
                    {byHours.map((p) => (
                      <div className="adk-leg" key={p.cl.id}>
                        <span className="sw" style={{ background: p.cl.color }} />
                        <button onClick={() => onOpenClient(p.cl.id, period)} title="פתיחת דוח הפרוייקט לתקופה זו" style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit", padding: 0, textAlign: "start" }}>{p.cl.name}</button>
                        <span className="pct">{Math.round((p.sec / denom) * 100)}%</span>
                        {onShareClient && <button title="שיתוף" onClick={() => onShareClient(p.cl)} style={{ marginInlineStart: 6, background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 0, display: "inline-flex" }}><Icon name="share" size={14} /></button>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {mostProfit && (
                <div style={{ background: "var(--accent-soft)", border: "1px solid #bfe2e0", borderRadius: 12, padding: "12px 15px", marginTop: 20 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--accent-d)", textTransform: "uppercase", letterSpacing: ".05em" }}>הפרוייקט הכי רווחי {scopeLabel}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, marginTop: 3 }}>{mostProfit.cl.name} · {fmtMoney(mostProfit.revenue)} <span style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>({fmtHours(mostProfit.sec)}ש × ₪{mostProfit.rate})</span></div>
                </div>
              )}
            </div>
            <div className="adk-panel-block">
              <p className="adk-block-title">שעות עבודה לפי {single ? "יום" : "חודש"} · צבע לפי פרוייקט</p>
              <div className="adk-barchart" style={{ direction: "ltr" }}>
                {bucketData.map((m) => (
                  <div className="adk-bc-col" key={String(m.bk)}>
                    <div className="adk-bc-track">
                      <div className="adk-bc-stack" style={{ height: `${(m.total / maxB) * 100}%` }}>
                        {m.segs.map((s: any) => (
                          <div key={s.cl.id} style={{ background: s.cl.color, height: `${(s.sec / (m.total || 1)) * 100}%`, cursor: "pointer" }}
                            onMouseMove={(e) => showTip(e, `${s.cl.name} · ${fmtHours(s.sec)} שע׳`)} onMouseLeave={() => setTip(null)} />
                        ))}
                      </div>
                    </div>
                    <div className="adk-bc-x">{single ? m.bk : `${String(m.bk).slice(5)}/${String(m.bk).slice(2, 4)}`}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="adk-pcard-foot" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <p className="adk-block-title">לפי פרוייקט</p>
            <div style={{ overflowY: "auto", minHeight: 0 }}>
              <table className="adk-reptable">
                <thead><tr><th>פרוייקט</th><th>משימות</th><th>שעות</th><th>נתח</th><th>הכנסה</th></tr></thead>
                <tbody>
                  {byHours.map((p) => (
                    <tr key={p.cl.id} onClick={() => onOpenClient(p.cl.id, period)} title="פתיחת דוח הלקוח לתקופה זו">
                      <td>{p.cl.name}</td><td>{p.count}</td><td>{fmtHours(p.sec)}</td><td>{Math.round((p.sec / denom) * 100)}%</td><td>{p.rate > 0 ? fmtMoney(p.revenue) : "—"}</td>
                    </tr>
                  ))}
                  {byHours.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--faint)", padding: 24 }}>אין נתונים {scopeLabel}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      {tip && <div style={{ position: "fixed", left: tip.x + 12, top: tip.y + 12, zIndex: 80, background: "var(--ink)", color: "var(--canvas)", fontSize: 12, fontWeight: 700, padding: "5px 9px", borderRadius: 8, pointerEvents: "none", whiteSpace: "nowrap", direction: "ltr", boxShadow: "0 6px 18px rgba(0,0,0,.25)" }}>{tip.text}</div>}
    </div>
  );
}
