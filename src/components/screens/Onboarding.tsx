import { useState, useRef, useEffect } from "react";
import { Icon } from "../ui/Icon";

// buno — first-run onboarding, DESIGN PROTOTYPE (front-end only, mocked backend).
// Faithful to buno-onboarding-script.md (exact copy) + buno-onboarding-handoff.md
// (state machine). The door is a chat: one buno message + one input per node,
// skip always available, every skip leaves a working state. No real OTP / OAuth /
// board writes yet — mock* transitions stand in; wiring swaps them later.
//
// States (handoff §1): welcome → otp → verticals → sharing → boards → first_task
//   → calendar_offer → [calendar] → whatsapp → my_day. Phase-0 never mentions
//   WhatsApp (the reveal is saved for step 5).

type Step = "welcome" | "otp" | "verticals" | "sharing" | "boards" | "first_task"
  | "calendar_offer" | "calendar" | "whatsapp" | "my_day";
type Msg = { by?: "twin" | "me"; text?: string; kind?: "boards" | "calendar" | "typing" };

const VERTICALS = [
  { key: "business", label: "העסק שלי", emoji: "💼", color: "#0E8F8C" },
  { key: "home", label: "הבית והמשפחה", emoji: "🏠", color: "#8E54C4" },
  { key: "idea", label: "רעיון שאני בונה", emoji: "💡", color: "#C9821A" },
  { key: "personal", label: "סדר בחיים האישיים", emoji: "🎯", color: "#3B6FE0" },
] as const;
const vLabel = (k: string) => VERTICALS.find((v) => v.key === k)?.label || "";
const vColor = (k: string) => VERTICALS.find((v) => v.key === k)?.color || "#455A64";

// buno's own setup cards — the first board IS the onboarding (handoff §2).
type Card = { id: string; title: string; done: boolean };
const SETUP_CARDS: Card[] = [
  { id: "know", title: "להכיר את בונו", done: true },
  { id: "cal", title: "לחבר את יומן גוגל", done: false },
  { id: "wa", title: "לגלות את בונו בוואטסאפ", done: false },
  { id: "first", title: "להוסיף את המשימה האמיתית הראשונה שלך", done: false },
];

const CAL_ITEMS = [
  { id: "c1", text: "פגישה עם דנה — חמישי 10:00", board: "business" },
  { id: "c2", text: "רופא שיניים — שני הבא", board: "home" },
];

