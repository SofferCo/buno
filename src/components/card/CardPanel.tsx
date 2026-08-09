import { useState, useRef } from "react";
import { CommentBox } from "./CommentBox";
import { GiverInput } from "./GiverInput";
import { ScheduleNegotiation } from "./ScheduleNegotiation";
import { SchedulePicker } from "./SchedulePicker";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { Icon } from "../ui/Icon";
import { renderMentions } from "../ui/Mentions";
import { Stepper } from "../ui/Stepper";
import { PRIORITY, ROUTINE_LABEL } from "../../lib/constants";
import { relTime, routineKind } from "../../lib/date";
import { fmtClock, fmtShort } from "../../lib/format";
import { uid } from "../../lib/id";
import { ccOf, creatorOf } from "../../lib/people";
import { cardSeconds, subHours } from "../../lib/time";

const MY_STATUS: Record<string, string> = { accepted: "אישרת הגעה", declined: "סירבת", tentative: "אולי", needsAction: "טרם ענית" };

export function CardPanel({ card, now, assets, client, projects, onMoveProject, onCreateProject, onComplete, giverSuggestions, profileName, viewer, onClose, onChange, onDelete, onToggleTimer, onAddFiles, onAddLink, onUpdateAtt, onRemoveAtt, meeting, onEventAction, onProposeTime }: any) {
  const isRun = !!card.timerStart, secs = cardSeconds(card, now);
  const directHours = Math.round((card.timeSpent || 0) / 3600);
  const subTotal = subHours(card);
  const fileRef = useRef<any>(); const [over, setOver] = useState(false); const [keb, setKeb] = useState(false);
  const [projOpen, setProjOpen] = useState(false); const [newProj, setNewProj] = useState("");
  const canPickProject = !viewer && !!onMoveProject;
  function pickProject(pid) { if (pid !== card.clientId) onMoveProject(pid); setProjOpen(false); }
  function makeProject() { const n = newProj.trim(); if (!n || !onCreateProject) return; onCreateProject(n); setNewProj(""); setProjOpen(false); }
  const [ccInput, setCcInput] = useState(""); const [commentInput, setCommentInput] = useState(""); const [replyTo, setReplyTo] = useState(null); const [trailOpen, setTrailOpen] = useState(false);
  const creator = creatorOf(card); const cc = ccOf(card); const comments = card.comments || [];
  const mentionPeople = Array.from(new Set([creator, ...cc, ...((client?.members) || [])].map((s) => (s || "").trim()).filter(Boolean)));
  function addCc(n) { n = (n || "").trim(); if (!n || n === creator || cc.includes(n)) return; onChange({ cc: [...cc, n] }); }
  function removeCc(n) { onChange({ cc: cc.filter((x) => x !== n) }); }
  function addComment() { const t = commentInput.trim(); if (!t) return; onChange({ comments: [...comments, { id: uid("cm"), by: profileName, text: t, at: Date.now(), parentId: replyTo ? replyTo.id : null }] }); setCommentInput(""); setReplyTo(null); }
  const rkind = routineKind(card);
  const st = card.subtasks || []; const [ghost, setGhost] = useState("");
  const files = (card.attachments || []).filter((a) => a.type !== "link");
  const links = (card.attachments || []).filter((a) => a.type === "link");
  function updSt(id, patch) { onChange({ subtasks: st.map((s) => (s.id === id ? { ...s, ...patch } : s)) }); }
  function addSt(text = "") { onChange({ subtasks: [...st, { id: uid("st"), text, done: false, hours: 0 }] }); }
  // a calendar-born card: the meeting details + calendar actions ride on top.
  const isMeeting = card.origin?.type === "calendar";
  const ev = meeting || null;
  const hhmm = (iso: string) => { try { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; } catch { return ""; } };
  const meetWhen = ev ? (ev.allDay ? "כל היום" : `${hhmm(ev.start)}${ev.end ? `–${hhmm(ev.end)}` : ""}`) : (card.time || "אירוע יומן");
  const [meetBusy, setMeetBusy] = useState<string | null>(null);
  const [meetMsg, setMeetMsg] = useState<string | null>(null);
  async function meetManage(action: string, label: string) {
    if (meetBusy || !onEventAction) return;
    if (action === "cancel" && !confirm(`לבטל את "${card.title}"? המשתתפים יקבלו עדכון.`)) return;
    setMeetBusy(action); setMeetMsg(null);
    const r = await onEventAction(action, action === "postpone" ? { minutes: 30 } : {});
    setMeetBusy(null);
    if (r?.ok) setMeetMsg(label); else setMeetMsg(r?.error ? "לא הצלחתי — " + r.error : "לא הצלחתי כרגע.");
  }
  return (
    <div className="adk-panel">
      <div className="adk-phead">
        <div className="ctx">
          <Badge client={client} size={22} />
          {canPickProject ? (
            <div className="adk-projpick">
              <button className="nm as-btn" onClick={() => setProjOpen((o) => !o)} title="העבר לפרויקט אחר">{client?.name || "בחר פרויקט"} <span className="car">▾</span></button>
              {projOpen && (<>
                <button className="adk-projpick-scrim" onClick={() => setProjOpen(false)} aria-label="סגור" />
                <div className="adk-projpick-menu">
                  <div className="adk-projpick-t">שייך לפרויקט</div>
                  {(projects || []).map((p) => (
                    <button key={p.id} className={"adk-projpick-item" + (p.id === card.clientId ? " on" : "")} onClick={() => pickProject(p.id)}>
                      <span className="dot" style={{ background: p.color }} /><span className="pn">{p.name}</span>{p.home && <span className="tag">בית</span>}{p.id === card.clientId && <span className="chk">✓</span>}
                    </button>
                  ))}
                  {onCreateProject && (
                    <div className="adk-projpick-new">
                      <input value={newProj} onChange={(e) => setNewProj(e.target.value)} placeholder="שם פרויקט חדש…" onKeyDown={(e) => { if (e.key === "Enter") makeProject(); }} />
                      <button className="mk" disabled={!newProj.trim()} onClick={makeProject}>+ פתח</button>
                    </div>
                  )}
                </div>
              </>)}
            </div>
          ) : (
            <span className="nm">{client?.name}</span>
          )}
          {rkind !== "none" && <span className="adk-rchip">↻ {ROUTINE_LABEL[rkind]}</span>}
          {isRun && <span className="clk"><span className="rec-dot" />{fmtClock(secs)}</span>}
          <button className="adk-x" style={{ marginInlineStart: "auto" }} onClick={onClose}>×</button>
        </div>
        <input className="adk-ptitle" value={card.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="שם המשימה" autoFocus={!card.title} />
      </div>

      <div className="adk-panel-body">
        {isMeeting && (
          <div style={{ margin: "0 0 16px", padding: "12px 14px", background: "var(--surface-2, #f4f5f6)", borderRadius: 12, border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 13.5, color: "var(--ink)" }}>
              <Icon name="calendar" size={15} /><span>{meetWhen}</span>
              {ev?.myStatus && <span style={{ marginInlineStart: "auto", fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>{MY_STATUS[ev.myStatus] || ""}</span>}
            </div>
            {ev?.meetLink && <a href={ev.meetLink} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10, fontWeight: 800, fontSize: 13, color: "var(--accent-d)" }}><Icon name="calendar" size={14} /> הצטרף ל‑Google Meet</a>}
            {(ev?.attendees || []).filter((a: any) => !a.self).length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                {ev.attendees.filter((a: any) => !a.self).slice(0, 6).map((a: any, i: number) => (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--muted)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20, padding: "3px 9px 3px 4px" }}>
                    <Avatar name={a.name || a.email} size={18} />{a.name || String(a.email || "").split("@")[0]}
                  </span>
                ))}
              </div>
            )}
            {onEventAction && !viewer && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12, alignItems: "center" }}>
                <button className="adk-btn" disabled={!!meetBusy} onClick={() => meetManage("postpone", "נדחתה בחצי שעה ✓")} style={{ height: 32, padding: "0 12px", fontSize: 12.5 }}>{meetBusy === "postpone" ? "דוחה…" : "דחה 30 דק׳"}</button>
                <button className="adk-btn" disabled={!!meetBusy} onClick={() => onProposeTime?.(ev)} style={{ height: 32, padding: "0 12px", fontSize: 12.5 }}>הצע זמן חדש</button>
                <button className="adk-btn danger" disabled={!!meetBusy} onClick={() => meetManage("cancel", "הפגישה בוטלה ✓")} style={{ height: 32, padding: "0 12px", fontSize: 12.5 }}>{meetBusy === "cancel" ? "מבטל…" : "בטל פגישה"}</button>
                {ev?.htmlLink && <a href={ev.htmlLink} target="_blank" rel="noreferrer" style={{ marginInlineStart: "auto", fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>פתח ביומן ↗</a>}
              </div>
            )}
            {meetMsg && <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 700, color: meetMsg.includes("✓") ? "var(--accent-d)" : "var(--rec)" }}>{meetMsg}</div>}
          </div>
        )}
        {card.draft && !viewer && (
          <div className="adk-draft-banner">
            <div className="adk-draft-txt"><Icon name="sun" size={15} /> {card.draft.level === "suggest" ? "buno מציע את הכרטיס הזה" : "טיוטת buno — ממתינה לאישורך"}</div>
            <div className="adk-req-act">
              <button className="ok" onClick={() => onChange({ draft: undefined, cc: Array.from(new Set([...cc, profileName].map((s) => (s || "").trim()).filter(Boolean).filter((n) => n !== creator))) })}>אשר</button>
              <button className="no" onClick={onDelete}>דחה</button>
            </div>
          </div>
        )}
        {viewer ? (
          <div className="adk-cell">
            <label>מתי</label>
            <ScheduleNegotiation card={card} me={profileName} allowFresh
              onApply={(p) => onChange({ deadline: p.deadline, routine: p.routine, dayFlex: p.dayFlex, time: p.time, proposed: undefined })}
              onPropose={(o) => onChange({ proposed: { deadline: o.deadline, routine: o.routine, dayFlex: o.dayFlex, time: o.time, by: profileName, at: Date.now() } })}
              onCancel={() => onChange({ proposed: undefined })} />
          </div>
        ) : (<>
          {card.proposed && (
            <div style={{ marginBottom: 14 }}>
              <ScheduleNegotiation card={card} me={profileName}
                onApply={(p) => onChange({ deadline: p.deadline, routine: p.routine, dayFlex: p.dayFlex, time: p.time, proposed: undefined })}
                onPropose={(o) => onChange({ proposed: { deadline: o.deadline, routine: o.routine, dayFlex: o.dayFlex, time: o.time, by: profileName, at: Date.now() } })}
                onCancel={() => onChange({ proposed: undefined })} />
            </div>
          )}
          <div className="adk-grid2">
            <div className="adk-cell">
              <label>מתי</label>
              <SchedulePicker deadline={card.deadline} routine={rkind} dayFlex={!!(card.dayFlex ?? card.flex)} time={card.time || ""} onChange={onChange} />
            </div>
            <div className="adk-cell">
              <label>זמן · שעות</label>
              <div className="trow">
                <Stepper sm value={directHours} onChange={(v) => onChange({ timeSpent: v * 3600 })} />
                <button className={"adk-timer-btn" + (isRun ? " on" : "")} style={{ position: "static", margin: 0, width: 38, height: 38, borderRadius: "50%" }} onClick={onToggleTimer} title={isRun ? "עצור" : "התחל"}>{isRun ? "■" : "▶"}</button>
              </div>
            </div>
          </div>
        </>)}
        {!viewer && subTotal > 0 && <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700, marginTop: -6 }}>+ {subTotal}ש בתת־משימות · סה״כ {fmtShort(secs)}</div>}

        <div className="adk-cell">
          <label>חשיבות</label>
          {viewer
            ? <div><span className="adk-prichip on" style={{ background: PRIORITY[card.priority].soft, color: PRIORITY[card.priority].color, borderColor: PRIORITY[card.priority].color }}>{PRIORITY[card.priority].label}</span></div>
            : <div className="adk-prichips">{Object.entries(PRIORITY).map(([k, v]) => <button key={k} className={"adk-prichip" + (card.priority === k ? " on" : "")} onClick={() => onChange({ priority: k })} style={card.priority === k ? { background: v.soft, color: v.color, borderColor: v.color } : {}}>{v.label}</button>)}</div>}
        </div>

        <div className="adk-hr" />

        <div className="adk-group">

          <div className="adk-field"><label>אנשים</label>
            <div className="adk-tagbox">
              {creator && <span className="adk-cc-chip locked" title="יוצר — פתח/ה את המשימה"><Avatar name={creator} size={18} /> {creator}</span>}
              {cc.map((n) => (
                <span className="adk-cc-chip" key={n}><Avatar name={n} size={18} /> {n} <button onClick={() => removeCc(n)}>×</button></span>
              ))}
              <GiverInput bare value={ccInput} onChange={setCcInput} onPick={addCc} suggestions={giverSuggestions.filter((s) => s !== creator && !cc.includes(s))} placeholder="+ הוסף אדם" />
            </div>
          </div>

          <div className="adk-field"><label>תוכן הבריף</label>
            <input ref={fileRef} type="file" accept="*/*" multiple style={{ display: "none" }} onChange={(e) => { onAddFiles(e.target.files); e.target.value = ""; }} />
            <div className={"adk-brief" + (over ? " over" : "")}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files?.length) onAddFiles(e.dataTransfer.files); }}>
              <textarea className="adk-brief-text" rows={4} value={card.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="כתוב את הבריף כאן, גרור קבצים או הוסף לינקים…" />
              {(files.length > 0 || links.length > 0) && (
                <div className="adk-brief-atts">
                  {files.length > 0 && (
                    <div className="adk-att-grid">
                      {files.map((a) => (
                        <div className="adk-att-item" key={a.id}>
                          <button className="del" onClick={() => onRemoveAtt(a.id)}>×</button>
                          {a.type === "image" && assets[a.id]
                            ? <img className="adk-att-img" src={assets[a.id]} alt="" onClick={() => window.open(assets[a.id], "_blank")} />
                            : <a className="adk-att-file" href={assets[a.id] || "#"} download={a.name} target="_blank" rel="noreferrer">📄 <span>{a.name}</span></a>}
                        </div>
                      ))}
                    </div>
                  )}
                  {links.map((a) => { const href = a.url ? (/^https?:\/\//i.test(a.url.trim()) ? a.url.trim() : "https://" + a.url.trim()) : ""; return (
                    <div className="adk-linkrow" key={a.id}>
                      <input className="adk-input" style={{ flex: "0 0 32%", padding: "7px 9px", fontSize: 13 }} value={a.name} onChange={(e) => onUpdateAtt(a.id, { name: e.target.value })} placeholder="שם" />
                      <input className="adk-input" style={{ padding: "7px 9px", fontSize: 13 }} value={a.url} onChange={(e) => onUpdateAtt(a.id, { url: e.target.value })} placeholder="https://" dir="ltr" />
                      {href && <a className="adk-linkopen" href={href} target="_blank" rel="noreferrer" title="פתח בכרטיסייה חדשה">↗</a>}
                      <button className="adk-x" onClick={() => onRemoveAtt(a.id)}>×</button>
                    </div>
                  ); })}
                </div>
              )}
              <div className="adk-brief-bar">
                <button onClick={() => fileRef.current.click()}>＋ קובץ / תמונה</button>
                <button onClick={onAddLink}>🔗 לינק</button>
                <span className="hint">או גרור לכאן</span>
              </div>
            </div>
          </div>
        </div>

        {/* breakdown group */}
        <div className="adk-hr" />
        <div className="adk-cell" style={{ gap: 3 }}>
          {st.map((s) => (
            <div className="adk-st" key={s.id}>
              <div className={"chk" + (s.done ? " on" : "")} onClick={() => updSt(s.id, { done: !s.done })}>✓</div>
              <input className={"txt" + (s.done ? " done" : "")} value={s.text} onChange={(e) => updSt(s.id, { text: e.target.value })} placeholder="משימה…" />
              <div className="h" title="שעות">
                <button onClick={() => updSt(s.id, { hours: Math.max(0, (Number(s.hours) || 0) - 1) })}>−</button>
                <div className="v">{Number(s.hours) || 0}</div>
                <button onClick={() => updSt(s.id, { hours: (Number(s.hours) || 0) + 1 })}>+</button>
              </div>
              <button className="del" onClick={() => onChange({ subtasks: st.filter((x) => x.id !== s.id) })}>×</button>
            </div>
          ))}
          <div className="adk-st ghost">
            <div className="chk" />
            <input className="txt" value={ghost} placeholder="כתוב כאן משימות לביצוע…"
              onChange={(e) => setGhost(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && ghost.trim()) { e.preventDefault(); addSt(ghost.trim()); setGhost(""); } }}
              onBlur={() => { if (ghost.trim()) { addSt(ghost.trim()); setGhost(""); } }} />
          </div>
        </div>

        <div className="adk-hr" />
        <div className="adk-cell" style={{ gap: 4 }}>
          <label>תגובות {comments.length > 0 ? `· ${comments.length}` : ""}</label>
          <div className="adk-thread">
            {comments.filter((c) => !c.parentId).map((cm) => (
              <div className="adk-cmt" key={cm.id}>
                <Avatar name={cm.by} size={22} />
                <div className="adk-cmt-b">
                  <div className="adk-cmt-line"><b>{cm.by}</b> {renderMentions(cm.text)} <span className="t">{relTime(cm.at)}</span></div>
                  <button className="adk-cmt-reply" onClick={() => setReplyTo(cm)}>השב</button>
                  {comments.filter((r) => r.parentId === cm.id).map((r) => (
                    <div className="adk-cmt reply" key={r.id}>
                      <Avatar name={r.by} size={20} />
                      <div className="adk-cmt-b"><div className="adk-cmt-line"><b>{r.by}</b> {renderMentions(r.text)} <span className="t">{relTime(r.at)}</span></div></div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {comments.length === 0 && <div style={{ fontSize: 12.5, color: "var(--faint)", fontWeight: 600, padding: "4px 0" }}>אין תגובות עדיין</div>}
          </div>
          <div className="adk-cmt-compose">
            {replyTo && <div className="adk-cmt-replying">משיב ל־<b>{replyTo.by}</b><button onClick={() => setReplyTo(null)}>×</button></div>}
            <div className="adk-cmt-input">
              <Avatar name={profileName} size={22} />
              <CommentBox value={commentInput} onChange={setCommentInput} onSend={addComment} people={mentionPeople} placeholder={replyTo ? "כתוב תשובה…  (@ לתיוג)" : "כתוב תגובה…  (@ לתיוג)"} />
              <button className="adk-cmt-send" onClick={addComment} title="שלח"><Icon name="arrowUp" size={17} /></button>
            </div>
          </div>
        </div>

        {(card.history || []).length > 0 && (
          <>
            <div className="adk-hr" />
            <div className="adk-cell" style={{ gap: 6 }}>
              <button className="adk-trail-toggle" onClick={() => setTrailOpen((v) => !v)}>
                <Icon name="clock" size={14} /> שובל עריכה · {card.history.length} <span className="chev">{trailOpen ? "▾" : "◂"}</span>
              </button>
              {trailOpen && (
                <div className="adk-trail">
                  {[...card.history].reverse().map((h) => (
                    <div className="adk-trail-row" key={h.id}>
                      <Avatar name={h.by} size={20} />
                      <span className="adk-trail-txt"><b>{h.by}</b> ערך/ה · {h.label}</span>
                      <span className="adk-trail-time">{relTime(h.at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="adk-panel-foot">
        <div className="adk-kebab">
          <button className="adk-x" onClick={() => setKeb((v) => !v)} title="עוד">⋮</button>
          {keb && (<>
            <div style={{ position: "fixed", inset: 0, zIndex: 7 }} onClick={() => setKeb(false)} />
            <div className="adk-kmenu up">
              <button className="adk-kmenu-del" onClick={() => { setKeb(false); onDelete(); }}>{viewer ? "הסר מהפרויקט" : "מחק משימה"}</button>
            </div>
          </>)}
        </div>
        <div style={{ marginInlineStart: "auto", display: "flex", gap: 8 }}>
          {!viewer && onComplete && card.activeColumn !== "col-done" && !card.draft && <button className="adk-btn done" onClick={onComplete}>✓ סיימתי</button>}
          <button className="adk-btn primary" onClick={onClose}>שמור וסגור</button>
        </div>
      </div>
    </div>
  );
}
