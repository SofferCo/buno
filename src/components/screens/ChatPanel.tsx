import { useState, useEffect, useRef } from "react";
import { Icon } from "../ui/Icon";
import { initials } from "../../lib/people";
import { loadAssistantThread, sendReviewAction, subscribeAssistant } from "../../data/assistant";

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

export function ChatPanel({ onClose, answer, onAction, asstLevel, seed, onSeedUsed, ask, live, profileName, calConnected, mailConnected, onOpenCard, onOpenEvent, onOpenSettings, onApproveCard, onRejectCard, onSweepNow, onReviewAction, onUploadFile, eventColor, eventProject, cardColor, invited, onInvitedSeen, onWantPersonalSpace, onGoBoard }: any) {
  const hi = profileName ? `היי ${profileName} 👋` : "היי 👋";
  const [msgs, setMsgs] = useState([{ by: "twin", text: `${hi} אני buno. אני רואה את הלוח שלך ואפשר לשאול אותי עליו — מה פתוח, מה דחוף, מה קורה אצל לקוח מסוים.` }]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [cardActs, setCardActs] = useState<Record<string, string>>({}); // inline draft approve/reject state
  const [sessionState, setSessionState] = useState<{ pending: number; started: boolean } | null>(null); // live guided-review session (drives the continuity chips)
  const [plusOpen, setPlusOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<any>(null); // file staged on the compose bar, waiting for the user's intent
  const [pendingUrl, setPendingUrl] = useState<string | null>(null); // object URL for an image preview
  const plusFileRef = useRef<any>();
  function clearPending() { setPendingFile(null); if (pendingUrl) { URL.revokeObjectURL(pendingUrl); setPendingUrl(null); } }
  const boxRef = useRef<any>();
  const seededRef = useRef(false);
  const threadRef = useRef<string | undefined>(undefined);
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const pushSeen = useRef<Set<string>>(new Set()); // dedup live proactive pushes
  // one continuous conversation: on open, load the ongoing twin thread so the
  // chat isn't empty each time. Falls back to the greeting for a first-timer.
  useEffect(() => {
    if (!live) return;
    loadAssistantThread().then(async (r) => {
      threadRef.current = r.threadId;
      setThreadId(r.threadId);
      if (r.messages.length) setMsgs(r.messages as any);
      // continuity: if a guided-review session is open, greet with a resume prompt
      try {
        const p = await sendReviewAction("rv:peek");
        if (p?.pending && p.pending > 0) {
          setSessionState({ pending: p.pending, started: !!p.started });
          setMsgs((m) => [...m, { by: "twin", text: `נמשיך מאיפה שהפסקנו? יש ${p.pending} הצעות ממתינות`, at: Date.now(), actions: [{ id: "rv:start", label: "בוא נמשיך" }] }]);
        }
      } catch { /* peek is best-effort */ }
    }).catch(() => {});
  }, [live]);
  // invited onboarding: a freshly-joined member opens on a CONTEXTUAL greeting
  // (board, role, what's open) instead of the generic hello — then "tour or work".
  useEffect(() => {
    if (!invited) return;
    const extra = invited.open ? `יש כאן ${invited.open} משימות פתוחות` : "הלוח עדיין ריק";
    const ppl = invited.people > 1 ? ` · ${invited.people} אנשים בצוות` : "";
    setMsgs([{ by: "twin",
      text: `הצטרפת ללוח "${invited.boardName}" בתור ${invited.roleHe}. ${extra}${ppl}.\nרוצה סיור קצר או ישר לעבודה?`,
      at: Date.now(), actions: [{ id: "inv:tour", label: "סיור קצר" }, { id: "inv:work", label: "ישר לעבודה" }] } as any]);
    onInvitedSeen?.();
  }, [invited]);
  // live proactive pushes (D4 reminders / sweep brief) — buno is always open, so
  // they land in the thread without a reload. Dedup by row id (StrictMode + reconnects).
  useEffect(() => {
    if (!live || !threadId) return;
    const off = subscribeAssistant(threadId, (m) => {
      if (m.id && pushSeen.current.has(m.id)) return;
      if (m.id) pushSeen.current.add(m.id);
      setMsgs((cur) => [...cur, m as any]);
    });
    return off;
  }, [live, threadId]);
  // dynamic suggestion chips generated by buno each turn (step 1). null = not asked yet
  // (show the static starters); [] = buno decided nothing adds value (show no chips).
  const [dynSug, setDynSug] = useState<{ label: string; value?: string }[] | null>(null);
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
        setMsgs((m) => [...m, { by: "twin", text: res?.reply || "לא הצלחתי להשיב כרגע.", at: Date.now(), cards: res?.created?.length ? res.created : undefined, events: res?.events?.length ? res.events : undefined, actions: res?.actions?.length ? res.actions : undefined, review: res?.review || undefined }]);
        if (res?.pending && res.pending > 0) setSessionState({ pending: res.pending, started: !!res.started }); // a walk just opened → contextual chips reflect it
        if (Array.isArray(res?.suggestions)) setDynSug(res.suggestions); // buno's contextual chips for THIS moment (may be empty = show none)

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
      if (r?.ok && r?.review) {
        setMsgs((m) => [...m, { by: "twin", text: r.review.text, at: Date.now(), actions: r.review.actions }]);
        try { const p = await sendReviewAction("rv:peek"); setSessionState(p?.pending && p.pending > 0 ? { pending: p.pending, started: !!p.started } : null); } catch { /* best-effort */ }
      }
    } catch { setMsgs((m) => [...m, { by: "twin", text: "לא הצלחתי לסרוק כרגע.", at: Date.now() }]); }
    finally { setTyping(false); }
  }
  // run a guided-review action, append the next step, and refresh the session
  // state (so the continuity chips update). Used by both the in-bubble buttons
  // and the contextual chips.
  async function pushReview(id: string) {
    if (typing || !onReviewAction) return;
    setTyping(true);
    try {
      const r = await onReviewAction(id);
      setSessionState(r?.pending && r.pending > 0 ? { pending: r.pending, started: !!r.started } : null);
      if (r?.reply) setMsgs((m) => [...m, { by: "twin", text: r.reply, at: Date.now(), actions: r?.reviewDone ? undefined : r?.actions, review: r?.reviewDone ? undefined : (r?.review || undefined) }]);
    } catch { setMsgs((m) => [...m, { by: "twin", text: "לא הצלחתי כרגע.", at: Date.now() }]); }
    finally { setTyping(false); }
  }
  // a guided-review button: url actions open the link; the rest advance the walk.
  // `mi` is the message the button lives on — we stamp the chosen action onto it
  // so the button reads as pressed (not untouched) once the walk moves on.
  async function reviewClick(action: any, mi: number) {
    if (action?.url) { window.open(action.url, "_blank"); return; }
    if (String(action?.id || "").startsWith("inv:")) { await invitedClick(action.id, mi); return; }
    if (typing || !onReviewAction) return;
    setMsgs((m) => m.map((x: any, k) => (k === mi ? { ...x, resolved: action.id } : x)));
    await pushReview(action.id);
  }
  // invited-onboarding chips (local, never the guided-review edge path).
  const personalOffered = useRef(false);
  function offerPersonalSpace() {
    if (personalOffered.current) return;
    personalOffered.current = true;
    setMsgs((m) => [...m, { by: "twin", at: Date.now(),
      text: "אגב — אפשר לפתוח לך גם מרחב אישי משלך, לצד הלוח המשותף. רוצה?",
      actions: [{ id: "inv:personal-yes", label: "כן, פתח לי" }, { id: "inv:personal-no", label: "לא צריך" }] } as any]);
  }
  async function invitedClick(id: string, mi: number) {
    setMsgs((m) => m.map((x: any, k) => (k === mi ? { ...x, resolved: id } : x)));
    if (id === "inv:tour") { await send("סכם לי בקצרה מה פתוח בלוח הזה ומה הכי דחוף"); setTimeout(offerPersonalSpace, 400); return; }
    if (id === "inv:work") {
      setMsgs((m) => [...m, { by: "twin", text: "מעולה. אני כאן — כתוב לי כל דבר ואפעל.", at: Date.now() } as any]);
      setTimeout(offerPersonalSpace, 400); return;
    }
    if (id === "inv:personal-yes") { onWantPersonalSpace?.(); return; }
    if (id === "inv:personal-no") { setMsgs((m) => [...m, { by: "twin", text: "בסדר גמור — נשארים בלוח המשותף. 🙂", at: Date.now() } as any]); return; }
  }
  // the contextual-chip set, chosen by state: an in-progress walk offers resume/skip;
  // a queued-but-unstarted session (e.g. after a morning snapshot) offers to begin;
  // otherwise the plain suggestions.
  function chipSet(): { label: string; act: () => void }[] {
    if (sessionState && sessionState.pending > 0) {
      return sessionState.started
        ? [{ label: "נמשיך?", act: () => pushReview("rv:start") }, { label: "דלג על הכול", act: () => pushReview("rv:skipall") }]
        : [{ label: "בוא נעבור על העדכונים", act: () => pushReview("rv:start") }];
    }
    // once buno has answered, use ITS suggestions for this moment: [] → no chips at all
    // (zero is a valid answer — e.g. after a day summary). null → the static starters.
    if (dynSug !== null) return dynSug.map((s) => ({ label: s.label, act: () => send(s.label) }));
    return suggestions.map((s: string) => ({ label: s, act: () => send(s) }));
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
      <div className="adk-chat">
        <div className="adk-chat-head">
          <div className="adk-chat-id">
            <div className="adk-chat-av"><img src="/bunologo.svg" alt="buno" /></div>
            <b>buno</b>
          </div>
          <div className="sp" style={{ flex: 1 }} />
          <button className="adk-conn-tag" title={`מחובר ל־ ${connectedNames}`} onClick={() => onOpenSettings?.()}><span className="d" />מחובר</button>
          {/* mobile only: jump to the board (buno stays live, just moves behind) */}
          <button className="adk-chat-board" title="הלוח" onClick={() => onGoBoard?.()}><Icon name="grid" size={18} /></button>
        </div>
        <div className="adk-chat-body" ref={boxRef}>
          {msgs.map((m: any, i) => (
            <div key={i} className={"adk-msg " + m.by}>
              <div className="adk-bubble">
                {(() => {
                  const proj = m.review?.project;
                  const projCol = proj ? cardColor?.({ project: proj }) : null;
                  return m.text.split("\n").map((l: string, k: number) =>
                    // the project line is upgraded to a colored chip (with an avatar dot)
                    proj && l.trim() === String(proj).trim()
                      ? <span key={k} className="adk-rv-proj" style={projCol ? { color: projCol, borderColor: projCol } : undefined}>
                          <span className="dot" style={projCol ? { background: projCol } : undefined} />{proj}
                        </span>
                      : renderLine(l, k));
                })()}
                {m.actions && m.actions.length > 0 && (
                  <div className="adk-rv-acts">
                    {m.actions.map((a: any) => {
                      const spent = !!m.resolved;            // an action was already chosen on this message
                      const chosen = m.resolved === a.id;
                      return (
                        <button key={a.id}
                          className={"adk-rv-btn" + (a.url ? " link" : "") + (spent ? (chosen ? " chosen" : " dimmed") : "")}
                          disabled={spent && !a.url}
                          onClick={() => reviewClick(a, i)}>{a.label}{chosen ? " ✓" : ""}</button>
                      );
                    })}
                  </div>
                )}
                {m.at && <div className="adk-msg-time">{fmtMsgTime(m.at)}{m.waFailed ? " · לא נשלח לוואטסאפ" : ""}</div>}
                {m.events && m.events.length > 0 && (
                  <div className="adk-chat-cards">
                    {m.events.map((e: any, ei: number) => {
                      const t = e.allDay ? "כל היום" : (e.start || "").slice(11, 16);
                      const p = eventProject?.(e);
                      const col = p?.color || eventColor?.(e) || null;
                      const isMeeting = (e.attendees || []).some((a: any) => !a.self);
                      return (
                        <button key={e.id || ei} className="adk-chat-card ev" onClick={() => onOpenEvent?.(e)}
                          style={col ? ({ ["--pc"]: col } as any) : undefined}>
                          <span className="ic cal" style={col ? { background: col } : undefined}><Icon name="calendar" size={12} /></span>
                          <span className="tx"><b>{e.title}</b><em>{t}{isMeeting ? " · פגישה" : ""}{p?.name && <>{" · "}<span className="bdot" style={col ? { background: col } : undefined} />{p.name}</>}</em></span>
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
                          <button className="adk-chat-card" onClick={() => onOpenCard?.(c.id)} style={col ? ({ ["--pc"]: col } as any) : undefined}>
                            <span className="ic" style={{ ...(col ? { background: col } : {}), fontSize: 10, fontWeight: 800, letterSpacing: ".02em" }}>{c.project ? initials(c.project) : <Icon name="sun" size={12} />}</span>
                            <span className="tx"><b>{c.title}</b>{c.project && <em><span className="bdot" style={col ? { background: col } : undefined} />{c.project}</em>}</span>
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
          {typing && <div className="adk-msg twin"><div className="adk-bubble typing"><span /><span /><span /></div></div>}
          {/* contextual chips live INSIDE the stream, on the user's side, under buno's
              last message — they vanish while typing and return after buno replies */}
          {!pendingFile && !input.trim() && !typing && msgs.length > 0 && msgs[msgs.length - 1].by === "twin" && chipSet().length > 0 && (
            <div className="adk-chat-streamchips">
              {chipSet().slice(0, 4).map((c, ci) => <button key={ci} onClick={c.act}>{c.label}</button>)}
            </div>
          )}
        </div>
        {pendingFile && (
          <div className={"adk-chat-pending" + (pendingUrl ? " img" : "")}>
            {pendingUrl
              ? <span className="thumb"><img src={pendingUrl} alt={pendingFile.name} /><button className="x" onClick={clearPending} title="הסר">×</button></span>
              : <><span className="pf">📎 <span className="fn">{pendingFile.name}</span></span><button className="x" onClick={clearPending} title="הסר">×</button></>}
          </div>
        )}
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
          <button className="adk-cmt-send" onClick={() => send()} title="שלח"><Icon name="arrowUp" size={18} /></button>
          <button className="adk-mic" title="הקלטה קולית — בקרוב" onClick={() => {}}><Icon name="mic" size={18} /></button>
        </div>
      </div>
    </>
  );
}
