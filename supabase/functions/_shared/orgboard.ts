// buno — recognize a client/organization and give it a home.
// When triage sees an email from a real organization that has NO board yet,
// buno opens a board for that org (owner = the user, standard columns, its own
// color) so the card lands in the right place and gets the right color instead
// of being dumped into "אישי". This is core to buno's onboarding: it learns the
// user's world from their inbox and builds the boards around it.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// mirrors src/lib/constants.ts DEFAULT_COLUMNS (edge functions can't import src)
const DEFAULT_COLUMNS = [
  { key: "col-brief", title: "בריף חדש" },
  { key: "col-doing", title: "בעבודה" },
  { key: "col-review", title: "לבדיקה / אישור" },
  { key: "col-done", title: "הושלם" },
];

// board colors, in priority order (skip teal #0E8F8C — the personal default)
const ORG_COLORS = ["#3B6FE0", "#8E54C4", "#D9503A", "#C9821A", "#2E9E5B", "#4FB0AD", "#6C7BE0", "#455A64"];

// personal email providers — a card from these is NOT an organization
const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com", "hotmail.com",
  "live.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com",
  "walla.co.il", "walla.com", "nana10.co.il", "163.com", "qq.com", "gmx.com", "zoho.com",
]);

export function domainOf(from: string): string {
  const m = String(from || "").match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
  return m ? m[1].toLowerCase().replace(/^www\./, "") : "";
}

export function isPersonalDomain(domain: string): boolean {
  return !domain || PERSONAL_DOMAINS.has(domain);
}

// the org's "core" name from its domain — trendmind.ai → "trendmind"
export function domainCore(domain: string): string {
  const host = domain.split(".")[0] || "";
  return host.toLowerCase();
}

// does an existing project already represent this org (by email domain or name)?
export function matchOrgProject(projList: any[], domain: string, orgName: string): any | null {
  const core = domainCore(domain);
  const nm = String(orgName || "").trim().toLowerCase();
  for (const p of projList) {
    if (p.is_personal) continue;
    const pDomain = domainOf(p.email || "") || String(p.email || "").toLowerCase();
    const pName = String(p.name || "").toLowerCase();
    if (domain && pDomain && (pDomain === domain || domainCore(pDomain) === core)) return p;
    if (core && pName && (pName === core || pName.includes(core) || core.includes(pName))) return p;
    if (nm && pName && (pName === nm || pName.includes(nm) || nm.includes(pName))) return p;
  }
  return null;
}

// create a board for a newly-recognized org. Returns the new project row (with
// is_personal) and pushes it onto projList so later cards in the same run reuse
// it. usedColors tracks colors already taken this run + already on the board.
export async function ensureOrgBoard(
  admin: SupabaseClient,
  userId: string,
  orgName: string,
  domain: string,
  projList: any[],
  usedColors: Set<string>,
): Promise<any | null> {
  // reuse an existing board if one already fits (idempotent across the run)
  const existing = matchOrgProject(projList, domain, orgName);
  if (existing) return existing;

  const name = (String(orgName || "").trim() || domainCore(domain) || "לקוח חדש").slice(0, 60);
  const color = ORG_COLORS.find((c) => !usedColors.has(c)) || ORG_COLORS[projList.length % ORG_COLORS.length];

  const { data: proj, error } = await admin.from("project").insert({
    name, color, email: domain || null, is_personal: false, created_by: userId,
  }).select("id,name,color,email,is_personal").single();
  if (error || !proj) return null;

  await admin.from("project_member").insert({ project_id: proj.id, user_id: userId, role: "owner" });
  await admin.from("board_column").insert(
    DEFAULT_COLUMNS.map((c, i) => ({ project_id: proj.id, key: c.key, title: c.title, position: i, is_done: c.key === "col-done" })),
  );

  usedColors.add(color);
  projList.push(proj);
  return proj;
}
