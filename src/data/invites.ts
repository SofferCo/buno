// buno — sharing operations (Stage D). Thin wrappers over Supabase; RLS and
// the SECURITY DEFINER functions in 0006 are the real gate.
import type { SupabaseClient } from "@supabase/supabase-js";

function token(): string {
  // unguessable invite token; the invite is also email-bound server-side
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type PendingInvite = { id: string; email: string; role: string; token: string; created_at: string };

export async function listInvites(sb: SupabaseClient, projectId: string): Promise<PendingInvite[]> {
  const { data, error } = await sb.from("project_invite")
    .select("id,email,role,token,created_at,accepted_at")
    .eq("project_id", projectId).is("accepted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(({ accepted_at, ...r }) => r);
}

// owner creates an invite; returns the row incl. the shareable link
export async function createInvite(
  sb: SupabaseClient, projectId: string, email: string, role: string, invitedBy: string, origin: string
): Promise<{ invite: PendingInvite; link: string }> {
  const tok = token();
  const { data, error } = await sb.from("project_invite")
    .insert({ project_id: projectId, email: email.trim().toLowerCase(), role, token: tok, invited_by: invitedBy })
    .select("id,email,role,token,created_at").single();
  if (error) throw new Error(error.message);
  return { invite: data as PendingInvite, link: `${origin}/?invite=${tok}` };
}

export async function revokeInvite(sb: SupabaseClient, inviteId: string): Promise<void> {
  const { error } = await sb.from("project_invite").delete().eq("id", inviteId);
  if (error) throw new Error(error.message);
}

// owner changes a member's role or removes them
export async function setMemberRole(sb: SupabaseClient, projectId: string, userId: string, role: string): Promise<void> {
  const { error } = await sb.from("project_member").update({ role }).eq("project_id", projectId).eq("user_id", userId);
  if (error) throw new Error(error.message);
}
export async function removeMember(sb: SupabaseClient, projectId: string, userId: string): Promise<void> {
  const { error } = await sb.from("project_member").delete().eq("project_id", projectId).eq("user_id", userId);
  if (error) throw new Error(error.message);
}
export async function leaveProject(sb: SupabaseClient, projectId: string): Promise<void> {
  const { data: u } = await sb.auth.getUser();
  const { error } = await sb.from("project_member").delete().eq("project_id", projectId).eq("user_id", u.user!.id);
  if (error) throw new Error(error.message);
}

// invitee side — token-gated, email-bound in the DB function
export async function peekInvite(sb: SupabaseClient, tok: string):
  Promise<{ projectId: string; projectName: string; role: string; inviter: string } | null> {
  const { data, error } = await sb.rpc("peek_project_invite", { invite_token: tok });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return { projectId: row.project_id, projectName: row.project_name, role: row.role, inviter: row.inviter };
}
export async function acceptInvite(sb: SupabaseClient, tok: string): Promise<string> {
  const { data, error } = await sb.rpc("accept_project_invite", { invite_token: tok });
  if (error) throw new Error(error.message);
  return data as string; // project_id
}

// PUBLIC summary for the pre-auth contextual entry screen — anon-callable, no email
// binding (just board name + inviter + role). Returns null for an invalid/expired token.
export async function publicInviteSummary(sb: SupabaseClient, tok: string):
  Promise<{ projectName: string; inviter: string; role: string } | null> {
  try {
    const { data } = await sb.rpc("invite_public_summary", { invite_token: tok });
    const row = Array.isArray(data) ? data[0] : data;
    return row ? { projectName: row.project_name, inviter: row.inviter_name, role: row.role } : null;
  } catch { return null; }
}

export type InviteOutlineCol = { name: string; count: number; titles: string[] };
export type InviteContext = {
  projectName: string; inviter: string; role: string;
  email: string; color: string; outline: InviteOutlineCol[];
};
// PUBLIC rich context (anon): header + invited email + a safe board outline
// (column titles + card titles + counts + board color; no inner content).
// Returns null for an invalid/expired/accepted token. See migration 0024.
export async function publicInviteContext(sb: SupabaseClient, tok: string): Promise<InviteContext | null> {
  try {
    const { data } = await sb.rpc("invite_public_context", { invite_token: tok });
    if (!data) return null;
    return {
      projectName: data.projectName, inviter: data.inviter, role: data.role,
      email: data.email || "", color: data.color || "#0E8F8C",
      outline: Array.isArray(data.outline) ? data.outline : [],
    };
  } catch { return null; }
}