export function Onboarding({ onDone, onSeed, onAddTask, onComplete, calEvents, boardOptions, inferBoard, onCreateEventCard, onWhatsappSeen, onTrack }: {
  onDone?: () => void;
  onSeed?: (verts: { key: string; label: string; color: string }[]) => void;   // seed real boards
  onAddTask?: (boardKey: string, text: string) => void;                          // land the first task
  onComplete?: () => void;                                                       // finish → My Day
  calEvents?: any[];                                                             // up to 6 real upcoming events (A2)
  boardOptions?: { id: string; name: string; color: string }[];                  // board options for the dropdown
  inferBoard?: (ev: any) => string | null;                                       // auto-assign an event to a board
  onCreateEventCard?: (ev: any, boardId: string) => void;                        // create a prep card for an event
  onWhatsappSeen?: () => void;                                                    // close the "discover WA" setup card
  onTrack?: (event: string, props?: any) => void;                                // analytics
}) {
  // REAL mode = wired into the app (post-login first-run): the user is already
  // authenticated, so skip the phone/OTP intro and start at verticals. Without
  // callbacks it stays the pure design preview (?onboarding=1).
  const realMode = !!onSeed;
  const [step, setStep] = useState<Step>(realMode ? "verticals" : "welcome");
  const [msgs, setMsgs] = useState<Msg[]>(realMode ? [
    { by: "twin", text: "היי, אני בונו — העוזר האישי שלך. 👋" },
    { by: "twin", text: "בשביל מה אתה צריך אותי? אפשר לסמן כמה שרוצים — אני יודע להחזיק הכול ביחד." },
  ] : [
    { by: "twin", text: "היי, אני בונו — העוזר האישי שלך. 👋" },
    { by: "twin", text: "מה המספר שלך? אשלח לך קוד כניסה." },
  ]);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [smsShown, setSmsShown] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [task, setTask] = useState("");
  const [cards, setCards] = useState<Card[]>(SETUP_CARDS);
  const [extraCards, setExtraCards] = useState<Record<string, string[]>>({}); // per-board free tasks
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight; }, [msgs, step]);
  // SMS fallback surfaces after 30s of an unverified OTP (script step 0)
  useEffect(() => { if (step !== "otp") return; const t = setTimeout(() => setSmsShown(true), 30000); return () => clearTimeout(t); }, [step]);

  const say = (...t: string[]) => setMsgs((m) => [...m, ...t.map((text) => ({ by: "twin" as const, text }))]);
  const me = (text: string) => setMsgs((m) => [...m, { by: "me", text }]);
  const closeCard = (id: string) => setCards((cs) => cs.map((c) => c.id === id ? { ...c, done: true } : c));

  const boards = (picked.length ? picked : ["personal"]);

  // --- transitions (mocked) -----------------------------------------------
  function submitPhone(skip = false) {
    if (skip) { me("דלג"); say("סבבה — נדלג על האימות בינתיים. אפשר לחבר טלפון אחר כך."); goVerticals(); return; }
    if (phone.trim().length < 9) return;
    me(phone.trim());
    say("שלחתי לך קוד. הקלד אותו כאן 👇");
    setStep("otp");
  }
  function submitCode(skip = false) {
    if (!skip && code.replace(/\D/g, "").length < 4) return;
    me(skip ? "דלג" : code);
    say("מעולה, אתה בפנים. תוך שלוש דקות יהיה לך פה סדר.");
    goVerticals();
  }
  function goVerticals() {
    say("בשביל מה אתה צריך אותי? אפשר לסמן כמה שרוצים — אני יודע להחזיק הכול ביחד.");
    setStep("verticals");
  }
  function submitVerticals(skip = false) {
    const chosen = skip || !picked.length ? ["personal"] : picked;
    setPicked(chosen);
    me(skip || !picked.length ? "כל מה שרלוונטי" : chosen.map(vLabel).join(" · "));
    say("משהו מזה משותף עם עוד אנשים? למשל — את הבית אפשר לנהל ביחד עם בן/בת הזוג, ואת העסק עם הצוות.");
    setStep("sharing");
  }
  function submitSharing(answer: string) {
    me(answer);
    say("בכל מקרה, תמיד אפשר להוסיף אנשים אחר כך — בורד הוא דבר שחי ומשתנה.");
    setStep("boards");
    const list = picked.length ? picked : ["personal"];
    // REAL mode: create the boards for real (they sync + appear in the app).
    onSeed?.(list.map((k) => ({ key: k, label: vLabel(k), color: vColor(k) })));
    const at = (ms: number, fn: () => void) => setTimeout(fn, ms);
    // staged build — buno narrates the "why", then the boards fall in one by one,
    // their cards cascade, and only then he hands the turn back to the user.
    at(500, () => setMsgs((m) => [...m, { kind: "typing" }]));
    at(1500, () => { setMsgs((m) => m.filter((x) => x.kind !== "typing"));
      say(list.length > 1
        ? `סימנת ${list.length} תחומים — פותח בורד לכל אחד, ככה כל דבר יושב במקום שלו ושום דבר לא מתערבב.`
        : "פותח לך את הבורד — מקום אחד שכל מה שחשוב יֵשב בו."); });
    at(2400, () => setMsgs((m) => [...m, { kind: "boards" }]));      // boards + cards cascade (CSS)
    at(4000, () => say("שים לב — כבר שמתי לנו כמה משימות משותפות שנתחיל מהן. ככה תראה איך זה עובד תוך כדי תנועה."));
    at(5000, () => { say("ועכשיו תורך — תגיד לי דבר אחד אמיתי שיושב לך על הראש, ואני אכניס אותו למקום הנכון."); setStep("first_task"); });
  }
  function submitTask(skip = false) {
    if (skip || !task.trim()) { me("אחר כך"); say("אפשר גם אחר כך — הכרטיס מחכה."); goCalendarOffer(); return; }
    const board = picked.includes("business") ? "business" : boards[0];
    me(task.trim());
    onAddTask?.(board, task.trim());   // REAL mode: create the card on that board
    setExtraCards((e) => ({ ...e, [board]: [...(e[board] || []), task.trim()] }));
    closeCard("first");
    say(`נשמע כמו משהו של ${vLabel(board)} — שמתי שם. טעיתי? תגרור.`,
      "נכנס ✅ — וגם סגרתי לנו את \"להוסיף משימה ראשונה\". רואה איך זה עובד?");
    goCalendarOffer();
  }
  function goCalendarOffer() {
    say("בוא נסגור עוד משימה מהרשימה — היומן. אם תחבר אותו, אני אראה מה קורה לך השבוע ואשלב את זה ב\"היום שלי\". בלי לגעת בכלום, רק לקרוא.");
    setStep("calendar_offer");
  }
  function calendarConnect() {
    me("חבר יומן");
    closeCard("cal");
    if (realMode) {
      onTrack?.("calendar_offer_accept");
      // A2 co-creation: if the calendar is already connected we have real upcoming
      // events — assign each to a board and offer to create prep cards. Otherwise
      // defer the OAuth to Settings (no mid-flow redirect that would lose state).
      if (calEvents && calEvents.length) {
        say(`מצאתי ${calEvents.length} דברים קרובים ביומן — לכל אחד שיבצתי בורד. תקן אם צריך, ואפתח מהם משימות.`);
        setMsgs((m) => [...m, { kind: "calendar" }]);
        setStep("calendar");
        return;
      }
      say("מעולה — נחבר את היומן מההגדרות אחרי שנסיים, ואז אני אראה מה קורה לך השבוע ואשלב את זה ב\"היום שלי\".");
      goWhatsapp();
      return;
    }
    say("מצאתי כמה דברים ביומן. תגיד לי מה שווה מעקב:");
    setMsgs((m) => [...m, { kind: "calendar" }]);
    setStep("calendar");
  }
  function calendarSkip() {
    me("דלג בינתיים");
    say("אין בעיה — הכרטיס נשאר על הלוח, נחזור לזה כשתרצה.");
    goWhatsapp();
  }
  function goWhatsapp() {
    onWhatsappSeen?.();   // REAL mode: reaching the WhatsApp reveal closes its setup card
    say(realMode
      ? "ודבר אחרון ששווה לדעת — אני זמין לך גם בוואטסאפ. אפשר לחבר את המספר מההגדרות, ואז מה שתזרוק לי שם יופיע כאן."
      : "ודבר אחרון ששווה לדעת — אני זמין לך גם בוואטסאפ, באותו מספר שנכנסת איתו.",
      "זה אני. אותו בונו, אותו זיכרון, אותם בורדים. תזרוק לי משימה בוואטסאפ תוך כדי יום — היא תופיע פה. תשאל אותי שם מה על הלוח — אני אדע.");
    setStep("whatsapp");
  }
  function goMyDay() {
    say("זהו, אנחנו מסודרים. מחר בבוקר תקבל ממני בריף — מה חשוב היום, בלי רעש.", "נתראה שם 👋");
    setStep("my_day");
  }

  // three macro-phases for the header label
  const phase = ["welcome", "otp"].includes(step) ? 1 : ["verticals", "sharing"].includes(step) ? 2 : 3;

  return (
    <div className="adk ob-root">
      <video className="ob-bg" src="/onboarding-bg.mp4" autoPlay muted loop playsInline />
      <div className="ob-bg-tint" />
      <div className="ob-card">
        <div className="ob-head">
          <div className="ob-av"><img src="/bunologo.svg" alt="buno" /></div>
          <div className="ob-head-tx"><b>בונו</b><span>הקמה ראשונית</span></div>
          <div style={{ flex: 1 }} />
          <div className="ob-steplabel">שלב {phase} מתוך 3</div>
        </div>

        <div className="ob-body" ref={boxRef}>
          {msgs.map((m, i) => {
            if (m.kind === "typing") return (
              <div key={i} className="ob-msg twin"><div className="ob-bubble ob-typing"><span /><span /><span /></div></div>
            );
            if (m.kind === "boards") return <BoardsWidget key={i} boards={boards} cards={cards} extra={extraCards} />;
            if (m.kind === "calendar") return realMode
              ? <RealCalendarBlock key={i} events={calEvents || []} boards={boardOptions || []} inferBoard={inferBoard} onCreate={onCreateEventCard} onDone={goWhatsapp} />
              : <CalendarBlock key={i} onDone={goWhatsapp} />;
            return (
              <div key={i} className={"ob-msg " + m.by}>
                <div className="ob-bubble">{m.text}</div>
              </div>
            );
          })}
        </div>

        <div className="ob-foot">
          {step === "welcome" && (
            <div className="ob-control">
              <input className="ob-input" inputMode="tel" placeholder="050-000-0000" value={phone}
                onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitPhone()} autoFocus />
              <button className="ob-cta" onClick={() => submitPhone()} disabled={phone.trim().length < 9}>שלח לי קוד</button>
              <button className="ob-skip" onClick={() => submitPhone(true)}>דלג</button>
            </div>
          )}
          {step === "otp" && (
            <div className="ob-control ob-otp">
              <input className="ob-input ob-code" inputMode="numeric" maxLength={6} placeholder="— — — —" value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && submitCode()} autoFocus />
              <button className="ob-cta" onClick={() => submitCode()} disabled={code.replace(/\D/g, "").length < 4}>אמת</button>
              {smsShown && <button className="ob-linkbtn" onClick={() => say("שלחתי עכשיו ב־SMS.")}>לא הגיע? שלח ב־SMS</button>}
              <button className="ob-skip" onClick={() => submitCode(true)}>דלג</button>
            </div>
          )}
          {step === "verticals" && (
            <div className="ob-control ob-col">
              <div className="ob-verticals">
                {VERTICALS.map((v) => {
                  const on = picked.includes(v.key);
                  return (
                    <button key={v.key} className={"ob-vcard" + (on ? " on" : "")} style={{ ["--bc" as any]: v.color }}
                      onClick={() => setPicked((p) => on ? p.filter((k) => k !== v.key) : [...p, v.key])}>
                      <span className="ob-vemoji">{v.emoji}</span>
                      <span className="ob-vtx"><b>{v.label}</b></span>
                      <span className="ob-vcheck">{on ? "✓" : ""}</span>
                    </button>
                  );
                })}
              </div>
              <div className="ob-row">
                <button className="ob-cta" onClick={() => submitVerticals()} disabled={!picked.length}>המשך</button>
                <button className="ob-skip" onClick={() => submitVerticals(true)}>דלג</button>
              </div>
            </div>
          )}
          {step === "sharing" && (
            <div className="ob-control">
              <button className="ob-choice" onClick={() => submitSharing("כרגע רק אני")}>כרגע רק אני</button>
              <button className="ob-choice" onClick={() => submitSharing("כן, יש עוד אנשים")}>כן, יש עוד אנשים</button>
            </div>
          )}
          {step === "first_task" && (
            <div className="ob-control">
              <input className="ob-input" placeholder="דבר אחד שיושב לך על הראש…" value={task}
                onChange={(e) => setTask(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitTask()} autoFocus />
              <button className="ob-cta" onClick={() => submitTask()} disabled={!task.trim()}>הוסף</button>
              <button className="ob-skip" onClick={() => submitTask(true)}>דלג</button>
            </div>
          )}
          {step === "calendar_offer" && (
            <div className="ob-control">
              <button className="ob-cta" onClick={calendarConnect}>חבר יומן</button>
              <button className="ob-choice" onClick={calendarSkip}>דלג בינתיים</button>
            </div>
          )}
          {step === "whatsapp" && (
            <div className="ob-control ob-done"><button className="ob-cta ob-big" onClick={goMyDay}>הבנתי, בונו</button></div>
          )}
          {step === "my_day" && (
            <div className="ob-control ob-done"><button className="ob-cta ob-big" onClick={() => (onComplete || onDone)?.()}>קח אותי ל"היום שלי"</button></div>
          )}
        </div>
      </div>
    </div>
  );
}

