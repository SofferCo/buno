// DEV-ONLY harness (?meet=1) — renders a calendar-born card (event materialised as
// a task) so the meeting header + calendar actions can be checked without a session.
import { useState } from "react";
import { CardPanel } from "./CardPanel";

export function MeetCardPreview() {
  const now = Date.now();
  const start = new Date(now); start.setHours(12, 0, 0, 0);
  const end = new Date(now); end.setHours(13, 0, 0, 0);
  const [card, setCard] = useState<any>({
    id: "c_meet", clientId: "codata", title: "Design status", creator: "elior",
    cc: ["elior", "yaniv", "oded"], comments: [], attachments: [], subtasks: [],
    description: "", deadline: new Date(now).toISOString().slice(0, 10), priority: "regular",
    routine: "none", dayFlex: false, time: "12:00", timeSpent: 0, timerStart: null,
    createdAt: now, origin: { type: "calendar", ref: "cal-abc123" },
  });
  const meeting = {
    id: "abc123", title: "Design status", start: start.toISOString(), end: end.toISOString(),
    allDay: false, meetLink: "https://meet.google.com/xxx", htmlLink: "https://calendar.google.com/x",
    myStatus: "accepted", organizer: "elior@codata.io", organizerName: "elior",
    attendees: [
      { email: "elior@codata.io", name: "elior", status: "accepted", organizer: true },
      { email: "yaniv@codata.io", name: "yaniv", status: "needsAction" },
      { email: "oded@codata.io", name: "oded", status: "accepted" },
      { email: "talsoff@gmail.com", name: "talsoff", status: "accepted", self: true },
    ],
  };
  const client = { id: "codata", name: "codata", color: "#334155" };
  return (
    <div className="adk" style={{ position: "fixed", inset: 0, background: "var(--canvas,#eef0f1)" }}>
      <CardPanel
        card={card} now={now} assets={{}} client={client} projects={[client]}
        profileName="אני" viewer={false}
        meeting={meeting}
        onEventAction={async (action: string) => { await new Promise((r) => setTimeout(r, 400)); return { ok: true, start: new Date(now + 30 * 60000).toISOString() }; }}
        onProposeTime={() => alert("→ צ'אט: הצע זמן חדש")}
        onChange={(p: any) => setCard((c: any) => ({ ...c, ...p }))}
        onClose={() => { location.search = ""; }}
        onDelete={() => {}} onComplete={() => {}} onToggleTimer={() => {}}
        onAddFiles={() => {}} onAddLink={() => {}} onUpdateAtt={() => {}} onRemoveAtt={() => {}}
        onMoveProject={() => {}} giverSuggestions={[]}
      />
    </div>
  );
}
