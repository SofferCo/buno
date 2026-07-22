// buno — pre-import preview: exactly what will move to the cloud, nothing
// happens until the user confirms. Shown once, when signed in with an empty
// remote board while local data exists.
import { useState } from "react";
import type { Manifest } from "../../data/importer";
import { Badge } from "../ui/Badge";

export function ImportScreen({ manifest, email, onConfirm, onFresh }:
  { manifest: Manifest; email: string; onConfirm: () => Promise<void>; onFresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const t = manifest.totals;

  async function go() {
    if (busy) return;
    setBusy(true); setErr(null);
    try { await onConfirm(); }
    catch (e: any) { setErr(e.message || String(e)); setBusy(false); }
  }

  return (
    <div className="adk">
      <div className="adk-shell adk-import-shell">
        <div className="adk-import">
          <h2>העברת הלוח לענן</h2>
          <p className="sub">נמצא לוח מקומי בדפדפן הזה. זה מה שיעבור לחשבון <b dir="ltr">{email}</b> — שום דבר לא נשמר עד שתאשר.</p>

          <div className="adk-import-clients">
            {manifest.clients.map((c, i) => (
              <div className="row" key={i}>
                <Badge client={{ name: c.name, color: c.color }} size={30} />
                <span className="nm">{c.name}{c.home && <em> · אישי</em>}</span>
                <span className="ct">{c.active} משימות{c.archived > 0 && ` · ${c.archived} בארכיון`}{c.hours > 0 && ` · ${c.hours} שעות`}</span>
              </div>
            ))}
          </div>

          <div className="adk-import-totals">
            <span>{manifest.columns.length} עמודות ({manifest.columns.join(" · ")})</span>
            <span>{t.subtasks} סעיפי צ׳קליסט · {t.comments} תגובות · {t.historyEntries} רישומי עריכה</span>
            {(t.links > 0 || t.files > 0) && <span>{t.links} קישורים{t.files > 0 && ` · ${t.files} קבצים (הקבצים עצמם יעלו כשייווצר bucket האחסון; בינתיים הם נשארים זמינים מקומית)`}</span>}
            {(t.drafts > 0 || t.proposals > 0) && <span>{t.drafts} טיוטות עוזר · {t.proposals} בקשות תזמון — עוברות כמו שהן</span>}
          </div>

          {err && <div className="adk-import-err">ההעברה נכשלה: {err}<br />שום דבר חלקי לא יישאר — אפשר לנסות שוב.</div>}

          <div className="adk-import-actions">
            <button className="adk-btn primary" disabled={busy} onClick={go}>{busy ? "מעביר…" : "העבר את הלוח לענן"}</button>
            <button className="adk-link" disabled={busy} onClick={() => { if (window.confirm("להתחיל מלוח ריק? הלוח המקומי יישאר בדפדפן אבל לא יעבור לענן.")) onFresh(); }}>התחל מלוח ריק</button>
          </div>
        </div>
      </div>
    </div>
  );
}
