// DEV-ONLY harness (?dash=1) — the personal dashboard with mock data, no auth.
import { PersonalDashboard } from "./PersonalDashboard";

export function DashPreview() {
  const now = Date.now();
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date(now);
  const curDay = (day: number) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(day)}`;
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 15);
  const prevDay = (day: number) => `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-${pad(day)}`;
  const h = (n: number) => n * 3600;

  const clients = [
    { id: "codata", name: "codata", color: "#334155", rate: 350 },
    { id: "air", name: "Air Doctor", color: "#C6613F", rate: 300 },
    { id: "bio", name: "BioHarvest", color: "#0E8F8C", rate: 400 },
    { id: "home", name: "אישי / בית", color: "#7A5AF0", rate: 0, home: true },
  ];
  const mk = (id: string, clientId: string, timeSpent: number, deadline: string, extra: any = {}) =>
    ({ id, clientId, title: id, timeSpent, timerStart: null, createdAt: now, deadline, archived: false, subtasks: [], comments: [], attachments: [], ...extra });

  const list = [
    mk("codata-1", "codata", h(3), curDay(4)),
    mk("codata-2", "codata", h(2), curDay(20)),
    mk("air-1", "air", h(4), curDay(10)),
    mk("air-2", "air", h(1.5), curDay(11)),
    mk("bio-1", "bio", h(5), curDay(22)),
    // created LAST month but its deadline was moved into THIS month → should count THIS month (C1)
    mk("bio-moved", "bio", h(2), curDay(6), { createdAt: prev.getTime() }),
    // a couple in the previous month (visible under quarter / that month)
    mk("codata-prev", "codata", h(3), prevDay(8), { createdAt: prev.getTime() }),
    mk("air-prev", "air", h(2), prevDay(18), { createdAt: prev.getTime() }),
    // DELETED task with hours — must NOT appear in billing (C2)
    mk("ghost", "codata", h(10), curDay(3), { archived: true, archivedAt: now }),
  ];
  const cards: any = {}; list.forEach((c) => (cards[c.id] = c));
  const cardColumn: any = {}; list.forEach((c) => (cardColumn[c.id] = "col-brief"));

  return (
    <div className="adk" style={{ minHeight: "100vh" }}>
    <PersonalDashboard
      clients={clients} cards={cards} cardColumn={cardColumn} now={now}
      profile={{ name: "טל", photo: null }}
      onClose={() => { location.search = ""; }} onSetPhoto={() => {}} onSetName={() => {}} onSetAssistant={() => {}}
      onOpenClient={() => {}} onShareClient={(cl: any) => alert("שיתוף: " + cl.name)}
    />
    </div>
  );
}
