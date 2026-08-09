// DEV-ONLY harness (?report=1) — a client report with mock data, no auth.
import { ReportPanel } from "./ReportPanel";

export function ReportPreview() {
  const now = Date.now();
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date(now);
  const curDay = (day: number) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(day)}`;
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 15);
  const prevDay = (day: number) => `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-${pad(day)}`;
  const h = (n: number) => n * 3600;

  const client = { id: "air", name: "Air Doctor", color: "#C6613F", rate: 300 };
  const mk = (id: string, timeSpent: number, deadline: string, extra: any = {}) =>
    ({ id, clientId: client.id, title: id, timeSpent, timerStart: null, createdAt: now, deadline, archived: false, subtasks: [], comments: [], attachments: [], ...extra });

  const list = [
    mk("קמפיין קיץ", h(4), curDay(4), { creator: "דנה כהן" }),
    mk("עיצוב לנדינג", h(2), curDay(9), { creator: "דנה כהן" }),
    mk("באנרים", h(1.5), curDay(11), { creator: "יוסי לוי" }),
    mk("ניוזלטר", h(3), curDay(20), { creator: "buno" }),
    // created last month but re-dated into this month → should bill THIS month
    mk("ריטיינר", h(2), curDay(6), { createdAt: prev.getTime(), creator: "דנה כהן" }),
    mk("סקיצות ישנות", h(3), prevDay(8), { createdAt: prev.getTime(), creator: "יוסי לוי" }),
    // deleted task with hours — must not count toward worked hours
    mk("בוטל", h(10), curDay(3), { archived: true, archivedAt: now }),
    // removed by client — stays billable
    mk("שהוסר ע״י הלקוח", h(2), curDay(5), { archived: true, removedBy: "client" }),
  ];

  return (
    <div className="adk" style={{ minHeight: "100vh" }}>
    <ReportPanel
      client={client} cards={list} cardColumn={{}} now={now} roundMode="ceil_hour"
      onClose={() => { location.search = ""; }} onOpen={(id: string) => alert("פתיחת משימה: " + id)}
    />
    </div>
  );
}
