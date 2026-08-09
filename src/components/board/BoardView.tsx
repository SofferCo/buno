import { Avatar } from "../ui/Avatar";
import { Icon } from "../ui/Icon";
import { PRIORITY } from "../../lib/constants";
import { deadlineInfo, flexDay, routineKind } from "../../lib/date";
import { fmtClock, fmtShort } from "../../lib/format";
import { peopleOf } from "../../lib/people";
import { cardSeconds } from "../../lib/time";

export function BoardView({ columns, order, cards, clientId, assets, now, viewer, canManageColumns = true, filter, dnd, onOpenCard, onToggleTimer, onAddCard, onRenameCol, onDeleteColumn, onAddColumn }: any) {
  const firstImage = (c) => { const a = (c.attachments || []).find((x) => x.type === "image"); return a ? assets[a.id] : null; };
  const d = dnd || {};
  return (
    <div className="adk-board">
      {columns.map((col) => {
        let ids = (order[col.id] || []).filter((id) => cards[id] && cards[id].clientId === clientId && !cards[id].archived && (!filter || filter(cards[id])));
        // Done: newest-completed on top of the stack (by when it entered the column).
        if (col.id === "col-done") ids = [...ids].sort((a, b) => (cards[b].columnChangedAt || 0) - (cards[a].columnChangedAt || 0));
        const colTime = ids.reduce((a, id) => a + cardSeconds(cards[id], now), 0);
        return (
          <div key={col.id} className={"adk-col" + (!viewer && d.dropCol === col.id ? " drop" : "")}
            onDragOver={viewer ? undefined : (e) => { e.preventDefault(); d.setDropCol(col.id); }}
            onDragLeave={viewer ? undefined : (e) => { if (e.currentTarget === e.target) d.setDropCol(null); }}
            onDrop={viewer ? undefined : (e) => { e.preventDefault(); if (d.dragId) d.moveCard(d.dragId, col.id); d.setDropCol(null); d.setDragId(null); }}>
            <div className="adk-col-head">
              {viewer || !canManageColumns
                ? <span className="adk-col-title" style={{ fontWeight: 700, padding: "2px 4px" }}>{col.title}</span>
                : <input className="adk-col-title" value={col.title} onChange={(e) => onRenameCol(col.id, e.target.value)} spellCheck={false} />}
              <span className="adk-count">{ids.length}</span>
              {!viewer && canManageColumns && (order[col.id] || []).length === 0 && <button className="adk-colmenu" title="מחק עמודה ריקה" onClick={() => onDeleteColumn(col.id)}>×</button>}
            </div>
            {colTime > 0 && <div className="adk-col-time">⏱ {fmtShort(colTime)} בעמודה</div>}
            <div className="adk-cards">
              {ids.length === 0 && <div className="adk-empty">{viewer ? "—" : "גרור לכאן משימות"}</div>}
              {ids.map((id) => {
                const card = cards[id]; const secs = cardSeconds(card, now); const isRun = !!card.timerStart;
                const dl = deadlineInfo(card.deadline); const pri = PRIORITY[card.priority]; const thumb = firstImage(card);
                const st = card.subtasks || []; const done = st.filter((s) => s.done).length;
                return (
                  <div key={id} className={"adk-card" + (!viewer && d.dragId === id ? " dragging" : "") + (isRun ? " rec" : "") + (card.draft ? " draft" : "")}
                    draggable={!viewer}
                    onDragStart={viewer ? undefined : () => d.setDragId(id)}
                    onDragEnd={viewer ? undefined : () => { d.setDragId(null); d.setDropCol(null); }}
                    onDragOver={viewer ? undefined : (e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={viewer ? undefined : (e) => { e.preventDefault(); e.stopPropagation(); if (d.dragId && d.dragId !== id) d.moveCard(d.dragId, col.id, id); d.setDragId(null); d.setDropCol(null); }}
                    onClick={() => onOpenCard(id)}>
                    {thumb && <img className="adk-card-thumb" src={thumb} alt="" />}
                    <div className="adk-card-in">
                      <p className="adk-card-title">{routineKind(card) !== "none" && <span className="adk-routine-tag">↻ </span>}{card.title || "ללא כותרת"}</p>
                      <div className="adk-card-meta">
                        {card.priority !== "regular" && <span className="adk-pri" style={{ background: pri.soft, color: pri.color }}>● {pri.label}</span>}
                        {dl && <span className={"adk-dl " + dl.tone}>📅 {flexDay(card) ? "יום גמיש" : dl.text}</span>}
                        {card.time && <span className="adk-dl soon">🕐 {card.time}</span>}
                        {st.length > 0 && <span className="adk-checkmini">☑ {done}/{st.length}</span>}
                        {(card.comments || []).length > 0 && <span className="adk-checkmini"><Icon name="comment" size={13} /> {card.comments.length}</span>}
                        {card.proposed && <span className="adk-checkmini" style={{ background: "#FBF0DC", color: "#B9770F" }} title="בקשת לקוח ממתינה לאישור">⏳ בקשה</span>}
                        {card.draft && <span className="adk-checkmini" style={{ background: "#FBF0DC", color: "#B9770F" }} title="טיוטת העוזר"><Icon name="sun" size={12} /> טיוטה</span>}
                        {card.cardType === "waiting" && <span className="adk-checkmini" style={{ background: "#EEF2F4", color: "#5B6B72" }} title={card.waitingOn ? `ממתין ל${card.waitingOn}` : "ממתין לתשובה"}>⏳ ממתין{card.waitingOn ? ` · ${card.waitingOn}` : ""}</span>}
                      </div>
                      <div className="adk-card-foot">
                        {peopleOf(card).length > 0 && (
                          <div className="adk-avstack">
                            {peopleOf(card).slice(0, 3).map((n, i) => <Avatar key={i} name={n} size={22} />)}
                            {peopleOf(card).length > 3 && <div className="adk-av more" style={{ width: 22, height: 22 }}>+{peopleOf(card).length - 3}</div>}
                          </div>
                        )}
                        <span className={"adk-time-badge" + (isRun ? " live" : "")} style={{ marginInlineStart: peopleOf(card).length ? 0 : "auto" }}>{isRun ? <span className="rec-dot" /> : "⏱"} {isRun ? fmtClock(secs) : fmtShort(secs)}</span>
                        {!viewer && <button className={"adk-timer-btn" + (isRun ? " on" : "")} title={isRun ? "עצור" : "התחל"} onClick={(e) => { e.stopPropagation(); onToggleTimer(id); }}>{isRun ? "■" : "▶"}</button>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {!viewer && <button className="adk-add" onClick={() => onAddCard(col.id)}>+ משימה</button>}
          </div>
        );
      })}
      {!viewer && canManageColumns && <div className="adk-addcol"><button onClick={onAddColumn}><span className="plus">+</span><span className="lbl"> עמודה</span></button></div>}
    </div>
  );
}
