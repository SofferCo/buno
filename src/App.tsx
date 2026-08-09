import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { BoardView } from "./components/board/BoardView";
import { CardPanel } from "./components/card/CardPanel";
import { ArchivePanel } from "./components/screens/ArchivePanel";
import { CalendarPanel } from "./components/screens/CalendarPanel";
import { ChatPanel } from "./components/screens/ChatPanel";
import { ClientModal } from "./components/screens/ClientModal";
import { MyDay } from "./components/screens/MyDay";
import { Onboarding } from "./components/screens/Onboarding";
import { PersonalDashboard } from "./components/screens/PersonalDashboard";
import { ReportPanel } from "./components/screens/ReportPanel";
import { SettingsPanel } from "./components/screens/SettingsPanel";
import { ShareModal } from "./components/screens/ShareModal";
import { Badge } from "./components/ui/Badge";
import { DemoTag } from "./components/ui/DemoTag";
import { Icon } from "./components/ui/Icon";
import { APREFIX, DEFAULT_COLUMNS, KEY, PRI_ORDER, SWATCHES } from "./lib/constants";
import { storage } from "./data/local";
import { useAuth } from "./auth/AuthProvider";
import { addPeriod, daysUntil, flexDay, relTime, routineKind, todayStr, ymOf } from "./lib/date";
import { fmtMoney, fmtShort, fmtModeHours } from "./lib/format";
import { setUidMode, uid } from "./lib/id";
import { supabase } from "./lib/supabase";
import { loadRemote, SyncEngine } from "./data/remote";
import { uploadAsset, removeAsset, signMissingAssets } from "./data/assets";
import { buildManifest, pushImport } from "./data/importer";
import { peekInvite, acceptInvite } from "./data/invites";
import { askAssistant, sendReviewAction } from "./data/assistant";
import { fetchCalendar, listIntegrations, hasGmailScope, sweepNow, calendarAction } from "./data/integrations";
import { inferEventProjectId, eventDomains } from "./lib/inferProject";
import { upsertContact } from "./data/contacts";
import { EventPanel } from "./components/screens/EventPanel";
import { ImportScreen } from "./components/screens/ImportScreen";
import { readDataURL, resizeImage } from "./lib/image";
import { initials, nameColor, peopleOf } from "./lib/people";
import { cardSeconds, sumHours } from "./lib/time";

