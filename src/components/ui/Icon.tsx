export function Icon({ name, size = 18 }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, style: { flex: "none" } };
  const shapes = {
    chart: <><path d="M4 4v15a1 1 0 0 0 1 1h15" /><path d="M7.5 14.5l3.5-3.5 3 3 5-5.5" /></>,
    archive: <><rect x="3.5" y="4" width="17" height="4.2" rx="1.4" /><path d="M5.2 8.2v10.3a1.5 1.5 0 0 0 1.5 1.5h10.6a1.5 1.5 0 0 0 1.5-1.5V8.2" /><path d="M10 12h4" /></>,
    sun: <><circle cx="12" cy="12" r="3.6" /><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" /></>,
    printer: <><path d="M6.5 9V3.5h11V9" /><rect x="6.5" y="14" width="11" height="6.5" rx="1" /><path d="M6.5 17.5H5A2 2 0 0 1 3 15.5v-3A2 2 0 0 1 5 10.5h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-1.5" /></>,
    eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    comment: <><path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4 19l1-4.2A7.5 7.5 0 1 1 20 11.5Z" /></>,
    users: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 19a5.5 5.5 0 0 0-3-4.9" /></>,
    share: <><circle cx="17.5" cy="5.5" r="2.7" /><circle cx="6.5" cy="12" r="2.7" /><circle cx="17.5" cy="18.5" r="2.7" /><path d="M9 10.7l6-3.9M9 13.3l6 3.9" /></>,
    calendar: <><rect x="3.5" y="4.5" width="17" height="16" rx="2.5" /><path d="M3.5 9h17M8 3v3M16 3v3" /></>,
    arrowL: <><path d="M19 12H5M11 6l-6 6 6 6" /></>,
    arrowR: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    arrowUp: <><path d="M12 19V5M6 11l6-6 6 6" /></>,
    spark: <><path d="M12 3.5l1.7 5.3 5.3 1.7-5.3 1.7L12 17.5l-1.7-5.3L5 10.5l5.3-1.7z" /></>,
    gear: <><circle cx="12" cy="12" r="3.1" /><path d="M19.4 12c0-.4 0-.8-.1-1.2l2-1.5-2-3.5-2.3 1a7.2 7.2 0 0 0-2.1-1.2L14.5 3h-4l-.4 2.6a7.2 7.2 0 0 0-2.1 1.2l-2.3-1-2 3.5 2 1.5c-.1.4-.1.8-.1 1.2s0 .8.1 1.2l-2 1.5 2 3.5 2.3-1a7.2 7.2 0 0 0 2.1 1.2l.4 2.6h4l.4-2.6a7.2 7.2 0 0 0 2.1-1.2l2.3 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2Z" /></>,
    bell: <><path d="M18 8.4a6 6 0 1 0-12 0c0 6.6-2.6 8.4-2.6 8.4h17.2S18 15 18 8.4" /><path d="M13.7 20.5a2 2 0 0 1-3.4 0" /></>,
    chevD: <><path d="M6 9.5l6 6 6-6" /></>,
    grid: <><rect x="4" y="4" width="7" height="7" rx="1.6" /><rect x="13" y="4" width="7" height="7" rx="1.6" /><rect x="4" y="13" width="7" height="7" rx="1.6" /><rect x="13" y="13" width="7" height="7" rx="1.6" /></>,
    mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" /></>,
  };
  return <svg {...p}>{shapes[name]}</svg>;
}
