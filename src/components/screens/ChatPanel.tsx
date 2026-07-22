import { useState, useEffect, useRef } from "react";
import { DemoTag } from "../ui/DemoTag";
import { Icon } from "../ui/Icon";

export function ChatPanel({ onClose, answer, onAction, asstLevel, seed, onSeedUsed }) {
  const [msgs, setMsgs] = useState([{ by: "twin", text: "היי טל 👋 אני הכפיל הדיגיטלי שלך — אותה ישות פה ובוואטסאפ. אפשר לשאול על השעות, הלקוחות, ומה דחוף היום." }]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const boxRef = useRef<any>();
  const seededRef = useRef(false);
  const suggestions = ["כמה שעות עבדתי החודש?", "מי הלקוח הכי רווחי?", "מה דחוף היום?", "פתח לי טיוטת משימה"];
  const connectors = [{ n: "לוח", real: true }, { n: "יומן", real: false }, { n: "וואטסאפ", real: false }, { n: "דרייב", real: false }, { n: "מייל", real: false }];
  function send(q?: string) {
    const text = (q ?? input).trim(); if (!text || typing) return;
    // demo: assistant proposes a card via the permission gate
    if (/טיוטת? משימה|צור.*משימה|פתח.*משימה/.test(text) && onAction) {
      setMsgs((m) => [...m, { by: "me", text }]); setInput(""); setTyping(true);
      setTimeout(() => {
        onAction("create_card", { title: "לבדוק בריף חדש מהלקוח", description: "נוצר ע״י העוזר מתוך השיחה (הדגמה).", origin: { type: "chat", ref: "chat-demo-" + Date.now() } });
        const lvl = asstLevel ? asstLevel("cards") : "draft";
        const word = lvl === "act" ? "יצרתי משימה" : lvl === "suggest" ? "הצעתי משימה" : "פתחתי טיוטת משימה";
        setMsgs((m) => [...m, { by: "twin", text: `${word} על הלוח: "לבדוק בריף חדש מהלקוח". ${lvl === "act" ? "" : "היא ממתינה לאישורך — אפשר לאשר או לדחות בכרטיס."}` }]);
        setTyping(false);
      }, 550);
      return;
    }
    setMsgs((m) => [...m, { by: "me", text }]); setInput(""); setTyping(true);
    const reply = answer(text);
    setTimeout(() => { setMsgs((m) => [...m, { by: "twin", text: reply }]); setTyping(false); }, 480);
  }
  function attachDemo() {
    if (typing) return;
    setMsgs((m) => [...m, { by: "me", text: "📎 בריף_לקוח.pdf" }]); setTyping(true);
    setTimeout(() => { setMsgs((m) => [...m, { by: "twin", text: "קיבלתי את הקובץ. בגרסה המחוברת אנתח את הבריף ואפתח ממנו משימה תחת הלקוח המתאים — עם כותרת, דגשים וקבצים מצורפים. (הדגמה)" }]); setTyping(false); }, 650);
  }
  useEffect(() => { if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight; }, [msgs, typing]);
  useEffect(() => { if (seed && !seededRef.current) { seededRef.current = true; send(seed); onSeedUsed && onSeedUsed(); } }, [seed]); // eslint-disable-line
  return (
    <>
      <div className="adk-scrim" onClick={onClose} />
      <div className="adk-chat">
        <div className="adk-chat-head">
          <div className="adk-chat-id"><div className="adk-chat-av"><Icon name="spark" size={18} /></div><div><b>העוזר שלי</b><span>כפיל דיגיטלי · אחד בכל הדלתות</span></div></div>
          <div className="sp" style={{ flex: 1 }} />
          <button className="adk-x" onClick={onClose}>×</button>
        </div>
        <div className="adk-conn">
          <span className="adk-conn-lbl">מחובר ל־</span>
          {connectors.map((c) => (
            <span key={c.n} className={"adk-conn-chip" + (c.real ? " real" : "")} title={c.real ? "מחובר (אמיתי)" : "יחובר בגרסת השרת"}><span className="d" />{c.n}</span>
          ))}
          <DemoTag />
        </div>
        <div className="adk-chat-body" ref={boxRef}>
          {msgs.map((m, i) => (
            <div key={i} className={"adk-msg " + m.by}>
              {m.by === "twin" && <div className="adk-chat-av sm"><Icon name="spark" size={13} /></div>}
              <div className="adk-bubble">{m.text.split("\n").map((l, k) => <div key={k}>{l}</div>)}</div>
            </div>
          ))}
          {typing && <div className="adk-msg twin"><div className="adk-chat-av sm"><Icon name="spark" size={13} /></div><div className="adk-bubble typing"><span /><span /><span /></div></div>}
        </div>
        <div className="adk-chat-sugg">{suggestions.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}</div>
        <div className="adk-chat-input">
          <button className="adk-attach" onClick={attachDemo} title="העלה קובץ (הדגמה)"><Icon name="plus" size={18} /></button>
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder="שאל את הכפיל…" />
          <button className="adk-cmt-send" onClick={() => send()} title="שלח"><Icon name="arrowUp" size={17} /></button>
        </div>
        <div className="adk-chat-wa"><Icon name="comment" size={12} /> השיחה מסונכרנת עם וואטסאפ <DemoTag /></div>
      </div>
    </>
  );
}
