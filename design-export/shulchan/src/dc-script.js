
const PALETTE = ['#efe0ff', '#d9fb8a', '#d8f3ec', '#fde4ea', '#e3eefb', '#fff3c4', '#ffe4c7'];
const DOTS = ['#7c3aed', '#65a30d', '#10a974', '#e11d48', '#2563eb', '#ca8a04', '#ea580c'];
const SIDE_BG = ['#efe0ff', '#e6fca3'];
const HOLIDAYS = [
  { key: 'rh', name: 'ערב ראש השנה', prev: '2025-09-22', cur: '2026-09-11' },
  { key: 'yk', name: 'סעודה מפסקת', prev: '2025-10-01', cur: '2026-09-20' },
  { key: 'suk', name: 'ליל סוכות', prev: '2025-10-06', cur: '2026-09-25' },
  { key: 'han', name: 'נר ראשון של חנוכה', prev: '2025-12-14', cur: '2026-12-04' },
  { key: 'pes', name: 'ליל הסדר', prev: '2026-04-01', cur: '2027-04-21' },
  { key: 'shv', name: 'ליל שבועות', prev: '2026-05-21', cur: '2027-06-10' },
];
const DOW = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'שבת'];
const hebFmt = new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long' });
const hebMD = new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'numeric' });
const monthFmt = new Intl.DateTimeFormat('he', { month: 'long', year: 'numeric' });
const longFmt = new Intl.DateTimeFormat('he', { weekday: 'long', day: 'numeric', month: 'long' });
const shortFmt = new Intl.DateTimeFormat('he', { day: 'numeric', month: 'long' });
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const RANGE_START = new Date(2026, 8, 4), RANGE_END = new Date(2027, 7, 31);
const SEED_V = 4;

const DEFAULT_CFG = {
  homes: [
    { id: 'h1', name: 'אבא ורונית', city: 'רעננה', people: ['אבא', 'רונית'] },
    { id: 'h2', name: 'אמא', city: 'תל אביב', people: ['אמא'] },
    { id: 'h3', name: 'משפחת גוזלן', city: 'חולון', people: ['ציון', 'מרים'] },
  ],
  couples: [
    { id: 'c1', names: ['טל', 'שרון'], sides: [{ name: 'טל', homes: ['h1', 'h2'] }, { name: 'שרון', homes: ['h3'] }], history: { rh: 0, yk: 1, suk: 0, han: 1, pes: 0, shv: 1 }, lastShabbat: 'h3' },
    { id: 'c2', names: ['רז', 'ליאור'], sides: [{ name: 'רז', homes: ['h1', 'h2'] }, { name: 'ליאור', homes: ['other'] }], history: { rh: 0, yk: 1, suk: 0, han: 1, pes: 1, shv: 0 }, lastShabbat: 'other' },
    { id: 'c3', names: ['טהר', 'הדר'], sides: [{ name: 'טהר', homes: ['h1', 'h2'] }, { name: 'הדר', homes: ['other'] }], history: { rh: 1, yk: 1, suk: 0, han: 0, pes: 1, shv: 0 }, lastShabbat: 'h2' },
    { id: 'c4', names: ['נתי', 'שחר'], sides: [{ name: 'נתי', homes: ['h3'] }, { name: 'שחר', homes: ['other'] }], history: { rh: 0, yk: 0, suk: 0, han: 1, pes: 1, shv: 0 }, lastShabbat: 'other' },
    { id: 'c5', names: ['חיו', 'מיטל'], sides: [{ name: 'חיו', homes: ['h3'] }, { name: 'מיטל', homes: ['other'] }], history: { rh: 1, yk: 0, suk: 1, han: 0, pes: 0, shv: 1 }, lastShabbat: 'h3' },
    { id: 'c6', names: ['מאור', 'תמר'], sides: [{ name: 'מאור', homes: ['h3'] }, { name: 'תמר', homes: ['other'] }], history: { rh: 1, yk: 1, suk: 1, han: 0, pes: 1, shv: 0 }, lastShabbat: 'other' },
  ],
  people: { 'טל': { email: 'tal@gmail.com', bday: '1990-09-17', cal: 'greg' }, 'שרון': { email: 'sharon@gmail.com', bday: '1991-12-08', cal: 'heb' }, 'אבא': { email: 'aba@gmail.com' }, 'מרים': { bday: '1962-10-02', cal: 'heb' } },
  closed: {},
  myCouple: 'c1',
};

