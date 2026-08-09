// DEV-ONLY harness (?archive=1) — the archive drawer over a mock rail + float buttons,
// to verify the scrim covers them and nothing bleeds over the panel.
import { ArchivePanel } from "./ArchivePanel";
import { Icon } from "../ui/Icon";

export function ArchivePreview() {
  const now = Date.now();
  const client = { id: "ali", name: "Alibaba.com", color: "#2563EB" };
  const mk = (id: string, title: string, day: number, creator = "buno") =>
    ({ id, clientId: client.id, title, creator, priority: "regular", archived: true, archivedAt: now - day * 864e5, removedBy: "assistant", timeSpent: 0, subtasks: [], comments: [], attachments: [], createdAt: now - day * 864e5 });
  const items = [
    mk("a1", "לענות להודעות שלא נקראו באליבאבא", 1),
    mk("a2", "להגיב להודעות ממתינות באליבאבא", 4),
    mk("a3", "להשיב ל-7 הודעות ספקים ב-Alibaba", 6),
    mk("a4", "להשיב ל-7 הודעות ספקים באליבאבא", 7),
    mk("a5", "להשיב ל-7 הודעות ספקים באליבאבא", 11),
  ];
  return (
    <div className="adk" style={{ minHeight: "100vh", position: "relative" }}>
      {/* mock fixed chrome that used to bleed over the archive */}
      <img src="/bunologo.svg" className="adk-brand-wm" alt="" aria-hidden="true" />
      <button className="adk-float-av" style={{ background: "#8a4b6b" }}>טל</button>
      <button className="adk-float-bell"><Icon name="bell" size={19} /></button>
      <div className="adk-rail bare">
        <button className="adk-rail-btn"><Icon name="sun" /></button>
        <button className="adk-rail-btn"><Icon name="grid" /></button>
        <button className="adk-rail-btn"><Icon name="calendar" /></button>
        <button className="adk-rail-btn"><Icon name="chart" /></button>
      </div>
      <ArchivePanel items={items} client={client} now={now} onClose={() => { location.search = ""; }} onOpen={() => {}} onRestore={() => {}} onHardDelete={() => {}} />
    </div>
  );
}
