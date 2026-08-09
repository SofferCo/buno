// DEV-ONLY visual harness for "היום שלי" (?myday=1) — mock data, no auth. Lets
// the timeline redesign be checked against the spec without a live session.
import { useState } from "react";
import { MyDay } from "./MyDay";

export function MyDayPreview() {
  const now = Date.now();
  const [doneIds, setDoneIds] = useState<Record<string, number>>({}); // id → completion ms (live toggle to verify mark-done)
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  const dayStr = (off: number) => { const x = new Date(now + off * 864e5); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
  const todayKey = dayStr(0);
  const atToday = (h: number, m: number) => { const x = new Date(now); x.setHours(h, m, 0, 0); return x.getTime(); };

  const clients = [
    { id: "c1", name: "Air Doctor", color: "#C6613F" },
    { id: "c2", name: "BioHarvest", color: "#0E8F8C" },
    { id: "home", name: "אישי / בית", color: "#7A5AF0", home: true },
  ];
  const baseDone = [
    { at: atToday(9, 55), card: { id: "d0", title: "בדיקת דם אלי ומסירת שתן", clientId: "home" } },
    { at: atToday(10, 25), card: { id: "d1", title: "לבצע תיקונים במצגת לפי הערות יאיר", clientId: "c1" } },
    { at: atToday(10, 40), card: { id: "d2", title: "פגישה ועבודה – תיקוני מצגת", clientId: "c2" } },
  ];
  const basePlan = [
    { card: { id: "o1", title: "לשלם קנס אכיפה עירונית", clientId: "home", deadline: dayStr(-1), time: "", priority: "regular" } }, // flexible + past → NOT tagged, sinks to bottom
    { card: { id: "o2", title: "שיחת גבייה — ספק Shipito", clientId: "c1", deadline: dayStr(-3), time: "10:00", priority: "important" } }, // timed + past → overdue
    { card: { id: "a1", title: "תצרפי את זה ל-airdr", clientId: "c1", deadline: todayKey, time: "13:30", priority: "regular" } },
    { card: { id: "a2", title: "חאלקה ניל", clientId: "home", deadline: todayKey, time: "17:30", priority: "regular" } },
    { card: { id: "a3", title: "לסדר משימות", clientId: "home", deadline: todayKey, time: "", priority: "regular" } },
  ];
  // live toggle: clicking a rail circle marks done (moves to the green block) / reopens
  const planTasks = basePlan.filter((t: any) => !(t.card.id in doneIds));
  const completedToday = [
    ...baseDone.filter((d: any) => !(d.card.id in doneIds)),
    ...basePlan.filter((t: any) => t.card.id in doneIds).map((t: any) => ({ at: doneIds[t.card.id], card: t.card })),
  ];
  const upcoming = [
    { card: { id: "u1", title: "לבצע תיקונים במצגת לפי הערות יאיר", clientId: "c1", deadline: dayStr(3), time: "", priority: "important" } },
    { card: { id: "u2", title: "סגירת חודש - אצל כל הספקים", clientId: "c2", deadline: dayStr(5), time: "", priority: "regular" } },
  ];
  const events = { [todayKey]: [
    { t: "פגישת סנכרון — נועה", time: "15:00", location: "Google Meet", ev: { title: "פגישת סנכרון — נועה" }, projectId: "c2" },
  ] };

  return (
    <MyDay
      planTasks={planTasks} upcoming={upcoming} completedToday={completedToday}
      clients={clients} now={now} events={events}
      pending={{ drafts: 2, requests: 0 }} capacity={6} roundMode="ceil_hour"
      onClose={() => { location.search = ""; }} onOpenCard={() => {}} onOpenEvent={() => {}}
      onToggleTimer={() => {}} onDefer={() => {}}
      onDone={(id: string) => setDoneIds((p) => ({ ...p, [id]: now }))}
      onReopen={(id: string) => setDoneIds((p) => { const n = { ...p }; delete n[id]; return n; })}
    />
  );
}
