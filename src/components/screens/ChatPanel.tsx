import { useState, useEffect, useRef } from "react";
import { Icon } from "../ui/Icon";
import { loadAssistantThread } from "../../data/assistant";

// buno writes plain Hebrew, but the model still occasionally emits Markdown
// (**bold**, #, *). Render **bold** as bold and strip the rest so the bubble
// reads clean — no raw asterisks (self-audit: "כל הכוכביות האלה — לא נעים").
function renderLine(line: string, k: number) {
  const s = line.replace(/^\s*#{1,6}\s*/, "").replace(/^\s*[-*]\s+/, "• ");
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return (
    <div key={k}>
      {parts.map((p, i) => {
        const b = p.match(/^\*\*([^*]+)\*\*$/);
        if (b) return <b key={i}>{b[1]}</b>;
        return <span key={i}>{p.replace(/[*_`]/g, "")}</span>;
      })}
    </div>
  );
}

// message timestamp: HH:MM for today, "DD.MM · HH:MM" otherwise — so an evening
// sweep (or one from another day) is never mistaken for "now".
function fmtMsgTime(ms: number): string {
  const d = new Date(ms); const now = new Date();
  const hm = d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  const sameDay = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  return sameDay ? hm : `${d.getDate()}.${d.getMonth() + 1} · ${hm}`;
}

export function ChatPanel({ onClose, answer, onAction, asstLevel, seed, onSeedUsed, ask, live, profileName, calConnected, mailConnected, onOpenCard, onOpenEvent, onOpenSettings, onApproveCard, onRejectCard, onSweepNow, onReviewAction, onUploadFile, eventColor, cardColor }: any) {
  const hi = profileName ? `היי ${profileName} 👋` : "היי 👋";
  const [msgs, setMsgs] = useState([{ by: "twin", text: `${hi} אני buno. אני רואה את הלוח שלך ואפשר לשאול אותי עליו — מה פתוח, מה דחוף, מה קורה אצל לקוח מסוים.` }]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [cardActs, setCardActs] = useState<Record<string, string>>({}); // inline draft approve/reject state
  const [plusOpen, setPlusOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<any>(null); // file staged on the compose bar, waiting for the user's intent
  const [pendingUrl, setPendingUrl] = useState<string | null>(null); // object URL for an image preview
  const plusFileRef = useRef<any>();
  function clearPending() { setPendingFile(null); if (pendingUrl) { URL.revokeObjectURL(pendingUrl); setPendingUrl(null); } }
  const boxRef = useRef<any>();
  const seededRef = useRef(false);
  const threadRef = useRef<string | undefined>(undefined);
  // one continuous conversation: on open, load the ongoing twin thread so the
  // chat isn't empty each time. Falls back to the greeting for a first-timer.
  useEffect(() => {
    if (!live) return;
    loadAssistantThread().then((r) => {
      threadRef.current = r.threadId;
      if (r.messages.length) setMsgs(r.messages as any);
    }).catch(() => {});
  }, [live]);
  const suggestions = live
    ? ["מה פתוח היום?", "מה הכי דחוף עכשיו?", "סכם לי מה קורה בלוח", "כמה משימות בכל פרויקט?"]
    : ["כמה שעות עבדתי החודש?", "מי הלקוח הכי רווחי?", "מה דחוף היום?", "פתח לי טיוטת משימה"];
  const connectors = [{ n: "לוח", real: true }, { n: "יומן", real: !!calConnected }, { n: "מייל", real: !!mailConnected }, { n: "וואטסאפ", real: false }, { n: "דרייב", real: false }];
  const connectedNames = connectors.filter((c) => c.real).map((c) => c.n).join(" · ") || "לוח";
  async function send(q?: string) {
    const text = (q ?? input).trim();
    if (typing) return;
    // a staged file waits for the user's intent (B3): act only once they say what to do
    if (pendingFile) {
      const file = pendingFile;
      if (!text) { setMsgs((m) => [...m, { by: "twin", text: `קיבלתי את "${file.name}". מה לעשות איתו — לפתוח ממנו משימה, לצרף ללקוח, או לנתח?`, at: Date.now() }]); return; }
      clearPending(); setInput("");
      setMsgs((m) => [...m, { by: "me", text: `📎 ${file.name} — ${text}`, at: Date.now() }]);
      onUploadFile?.(file, text);
      setMsgs((m) => [...m, { by: "twin", text: `פתחתי טיוטה מהקובץ: "${text}". הקובץ מצורף — אפשר לפתוח ולסדר.`, at: Date.now() }]);
      return;
    }
    if (!text) return;
    // LIVE assistant (Stage 3a: conversation over the real board via Claude)
    if (live && ask) {
      const history = msgs.map((m: any) => ({ role: m.by === "me" ? "user" : "assistant", content: m.text }));
      setMsgs((m) => [...m, { by: "me", text, at: Date.now() }]); setInput(""); setTyping(true);
      try {
        const res = await ask(text, history, threadRef.current);
        if (res?.threadId) threadRef.current = res.threadId;
        setMsgs((m) => [...m, { by: "twin", text: res?.reply || "לא הצלחתי להשיב כרגע.", at: Date.now(), cards: res?.created?.length ? res.created : undefined, events: res?.events?.length ? res.events : undefined }]);
      } catch (e: any) {
        setMsgs((m) => [...m, { by: "twin", text: "buno לא זמין כרגע. נסה שוב בעוד רגע.", at: Date.now() }]);
      } finally { setTyping(false); }
      return;
    }
    // LOCAL fallback (no cloud): demo card via the permission gate + pattern-match answers
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
  // B4 — run the sweep pipeline on demand and show the result in the chat
  async function sweepNowLocal() {
    if (typing) return;
    setPlusOpen(false);
    if (!onSweepNow) return;
    setMsgs((m) => [...m, { by: "me", text: "סרוק עכשיו", at: Date.now() }]); setTyping(true);
    try {
      const r = await onSweepNow();
      const txt = r?.rateLimited || r?.connected === false ? (r?.message || "לא הצלחתי לסרוק כרגע.")
        : r?.ok ? (r.snapshot || "סרקתי — אין פריט חדש.") : (r?.message || "לא הצלחתי לסרוק כרגע.");
      const cards = r?.ok && r?.created?.length ? r.created.map((c: any) => ({ ...c, level: "draft" })) : undefined;
      setMsgs((m) => [...m, { by: "twin", text: txt, at: Date.now(), cards }]);
      // guided review offer (thread updates / invites) → a message with buttons
      if (r?.ok && r?.review) setMsgs((m) => [...m, { by: "twin", text: r.review.text, at: Date.now(), actions: r.review.actions }]);
    } catch { setMsgs((m) => [...m, { by: "twin", text: "לא הצלחתי לסרוק כרגע.", at: Date.now() }]); }
    finally { setTyping(false); }
  }
  // a guided-review button: url actions open the link; the rest advance the walk
  async function reviewClick(action: any) {
    if (action?.url) { window.open(action.url, "_blank"); return; }
    if (typing || !onReviewAction) return;
    setTyping(true);
    try {
      const r = await onReviewAction(action.id);
      setMsgs((m) => [...m, { by: "twin", text: r?.reply || "", at: Date.now(), actions: r?.reviewDone ? undefined : r?.actions }]);
    } catch { setMsgs((m) => [...m, { by: "twin", text: "לא הצלחתי כרגע.", at: Date.now() }]); }
    finally { setTyping(false); }
  }
  // B3 — a picked file is STAGED on the compose bar; buno waits for the user to
  // say what to do with it (never auto-acts on pick).
  function onPickFile(e: any) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    setPlusOpen(false);
    if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    setPendingFile(file);
    setPendingUrl(file.type?.startsWith("image/") ? URL.createObjectURL(file) : null);
  }
  useEffect(() => { if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight; }, [msgs, typing]);
  useEffect(() => { if (seed && !seededRef.current) { seededRef.current = true; send(seed); onSeedUsed && onSeedUsed(); } }, [seed]); // eslint-disable-line
  return (
    <>
      <div className="adk-scrim" onClick={onClose} />
      <div className="adk-chat">
        <div className="adk-chat-head">
          <div className="adk-chat-id">
            <div className="adk-chat-av"><Icon name="sun" size={18} /></div>
            <div>
              <b>buno</b>
              <button className="adk-conn-tag" title={`מחובר ל־ ${connectedNames}`} onClick={() => onOpenSettings?.()}><span className="d" />מחובר</button>
            </div>
          </div>
          <div className="sp" style={{ flex: 1 }} />
          <button className="adk-x" onClick={onClose}>×</button>
        </div>
        <div className="adk-chat-body" ref={boxRef}>
          {msgs.map((m: any, i) => (
            <div key={i} className={"adk-msg " + m.by}>
              {m.by === "twin" && <div className="adk-chat-av sm"><Icon name="sun" size={13} /></div>}
              <div className="adk-bubble">
                {m.text.split("\n").map((l: string, k: number) => renderLine(l, k))}
                {m.actions && m.actions.length > 0 && (
                  <div className="adk-rv-acts">
                    {m.actions.map((a: any) => (
                      <button key={a.id} className={"adk-rv-btn" + (a.url ? " link" : "")} onClick={() => reviewClick(a)}>{a.label}</button>
                    ))}
                  </div>
                )}
                {m.at && <div className="adk-msg-time">{fmtMsgTime(m.at)}{m.waFailed ? " · לא נשלח לוואטסאפ" : ""}</div>}
                {m.events && m.events.length > 0 && (
                  <div className="adk-chat-cards">
                    {m.events.map((e: any, ei: number) => {
                      const t = e.allDay ? "כל היום" : (e.start || "").slice(11, 16);
                      const col = eventColor?.(e);
                      return (
                        <button key={e.id || ei} className="adk-chat-card ev" onClick={() => onOpenEvent?.(e)}>
                          <span className="ic cal" style={col ? { background: col } : undefined}><Icon name="calendar" size={12} /></span>
                          <span className="tx"><b>{e.title}</b><em>{t}{(e.attendees || []).some((a: any) => !a.self) ? " · פגישה" : ""}</em></span>
                          <span className="go">›</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {m.cards && m.cards.length > 0 && (
                  <div className="adk-chat-cards">
                    {m.cards.map((c: any) => {
                      const col = cardColor?.(c);
                      const isDraft = c.level && c.level !== "act"; // buno-created drafts get inline approve/reject
                      const act = cardActs[c.id];
                      return (
                        <div key={c.id} className="adk-chat-cardwrap">
                          <button className="adk-chat-card" onClick={() => onOpenCard?.(c.id)}>
                            <span className="ic" style={col ? { background: col } : undefined}><Icon name="sun" size={12} /></span>
                            <span className="tx"><b>{c.title}</b>{c.project && <em>{c.project}</em>}</span>
                            <span className="go">›</span>
                          </button>
                          {isDraft && (act
                            ? <span className={"adk-chat-card-status " + act}>{act === "approved" ? "אושר ✓" : "נדחה"}</span>
                            : <span className="adk-chat-card-acts">
                                <button className="ok" onClick={() => { onApproveCard?.(c.id); setCardActs((s: any) => ({ ...s, [c.id]: "approved" })); }}>אשר</button>
                                <button className="no" onClick={() => { onRejectCard?.(c.id); setCardActs((s: any) => ({ ...s, [c.id]: "rejected" })); }}>דחה</button>
                              </span>)}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
          {typing && <div className="adk-msg twin"><div className="adk-chat-av sm"><Icon name="sun" size={13} /></div><div className="adk-bubble typing"><span /><span /><span /></div></div>}
        </div>
        {pendingFile && (
          <div className={"adk-chat-pending" + (pendingUrl ? " img" : "")}>
            {pendingUrl
              ? <span className="thumb"><img src={pendingUrl} alt={pendingFile.name} /><button className="x" onClick={clearPending} title="הסר">×</button></span>
              : <><span className="pf">📎 <span className="fn">{pendingFile.name}</span></span><button className="x" onClick={clearPending} title="הסר">×</button></>}
          </div>
        )}
        {!pendingFile && <div className="adk-chat-sugg">{suggestions.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}</div>}
        <div className="adk-chat-input">
          <div className="adk-plus">
            <button className="adk-attach" onClick={() => setPlusOpen((o) => !o)} title="עוד"><Icon name="plus" size={18} /></button>
            {plusOpen && (<>
              <button className="adk-plus-scrim" onClick={() => setPlusOpen(false)} aria-label="סגור" />
              <div className="adk-plus-menu">
                {live && onSweepNow && <button onClick={sweepNowLocal}><Icon name="sun" size={14} /> סרוק עכשיו</button>}
                <button onClick={() => plusFileRef.current?.click()}><Icon name="plus" size={14} /> העלה קובץ</button>
              </div>
            </>)}
            <input ref={plusFileRef} type="file" hidden onChange={onPickFile} />
          </div>
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder={pendingFile ? "כתוב מה לעשות עם הקובץ…" : "שאל את בונו…"} />
          <button className="adk-cmt-send" onClick={() => send()} title="שלח"><Icon name="arrowUp" size={17} /></button>
        </div>
      </div>
    </>
  );
}
