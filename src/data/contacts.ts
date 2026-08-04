// buno — contacts data layer. Thin people entities (not users) born from the
// conversation, the calendar, or email. See migration 0022.
import { supabase } from "../lib/supabase";

export async function listContacts() {
  if (!supabase) return [];
  try { const { data } = await supabase.from("contacts").select("id,name,email,phone,source"); return data || []; } catch { return []; }
}

// Upsert by (user_id, name). Only the fields you pass are written, so a later
// mention (name only) never wipes an email a calendar sync already captured.
export async function upsertContact(userId: string, c: { name: string; email?: string; phone?: string; source?: string; createdFrom?: string }) {
  if (!supabase || !userId || !c.name?.trim()) return;
  const row: any = { user_id: userId, name: c.name.trim() };
  if (c.email) row.email = c.email;
  if (c.phone) row.phone = c.phone;
  if (c.source) row.source = c.source;
  if (c.createdFrom) row.created_from = c.createdFrom;
  try { await supabase.from("contacts").upsert(row, { onConflict: "user_id,name" }); } catch { /* pre-0022 or dup — ignore */ }
}
