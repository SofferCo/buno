// DEV-ONLY harness (?peek=1) — the projects "peek" flyout, open, with mock projects.
import { Badge } from "../ui/Badge";
import { Icon } from "../ui/Icon";

export function PeekPreview() {
  const clients = [
    { id: "air", name: "Air Doctor", color: "#C6613F" },
    { id: "home", name: "אישי / בית", color: "#7A5AF0", home: true },
    { id: "codata", name: "codata", color: "#334155" },
    { id: "buno", name: "buno", color: "#0E8F8C" },
    { id: "ali", name: "Alibaba.com", color: "#2563EB" },
    { id: "dyn", name: "Dynadot", color: "#7C3AED" },
    { id: "chk", name: "בדיקות", color: "#4F46E5" },
    { id: "kem", name: "Kemtai", color: "#E8664A" },
    { id: "bio", name: "BioHarvest", color: "#0E8F8C" },
    { id: "shi", name: "Shipito", color: "#C9821A" },
  ];
  const counts: Record<string, number> = { air: 24, home: 48, codata: 12, buno: 22, ali: 4, dyn: 4, chk: 10, kem: 1, bio: 3, shi: 1 };
  const currentId = "air";
  return (
    <div className="adk" style={{ minHeight: "100vh", position: "relative" }}>
      <div className="adk-rail bare">
        <button className="adk-rail-btn" data-label="היום שלי"><Icon name="sun" /></button>
        <div className="adk-peek-zone">
          <button className="adk-rail-btn" data-label="פרויקטים"><Icon name="grid" /></button>
          <div className="adk-peek">
            <button className="adk-peek-row special">
              <span className="adk-day-sun sm"><Icon name="sun" size={15} /></span>
              <span className="nm">היום שלי</span>
              <span className="cnt">3</span>
            </button>
            <div className="adk-peek-sep" />
            {clients.map((c) => (
              <button key={c.id} className={"adk-peek-row" + (c.id === currentId ? " active" : "")}>
                <Badge client={c} size={24} />
                <span className="nm">{c.name}</span>
                <span className="cnt">{counts[c.id]}</span>
              </button>
            ))}
            <button className="adk-peek-add">+ הוסף פרוייקט</button>
          </div>
        </div>
        <button className="adk-rail-btn" data-label="יומן"><Icon name="calendar" /></button>
        <button className="adk-rail-btn" data-label="דשבורד"><Icon name="chart" /></button>
      </div>
    </div>
  );
}