class Component extends DCLogic {
  constructor(p) {
    super(p);
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('shulhan.v2b') || 'null'); } catch (e) {}
    if (saved && (saved.v !== SEED_V || !(saved.cfg && saved.cfg.configured))) saved = null;
    this.state = Object.assign({ v: SEED_V,
      screen: 'login', obStep: 0, tab: 'cal', filter: 'all', selected: null, wide: true, loginEmail: '',
      banner: 'חדש: כל בית רואה עכשיו מי מגיע אליו — גם מהזוגות של האחים.',
      cfg: DEFAULT_CFG, viewer: 'טל', overrides: {},
      rsvp: { 'h3|hol-rh': { c1: { status: 'yes' }, c5: { status: 'yes', note: 'עם הילדים' }, c4: { status: 'maybe' } }, 'h1|shb-2026-09-18': { c3: { status: 'yes', note: 'רק טהר' } } },
      bring: { 'h3|hol-rh': [{ item: 'תפוח בדבש + רימונים', by: 'c5' }, { item: 'ראש דג', by: '' }, { item: 'חלות עגולות', by: 'c1' }] },
      polls: { 'h3|hol-rh': [{ q: 'באיזו שעה מתחילים?', options: [{ t: '18:30', votes: ['c5', 'h3'] }, { t: '19:30', votes: ['c1'] }] }] },
      newBring: '', addingPoll: false, newPollQ: '', newPollOpts: '', prefs: { calSync: true, mail: true, push: true },
    }, saved || {});
  }
  componentDidMount() {
    this.mq = window.matchMedia('(min-width: 760px)');
    const upd = () => this.setState({ wide: this.mq.matches });
    upd(); this.mq.addEventListener('change', upd);
  }
  componentDidUpdate() {
    const { screen, obStep, tab, filter, selected, cfg, viewer, overrides, rsvp, bring, polls, prefs, banner } = this.state;
    if (this.state.v !== SEED_V || !cfg.configured) return;
    try { localStorage.setItem('shulhan.v2b', JSON.stringify({ v: SEED_V, screen, obStep, tab, filter, selected, cfg, viewer, overrides, rsvp, bring, polls, prefs, banner })); } catch (e) {}
  }
  setCfg(fn) { this.setState(s => { const c = JSON.parse(JSON.stringify(s.cfg)); fn(c); return { cfg: c }; }); }
  home(id) { return this.state.cfg.homes.find(h => h.id === id); }
  homeIdx(id) { return this.state.cfg.homes.findIndex(h => h.id === id); }
  coupleLabel(c) { return c.names.join(' ו'); }
  coupleIdx(id) { return this.state.cfg.couples.findIndex(c => c.id === id); }
  // unit of the current viewer: couple or home
  unit() {
    const { cfg, viewer } = this.state;
    const c = cfg.couples.find(c => c.names.includes(viewer));
    if (c) return { kind: 'couple', id: c.id, couple: c, label: this.coupleLabel(c) };
    const h = cfg.homes.find(h => h.people.includes(viewer)) || cfg.homes[0];
    return { kind: 'home', id: h.id, home: h, label: h.name };
  }
  baseEvents() {
    const ev = HOLIDAYS.map(h => ({ key: 'hol-' + h.key, hkey: h.key, date: parse(h.cur), title: h.name, isHoliday: true }));
    let d = new Date(RANGE_START);
    while (d <= RANGE_END) {
      const sat = new Date(d); sat.setDate(d.getDate() + 1);
      if (!ev.some(e => e.isHoliday && iso(e.date) >= iso(d) && iso(e.date) <= iso(sat))) ev.push({ key: 'shb-' + iso(d), date: new Date(d), title: 'ארוחת שבת', isHoliday: false });
      d.setDate(d.getDate() + 7);
    }
    return ev.sort((a, b) => a.date - b.date);
  }
  // per-couple assignment: key -> {homeId, side, skip, overridden}
  assign(couple, base) {
    const ov = this.state.overrides[couple.id] || {};
    const out = {};
    const perSideHol = couple.sides.map(() => 0);
    base.filter(e => e.isHoliday).forEach(e => {
      const side = ((couple.history[e.hkey] ?? 0) + 1) % couple.sides.length;
      const homes = couple.sides[side].homes;
      out[e.key] = { homeId: homes[perSideHol[side]++ % homes.length], side };
    });
    let lastSide = couple.sides.findIndex(s => s.homes.includes(couple.lastShabbat)); if (lastSide < 0) lastSide = 0;
    const ptr = couple.sides.map((s, si) => si !== lastSide ? 0 : (s.homes.indexOf(couple.lastShabbat) + 1) % s.homes.length);
    let side = (lastSide + 1) % couple.sides.length;
    base.filter(e => !e.isHoliday).forEach(e => {
      const homes = couple.sides[side].homes;
      out[e.key] = { homeId: homes[ptr[side]++ % homes.length], side };
      side = (side + 1) % couple.sides.length;
    });
    Object.entries(ov).forEach(([k, o]) => { if (!out[k]) return; if (o.skip) out[k] = { ...out[k], skip: true }; else if (o.home) { const si = couple.sides.findIndex(s => s.homes.includes(o.home)); out[k] = { homeId: o.home, side: si < 0 ? out[k].side : si, overridden: true }; } });
    return out;
  }
  birthdays(base) {
    if (this.props.showBirthdays === false) return {};
    const { cfg } = this.state; const map = {};
    Object.entries(cfg.people).forEach(([name, p]) => {
      if (!p.bday) return;
      const b = parse(p.bday); let target = null;
      if (p.cal === 'heb') {
        const want = hebMD.format(b);
        for (let d = new Date(RANGE_START); d <= RANGE_END; d.setDate(d.getDate() + 1)) if (hebMD.format(d) === want) { target = new Date(d); break; }
      } else {
        target = new Date(RANGE_START.getFullYear(), b.getMonth(), b.getDate()); if (target < RANGE_START) target.setFullYear(target.getFullYear() + 1);
      }
      if (!target || target > RANGE_END) return;
      // nearest event within a week after (or same day)
      const ev = base.find(e => e.date >= new Date(target.getFullYear(), target.getMonth(), target.getDate() - 1));
      if (!ev) return;
      (map[ev.key] = map[ev.key] || []).push({ name, label: `יום הולדת ל${name} · ${shortFmt.format(target)}${p.cal === 'heb' ? ' (עברי)' : ''}`, short: `יום הולדת ל${name}` });
    });
    return map;
  }

  renderVals() {
    const s = this.state; const { cfg } = s;
    const unit = this.unit(); const isCoupleView = unit.kind === 'couple'; const isHomeView = !isCoupleView;
    const my = cfg.couples.find(c => c.id === cfg.myCouple) || cfg.couples[0];
    const me = my.names[0], partner = my.names[1];
    const toggle = on => ({ bg: on ? '#10a974' : '#c9d2dd', knob: on ? '3px' : '23px' });
    const base = this.baseEvents();
    const assigns = {}; cfg.couples.forEach(c => { assigns[c.id] = this.assign(c, base); });
    const bdays = this.birthdays(base);
    const couplesAt = (homeId, key) => cfg.couples.filter(c => { const a = assigns[c.id][key]; return a && !a.skip && a.homeId === homeId; });
    const homeColor = id => { const i = this.homeIdx(id); return i < 0 ? ['#f4f5f8', '#8a97a8'] : [PALETTE[i % PALETTE.length], DOTS[i % DOTS.length]]; };
    const coupleBg = id => PALETTE[(this.coupleIdx(id) + 3) % PALETTE.length];
    const rsvpOf = (tk, cid) => (s.rsvp[tk] || {})[cid] || {};
    const statusText = st => st === 'yes' ? 'מגיעים' : st === 'maybe' ? 'אולי' : st === 'no' ? 'לא הפעם' : 'טרם אישרו';
    const statusDot = st => st === 'yes' ? '#10a974' : st === 'maybe' ? '#ca8a04' : st === 'no' ? '#e11d48' : '#c9d2dd';
    const attendeesFor = (homeId, key, excludeId) => couplesAt(homeId, key).filter(c => c.id !== excludeId).map(c => { const r = rsvpOf(homeId + '|' + key, c.id); return { id: c.id, label: this.coupleLabel(c), note: r.note || false, status: statusText(r.status), dot: statusDot(r.status) }; });

    // onboarding
    const mySide = si => my.sides[si];
    const sideEditors = my.sides.map((sd, si) => ({
      name: sd.name, color: SIDE_BG[si % 2], setName: e => this.setCfg(c => { c.couples.find(x => x.id === my.id).sides[si].name = e.target.value; }),
      homes: sd.homes.filter(id => id !== 'other').map(id => { const h = this.home(id) || { name: '', city: '' }; const others = cfg.couples.filter(c => c.id !== my.id && c.sides.some(x => x.homes.includes(id))).length; return {
        name: h.name, city: h.city || '', color: homeColor(id)[1], shared: others > 0, sharedLabel: `משותף עם ${others} זוגות`,
        setName: e => this.setCfg(c => { const hh = c.homes.find(x => x.id === id); if (hh) hh.name = e.target.value; }),
        setCity: e => this.setCfg(c => { const hh = c.homes.find(x => x.id === id); if (hh) hh.city = e.target.value; }),
        remove: () => this.setCfg(c => { const cp = c.couples.find(x => x.id === my.id); cp.sides[si].homes = cp.sides[si].homes.filter(x => x !== id); }),
      }; }),
      addHome: () => this.setCfg(c => { const id = 'h' + Date.now(); c.homes.push({ id, name: '', city: '', people: [] }); c.couples.find(x => x.id === my.id).sides[si].homes.push(id); }),
    }));
    const historyRows = HOLIDAYS.map(h => ({ name: h.name, lastDate: 'בשנה שעברה · ' + longFmt.format(parse(h.prev)), options: my.sides.map((sd, si) => ({ label: sd.name, bg: my.history[h.key] === si ? '#0f2a4a' : 'transparent', fg: my.history[h.key] === si ? '#fff' : '#5b6b7f', pick: () => this.setCfg(c => { c.couples.find(x => x.id === my.id).history[h.key] = si; }) })) }));
    const myHomeIds = my.sides.flatMap(sd => sd.homes).filter(id => id !== 'other');
    const lastShabbatOptions = myHomeIds.map(id => ({ label: (this.home(id) || {}).name || '—', border: my.lastShabbat === id ? '#0f2a4a' : '#dde3ea', bg: my.lastShabbat === id ? homeColor(id)[0] : '#fff', pick: () => this.setCfg(c => { c.couples.find(x => x.id === my.id).lastShabbat = id; }) }));
    const netPeople = [...my.names.map(n => ({ name: n, sub: 'אנחנו' })), ...myHomeIds.flatMap(id => (this.home(id) || { people: [] }).people.map(n => ({ name: n, sub: this.home(id).name })))];
    const inviteRows = netPeople.map((p, i) => { const info = cfg.people[p.name] || {}; const setP = fn => this.setCfg(c => { c.people[p.name] = c.people[p.name] || {}; fn(c.people[p.name]); }); const isHeb = info.cal === 'heb'; return {
      name: p.name, sub: p.sub, initial: p.name[0], color: PALETTE[i % PALETTE.length], email: info.email || '', setEmail: e => setP(x => { x.email = e.target.value; }),
      bday: info.bday || '', setBday: e => setP(x => { x.bday = e.target.value; x.cal = x.cal || 'greg'; }),
      gregBg: isHeb ? 'transparent' : '#0f2a4a', gregFg: isHeb ? '#5b6b7f' : '#fff', hebBg: isHeb ? '#0f2a4a' : 'transparent', hebFg: isHeb ? '#fff' : '#5b6b7f',
      setGreg: () => setP(x => { x.cal = 'greg'; }), setHeb: () => setP(x => { x.cal = 'heb'; }),
      bdayLabel: info.bday ? (isHeb ? hebFmt.format(parse(info.bday)) : shortFmt.format(parse(info.bday))) : '',
    }; });

    // events for the viewer
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const events = base.map(e => {
      let homeId, skip = false, overridden = false, closed = false;
      if (isCoupleView) { const a = assigns[unit.id][e.key]; homeId = a.homeId; skip = !!a.skip; overridden = !!a.overridden; }
      else homeId = unit.id;
      const real = homeId !== 'other'; const home = real ? this.home(homeId) : null;
      closed = real && !!cfg.closed[homeId + '|' + e.key];
      const tk = real ? homeId + '|' + e.key : null;
      const others = real ? attendeesFor(homeId, e.key, isCoupleView ? unit.id : null) : [];
      const mine = isCoupleView && tk ? rsvpOf(tk, unit.id) : {};
      const [bg, dot] = real ? homeColor(homeId) : ['#f4f5f8', '#8a97a8'];
      const otherName = isCoupleView ? 'ההורים של ' + (unit.couple.sides.find(sd => sd.homes.includes('other')) || { name: '' }).name : '';
      const yesCount = others.filter(o => o.dot === '#10a974').length + (mine.status === 'yes' ? 1 : 0);
      let hostLabel, hostFull, othersShort, othersTitle;
      if (isCoupleView) {
        hostLabel = skip ? 'לא נפגשים' : real ? home.name : otherName; hostFull = skip ? 'השבוע לא נפגשים' : 'אצל ' + hostLabel;
        othersShort = skip ? '' : !real ? '' : others.length ? 'גם: ' + others.map(o => o.label).join(', ') : 'רק אנחנו';
        othersTitle = real ? (others.length ? 'מי עוד יהיה שם' : 'רק אנחנו השבת') : 'מחוץ לרשת';
      } else {
        hostLabel = others.length ? `${others.length} זוגות` : 'אף אחד'; hostFull = closed ? 'לא מארחים' : others.length ? `${others.length} זוגות מגיעים` : 'אף אחד לא מגיע';
        othersShort = others.map(o => o.label).join(', '); othersTitle = others.length ? 'מי מגיע' : 'השולחן ריק השבת';
      }
      return { ...e, homeId, real, home, tk, skip, overridden, closed, others, mine, yesCount,
        day: e.date.getDate(), dow: DOW[e.date.getDay()], hebrew: hebFmt.format(e.date), longDate: longFmt.format(e.date),
        hostBg: skip || closed ? '#eceef2' : bg, hostDot: skip ? '#8a97a8' : dot, hostLabel, hostFull, othersShort, othersTitle, city: real && !skip ? home.city : '',
        attendees: isCoupleView && real && !skip ? [{ label: unit.label + ' (אנחנו)', dot: statusDot(mine.status), note: mine.note || false, status: statusText(mine.status) }, ...others] : others,
        rsvpSummary: skip ? '' : !real ? '' : yesCount ? `${yesCount} זוגות אישרו` : 'עוד לא אישרו',
        bdays: bdays[e.key] || [], dateBg: e.isHoliday ? '#fff3c4' : '#f4f5f8', border: overridden ? '#7c3aed' : 'transparent', opacity: skip || (isHomeView && !others.length) ? .6 : 1,
        open: () => this.setState({ selected: e.key }) };
    });
    const nextEv = events.find(e => !e.skip && e.date >= today) || null;
    const next = nextEv ? (() => { const days = Math.round((nextEv.date - today) / 86400000); return { ...nextEv, when: days === 0 ? 'היום' : days === 1 ? 'מחר' : days < 7 ? `בעוד ${days} ימים` : days < 14 ? 'בשבוע הבא' : `בעוד ${Math.round(days / 7)} שבועות`, cta: isCoupleView ? (nextEv.mine.status ? 'פרטים, מי מביא וסקרים' : 'אשרו הגעה') : 'לשולחן' }; })() : null;
    const filtered = events.filter(e => e !== nextEv && e.date >= today && (s.filter === 'all' || (s.filter === 'hol' ? e.isHoliday : !e.isHoliday)));
    const months = []; filtered.forEach(e => { const k = monthFmt.format(e.date); let m = months.find(x => x.label === k); if (!m) { m = { label: k, events: [], count: 0 }; months.push(m); } m.events.push(e); m.count++; });

    // detail
    const sel = events.find(e => e.key === s.selected) || null;
    const tk = sel && sel.tk;
    const setList = (key, fn) => this.setState(st => ({ [key]: { ...st[key], [tk]: fn(st[key][tk] || []) } }));
    const setMyRsvp = patch => this.setState(st => ({ rsvp: { ...st.rsvp, [tk]: { ...(st.rsvp[tk] || {}), [unit.id]: { ...((st.rsvp[tk] || {})[unit.id] || {}), ...patch } } } }));
    const rsvpOptions = [['yes', 'מגיעים', '#10a974'], ['maybe', 'אולי', '#ca8a04'], ['no', 'לא הפעם', '#8a97a8']].map(([v, label, c]) => ({ label, bg: sel && sel.mine.status === v ? c : 'transparent', fg: sel && sel.mine.status === v ? '#fff' : '#5b6b7f', pick: () => tk && setMyRsvp({ status: v }) }));
    const bringItems = sel && tk ? (s.bring[tk] || []).map((b, i) => { const c = cfg.couples.find(x => x.id === b.by); const h = this.home(b.by); return { item: b.item, who: c ? this.coupleLabel(c) : h ? h.name : false, dot: c ? DOTS[(this.coupleIdx(c.id) + 3) % DOTS.length] : '#8a97a8', open: !b.by, claim: () => setList('bring', l => l.map((x, j) => j === i ? { ...x, by: unit.id } : x)), remove: () => setList('bring', l => l.filter((x, j) => j !== i)) }; }) : [];
    const addBring = () => { if (!tk || !s.newBring.trim()) return; setList('bring', l => [...l, { item: s.newBring.trim(), by: '' }]); this.setState({ newBring: '' }); };
    const polls = sel && tk ? (s.polls[tk] || []).map((p, pi) => { const total = p.options.reduce((a, o) => a + o.votes.length, 0) || 1; return { q: p.q, options: p.options.map((o, oi) => { const mine = o.votes.includes(unit.id); return { t: o.t, count: o.votes.length, pct: Math.round(o.votes.length / total * 100) + '%', fill: mine ? '#efe0ff' : '#f4f5f8', border: mine ? '#7c3aed' : '#e9ecf1', weight: mine ? 700 : 500, vote: () => setList('polls', l => l.map((pp, j) => j !== pi ? pp : { ...pp, options: pp.options.map((oo, k) => ({ ...oo, votes: k === oi ? [...oo.votes.filter(v => v !== unit.id), unit.id] : oo.votes.filter(v => v !== unit.id) })) })) }; }) }; }) : [];
    const savePoll = () => { const opts = s.newPollOpts.split(',').map(x => x.trim()).filter(Boolean); if (!tk || !s.newPollQ.trim() || opts.length < 2) return; setList('polls', l => [...l, { q: s.newPollQ.trim(), options: opts.map(t => ({ t, votes: [] })) }]); this.setState({ addingPoll: false, newPollQ: '', newPollOpts: '' }); };
    const setOv = patch => sel && this.setState(st => ({ overrides: { ...st.overrides, [unit.id]: { ...(st.overrides[unit.id] || {}), [sel.key]: patch } } }));
    const hostOptions = sel && isCoupleView ? unit.couple.sides.flatMap(sd => sd.homes).map(id => { const real = id !== 'other'; const cur = !sel.skip && sel.homeId === id; const [bg, dot] = homeColor(id); return { label: real ? this.home(id).name : 'ההורים של ' + (unit.couple.sides.find(x => x.homes.includes('other')) || {}).name, dot, border: cur ? '#0f2a4a' : '#dde3ea', bg: cur ? bg : '#fff', pick: () => setOv({ home: id }) }; }) : [];
    const icsHref = sel ? 'data:text/calendar;charset=utf-8,' + encodeURIComponent(this.ics(sel)) : '#';
    const mailTo = sel && sel.real ? [...sel.home.people, ...couplesAt(sel.homeId, sel.key).flatMap(c => c.names)].map(n => (cfg.people[n] || {}).email).filter(Boolean).join(',') : '';
    const mailHref = sel ? `mailto:${mailTo}?subject=${encodeURIComponent(sel.title + ' · ' + sel.longDate)}&body=${encodeURIComponent(`${sel.hostFull}${sel.city ? ' (' + sel.city + ')' : ''}\n${sel.hebrew}\n\nלאישור הגעה, סקרים ו״מי מביא״: https://shulhan.app/t/${sel.tk || sel.key}`)}` : '#';

    // inbox
    const soon = events.filter(e => !e.skip && e.date >= today && e.date <= new Date(today.getTime() + 21 * 86400000));
    const inbox = [
      ...(isCoupleView ? soon.filter(e => e.real && !e.mine.status).map(e => ({ icon: '?', bg: '#fff3c4', title: `${e.title} ${e.hostFull} — עוד לא אישרתם הגעה`, sub: e.longDate })) : []),
      ...(isHomeView ? soon.filter(e => !e.others.length && !e.closed).map(e => ({ icon: '○', bg: '#eceef2', title: `${e.title} — אף זוג לא משובץ אליכם`, sub: e.longDate })) : []),
      ...(isCoupleView ? soon.filter(e => e.closed).map(e => ({ icon: '!', bg: '#fbe9f4', title: `${e.home.name} לא מארחים ב${e.title} — כדאי לשנות את הסבב`, sub: e.longDate })) : []),
      ...soon.flatMap(e => e.bdays.map(b => ({ icon: '✿', bg: '#fde4ea', title: b.label, sub: 'הכי קרוב ל' + e.title + ' · ' + e.longDate }))),
      { icon: '✓', bg: '#d8f3ec', title: 'חיו ומיטל לקחו על עצמם תפוח בדבש ורימונים לראש השנה אצל גוזלן', sub: 'לפני שעתיים' },
      { icon: '⌂', bg: '#e3eefb', title: 'הסבבים לשנת תשפ״ז נוצרו לכל הזוגות ברשת', sub: 'אוטומטי · לפי ההיסטוריה של כל זוג' },
    ];
    const tabs = [['cal', isCoupleView ? 'הלוח שלנו' : 'השולחן', 0], ['inbox', 'עדכונים', inbox.filter(n => n.icon === '?' || n.icon === '!' || n.icon === '○').length], ['settings', 'הרשת', 0]].map(([id, label, badge]) => ({ label, badge: badge || false, bg: s.tab === id ? '#fff' : 'transparent', fg: s.tab === id ? '#7c3aed' : '#5b6b7f', go: () => this.setState({ tab: id }) }));
    const filters = [['all', 'הכול'], ['shb', 'שבתות'], ['hol', 'חגים']].map(([id, label]) => ({ label, bg: s.filter === id ? '#0f2a4a' : 'transparent', fg: s.filter === id ? '#fff' : '#5b6b7f', go: () => this.setState({ filter: id }) }));

    // settings
    const visibleHomeIds = isCoupleView ? unit.couple.sides.flatMap(sd => sd.homes).filter(id => id !== 'other') : [unit.id];
    const myHomes = visibleHomeIds.map(id => { const h = this.home(id); const cps = cfg.couples.filter(c => c.sides.some(sd => sd.homes.includes(id))); const live = events.filter(e => e.date >= today); const n = isCoupleView ? live.filter(e => !e.skip && e.homeId === id).length : live.filter(e => e.others.length).length; return { name: h.name, dot: homeColor(id)[1], sub: `${h.city} · ${h.people.join(', ')}`, couples: cps.map(c => ({ label: this.coupleLabel(c), bg: coupleBg(c.id) })), stat: isCoupleView ? `אנחנו שם ${n} פעמים השנה` : `${n} שבתות וחגים עם אורחים השנה`, invite: () => this.setState({ banner: `קישור הזמנה ל${h.name} הועתק — כל זוג שייכנס דרכו יתחבר לבית הזה ויגדיר סבב משלו.` }) }; });
    const viewerOptions = [...cfg.couples.flatMap(c => c.names), ...cfg.homes.flatMap(h => h.people)].map(n => ({ label: n, border: s.viewer === n ? '#0f2a4a' : '#dde3ea', bg: s.viewer === n ? '#d9fb8a' : '#fff', pick: () => this.setState({ viewer: n, selected: null }) }));
    const prefRows = [['calSync', 'סנכרון ליומן Google', 'כל ארוחה מתעדכנת ביומן של שני בני הזוג'], ['mail', 'הזמנות ותזכורות במייל', 'שבוע לפני ויום לפני'], ['push', 'התראות', 'אישורי הגעה, סקרים, מי מביא']].map(([k, title, sub]) => ({ title, sub, ...toggle(s.prefs[k]), toggle: () => this.setState(st => ({ prefs: { ...st.prefs, [k]: !st.prefs[k] } })) }));

    const goApp = () => this.setState({ screen: cfg.configured ? 'app' : 'onboarding', obStep: 0 });
    return {
      isLogin: s.screen === 'login', isOnboarding: s.screen === 'onboarding', isApp: s.screen === 'app',
      loginEmail: s.loginEmail, setLoginEmail: e => this.setState({ loginEmail: e.target.value }), loginGoogle: goApp, loginEmailGo: goApp,
      me, partner, setMe: e => this.setCfg(c => { c.couples.find(x => x.id === my.id).names[0] = e.target.value; }), setPartner: e => this.setCfg(c => { c.couples.find(x => x.id === my.id).names[1] = e.target.value; }),
      obDots: [0, 1, 2, 3].map(i => ({ w: i === s.obStep ? '24px' : '8px', bg: i <= s.obStep ? '#7c3aed' : '#dde3ea' })),
      ob0: s.obStep === 0, ob1: s.obStep === 1, ob2: s.obStep === 2, ob3: s.obStep === 3,
      obBackVis: s.obStep === 0 ? 'hidden' : 'visible', obNextLabel: s.obStep < 3 ? 'המשך' : 'שליחת הזמנות וסיום',
      obBack: () => this.setState({ obStep: Math.max(0, s.obStep - 1) }),
      obNext: () => s.obStep < 3 ? this.setState({ obStep: s.obStep + 1 }) : (this.setCfg(c => { c.configured = true; }), this.setState({ screen: 'app', tab: 'cal', viewer: me, banner: 'הסבב שלכם נוצר. הבתים המשותפים כבר רואים אותכם בשולחן שלהם.' })),
      sideEditors, historyRows, lastShabbatOptions, inviteRows,
      unitName: unit.label, headerSub: isCoupleView ? `${s.viewer} · הסבב של הזוג` : `${s.viewer} · השולחן של הבית`, tabs, banner: s.banner || false, dismissBanner: () => this.setState({ banner: '' }),
      tabCal: s.tab === 'cal', tabInbox: s.tab === 'inbox', tabSettings: s.tab === 'settings',
      showList: s.wide || !s.selected, showDetail: s.wide || !!s.selected, narrow: !s.wide, closeDetail: () => this.setState({ selected: null }),
      hasNext: !!next, next: next || {}, filters, months, hasSel: !!sel, noSel: !sel, sel: sel || {},
      isCoupleView, isHomeView, hasTable: !!(sel && sel.real && !sel.skip), rsvpTitle: isCoupleView ? 'אנחנו מגיעים?' : 'מי מגיע',
      rsvpOptions, rsvpNote: sel ? sel.mine.note || '' : '', setRsvpNote: e => tk && setMyRsvp({ note: e.target.value }),
      attendees: sel ? sel.attendees : [], noAttendees: !!(sel && isHomeView && !sel.others.length),
      selClosedNote: sel && sel.closed ? (isCoupleView ? `${sel.home.name} סימנו שהם לא מארחים בתאריך הזה` : 'סימנתם שאתם לא מארחים בתאריך הזה') : false,
      bringItems, newBring: s.newBring, setNewBring: e => this.setState({ newBring: e.target.value }), addBring, bringKey: e => { if (e.key === 'Enter') addBring(); },
      polls, addingPoll: s.addingPoll, notAddingPoll: !s.addingPoll, togglePoll: () => this.setState({ addingPoll: !s.addingPoll }),
      newPollQ: s.newPollQ, setNewPollQ: e => this.setState({ newPollQ: e.target.value }), newPollOpts: s.newPollOpts, setNewPollOpts: e => this.setState({ newPollOpts: e.target.value }), savePoll,
      hostOptions, skipLabel: sel && sel.skip ? 'בכל זאת נפגשים' : 'לא נפגשים', skipBorder: sel && sel.skip ? '#0f2a4a' : '#dde3ea', skipBg: sel && sel.skip ? '#eceef2' : '#fff',
      toggleSkip: () => setOv(sel && sel.skip ? {} : { skip: true }),
      selNote: sel && sel.overridden ? 'שונה ידנית מהסבב האוטומטי — רק אנחנו רואים את הסבב שלנו' : false,
      closedLabel: sel && sel.closed ? 'בכל זאת מארחים' : 'לא מארחים בתאריך הזה', closedBorder: sel && sel.closed ? '#0f2a4a' : '#dde3ea', closedBg: sel && sel.closed ? '#eceef2' : '#fff',
      toggleClosed: () => sel && this.setCfg(c => { const k = unit.id + '|' + sel.key; if (c.closed[k]) delete c.closed[k]; else c.closed[k] = true; }),
      icsHref, icsName: sel ? sel.key + '.ics' : 'event.ics', mailHref,
      inbox, inboxEmpty: inbox.length === 0, myHomes, viewerOptions, prefRows,
      reconfigure: () => this.setState({ screen: 'onboarding', obStep: 1, viewer: me }), logout: () => this.setState({ screen: 'login' }),
    };
  }
  ics(e) {
    const d = e.date; const dt = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Shulhan//HE', 'BEGIN:VEVENT', `UID:${e.tk || e.key}@shulhan`, `DTSTART:${dt}T${e.isHoliday ? '183000' : '190000'}`, `DTEND:${dt}T220000`, `SUMMARY:${e.title} — ${e.hostFull}`, `LOCATION:${e.city || ''}`, `DESCRIPTION:${e.hebrew}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  }
}
