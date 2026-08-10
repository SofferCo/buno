// DEV-ONLY harness (?notif=1, add &theme=dark) — the notifications panel with mock rows.
import { useState } from "react";
import { NotifPanel } from "./NotifPanel";

export function NotifPreview() {
  const now = Date.now();
  const h = (n: number) => now - n * 3600e3;
  const [notifs, setNotifs] = useState<any[]>([
    { id: "1", type: "draft", status: "ממתין לאישור", at: h(1), cardId: "c1", title: "לסגור את הווידאו לנועם", client: "Air Doctor", color: "#C6613F", desc: "דדליין 2026-08-12 · Air Doctor", person: null, complete: true },
    { id: "2", type: "draft", status: "ממתין לאישור", at: h(3), cardId: "c2", title: "באנרים לקמפיין", client: "codata", color: "#334155", desc: "codata", person: null, complete: false },
    { id: "3", type: "comment", status: "תגובה חדשה", at: h(5), cardId: "c3", title: "עיצוב לנדינג", client: "BioHarvest", color: "#0E8F8C", desc: "יאיר כהן: אפשר לגוון את הכותרת?", person: "יאיר כהן", complete: false },
    { id: "4", type: "request", status: "בקשת תזמון", at: h(26), cardId: "c4", title: "פגישת סטטוס", client: "Air Doctor", color: "#C6613F", desc: "מוצע: מחר 15:00", person: "דנה לוי", complete: false },
    { id: "5", type: "mention", status: "תויגת", at: h(30), cardId: "c5", title: "סקירת נתונים", client: "codata", color: "#334155", desc: "טל: @אני צריך את זה עד חמישי", person: "טל סופר", complete: false },
    { id: "6", type: "untitled", status: "להשלמה", at: h(50), cardId: "c6", title: "כרטיס בלי כותרת", client: "BioHarvest", color: "#0E8F8C", desc: "BioHarvest", person: null, complete: false },
    { id: "7", type: "comment", status: "תגובה חדשה", at: h(100), cardId: "c7", title: "ריטיינר אוגוסט", client: "Air Doctor", color: "#C6613F", desc: "עודד: שילמנו, אפשר לסגור", person: "עודד", complete: false },
  ]);
  const notifSeen = h(4); // rows older than 4h read; newer unread
  const remove = (cardId: string) => setNotifs((p) => p.filter((n) => n.cardId !== cardId));
  return (
    <div className="adk" style={{ minHeight: "100vh", padding: 20 }}>
      <NotifPanel notifs={notifs} notifSeen={notifSeen} now={now}
        onApprove={remove} onReject={remove} onOpen={(id: string) => alert("פתח: " + id)}
        onMarkAll={() => alert("סמן הכל כנקרא")} onClose={() => { location.search = ""; }} />
    </div>
  );
}
