// Infer which project a calendar event belongs to, from its attendees' email
// domains. "oded@codata.io" → the project whose email domain is codata.io, or
// whose name matches the domain's core word ("codata"). Personal providers are
// ignored. Returns a project id or null.
const PERSONAL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "me.com", "walla.co.il", "proton.me"]);

const domainOf = (email: string) => (email || "").split("@")[1]?.toLowerCase().trim() || "";
const core = (domain: string) => domain.split(".")[0]; // codata.io → codata

export function inferEventProjectId(attendees: any[], clients: any[], organizer?: string | null): string | null {
  const domains = [
    ...(organizer ? [domainOf(organizer)] : []),        // organizer is the strongest signal
    ...(attendees || []).filter((a) => !a.self).map((a) => domainOf(a.email)),
  ].filter((d) => d && !PERSONAL.has(d));
  if (!domains.length) return null;
  for (const d of domains) {
    const c = core(d);
    // 1) a project whose stored email is on the same domain
    let match = clients.find((cl) => cl.email && domainOf(cl.email) === d);
    // 2) a project whose name matches the domain's core word (codata ↔ codata.io)
    if (!match) match = clients.find((cl) => {
      const n = (cl.name || "").toLowerCase().replace(/\s+/g, "");
      return n && (n === c || n.includes(c) || c.includes(n));
    });
    if (match) return match.id;
  }
  return null;
}