export default function App() {
  const { identity, signOut, localMode } = useAuth();
  const [loaded, setLoaded] = useState(false);
  const [clients, setClients] = useState<any[]>([]);
  const [currentId, setCurrentId] = useState<any>(null);
  const [columns, setColumns] = useState<any[]>(DEFAULT_COLUMNS);
  const [cards, setCards] = useState<Record<string, any>>({});
  const [order, setOrder] = useState<Record<string, string[]>>({});
  const [assets, setAssets] = useState<Record<string, string>>({});
  const [lastReset, setLastReset] = useState(todayStr());
  const [now, setNow] = useState(Date.now());
  const [editing, setEditing] = useState<any>(null);
  const [dragId, setDragId] = useState<any>(null);
  const [dropCol, setDropCol] = useState<any>(null);
  const [clientMenu, setClientMenu] = useState(false);
  const [clientEdit, setClientEdit] = useState<any>(null);
  const [shareFor, setShareFor] = useState<any>(null);   // dedicated share dialog target
  const [dayOpen, setDayOpen] = useState(true); // default landing = "היום שלי" (board is one click away)
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportPeriod, setReportPeriod] = useState<string | null>(null); // when opened from the dashboard, carry its period
  const [reportFromDash, setReportFromDash] = useState(false); // came from the dashboard → "back" returns there, not the board
  const [dashOpen, setDashOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  // hover-intent "peek" over the projects rail: opens a flyout to switch project in-place
  const [projPeek, setProjPeek] = useState(false);
  const projPeekT = useRef<any>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifSeen, setNotifSeen] = useState(() => Date.now() - 6 * 3600e3);
  // A1 first-run onboarding (real): shown once for a brand-new cloud account
  // right after the empty-board seed. onbBoards maps a vertical key → the created
  // board id, so the first-task step lands the card on the right board.
  const [showOnboarding, setShowOnboarding] = useState(false);
  const onbBoards = useRef<Record<string, string>>({});   // vertical key → board id
  const onbSetup = useRef<Record<string, string>>({});    // setup-card key → card id
  const onbResumeStep = useRef<string | null>(null);      // resume point for a paused onboarding run
  function openPage(name) {
    if (name === "report") { setReportPeriod(null); setReportFromDash(false); } // board-nav report = current client, default month
    setDayOpen(name === "day"); setArchiveOpen(name === "archive"); setReportOpen(name === "report");
    setDashOpen(name === "dash"); setSettingsOpen(name === "settings"); setCalOpen(name === "cal");
    setMobileView("board"); // on mobile, navigating brings the main surface in front of buno
  }
  // hover-intent for the projects flyout: a ~0.55s dwell opens it; a short grace on
  // leave lets the cursor travel from the rail button into the panel without it closing.
  const peekOpen = () => { clearTimeout(projPeekT.current); projPeekT.current = setTimeout(() => setProjPeek(true), 550); };
  const peekHold = () => { clearTimeout(projPeekT.current); setProjPeek(true); };
  const peekClose = () => { clearTimeout(projPeekT.current); projPeekT.current = setTimeout(() => setProjPeek(false), 160); };
  const notifs = useMemo(() => {
    const out = [];
    Object.values(cards).forEach((c) => {
      if (c.archived) return;
      const cn = clients.find((x) => x.id === c.clientId)?.name || "";
      const col = clients.find((x) => x.id === c.clientId)?.color || null;
      // a card with no title can't be shown in lists — surface it in the bell instead, with a link to complete it
      if (!String(c.title || "").trim()) { out.push({ id: "u" + c.id, type: "untitled", at: c.createdAt, cardId: c.id, title: "כרטיס בלי כותרת", client: cn, color: col, text: "כרטיס בלי כותרת ממתין להשלמה" }); return; }
      if (c.draft) out.push({ id: "d" + c.id, type: "draft", at: c.draft.at || c.createdAt, cardId: c.id, title: c.title || "משימה", client: cn, color: col, text: "טיוטת buno ממתינה לאישור" });
      if (c.proposed) out.push({ id: "p" + c.id, type: "request", at: c.proposed.at || c.createdAt, cardId: c.id, title: c.title || "משימה", client: cn, color: col, text: `בקשת תזמון מ${c.proposed.by || "לקוח"}` });
      (c.comments || []).forEach((cm) => {
        const mention = /@\S/.test(cm.text || "");
        out.push({ id: "c" + cm.id, type: mention ? "mention" : "comment", at: cm.at || c.createdAt, cardId: c.id, title: c.title || "משימה", client: cn, color: col, text: `${cm.by}: ${(cm.text || "").replace(/\s+/g, " ").slice(0, 44)}` });
      });
    });
    return out.sort((a, b) => b.at - a.at).slice(0, 30);
  }, [cards, clients]);
  const unreadCount = notifs.filter((n) => n.at > notifSeen).length;
  // buno is permanent — no open/close state. On mobile, where both can't share
  // the screen, this toggles which surface is in front (chat is the default).
  const [mobileView, setMobileView] = useState<"chat" | "board">("chat");
  const [chatSeed, setChatSeed] = useState<any>(null);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [rosters, setRosters] = useState<Record<string, any[]>>({});
  const [invitePrompt, setInvitePrompt] = useState<any>(null); // {token, projectName, role, inviter}
  const [invitedWelcome, setInvitedWelcome] = useState<any>(null); // {projectId, role} → contextual chat greeting
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const cloud = !!(supabase && identity);
  // my role on the current project: local mode / my own projects default to owner
  const myRole = !cloud ? "owner" : (roles[currentId as string] || "owner");
  const roleViewer = cloud && myRole === "viewer";
  const canManageColumns = !cloud || myRole === "owner";
  function applySharing(sharing: any) {
    if (sharing) { setRoles(sharing.roles || {}); setRosters(sharing.rosters || {}); }
  }
  // fresh import / seed: I own everything I just created
  function ownerSharing(clientList: any[]) {
    const roles: Record<string, string> = {}; const rosters: Record<string, any[]> = {};
    for (const c of clientList) { roles[c.id] = "owner"; rosters[c.id] = [{ userId: identity?.id, name: profile.name || identity?.name || "", photo: identity?.photo, role: "owner", self: true }]; }
    return { roles, rosters };
  }
  const [profile, setProfile] = useState<any>({ name: "", photo: null, assistant: { cards: "draft", calendar: "draft", outbound: "suggest" } });
  const engineRef = useRef<SyncEngine | null>(null);
  const [importPending, setImportPending] = useState<any>(null);
  const [syncErr, setSyncErr] = useState<string | null>(null);
  const [calEvents, setCalEvents] = useState<Record<string, any[]>>({});
  const [contactAffinity, setContactAffinity] = useState<any[]>([]); // A2: contact→board memory
  const [connectToast, setConnectToast] = useState<string | null>(null);
  const [eventOpen, setEventOpen] = useState<any>(null); // {ev, projectId} — legacy fallback panel
  const [meetingEvent, setMeetingEvent] = useState<any>(null); // the live calendar event backing the open card
  const [gcalInteg, setGcalInteg] = useState<any>(null);
  // a calendar event IS a task: opening one MATERIALISES a real linked card
  // (origin cal-<id>) and opens it in the full card — the meeting details + calendar
  // actions ride on top, the normal task fields (notes, subtasks, timer) live below.
  function openEvent(item: any) {
    const ev = item.ev || item;
    const ref = "cal-" + (ev.id || "");
    let card: any = Object.values(cards).find((c: any) => !c.archived && c.origin?.ref === ref);
    if (!card) {
      const cid = item.projectId || inferEventProjectId(ev.attendees || [], clients, ev.organizer) || clients.find((c) => c.home)?.id || clients[0]?.id;
      const colId = (columns.find((c) => c.id === "col-brief") || columns[0])?.id;
      if (!cid || !colId) { setEventOpen({ ev, projectId: item.projectId }); setMeetingEvent(ev); return; } // no board yet → legacy panel
      const id = uid("card");
      const atts = (ev.attendees || []) as any[];
      const nm = (a: any) => a?.name || (a?.email ? String(a.email).split("@")[0] : "");
      const people = atts.filter((a) => !a.self).map(nm).filter(Boolean);
      // whoever OPENED the meeting is the brief-giver (Tal: "מי שפתח את הפגישה").
      // resolve the organizer to a name — from the flag or the organizer email — and
      // if I organized it myself, the brief comes from the first other participant.
      const orgAtt = atts.find((a) => a.organizer) || (ev.organizer ? atts.find((a) => a.email === ev.organizer) : null);
      // brief-giver: the person who opened/invited the meeting if it's someone else,
      // else any other named participant — and if none, the USER themself (never buno).
      const other = atts.find((a) => !a.self);
      const briefGiver = (orgAtt && !orgAtt.self && nm(orgAtt)) || (other && nm(other)) || (orgAtt?.self ? "" : ev.organizerName) || profile?.name || "";
      card = { id, clientId: cid, title: ev.title || "פגישה", creator: briefGiver, cc: people.filter((n: string) => n !== briefGiver), comments: [], attachments: [], subtasks: [], description: ev.description || "", deadline: ev.start ? String(ev.start).slice(0, 10) : todayStr(), priority: "regular", routine: "none", dayFlex: false, time: ev.allDay ? "" : String(ev.start || "").slice(11, 16), activeColumn: colId, timeSpent: 0, timerStart: null, createdAt: Date.now(), origin: { type: "calendar", ref } };
      setCards((p: any) => ({ ...p, [id]: card }));
      setOrder((p: any) => ({ ...p, [colId]: [...(p[colId] || []), id] }));
    }
    // float the card over wherever the user is — do NOT switch the board behind it
    setMeetingEvent(ev);
    setEditing(card.id);
  }
  function prepTaskFromEvent(ev: any, project: any) {
    const when = ev.start ? new Date(ev.start) : null;
    const dl = when ? `${when.getFullYear()}-${String(when.getMonth()+1).padStart(2,"0")}-${String(when.getDate()).padStart(2,"0")}` : todayStr();
    assistantAction("create_card", { clientId: project.id, title: `הכנה ל${ev.title}`, description: `לקראת הפגישה ביומן${(ev.attendees||[]).length?` · עם ${ev.attendees.filter((a:any)=>!a.self).map((a:any)=>a.email).slice(0,4).join(", ")}`:""}`, deadline: dl, origin: { type: "calendar", ref: "cal-" + (ev.id||when?.getTime()) } });
    setEventOpen(null);
    setConnectToast(`נוצרה טיוטת הכנה תחת ${project.name}`); setTimeout(() => setConnectToast(null), 4000);
  }
  const asstLevel = (k) => (profile.assistant && profile.assistant[k]) || "draft"; // align with server default (draft)


  // routine daily reset — shared by the local and cloud load paths
  function applyRoutineReset(cds: Record<string, any>, ord: Record<string, string[]>, lastResetVal: string) {
    const t = todayStr();
    if ((lastResetVal || "") === t) return { cards: cds, order: ord, lastReset: t, changed: false };
    const no: Record<string, string[]> = {}; Object.keys(ord).forEach((k) => (no[k] = [...ord[k]]));
    const out = { ...cds }; let any = false;
    Object.values(cds).forEach((c: any) => {
      const kind = routineKind(c);
      if (kind !== "none") {
        let dl = c.deadline || t; let changed = false, guard = 0;
        while (dl < t && guard < 500) { dl = addPeriod(dl, kind); changed = true; guard++; }
        if (!c.deadline) { dl = t; changed = true; }
        const inDone = no["col-done"] && no["col-done"].includes(c.id);
        if (changed || inDone) {
          any = true;
          out[c.id] = { ...c, routine: kind, deadline: dl, subtasks: (c.subtasks || []).map((s) => ({ ...s, done: false })) };
          if (inDone) {
            no["col-done"] = no["col-done"].filter((x) => x !== c.id);
            const tgt = (c.activeColumn && no[c.activeColumn]) ? c.activeColumn : "col-doing";
            (no[tgt] = no[tgt] || []).push(c.id);
          }
        }
      }
    });
    return { cards: out, order: no, lastReset: t, changed: any };
  }
  function applyBoard(st: any) {
    setClients(st.clients); setCurrentId(st.currentId); setColumns(st.columns.length ? st.columns : DEFAULT_COLUMNS);
    setCards(st.cards); setOrder(st.order); setLastReset(st.lastReset || todayStr());
    if (st.profile) setProfile(st.profile);
  }
  // A stored access token whose `iat` is slightly ahead of Supabase's clock
  // (clock skew) is rejected with "JWT issued at future" / "expired". Refresh
  // the session once to mint a fresh token, then retry — instead of surfacing
  // a scary sync error for something self-healing.
  const isAuthSkew = (e: any) => /jwt|issued at future|token|expired/i.test(e?.message || "");
  async function loadRemoteRetry() {
    try { return await loadRemote(supabase!, identity!.id); }
    catch (e) {
      if (isAuthSkew(e)) { await supabase!.auth.refreshSession(); return await loadRemote(supabase!, identity!.id); }
      throw e;
    }
  }
  function attachEngine(colMap: any, baseline: any) {
    const eng = new SyncEngine(supabase!, identity!.id, colMap, baseline);
    eng.onError = (e) => setSyncErr(e.message);
    eng.onDirty = (d) => { if (!d) setSyncErr(null); };
    engineRef.current = eng;
    return eng;
  }
  // pull the board fresh from the cloud and re-baseline the sync engine — used
  // after the assistant writes cards server-side, so its drafts appear locally
  // without the engine re-inserting them.
  async function refreshBoardFromCloud(focusId?: string) {
    if (!cloud) return;
    try {
      const { state, colMap, sharing } = await loadRemoteRetry();
      if (state) { attachEngine(colMap, state); applyBoard({ ...state, currentId: focusId || state.currentId }); applySharing(sharing); }
    } catch (e: any) { setSyncErr(e.message || String(e)); }
  }
  // the ChatPanel's live assistant hook: call the Edge Function, and if it
  // created cards, refresh so the draft cards (with approve/reject) show up.
  async function askAssistantLive(message: string, history: any[], threadId?: string) {
    const res = await askAssistant(message, history, threadId, currentId);
    if (res?.created?.length || res?.changed) await refreshBoardFromCloud(currentId); // stay on the current board
    if (res?.calendarChanged) await refreshCalendar(); // buno postponed/cancelled a meeting → refresh the day
    return res;
  }

  const initedFor = useRef<string | null>(null);
  useEffect(() => {
    // StrictMode double-runs effects in dev; an empty-cloud load that runs
    // twice would seed (and push) twice. One init per signed-in user.
    const initKey = identity?.id || "local";
    if (initedFor.current === initKey) return;
    initedFor.current = initKey;
    (async () => {
      const cloud = !!(supabase && identity);
      let cloudCards: Record<string, any> | null = null;
      if (cloud) setUidMode("uuid");
      if (cloud) {
        try {
          const { state, colMap, sharing } = await loadRemoteRetry();
          applySharing(sharing);
          if (state) {
            const r = applyRoutineReset(state.cards, state.order, state.lastReset);
            const applied = { ...state, cards: r.cards, order: r.order, lastReset: r.lastReset };
            const eng = attachEngine(colMap, state);
            applyBoard(applied);
            cloudCards = applied.cards;
            if (r.changed) eng.schedule(applied);
            storage.delete(KEY).catch(() => {}); // consume any pre-auth local board; cloud is source of truth
            // onboarding recovery: a run that was started but never completed is a
            // PAUSE, not a loss — resume at the saved step instead of dropping onto
            // My Day. (Skipped for invite/welcome landings, which own the view.)
            const ob = (applied as any).profile?.settings?.onboarding;
            const qp = new URLSearchParams(location.search);
            if (ob?.started && !ob.completed && !qp.get("invite") && !qp.get("welcome")) {
              onbResumeStep.current = ob.step || "verticals";
              setShowOnboarding(true);
            }
          } else {
            // cloud board is empty — offer to import the local board, or seed
            let blob: any = null;
            try { const res = await storage.get(KEY); if (res?.value) blob = JSON.parse(res.value); } catch {}
            const hasLocal = blob?.clients?.length && Object.keys(blob.cards || {}).length;
            if (hasLocal) { setImportPending({ blob, manifest: buildManifest(blob) }); }
            else {
              // several open tabs race to seed a brand-new account; re-check
              // emptiness right before pushing, and let the losing tab load
              // whatever the winner already wrote
              const again = await loadRemoteRetry();
              if (again.state) {
                attachEngine(again.colMap, again.state);
                applyBoard(again.state);
                applySharing(again.sharing);
                cloudCards = again.state.cards;
              } else {
                const st = seedState();
                attachEngine({}, { clients: [], currentId: null, columns: [], cards: {}, order: {}, lastReset: "", profile: null });
                applyBoard(st);
                const os = ownerSharing(st.clients); setRoles(os.roles); setRosters(os.rosters);
                engineRef.current!.schedule(st);
                // brand-new account → first-run onboarding, UNLESS arriving via an invite
                // (invitees get the contextual invited flow, never the generic verticals).
                if (!new URLSearchParams(location.search).get("invite")) setShowOnboarding(true);
              }
            }
          }
          // just joined via the contextual invite entry (InvitedEntry → ?welcome=<id>):
          // land ON the shared board (not My Day) and let buno greet in-context.
          try {
            const wid = new URLSearchParams(location.search).get("welcome");
            if (wid) {
              setCurrentId(wid);
              setDayOpen(false);                              // fix: land on the board, never the empty My Day
              setInvitedWelcome({ projectId: wid });          // contextual chat greeting
              window.history.replaceState({}, "", location.pathname); // strip ?welcome
            }
          } catch { /* ignore */ }
        } catch (e: any) { setSyncErr("הטעינה מהענן נכשלה: " + (e.message || e)); }
      } else {
        try {
          const res = await storage.get(KEY);
          if (res && res.value) {
            const b = JSON.parse(res.value);
            const r = applyRoutineReset(b.cards || {}, b.order || {}, b.lastReset || "");
            applyBoard({ clients: b.clients || [], currentId: b.currentId || (b.clients || [])[0]?.id, columns: b.columns || DEFAULT_COLUMNS, cards: r.cards, order: r.order, lastReset: r.lastReset, profile: b.profile });
            if (!(b.clients || []).length) applyBoard(seedState());
          } else applyBoard(seedState());
        } catch { applyBoard(seedState()); }
      }
      // assets: locally-cached dataURLs (may fail if IndexedDB is unavailable),
      // then signed URLs for anything cloud-stored we don't already have. The
      // two are independent — a dead local cache must not block cloud images.
      const map: Record<string, string> = {};
      try {
        const lst = await storage.list(APREFIX);
        const keys = (lst && lst.keys) || [];
        const entries = await Promise.all(keys.map(async (k) => {
          const key = typeof k === "string" ? k : (k as any).key;
          try { const r = await storage.get(key); return [key.replace(APREFIX, ""), r?.value]; } catch { return null; }
        }));
        entries.forEach((e) => { if (e && e[1]) map[e[0]] = e[1]; });
      } catch {}
      if (cloudCards && supabase) { try { Object.assign(map, await signMissingAssets(supabase, cloudCards, map)); } catch {} }
      setAssets(map);
      setLoaded(true);
    })();
    function seedState() {
      // every new user gets only the personal board; the first real project is
      // created later (onboarding — future work). No demo/example project.
      const home = { id: uid("cl"), name: "אישי / בית", color: "#8E54C4", home: true, contact: "", email: "", notes: "", logo: null };
      const o: Record<string, string[]> = {}; DEFAULT_COLUMNS.forEach((c) => (o[c.id] = []));
      return { clients: [home], currentId: home.id, columns: DEFAULT_COLUMNS, cards: {}, order: o, lastReset: todayStr(), profile: null };
    }
  }, [identity?.id]);

  useEffect(() => {
    if (!loaded) return;
    const cacheKey = (supabase && identity) ? `${KEY}:${identity.id}` : KEY; // per-user in cloud mode: never pollute another user's local board
    (async () => { try { await storage.set(cacheKey, JSON.stringify({ clients, currentId, columns, cards, order, lastReset, profile })); } catch (e) {} })();
    engineRef.current?.schedule({ clients, currentId, columns, cards, order, lastReset, profile });
  }, [clients, currentId, columns, cards, order, lastReset, profile, loaded]);

  // Auth identity seeds the profile once (name for card creator/My Day, Google photo).
  useEffect(() => {
    if (!loaded || !identity) return;
    setProfile((p: any) => {
      const name = p.name || identity.name || "";
      const photo = p.photo || identity.photo || null;
      return (name === p.name && photo === p.photo) ? p : { ...p, name, photo };
    });
  }, [loaded, identity]);

  // Deep link (item 7): buno.io/?card=<id> from a buno-sent link opens that card.
  const cardLinkDone = useRef(false);
  useEffect(() => {
    if (cardLinkDone.current || !loaded) return;
    const cardId = new URLSearchParams(location.search).get("card");
    if (!cardId) { cardLinkDone.current = true; return; }
    const c = cards[cardId];
    if (!c) return; // the board may still be loading — try again on the next cards update
    cardLinkDone.current = true;
    setCurrentId(c.clientId); openPage(null); setEditing(cardId);
    const u = new URL(location.href); u.searchParams.delete("card"); window.history.replaceState({}, "", u.pathname + u.search);
  }, [loaded, cards]);

  // Google Calendar events → grouped by YYYY-MM-DD for the calendar + My Day.
  // Extracted so a write action (B6) can refresh the same way after it lands.
  async function refreshCalendar() {
    const r = await fetchCalendar();
    if (!r.connected) return;
    const by: Record<string, any[]> = {};
    for (const e of r.events) {
      const d = (e.start || "").slice(0, 10);
      if (!d) continue;
      const time = e.allDay ? "" : (e.start || "").slice(11, 16);
      const projectId = inferEventProjectId(e.attendees || [], clients, e.organizer);
      (by[d] = by[d] || []).push({ t: e.title, time, location: e.location, ev: e, projectId });
    }
    setCalEvents(by);
    // (ב) calendar attendees are real people (they have an email) → contacts.
    if (identity) { const seen = new Set<string>(); for (const e of r.events) for (const a of ((e as any).attendees || [])) { if (a.self || !a.email || seen.has(a.email)) continue; seen.add(a.email); const nm = String(a.displayName || String(a.email).split("@")[0] || "").trim(); if (nm) upsertContact(identity.id, { name: nm, email: a.email, source: "calendar" }); } }
  }
  useEffect(() => {
    if (!cloud || !loaded) return;
    let alive = true;
    listIntegrations().then((list) => { if (alive) setGcalInteg(list.find((i) => i.kind === "gcal") || null); }).catch(() => {});
    if (alive) refreshCalendar().catch(() => {});
    return () => { alive = false; };
  }, [cloud, loaded, clients.length]); // re-run once projects are loaded so inference has them

  // A2 — load the contact→board affinity (own rows). Fail-open before 0021 lands.
  useEffect(() => {
    if (!cloud || !loaded || !supabase) return;
    let alive = true;
    (async () => { try { const { data } = await supabase!.from("contact_board_affinity").select("contact,project_id,weight"); if (alive && data) setContactAffinity(data); } catch { /* table not there yet */ } })();
    return () => { alive = false; };
  }, [cloud, loaded]);

  // Returning from Google consent (?connected=…) → one-line status toast.
  useEffect(() => {
    const c = new URLSearchParams(location.search).get("connected");
    if (!c) return;
    setConnectToast(c === "calendar" ? "יומן Google חובר ✓" : c === "denied" ? "החיבור בוטל." : "החיבור נכשל — נסה שוב.");
    window.history.replaceState({}, "", location.pathname);
    const t = setTimeout(() => setConnectToast(null), 4000);
    return () => clearTimeout(t);
  }, []);

  const running = Object.values(cards).some((c) => c.timerStart);
  useEffect(() => { if (!running) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [running]);

  const updateCard = useCallback((id, patch) => setCards((p) => ({ ...p, [id]: { ...p[id], ...patch } })), []);
  // every assistant-initiated action passes through here; the app (not the prompt) enforces the matrix
  function assistantAction(kind: string, payload: any = {}) {
    const cat = /event|calendar/.test(kind) ? "calendar" : (/send|email|outbound/.test(kind) ? "outbound" : "cards");
    const level = asstLevel(cat); // suggest | draft | act
    if (kind === "create_card") {
      const colId = payload.colId || (columns.find((c) => c.id === "col-brief") || columns[0])?.id;
      if (!colId) return null;
      const id = uid("card");
      const draft = level === "act" ? null : { by: "buno", at: Date.now(), level };
      setCards((p) => ({ ...p, [id]: { id, clientId: payload.clientId || currentId, title: payload.title || "", creator: "buno", cc: [], comments: [], attachments: [], subtasks: payload.subtasks || [], description: payload.description || "", deadline: payload.deadline || todayStr(), priority: payload.priority || "regular", routine: "none", dayFlex: false, time: payload.time || "", activeColumn: colId, timeSpent: 0, timerStart: null, createdAt: Date.now(), origin: payload.origin || { type: "chat", ref: "chat-" + id }, draft } }));
      setOrder((p) => ({ ...p, [colId]: [...(p[colId] || []), id] }));
      return id;
    }
    return null;
  }
  // sweep: assistant drafts unresolved for 7+ days quietly expire (soft-remove)
  useEffect(() => {
    const WEEK = 7 * 864e5, t = Date.now();
    const stale = Object.values(cards).filter((c) => c.draft && !c.archived && (t - c.draft.at) > WEEK);
    if (stale.length) setCards((p) => { const n = { ...p }; stale.forEach((c) => { n[c.id] = { ...n[c.id], archived: true, archivedAt: t, removedBy: "assistant" }; }); return n; });
  }, []); // eslint-disable-line
  const editWithTrail = useCallback((id, patch, by) => setCards((p) => {
    const c = p[id]; if (!c) return p;
    const FIELD_LABEL = { title: "כותרת", description: "תיאור", cc: "אנשים", subtasks: "צ׳קליסט", comments: "תגובה", attachments: "קבצים", proposed: "הצעת תזמון", priority: "עדיפות", deadline: "תזמון", time: "שעה", routine: "חזרתיות" };
    const key = Object.keys(patch).find((k) => FIELD_LABEL[k]) || Object.keys(patch)[0];
    const label = FIELD_LABEL[key] || key;
    const t = Date.now(); const hist = c.history ? [...c.history] : [];
    const last = hist[hist.length - 1];
    if (last && last.by === by && last.field === key && (t - last.at) < 240000) hist[hist.length - 1] = { ...last, at: t };
    else hist.push({ id: uid("h"), by, field: key, label, at: t });
    return { ...p, [id]: { ...c, ...patch, history: hist } };
  }), []);
  const cardColumn = useMemo(() => { const m = {}; Object.keys(order).forEach((col) => order[col].forEach((id) => (m[id] = col))); return m; }, [order]);

  function addCard(colId, asCreator) {
    const id = uid("card");
    setCards((p) => ({ ...p, [id]: { id, clientId: currentId, title: "", creator: (asCreator || profile.name || "אני"), cc: [], comments: [], attachments: [], subtasks: [], description: "", deadline: todayStr(), priority: "regular", routine: "none", dayFlex: false, time: "", activeColumn: colId, timeSpent: 0, timerStart: null, createdAt: Date.now() } }));
    setOrder((p) => ({ ...p, [colId]: [...(p[colId] || []), id] }));
    setEditing(id);
  }
  function deleteCard(id, by = "owner") { // soft: move to archive, recoverable
    setCards((p) => ({ ...p, [id]: { ...p[id], archived: true, archivedAt: Date.now(), removedBy: by, timerStart: null } }));
    setOrder((p) => { const n = {}; Object.keys(p).forEach((k) => (n[k] = p[k].filter((x) => x !== id))); return n; });
    setEditing(null);
  }
  function restoreCard(id) {
    const c = cards[id]; const cols = columns.map((x) => x.id);
    let tgt = c?.activeColumn;
    if (!tgt || !cols.includes(tgt) || tgt === "col-done") tgt = cols.find((x) => x !== "col-done") || cols[0];
    setCards((p) => ({ ...p, [id]: { ...p[id], archived: false, removedBy: undefined } }));
    setOrder((p) => { const n = {}; Object.keys(p).forEach((k) => (n[k] = p[k].filter((x) => x !== id))); (n[tgt] = n[tgt] || []).push(id); return n; });
  }
  function hardDelete(id) { // permanent
    const c = cards[id]; (c?.attachments || []).forEach((a: any) => { if (a.type !== "link") { storage.delete(APREFIX + a.id).catch(() => {}); if (supabase && a.storageKey) removeAsset(supabase, a.storageKey); } });
    setOrder((p) => { const n = {}; Object.keys(p).forEach((k) => (n[k] = p[k].filter((x) => x !== id))); return n; });
    setCards((p) => { const n = { ...p }; delete n[id]; return n; });
  }
  function toggleTimer(id) {
    setCards((prev) => {
      const next = { ...prev }, ts = Date.now(), card = next[id];
      if (card.timerStart) next[id] = { ...card, timeSpent: (card.timeSpent || 0) + Math.floor((ts - card.timerStart) / 1000), timerStart: null };
      else { Object.keys(next).forEach((k) => { if (next[k].timerStart) next[k] = { ...next[k], timeSpent: (next[k].timeSpent || 0) + Math.floor((ts - next[k].timerStart) / 1000), timerStart: null }; }); next[id] = { ...next[id], timerStart: ts }; }
      return next;
    });
    setNow(Date.now());
  }
  function moveCard(id, toCol, beforeId = null) {
    // stamp the column-change time (client-side mirror of the 0013 trigger) so
    // "היום שלי" knows when a card was completed today.
    setCards((p) => (p[id] ? { ...p, [id]: { ...p[id], columnChangedAt: Date.now(), ...(toCol !== "col-done" ? { activeColumn: toCol } : {}) } } : p));
    setOrder((prev) => {
      const n = {}; Object.keys(prev).forEach((k) => (n[k] = prev[k].filter((x) => x !== id)));
      if (!n[toCol]) n[toCol] = [];
      if (beforeId && n[toCol].includes(beforeId)) n[toCol].splice(n[toCol].indexOf(beforeId), 0, id); else n[toCol].push(id);
      return n;
    });
  }
  function renameCol(id, title) { if (!canManageColumns) return; setColumns((p) => p.map((c) => (c.id === id ? { ...c, title } : c))); }
  function addColumn() { if (!canManageColumns) return; const id = uid("col"); setColumns((p) => [...p, { id, title: "עמודה חדשה" }]); setOrder((p) => ({ ...p, [id]: [] })); }
  function deleteColumn(id) { if (!canManageColumns) return; setColumns((p) => p.filter((c) => c.id !== id)); setOrder((p) => { const n = { ...p }; delete n[id]; return n; }); }

  async function addFiles(cardId, fileList: any) {
    for (const file of Array.from(fileList) as any[]) {
      const isImg = file.type.startsWith("image/");
      let dataUrl: string;
      try { dataUrl = isImg ? await resizeImage(file, 1000, "image/jpeg", 0.72) : await readDataURL(file); } catch { continue; }
      if (dataUrl.length > 4600000) { continue; }
      const attId = uid("att");
      try { await storage.set(APREFIX + attId, dataUrl); } catch (e) {}
      setAssets((p) => ({ ...p, [attId]: dataUrl }));
      setCards((p) => ({ ...p, [cardId]: { ...p[cardId], attachments: [...(p[cardId].attachments || []), { id: attId, type: isImg ? "image" : "file", name: file.name, mime: file.type }] } }));
      // cloud: upload in the background; storageKey lands on the attachment and
      // the sync engine writes it to the row. Failure = stays local-only.
      if (supabase && identity) {
        const projectId = cards[cardId]?.clientId;
        if (projectId) uploadAsset(supabase, projectId, cardId, attId, dataUrl).then((key) => { if (key) updateAtt(cardId, attId, { storageKey: key }); });
      }
    }
  }
  function addLink(cardId) { const attId = uid("att"); setCards((p) => ({ ...p, [cardId]: { ...p[cardId], attachments: [...(p[cardId].attachments || []), { id: attId, type: "link", name: "", url: "" }] } })); }
  function updateAtt(cardId, attId, patch) { setCards((p) => ({ ...p, [cardId]: { ...p[cardId], attachments: p[cardId].attachments.map((a) => (a.id === attId ? { ...a, ...patch } : a)) } })); }
  function removeAtt(cardId, attId) { const a = cards[cardId]?.attachments?.find((x: any) => x.id === attId); if (a && a.type !== "link") { storage.delete(APREFIX + attId).catch(() => {}); if (supabase && a.storageKey) removeAsset(supabase, a.storageKey); } setAssets((p) => { const n = { ...p }; delete n[attId]; return n; }); setCards((p) => ({ ...p, [cardId]: { ...p[cardId], attachments: p[cardId].attachments.filter((x) => x.id !== attId) } })); }

  function saveClient(c) { setClients((p) => { const i = p.findIndex((x) => x.id === c.id); if (i === -1) return [...p, c]; const n = [...p]; n[i] = c; return n; }); if (!currentId) setCurrentId(c.id); setClientEdit(null); }
  async function runAcceptInvite(token: string) {
    if (!supabase || inviteBusy) return;
    setInviteBusy(true); setInviteError(null);
    try {
      const projectId = await acceptInvite(supabase, token);
      // reload the board — the newly-joined project is now visible
      const { state, colMap, sharing } = await loadRemoteRetry();
      if (state) { attachEngine(colMap, state); applyBoard({ ...state, currentId: projectId }); applySharing(sharing); setCurrentId(projectId); }
      setInvitePrompt(null);
      window.history.replaceState({}, "", location.pathname); // strip ?invite
    } catch (e: any) { setInviteError(e.message || String(e)); }
    finally { setInviteBusy(false); }
  }
  function deleteClient(id) {
    const ids = Object.values(cards).filter((c) => c.clientId === id).map((c) => c.id);
    setCards((p) => { const n = { ...p }; ids.forEach((x) => delete n[x]); return n; });
    setOrder((p) => { const n = {}; Object.keys(p).forEach((k) => (n[k] = p[k].filter((x) => !ids.includes(x)))); return n; });
    setClients((p) => p.filter((c) => c.id !== id)); setClientEdit(null); setClientMenu(false);
    if (currentId === id) setCurrentId(clients.filter((c) => c.id !== id)[0]?.id || null);
  }

  if (!loaded) return <div className="adk" style={{ display: "grid", placeItems: "center", height: "100vh" }}><div style={{ color: "var(--muted)", fontWeight: 600 }}>טוען את הלוח…</div></div>;

  // ---- A1/A2 real onboarding -----------------------------------------------
  // Boards are ordinary clients; the 4 setup cards are REAL cards that auto-close
  // on their event; the first task + calendar co-creation write real cards.
  // Progress + analytics persist in profile.settings.onboarding (jsonb; no migration).
  const onbSetState = (patch: any) => setProfile((p: any) => ({ ...p, settings: { ...p.settings, onboarding: { ...(p.settings?.onboarding || {}), ...patch } } }));
  const onbTrack = (event: string, props?: any) => setProfile((p: any) => {
    const ob = p.settings?.onboarding || {};
    return { ...p, settings: { ...p.settings, onboarding: { ...ob, events: [...(ob.events || []), { event, at: Date.now(), ...(props || {}) }].slice(-100) } } };
  });
  const mkCard = (clientId: string, title: string, o: any = {}) => {
    const id = uid("card"); const col = o.col || "col-brief";
    setCards((p) => ({ ...p, [id]: { id, clientId, title, creator: o.creator || profile.name || identity?.name || "אני", cc: [], comments: [], attachments: [], subtasks: [], description: o.description || "", deadline: o.deadline ?? todayStr(), priority: "regular", routine: "none", dayFlex: false, time: "", activeColumn: col, timeSpent: 0, timerStart: null, createdAt: Date.now(), cardType: "work", origin: o.origin } }));
    setOrder((p) => ({ ...p, [col]: [...(p[col] || []), id] }));
    return id;
  };
  const onbCloseSetup = (key: string) => {
    const id = onbSetup.current[key]; if (!id) return;
    setOrder((p) => { const n: Record<string, string[]> = {}; Object.keys(p).forEach((k) => (n[k] = p[k].filter((x) => x !== id))); (n["col-done"] = n["col-done"] || []).push(id); return n; });
    setCards((p) => (p[id] ? { ...p, [id]: { ...p[id], activeColumn: "col-done" } } : p));
  };
  const onbSeed = (verts: { key: string; label: string; color: string }[]) => {
    // idempotent by board name (so a restart never double-seeds).
    const created: Record<string, string> = {}; const add: any[] = [];
    verts.forEach((v) => {
      const ex = clients.find((c) => c.name === v.label && !c.home);
      if (ex) { created[v.key] = ex.id; return; }
      const id = uid("cl"); created[v.key] = id;
      add.push({ id, name: v.label, color: v.color, home: false, contact: "", email: "", notes: "", logo: null, why: "" });
    });
    onbBoards.current = created;
    if (add.length) setClients((p) => [...p, ...add]);
    const firstBoard = created[verts[0]?.key] || add[0]?.id;
    if (firstBoard) setCurrentId(firstBoard);
    if (firstBoard && !onbSetup.current.first) onbSetup.current = {
      know: mkCard(firstBoard, "להכיר את בונו", { col: "col-done", creator: "buno" }),
      cal: mkCard(firstBoard, "לחבר את יומן גוגל", { creator: "buno" }),
      wa: mkCard(firstBoard, "לגלות את בונו בוואטסאפ", { creator: "buno" }),
      first: mkCard(firstBoard, "להוסיף את המשימה הראשונה שלך", { creator: "buno" }),
    };
    onbSetState({ started: true, completed: false, verticals: verts.map((v) => v.key), startedAt: profile.settings?.onboarding?.startedAt || Date.now(), step: "boards" });
    onbTrack("verticals_selected", { verticals: verts.map((v) => v.key) });
  };
  const onbAddTask = (boardKey: string, text: string) => {
    const t = String(text || "").trim(); if (!t) return;
    const cid = onbBoards.current[boardKey] || clients.find((c) => c.home)?.id || clients[0]?.id; if (!cid) return;
    mkCard(cid, t); onbCloseSetup("first"); onbTrack("first_task_added");
  };
  // A2 — prefer a board this contact was assigned to before; else infer from domain.
  const affinityBoard = (ev: any): string | null => {
    const domains = eventDomains(ev.attendees || [], ev.organizer);
    if (!domains.length) return null;
    let best: string | null = null, bestW = 0;
    for (const r of contactAffinity) if (domains.includes(r.contact) && (r.weight || 0) > bestW && clients.some((c) => c.id === r.project_id)) { best = r.project_id; bestW = r.weight || 0; }
    return best;
  };
  const onbCreateEventCard = (ev: any, boardId: string) => {
    const cid = boardId || clients.find((c) => c.home)?.id || clients[0]?.id; if (!cid) return;
    mkCard(cid, `הכנה ל${ev.title || "פגישה"}`, { description: (ev.attendees || []).filter((a: any) => !a.self).map((a: any) => a.email).slice(0, 4).join(", "), deadline: ev.start ? String(ev.start).slice(0, 10) : todayStr(), origin: { type: "calendar", ref: "cal-" + (ev.id || "") } });
    onbCloseSetup("cal"); onbTrack("calendar_event_added");
    // record the contact→board affinity so future auto-assignment improves (fail-open).
    if (supabase) for (const d of eventDomains(ev.attendees || [], ev.organizer)) { supabase.rpc("bump_contact_affinity", { p_contact: d, p_project: cid }).then(() => {}, () => {}); }
  };
  const onbWhatsappSeen = () => { onbCloseSetup("wa"); onbTrack("whatsapp_seen"); };
  const onbComplete = () => { onbSetState({ completed: true, completedAt: Date.now(), step: "my_day" }); onbTrack("completed"); setShowOnboarding(false); openPage("day"); };
  // up to 6 upcoming real events for the co-creation step (only if calendar connected).
  const onbUpcoming = Object.values(calEvents).flat().map((w: any) => w.ev || w).filter((e: any) => e && !e.allDay && e.start && new Date(e.start).getTime() >= Date.now() - 6 * 3600e3).sort((a: any, b: any) => String(a.start).localeCompare(String(b.start))).slice(0, 6);
  if (showOnboarding) return <Onboarding
    onSeed={onbSeed} onAddTask={onbAddTask}
    calEvents={onbUpcoming} boardOptions={clients.map((c: any) => ({ id: c.id, name: c.name, color: c.color }))}
    inferBoard={(ev: any) => affinityBoard(ev) || inferEventProjectId(ev.attendees || [], clients, ev.organizer)}
    onCreateEventCard={onbCreateEventCard} onWhatsappSeen={onbWhatsappSeen}
    onComplete={onbComplete} onTrack={onbTrack} initialStep={onbResumeStep.current} />;

  const current = clients.find((c) => c.id === currentId);
  const clientCards = (id) => Object.values(cards).filter((c) => c.clientId === id);
  const curCards = clientCards(currentId);
  const openCount = curCards.filter((c) => !c.archived && cardColumn[c.id] !== "col-done").length;
  const curTime = curCards.reduce((a, c) => a + cardSeconds(c, now), 0);
  const roundMode = (profile.settings && profile.settings.timeRound) || "ceil_hour"; // system rounding principle
  const archiveList = curCards.filter((c) => c.archived || cardColumn[c.id] === "col-done")
    .map((c) => ({ ...c, reason: c.archived ? (c.removedBy === "client" ? "client" : "deleted") : "done", when: c.archivedAt || c.createdAt }))
    .sort((a, b) => b.when - a.when);

  const dayTasks = Object.values(cards).filter((c) => !c.archived && cardColumn[c.id] !== "col-done" && String(c.title || "").trim()).map((c) => ({ card: c, d: daysUntil(c.deadline) }));
  const planWindow = (c) => c.routine === "monthly" ? 31 : 7;
  const inPlan = (t) => { if (t.d === null) return false; if (flexDay(t.card)) return t.d <= planWindow(t.card); return t.d <= 0; };
  const byTime = (a, b) => { const ta = a.card.time || "99:99", tb = b.card.time || "99:99"; return ta < tb ? -1 : ta > tb ? 1 : 0; };
  const planTasks = dayTasks.filter(inPlan).sort((a, b) => byTime(a, b) || (PRI_ORDER[a.card.priority] - PRI_ORDER[b.card.priority]) || ((a.d ?? 99) - (b.d ?? 99)));
  const upcoming = dayTasks.filter((t) => !inPlan(t) && t.d !== null && t.d >= 1 && t.d <= 7).sort((a, b) => a.d - b.d);
  // "היום שלי" as a living timeline: what closed today (above the now-line, dimmed),
  // and today's no-deadline additions (so a day with actions never looks empty).
  const isTodayMs = (ms: any) => !!ms && new Date(ms).toDateString() === new Date().toDateString();
  const completedToday = Object.values(cards).filter((c: any) => !c.archived && cardColumn[c.id] === "col-done" && isTodayMs(c.columnChangedAt) && String(c.title || "").trim()).map((c: any) => ({ card: c, at: c.columnChangedAt })).sort((a: any, b: any) => (a.at || 0) - (b.at || 0));
  const addedToday = Object.values(cards).filter((c: any) => !c.archived && !c.draft && cardColumn[c.id] !== "col-done" && !c.deadline && isTodayMs(c.createdAt) && String(c.title || "").trim()).map((c: any) => ({ card: c }));
  const runningCard = Object.values(cards).find((c) => c.timerStart);
  const firstImage = (c) => { const a = (c.attachments || []).find((x) => x.type === "image"); return a ? assets[a.id] : null; };

  if (importPending) return (
    <ImportScreen
      manifest={importPending.manifest}
      email={identity?.email || ""}
      onConfirm={async () => {
        const { state, colMap } = await pushImport(supabase!, identity!.id, importPending.blob);
        attachEngine(colMap, state);
        applyBoard(state);
        const os = ownerSharing(state.clients); setRoles(os.roles); setRosters(os.rosters);
        storage.delete(KEY).catch(() => {});
        setImportPending(null);
      }}
      onFresh={() => {
        const o: Record<string, string[]> = {}; DEFAULT_COLUMNS.forEach((c) => (o[c.id] = []));
        const st = { clients: [], currentId: null, columns: DEFAULT_COLUMNS, cards: {}, order: o, lastReset: todayStr(), profile: null };
        attachEngine({}, { clients: [], currentId: null, columns: [], cards: {}, order: {}, lastReset: "", profile: null });
        applyBoard(st);
        const os = ownerSharing(st.clients); setRoles(os.roles); setRosters(os.rosters);
        storage.delete(KEY).catch(() => {});
        engineRef.current!.schedule(st as any);
        setImportPending(null);
      }}
    />
  );

  return (
    <div className={"adk chat-open " + (mobileView === "chat" ? "mv-chat" : "mv-board")}>
      <img src="/bunologo.svg" className="adk-brand-wm" alt="" aria-hidden="true" />
      <div className="adk-shell">
      <div className="adk-top">
        <div className="adk-csel">
          <div className="adk-csel-btn" onClick={() => setClientMenu((v) => !v)}>
            <Badge client={current} />
            <div><div className="nm">{current?.name || "בחר לקוח"}</div><div className="sub">{clientCards(currentId).length} משימות</div></div>
            <span className="chev"><Icon name="chevD" size={16} /></span>
          </div>
          {clientMenu && (<>
            <div style={{ position: "fixed", inset: 0, zIndex: 39 }} onClick={() => setClientMenu(false)} />
            <div className="adk-drop">
              <div className="adk-drop-item special" onClick={() => { setClientMenu(false); openPage("day"); }}>
                <div className="adk-day-sun sm"><Icon name="sun" size={17} /></div>
                <div><div className="nm">היום שלי</div><div className="sub">מבט־על · כל הלקוחות</div></div>
                {planTasks.length > 0 && <span className="cnt">{planTasks.length}</span>}
              </div>
              <div className="adk-drop-sep" />
              {clients.map((c) => (
                <div key={c.id} className={"adk-drop-item" + (c.id === currentId ? " active" : "")} onClick={() => { setCurrentId(c.id); setClientMenu(false); }}>
                  <Badge client={c} size={30} />
                  <div><div className="nm">{c.name}</div>{c.contact && <div className="sub">{c.contact}</div>}</div>
                  <span className="cnt">{clientCards(c.id).length}</span>
                  <button className="edit" title="ערוך" onClick={(e) => { e.stopPropagation(); setClientEdit(c); setClientMenu(false); }}>✎</button>
                </div>
              ))}
              <button className="adk-drop-add" onClick={() => { setClientEdit("new"); setClientMenu(false); }}>+ הוסף לקוח</button>
            </div>
          </>)}
        </div>
        <div className="adk-stats" style={{ marginInlineStart: "auto" }}>
          <div className="adk-stat"><b>{openCount}</b><small>משימות</small></div>
          <div className="adk-stat"><b>{fmtModeHours(sumHours(curCards, now, roundMode), roundMode)}</b><small>שעות</small></div>
          {running && <div className="adk-stat" style={{ background: "var(--rec-soft)", borderColor: "transparent" }}><b style={{ color: "var(--rec)", display: "flex", alignItems: "center", gap: 6 }}><span className="rec-dot" />מוקלט</b><small style={{ color: "var(--rec)" }}>טיימר פעיל</small></div>}
          <button className="adk-icon-btn" data-label="דוח" onClick={() => openPage("report")}><Icon name="chart" /></button>
          <button className="adk-icon-btn" data-label="ארכיון" onClick={() => openPage("archive")}><Icon name="archive" />{archiveList.length > 0 && <span className="ic-badge">{archiveList.length}</span>}</button>
          {cloud && current && <button className="adk-icon-btn" data-label="שיתוף" onClick={() => setShareFor(current)}><Icon name="share" /></button>}
        </div>
      </div>

      {(<>
        <button className="adk-float-av" style={{ background: nameColor(profile.name || identity?.name || identity?.email || "אני") }} title="הדשבורד שלי" onClick={() => openPage("dash")}>
          {(profile.photo || identity?.photo) ? <img src={profile.photo || identity?.photo || undefined} alt="" /> : <span>{(profile.name || identity?.name) ? initials(profile.name || identity?.name) : (identity?.email ? initials(identity.email) : "אני")}</span>}
        </button>
        <button className="adk-float-bell" title="התראות" onClick={() => { setNotifOpen((v) => { const nv = !v; if (nv) setNotifSeen(Date.now()); return nv; }); }}>
          <Icon name="bell" size={19} />{unreadCount > 0 && <span className="ic-badge">{unreadCount}</span>}
        </button>
        {syncErr && <div className="adk-sync-err">הסנכרון לענן נתקל בשגיאה: {syncErr} · השינויים שמורים מקומית וינסו שוב</div>}
        {connectToast && <div className="adk-connect-toast">{connectToast}</div>}
        {notifOpen && (<>
          <div className="adk-notif-scrim" onClick={() => setNotifOpen(false)} />
          <div className="adk-notif">
            <div className="adk-notif-head"><b>התראות</b>{notifs.length > 0 && <button onClick={() => { setNotifSeen(Date.now()); }}>סמן הכל כנקרא</button>}</div>
            <div className="adk-notif-list">
              {notifs.length === 0 && <div className="adk-notif-empty">אין תנועות חדשות ✦</div>}
              {notifs.map((n) => (
                <button key={n.id} className={"adk-notif-item" + (n.at > notifSeen ? " unread" : "")} onClick={() => { setNotifOpen(false); setEditing(n.cardId); }}>
                  <span className={"adk-notif-dot " + n.type} style={n.color ? { background: n.color } : undefined} />
                  <span className="adk-notif-body">
                    <span className="t">{n.type === "draft" ? "טיוטת buno" : n.type === "request" ? "בקשת תזמון" : n.type === "mention" ? "תויגת" : n.type === "untitled" ? "להשלמה" : "תגובה"} · <b>{n.title}</b>{n.client && <em> · {n.client}</em>}</span>
                    <span className="s">{n.text}</span>
                    <span className="tm">{relTime(n.at)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>)}
        <div className="adk-rail bare">
          <button className="adk-rail-btn" data-label="היום שלי" onClick={() => openPage("day")}><Icon name="sun" />{planTasks.length > 0 && <span className="ic-badge">{planTasks.length}</span>}</button>
          <div className="adk-peek-zone" onMouseEnter={peekOpen} onMouseLeave={peekClose}>
            <button className="adk-rail-btn" data-label="פרויקטים" onClick={() => { if (clients[0]) setCurrentId(clients[0].id); openPage(null); }}><Icon name="grid" /></button>
            {projPeek && (
              <div className="adk-peek" onMouseEnter={peekHold} onMouseLeave={peekClose}>
                <button className="adk-peek-row special" onClick={() => { openPage("day"); setProjPeek(false); }}>
                  <span className="adk-day-sun sm"><Icon name="sun" size={15} /></span>
                  <span className="nm">היום שלי</span>
                  {planTasks.length > 0 && <span className="cnt">{planTasks.length}</span>}
                </button>
                <div className="adk-peek-sep" />
                {clients.map((c) => (
                  <button key={c.id} className={"adk-peek-row" + (c.id === currentId ? " active" : "")} onClick={() => { setCurrentId(c.id); openPage(null); setProjPeek(false); }}>
                    <Badge client={c} size={24} />
                    <span className="nm">{c.name}</span>
                    <span className="cnt">{clientCards(c.id).length}</span>
                  </button>
                ))}
                <button className="adk-peek-add" onClick={() => { setClientEdit("new"); setProjPeek(false); }}>+ הוסף פרוייקט</button>
              </div>
            )}
          </div>
          <button className="adk-rail-btn" data-label="יומן" onClick={() => openPage("cal")}><Icon name="calendar" /></button>
          <button className="adk-rail-btn" data-label="דשבורד" onClick={() => openPage("dash")}><Icon name="chart" /></button>
        </div>
        <button className="adk-float-gear bare" data-label="הגדרות" onClick={() => openPage("settings")}><Icon name="gear" size={20} /></button>
      </>)}

      <BoardView columns={columns} order={order} cards={cards} clientId={currentId} assets={assets} now={now} viewer={roleViewer} canManageColumns={canManageColumns}
        dnd={{ dragId, setDragId, dropCol, setDropCol, moveCard }}
        onOpenCard={(id) => setEditing(id)} onToggleTimer={toggleTimer} onAddCard={addCard}
        onRenameCol={renameCol} onDeleteColumn={deleteColumn} onAddColumn={addColumn} />
      </div>

      {editing && cards[editing] && (<>
        <div className="adk-scrim" onClick={() => { setEditing(null); setMeetingEvent(null); }} />
        <CardPanel card={cards[editing]} now={now} assets={assets} client={clients.find((c) => c.id === cards[editing].clientId)}
          projects={clients}
          meeting={(() => { const c = cards[editing]; if (c?.origin?.type !== "calendar") return null; const live = Object.values(calEvents).flat().find((w: any) => ("cal-" + (w.ev?.id)) === c.origin.ref)?.ev; return live || (meetingEvent && ("cal-" + meetingEvent.id) === c.origin.ref ? meetingEvent : null); })()}
          onEventAction={async (action: any, opts: any) => {
            const c = cards[editing]; const evId = String(c?.origin?.ref || "").replace(/^cal-/, "");
            if (!evId) return { ok: false, error: "לא פגישת יומן" };
            const r = await calendarAction(action, evId, opts);
            if (r.ok) {
              await refreshCalendar();
              if (action === "cancel") { deleteCard(editing, "owner"); setEditing(null); setMeetingEvent(null); }
              else if (r.start) { const d = new Date(r.start); updateCard(editing, { deadline: r.start.slice(0, 10), time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` }); }
            }
            return r;
          }}
          onProposeTime={(ev: any) => { const t = ev?.title || cards[editing]?.title; setEditing(null); setMeetingEvent(null); setChatSeed(`הצע זמן חלופי לפגישה "${t}" ובצע את הדחייה`); setMobileView("chat"); }}
          onMoveProject={roleViewer ? undefined : (pid) => updateCard(editing, { clientId: pid })}
          onCreateProject={roleViewer ? undefined : (name) => {
            const color = SWATCHES.find((s) => !clients.some((c) => c.color === s)) || SWATCHES[clients.length % SWATCHES.length];
            const nc = { id: uid("cl"), name, color, home: false, contact: "", email: "", notes: "", logo: null };
            saveClient(nc); updateCard(editing, { clientId: nc.id });
          }}
          giverSuggestions={Array.from(new Set([
            ...((clients.find((c) => c.id === cards[editing].clientId)?.members) || []),
            ...Object.values(cards).filter((c) => c.clientId === cards[editing].clientId).flatMap((c) => peopleOf(c)),
          ].map((s) => (s || "").trim()).filter(Boolean)))}
          profileName={roleViewer ? (current?.contact || (current?.members && current.members[0]) || "לקוח") : (profile.name || identity?.name || "אני")}
          viewer={roleViewer}
          onClose={() => { setEditing(null); setMeetingEvent(null); }} onChange={roleViewer ? ((p) => editWithTrail(editing, p, current?.contact || (current?.members && current.members[0]) || "לקוח")) : ((p) => updateCard(editing, p))} onDelete={() => deleteCard(editing, roleViewer ? "client" : "owner")}
          onComplete={() => { moveCard(editing, "col-done"); setEditing(null); setMeetingEvent(null); }}
          onToggleTimer={() => toggleTimer(editing)} onAddFiles={(fl) => addFiles(editing, fl)} onAddLink={() => addLink(editing)}
          onUpdateAtt={(aid, p) => updateAtt(editing, aid, p)} onRemoveAtt={(aid) => removeAtt(editing, aid)} />
      </>)}

      {eventOpen && <EventPanel ev={eventOpen.ev} project={clients.find((c) => c.id === eventOpen.projectId) || null} onClose={() => setEventOpen(null)} onPrepTask={prepTaskFromEvent}
        canManage={gcalInteg?.status === "connected"}
        onEventAction={async (action: any, opts: any) => { const r = await calendarAction(action, eventOpen.ev.id, opts); if (r.ok) await refreshCalendar(); return r; }}
        onProposeTime={(ev: any) => { setEventOpen(null); setChatSeed(`הצע לי זמן חלופי לפגישה "${ev.title}" ובצע את הדחייה`); setMobileView("chat"); }} />}

      {clientEdit && <ClientModal client={clientEdit === "new" ? null : clientEdit} onClose={() => setClientEdit(null)} onSave={saveClient} onDelete={deleteClient}
        sharing={cloud && clientEdit !== "new" ? { role: roles[clientEdit.id], roster: rosters[clientEdit.id] || [], projectId: clientEdit.id, supabase, meId: identity?.id, meName: profile.name || identity?.name, origin: location.origin } : null} />}

      {shareFor && cloud && <ShareModal boardName={shareFor.name} onClose={() => setShareFor(null)}
        sharing={{ role: roles[shareFor.id], roster: rosters[shareFor.id] || [], projectId: shareFor.id, supabase, meId: identity?.id, meName: profile.name || identity?.name, origin: location.origin }} />}

      {(invitePrompt || inviteError) && (
        <div className="adk-overlay">
          <div className="adk-modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <div className="adk-invite-card">
              {invitePrompt ? (<>
                <div className="adk-invite-mark">buno</div>
                <p className="adk-invite-msg"><b>{invitePrompt.inviter}</b> הזמין אותך להצטרף אל<br /><b className="proj">{invitePrompt.projectName}</b><br />בתור {invitePrompt.role === "viewer" ? "צופה" : invitePrompt.role === "member" ? "חבר צוות" : "בעלים"}.</p>
                {inviteError && <div className="adk-invite-err">{inviteError}</div>}
                <div className="adk-invite-actions">
                  <button className="adk-btn primary" disabled={inviteBusy} onClick={() => runAcceptInvite(invitePrompt.token)}>{inviteBusy ? "מצטרף…" : "הצטרף"}</button>
                  <button className="adk-link" disabled={inviteBusy} onClick={() => { setInvitePrompt(null); window.history.replaceState({}, "", location.pathname); }}>אולי אחר כך</button>
                </div>
              </>) : (<>
                <div className="adk-invite-mark">buno</div>
                <div className="adk-invite-err">{inviteError}</div>
                <div className="adk-invite-actions"><button className="adk-btn primary" onClick={() => { setInviteError(null); window.history.replaceState({}, "", location.pathname); }}>הבנתי</button></div>
              </>)}
            </div>
          </div>
        </div>
      )}

      {dayOpen && (
        <MyDay planTasks={planTasks} upcoming={upcoming} completedToday={completedToday} addedToday={addedToday} clients={clients} now={now} runningCard={runningCard} events={calEvents} onOpenEvent={openEvent}
          linkedEventIds={new Set(Object.values(cards).filter((c: any) => !c.archived && c.origin?.type === "calendar").map((c: any) => String(c.origin.ref).replace(/^cal-/, "")))}
          profileName={profile.name} roundMode={roundMode} capacity={(profile.settings && profile.settings.dailyCapacity) || 6}
          pending={{ drafts: notifs.filter((n) => n.type === "draft").length, requests: notifs.filter((n) => n.type === "request").length }}
          onAsk={(question) => { setChatSeed(question); setMobileView("chat"); }}
          onClose={() => setDayOpen(false)}
          onOpenCard={(id) => setEditing(id)}
          onToggleTimer={toggleTimer} onDone={(id) => moveCard(id, "col-done")}
          onReopen={(id) => moveCard(id, cards[id]?.activeColumn)}
          onDefer={(id) => updateCard(id, { deadline: new Date(Date.now() + 864e5).toISOString().slice(0, 10) })} />
      )}

      {archiveOpen && (<>
        <div className="adk-scrim" onClick={() => setArchiveOpen(false)} />
        <ArchivePanel items={archiveList} client={current} now={now}
          onClose={() => setArchiveOpen(false)}
          onOpen={(id) => setEditing(id)}
          onRestore={restoreCard}
          onHardDelete={hardDelete} />
      </>)}

      {reportOpen && (
        <ReportPanel client={current} cards={curCards} cardColumn={cardColumn} now={now} roundMode={roundMode} initialPeriod={reportPeriod} onClose={() => { setReportOpen(false); if (reportFromDash) { setReportFromDash(false); setDashOpen(true); } }} onOpen={(id) => setEditing(id)} />
      )}


      {calOpen && (
        <CalendarPanel clients={clients} cards={cards} now={now} events={calEvents}
          linkedEventIds={new Set(Object.values(cards).filter((c: any) => !c.archived && c.origin?.type === "calendar").map((c: any) => String(c.origin.ref).replace(/^cal-/, "")))}
          onClose={() => setCalOpen(false)}
          onOpen={(id) => setEditing(id)} onOpenEvent={openEvent} />
      )}

      {/* mobile-only surface toggle — buno and the board can't share a phone
          screen, so one button flips between them (no closing, just switching). */}
      <button className="adk-mtoggle" onClick={() => setMobileView((v) => (v === "chat" ? "board" : "chat"))} title={mobileView === "chat" ? "הלוח" : "buno"}>
        {mobileView === "chat" ? <Icon name="grid" size={22} /> : <img src="/bunologo.svg" alt="buno" style={{ width: 26, height: 26 }} />}
      </button>

      {<ChatPanel seed={chatSeed} onSeedUsed={() => setChatSeed(null)} onAction={assistantAction} asstLevel={asstLevel}
        onGoBoard={() => setMobileView("board")}
        live={cloud} ask={askAssistantLive} profileName={profile.name || identity?.name || ""}
        invited={invitedWelcome ? (() => {
          const proj = clients.find((c) => c.id === invitedWelcome.projectId);
          const open = Object.values(cards).filter((c: any) => c.clientId === invitedWelcome.projectId && !c.archived && cardColumn[c.id] !== "col-done").length;
          const people = (rosters[invitedWelcome.projectId] || []).length;
          const role = roles[invitedWelcome.projectId];
          const roleHe = role === "viewer" ? "צופה" : role === "owner" ? "בעלים" : "חבר צוות";
          return { boardName: proj?.name || "הלוח", roleHe, open, people };
        })() : null}
        onInvitedSeen={() => setInvitedWelcome(null)}
        onWantPersonalSpace={() => { setShowOnboarding(true); }}
        calConnected={gcalInteg?.status === "connected"} mailConnected={gcalInteg?.status === "connected" && hasGmailScope(gcalInteg)}
        onOpenSettings={() => openPage("settings")}
        onApproveCard={(id) => { const c = cards[id]; if (c) updateCard(id, { draft: undefined, cc: Array.from(new Set([...(c.cc || []), profile.name].map((s) => (s || "").trim()).filter(Boolean))) }); }}
        onRejectCard={(id) => deleteCard(id, "owner")}
        onSweepNow={async () => { const r = await sweepNow(); if (r?.ok && (r?.created?.length || r?.review)) await refreshBoardFromCloud(currentId); return r; }}
        onReviewAction={async (id: string) => { const r = await sendReviewAction(id); await refreshBoardFromCloud(currentId); return r; }}
        onSuggestionClick={(key: string) => { if (supabase) supabase.rpc("bump_suggestion", { p_key: key, p_shown: 0, p_clicked: 1 }).then(() => {}, () => {}); }}
        onUploadFile={(file: any, intent?: string) => { const id = assistantAction("create_card", { title: (intent || file.name || "").slice(0, 80), description: intent ? `מהקובץ ${file.name}` : "קובץ שהועלה מהצ'אט", origin: { type: "chat", ref: "upload-" + Date.now() } }); if (id) addFiles(id, [file]); }}
        onOpenCard={(id) => setEditing(id)}
        onOpenEvent={(ev) => setEventOpen({ ev, projectId: inferEventProjectId(ev.attendees || [], clients, ev.organizer) })}
        eventColor={(ev: any) => { const id = inferEventProjectId(ev.attendees || [], clients, ev.organizer); return clients.find((c) => c.id === id)?.color || null; }}
        // an event's board: the inferred client, else the personal board — so every
        // event tile carries a clear board name + color (never an anonymous tile).
        eventProject={(ev: any) => { const id = inferEventProjectId(ev.attendees || [], clients, ev.organizer); const p = clients.find((c) => c.id === id) || clients.find((c) => c.home) || null; return p ? { name: p.name, color: p.color } : null; }}
        cardColor={(c: any) => clients.find((x) => x.name === c.project)?.color || null}
        answer={(q) => {
        const s = q.toLowerCase();
        const nonArch = Object.values(cards).filter((c) => !c.archived);
        const monthKey = ymOf(Date.now());
        const monthHours = sumHours(nonArch.filter((c) => ymOf(c.createdAt) === monthKey), now, roundMode);
        const perClient = clients.map((cl) => { const cc = Object.values(cards).filter((c) => c.clientId === cl.id && !c.archived); return { cl, sec: cc.reduce((a, c) => a + cardSeconds(c, now), 0), hours: sumHours(cc, now, roundMode), rate: Number(cl.rate) || 0 }; });
        if (s.includes("שעות") && s.includes("חודש")) return `החודש נצברו ${fmtModeHours(monthHours, roundMode)} שעות עבודה על פני ${perClient.filter((p) => p.sec > 0).length} לקוחות.`;
        if (s.includes("רווחי") || s.includes("רווח")) { const p = perClient.map((x) => ({ ...x, rev: x.hours * x.rate })).filter((x) => x.rev > 0).sort((a, b) => b.rev - a.rev); return p.length ? `הלקוח הכי רווחי הוא ${p[0].cl.name} — הכנסה משוערת ${fmtMoney(p[0].rev)} (${fmtModeHours(p[0].hours, roundMode)} שעות × ₪${p[0].rate}).` : "עדיין אין תעריפים מוגדרים ללקוחות, אז אי אפשר לחשב רווחיות. הוסף תעריף שעתי בכרטיס הלקוח."; }
        if (s.includes("דחוף") || s.includes("היום")) { if (!planTasks.length) return "אין משימות דחופות להיום — נקי! ✦"; const top = planTasks.slice(0, 5).map((t) => `• ${t.card.title || "משימה"}${t.card.time ? ` · ${t.card.time}` : ""}`).join("\n"); return `יש ${planTasks.length} משימות בתוכנית של היום:\n${top}`; }
        if (s.includes("כמה") && s.includes("משימ")) { const open = nonArch.filter((c) => cardColumn[c.id] !== "col-done").length; return `יש ${open} משימות פתוחות כרגע על פני כל הלקוחות.`; }
        if (s.includes("לקוח") && s.includes("שעות")) { const p = perClient.filter((x) => x.sec > 0).sort((a, b) => b.sec - a.sec); return p.length ? "שעות לפי לקוח:\n" + p.map((x) => `• ${x.cl.name}: ${fmtModeHours(x.hours, roundMode)} שעות`).join("\n") : "אין עדיין שעות רשומות."; }
        return "אני עדיין בהדגמה — בגרסה המחוברת (עם שרת) אענה בשפה חופשית, אזכור שיחות, ואצוף גם בוואטסאפ. בינתיים נסה: \"כמה שעות עבדתי החודש?\", \"מי הלקוח הכי רווחי?\", \"מה דחוף היום?\"";
      }} />}

      {settingsOpen && (
        <SettingsPanel profile={profile} account={identity?.email} cloud={cloud} onSignOut={localMode ? undefined : signOut}
          onScanned={() => { refreshBoardFromCloud(currentId); setConnectToast("נוספו טיוטות מהמייל — בדוק את הלוח"); setTimeout(() => setConnectToast(null), 4000); }}
          onClose={() => setSettingsOpen(false)}
          onSetName={(name) => setProfile((p) => ({ ...p, name }))}
          onSetPhoto={(photo) => setProfile((p) => ({ ...p, photo }))}
          onSetAssistant={(k, v) => setProfile((p) => ({ ...p, assistant: { ...(p.assistant || {}), [k]: v } }))}
          onSetPref={(k, v) => setProfile((p) => ({ ...p, settings: { ...(p.settings || {}), [k]: v } }))} />
      )}

      {dashOpen && (
        <PersonalDashboard clients={clients} cards={cards} cardColumn={cardColumn} now={now} profile={profile}
          onClose={() => setDashOpen(false)}
          onSetPhoto={(photo) => setProfile((p) => ({ ...p, photo }))}
          onSetName={(name) => setProfile((p) => ({ ...p, name }))}
          onSetAssistant={(k, v) => setProfile((p) => ({ ...p, assistant: { ...(p.assistant || {}), [k]: v } }))}
          onOpenClient={(id, period) => { setCurrentId(id); setReportPeriod(period || null); setReportFromDash(true); setDashOpen(false); setReportOpen(true); }}
          onShareClient={cloud ? ((cl: any) => { setShareFor(cl); setDashOpen(false); }) : undefined} />
      )}
    </div>
  );
}
