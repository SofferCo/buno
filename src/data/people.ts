// buno — ask the edge to read the PERSON names off a card title (+ note). Used
// when a hand-typed title names someone buno doesn't know yet; the edge also
// registers them as contacts, so the next title matches locally.
import { supabase } from "../lib/supabase";

export async function extractPeople(title: string, description: string, known: string[], self: string): Promise<string[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.functions.invoke("extract-people", { body: { title, description, known, self } });
    if (error) return [];
    return Array.isArray((data as any)?.people) ? (data as any).people.map((s: any) => String(s || "").trim()).filter(Boolean) : [];
  } catch { return []; }
}

// batch variant for the one-time backfill: many titles → one model call.
export async function extractPeopleBatch(items: { id: string; title: string; description?: string }[], known: string[], self: string): Promise<Record<string, string[]>> {
  if (!supabase || !items.length) return {};
  try {
    const { data, error } = await supabase.functions.invoke("extract-people", { body: { items, known, self } });
    if (error) return {};
    const out: Record<string, string[]> = {};
    for (const r of (Array.isArray((data as any)?.results) ? (data as any).results : [])) out[String(r.id)] = Array.isArray(r.people) ? r.people.map((s: any) => String(s || "").trim()).filter(Boolean) : [];
    return out;
  } catch { return {}; }
}
