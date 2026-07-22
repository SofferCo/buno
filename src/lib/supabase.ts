// buno — Supabase client (singleton).
// Reads the project URL + publishable key from .env.local (see .env.example).
// When the env is absent the app runs in LOCAL MODE — no auth, data stays in
// the browser (Stage-A behavior) — so dev never breaks on a missing key.
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key) : null;

export const isLocalMode = !supabase;