function BoardsWidget({ boards, cards, extra }: { boards: string[]; cards: Card[]; extra: Record<string, string[]> }) {
  return (
    <div className="ob-boards">
      {boards.map((b, bi) => (
        <div key={b} className="ob-board" style={{ ["--bc" as any]: vColor(b) }}>
          <div className="ob-board-head"><span className="ob-board-dot" /><b>{vLabel(b)}</b></div>
          <div className="ob-board-cards">
            {bi === 0 && cards.map((c) => (
              <div key={c.id} className={"ob-tcard" + (c.done ? " done" : "")}>
                <span className="ob-check">{c.done ? "✓" : ""}</span><span>{c.title}</span>
              </div>
            ))}
            {(extra[b] || []).map((t, i) => (
              <div key={"x" + i} className="ob-tcard new"><span className="ob-check" /><span>{t}</span></div>
            ))}
            {bi !== 0 && !(extra[b] || []).length && <div className="ob-board-empty">ריק בינתיים — נמלא ביחד</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// A2 — REAL calendar co-creation: up to 6 upcoming events, each auto-assigned to a
// board (inferBoard) with a dropdown to correct, and a per-event create/skip.
function RealCalendarBlock({ events, boards, inferBoard, onCreate, onDone }: {
  events: any[]; boards: { id: string; name: string; color: string }[];
  inferBoard?: (ev: any) => string | null;
  onCreate?: (ev: any, boardId: string) => void; onDone: () => void;
}) {
  const keyOf = (e: any) => String(e.id || e.start || Math.random());
  const defBoard = (ev: any) => inferBoard?.(ev) || boards[0]?.id || "";
  const [assign, setAssign] = useState<Record<string, string>>(() => Object.fromEntries(events.map((e) => [keyOf(e), defBoard(e)])));
  const [acted, setActed] = useState<Record<string, "add" | "skip">>({});
  const boardOf = (id: string) => boards.find((b) => b.id === id);
  const fmt = (iso: string) => { try { return new Intl.DateTimeFormat("he-IL", { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); } catch { return ""; } };
  return (
    <div className="ob-cal">
      {events.map((ev) => {
        const k = keyOf(ev); const bid = assign[k]; const b = boardOf(bid);
        return (
          <div key={k} className={"ob-cal-item" + (acted[k] ? " acted" : "")} style={{ ["--bc" as any]: b?.color || "#455A64" }}>
            <div className="ob-cal-tx"><span className="ob-cal-cal"><Icon name="calendar" size={13} /></span><b>{ev.title || "פגישה"}</b> <span style={{ color: "var(--faint)", fontWeight: 600 }}>{fmt(ev.start)}</span></div>
            <div className="ob-cal-assign">
              שייכתי לבורד
              <select className="ob-cal-board" value={bid} onChange={(e) => setAssign((a) => ({ ...a, [k]: e.target.value }))} style={{ marginInlineStart: 6 }}>
                {boards.map((b2) => <option key={b2.id} value={b2.id}>{b2.name}</option>)}
              </select>
            </div>
            {acted[k]
              ? <div className="ob-cal-status">{acted[k] === "add" ? "נוצרה משימה ✓" : "דילגתי"}</div>
              : <div className="ob-cal-acts">
                  <button className="ob-mini ok" onClick={() => { onCreate?.(ev, assign[k]); setActed((a) => ({ ...a, [k]: "add" })); }}>צור משימה</button>
                  <button className="ob-mini" onClick={() => setActed((a) => ({ ...a, [k]: "skip" }))}>לא רלוונטי</button>
                </div>}
          </div>
        );
      })}
      <button className="ob-cta ob-big" style={{ marginTop: 4 }} onClick={onDone}>המשך</button>
    </div>
  );
}

function CalendarBlock({ onDone }: { onDone: () => void }) {
  const [acted, setActed] = useState<Record<string, "add" | "skip">>({});
  return (
    <div className="ob-cal">
      {CAL_ITEMS.map((c) => (
        <div key={c.id} className={"ob-cal-item" + (acted[c.id] ? " acted" : "")} style={{ ["--bc" as any]: vColor(c.board) }}>
          <div className="ob-cal-tx"><span className="ob-cal-cal"><Icon name="calendar" size={13} /></span><b>{c.text}</b></div>
          <div className="ob-cal-assign">
            שייכתי לבורד <button className="ob-cal-board"><span className="ob-board-dot" />{vLabel(c.board)} ▾</button>
          </div>
          {acted[c.id]
            ? <div className="ob-cal-status">{acted[c.id] === "add" ? "נוצרה משימה ✓" : "דילגתי"}</div>
            : <div className="ob-cal-acts">
                <button className="ob-mini ok" onClick={() => setActed((a) => ({ ...a, [c.id]: "add" }))}>צור משימה</button>
                <button className="ob-mini" onClick={() => setActed((a) => ({ ...a, [c.id]: "skip" }))}>לא רלוונטי</button>
              </div>}
        </div>
      ))}
      <button className="ob-cta ob-big" style={{ marginTop: 4 }} onClick={onDone}>המשך</button>
    </div>
  );
}
