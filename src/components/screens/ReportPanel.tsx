import { useState } from "react";
import { Badge } from "../ui/Badge";
import { Icon } from "../ui/Icon";
import { PeriodPicker } from "../ui/PeriodPicker";
import { DONUT_COLORS } from "../../lib/constants";
import { last12Months, ymLabel, ymOf, dayRange, rangeDays, billDayMs, dayShort, dayRangeLabel } from "../../lib/date";
import { fmtModeHours, fmtMoney } from "../../lib/format";
import { briefGiverOf } from "../../lib/people";
import { cardSeconds, sumHours, cardHours } from "../../lib/time";

export function ReportPanel({ client, cards, cardColumn, now, roundMode = "ceil_hour", initialPeriod = null, onClose, onOpen }) {
  const seq = last12Months();
  const curYm = ymOf(now);
  const [period, setPeriod] = useState(initialPeriod || "month");   // default: the current month (or the period carried from the dashboard)
  // day-level periods ("היום" / "השבוע") scope by a date RANGE; else by whole months.
  const range = dayRange(period, now);
  const dayMode = !!range;
  // which months this period spans (mirrors the dashboard; empty in day-mode)
  const months = dayMode ? [] : period === "quarter" ? seq.slice(-3) : period === "12m" ? seq : period === "month" ? [curYm] : [period];
  const scopeSet = new Set(months);
  // billing month follows the DEADLINE (the date the user controls), else creation.
  const billYm = (c: any) => (c.deadline ? String(c.deadline).slice(0, 7) : ymOf(c.createdAt));
  const inScope = cards.filter((c: any) => dayMode ? (billDayMs(c) >= range!.fromMs && billDayMs(c) <= range!.toMs) : scopeSet.has(billYm(c)));
  const isBillable = (c) => !c.archived || c.removedBy === "client";
  // hours + revenue follow the system rounding principle (same per-card rule as
  // the board header), so the invoice never disagrees with what the board shows.
  const workedHours = sumHours(inScope.filter((c) => !c.archived), now, roundMode);
  const billableHours = sumHours(inScope.filter(isBillable), now, roundMode);
  const rate = Number(client?.rate) || 0;
  const revenue = billableHours * rate;
  const byGiver: Record<string, any> = {};
  // buno is a tool, never a brief-giver: a buno/unattributed card is "ללא שיוך", not buno.
  inScope.filter((c) => !c.archived).forEach((c) => { const g = briefGiverOf(c) || "ללא שיוך"; (byGiver[g] = byGiver[g] || { count: 0, sec: 0 }); byGiver[g].count++; byGiver[g].sec += cardSeconds(c, now); });
  const givers = Object.entries(byGiver).map(([k, v]) => ({ name: k, ...v })).sort((a, b) => b.sec - a.sec);
  const distinctGivers = givers.filter((g) => g.name !== "ללא שיוך").length;
  const gDenom = givers.reduce((a, g) => a + g.sec, 0) || 1;
  let gacc = 0;
  const gStops = givers.map((g, i) => { const from = (gacc / gDenom) * 360; gacc += g.sec; const to = (gacc / gDenom) * 360; return `${DONUT_COLORS[i % DONUT_COLORS.length]} ${from}deg ${to}deg`; }).join(", ");
  // chart buckets mirror the dashboard: a single month → DAYS (a current month shows
  // the elapsed days + 2, e.g. on the 9th → 1..11); else the months in scope. Billed
  // by deadline, so a task re-dated to another day/month moves buckets. Rendered LTR.
  const single = !dayMode && months.length === 1;
  const billDay = (c: any) => { const d = c.deadline ? new Date(String(c.deadline) + "T00:00:00") : new Date(c.createdAt); return d.getDate(); };
  const daysInMonth = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(y, m, 0).getDate(); };
  const dayLimit = single ? (months[0] === curYm ? Math.min(daysInMonth(months[0]), new Date(now).getDate() + 2) : daysInMonth(months[0])) : 0;
  const monthBuckets = period === "quarter" ? months : seq;
  const buckets: (number | string)[] = dayMode ? rangeDays(range!.fromMs, range!.toMs) : single ? Array.from({ length: dayLimit }, (_, i) => i + 1) : monthBuckets;
  const live = cards.filter((c: any) => !c.archived);
  const bucketData = buckets.map((bk) => {
    const inB = dayMode ? live.filter((c: any) => billDayMs(c) === bk) : single ? live.filter((c: any) => billYm(c) === months[0] && billDay(c) === bk) : live.filter((c: any) => billYm(c) === bk);
    return { bk, sec: inB.reduce((a: number, c: any) => a + cardSeconds(c, now), 0), hours: sumHours(inB, now, roundMode) };
  });
  const maxM = Math.max(1, ...bucketData.map((m) => m.sec));
  const listed = [...inScope].sort((a, b) => cardSeconds(b, now) - cardSeconds(a, now));
  const statusOf = (c) => c.archived ? (c.removedBy === "client" ? "הוסר ע״י הלקוח" : "נמחק") : (cardColumn[c.id] === "col-done" ? "הושלם" : "פעיל");
  const rangeLabel = dayMode ? dayRangeLabel(period, now) : period === "month" ? ymLabel(curYm) : period === "quarter" ? `${ymLabel(months[0])} – ${ymLabel(months[2])}` : period === "12m" ? `${ymLabel(seq[0])} – ${ymLabel(seq[11])}` : ymLabel(period);
  return (
    <div className="adk-page">
      <div className="adk-pcard" style={{ display: "flex", flexDirection: "column" }}>
        <div className="adk-pcard-head">
          <button className="adk-back" onClick={onClose} title="חזרה"><Icon name="arrowR" size={22} /></button>
          <div className="titleblk">
            <Badge client={client} size={34} />
            <div><h2>דוח · {client?.name}</h2><span>{rangeLabel}</span></div>
          </div>
          <div className="sp" />
          <PeriodPicker value={period} onChange={setPeriod} seq={seq} />
          <button className="btn" onClick={() => window.print()}><Icon name="printer" /> הדפסה</button>
        </div>

        <div className="adk-kpistrip">
          <div className="adk-kcell"><b>{fmtModeHours(workedHours, roundMode)}<small>שע׳</small></b><span>שעות עבודה</span></div>
          <div className="adk-kcell billable"><b>{fmtModeHours(billableHours, roundMode)}<small>שע׳</small></b><span>שעות לחיוב</span></div>
          <div className="adk-kcell"><b>{inScope.filter((c) => !c.archived).length}</b><span>משימות</span></div>
          <div className="adk-kcell"><b>{distinctGivers}</b><span>נותני בריף</span></div>
          {rate > 0 && <div className="adk-kcell"><b>{fmtMoney(revenue)}</b><span>לחיוב משוער</span></div>}
        </div>
        {billableHours > workedHours && <div className="adk-billnote">שעות לחיוב כוללות גם משימות שהוסרו ע״י הלקוח — השעות עליהן נשמרות ונכנסות לחשבונית.</div>}

        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div className="adk-pcard-body">
          <div className="adk-panel-block">
            <p className="adk-block-title">פילוח שעות לפי נותן בריף</p>
            {givers.length === 0 ? <div className="adk-arch-empty">אין נתונים בתקופה זו</div> : (
              <div style={{ display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap" }}>
                <div className="adk-donut" style={{ backgroundImage: `conic-gradient(${gStops})` }} />
                <div className="adk-legend">
                  {givers.map((g, i) => (
                    <div className="adk-leg" key={g.name}>
                      <span className="sw" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                      {g.name}
                      <span className="pct">{Math.round((g.sec / gDenom) * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="adk-panel-block">
            <p className="adk-block-title">שעות עבודה לפי {dayMode || single ? "יום" : "חודש"}</p>
            <div className="adk-barchart" style={{ direction: "ltr" }}>
              {bucketData.map((m) => (
                <div className="adk-bc-col" key={String(m.bk)} title={`${fmtModeHours(m.hours, roundMode)} שעות`}>
                  <div className="adk-bc-track"><div className={"adk-bc-bar" + (dayMode || single || scopeSet.has(String(m.bk)) ? " hl" : "")} style={{ height: `${(m.sec / maxM) * 100}%` }} /></div>
                  <div className="adk-bc-x">{dayMode ? dayShort(m.bk as number) : single ? m.bk : `${String(m.bk).slice(5)}/${String(m.bk).slice(2, 4)}`}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="adk-pcard-foot" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <p className="adk-block-title">כל המשימות בתקופה</p>
          <div style={{ overflowY: "auto", minHeight: 0 }}>
          <table className="adk-reptable">
            <thead><tr><th>משימה</th><th>נותן בריף</th><th>סטטוס</th><th>שעות</th></tr></thead>
            <tbody>
              {listed.map((c) => (
                <tr key={c.id} onClick={() => onOpen(c.id)}>
                  <td>{c.title || "ללא כותרת"}</td><td>{briefGiverOf(c) || "ללא שיוך"}</td><td>{statusOf(c)}</td><td>{fmtModeHours(cardHours(cardSeconds(c, now), roundMode), roundMode)}</td>
                </tr>
              ))}
              {listed.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--faint)", padding: 24 }}>אין משימות בתקופה זו</td></tr>}
            </tbody>
          </table>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
