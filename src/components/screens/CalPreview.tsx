// DEV-ONLY harness (?cal=1) — the calendar with a long project list, no auth.
import { CalendarPanel } from "./CalendarPanel";

export function CalPreview() {
  const now = Date.now();
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date(now);
  const day = (n: number) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(n)}`;
  const clients = [
    { id: "air", name: "Air Doctor", color: "#C6613F" },
    { id: "home", name: "אישי / בית", color: "#7A5AF0", home: true },
    { id: "codata", name: "codata", color: "#334155" },
    { id: "ali", name: "Alibaba.com", color: "#2563EB" },
    { id: "dyn", name: "Dynadot", color: "#7C3AED" },
    { id: "chk", name: "בדיקות", color: "#4F46E5" },
    { id: "kem", name: "Kemtai", color: "#E8664A" },
    { id: "bio", name: "BioHarvest", color: "#0E8F8C" },
    { id: "shi", name: "Shipito", color: "#C9821A" },
    { id: "ant", name: "Anthropic", color: "#14B8A6" },
  ];
  const mk = (id: string, clientId: string, deadline: string, time: string, title: string) =>
    ({ id, clientId, title, deadline, time, archived: false, subtasks: [], comments: [], attachments: [], timeSpent: 0, createdAt: now });
  const list = [
    mk("c1", "codata", day(9), "12:00", "Design status"),
    mk("c2", "home", day(9), "20:00", "קורס אוטומציה"),
    mk("c3", "air", day(9), "", "יצירת סט תמונות לשימוש חוזר"),
    mk("c4", "bio", day(15), "10:00", "סקירת נתונים"),
  ];
  const cards: any = {}; list.forEach((c) => (cards[c.id] = c));

  return (
    <div className="adk" style={{ minHeight: "100vh" }}>
      <CalendarPanel
        clients={clients} cards={cards} now={now} events={[]}
        onClose={() => { location.search = ""; }} onOpen={() => {}} onOpenEvent={() => {}}
      />
    </div>
  );
}
