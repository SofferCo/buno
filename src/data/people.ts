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
