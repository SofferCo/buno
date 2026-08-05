// buno — auth context. One place owns the Supabase session.
// Identity → display: Google photo (user_metadata.avatar_url) or real
// initials from the name/email. The avatar must never hardcode "אני".
import { createContext, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, isLocalMode } from "../lib/supabase";

export type Identity = {
  id: string;
  email: string;
  name: string;      // full name from the provider, or "" (initials fall back to email)
  photo: string | null; // Google profile photo when present
};

type AuthCtx = {
  loading: boolean;
  session: Session | null;
  identity: Identity | null;
  localMode: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

function toIdentity(s: Session | null): Identity | null {
  if (!s) return null;
  const u = s.user;
  const m: any = u.user_metadata || {};
  return {
    id: u.id,
    email: u.email || "",
    name: m.full_name || m.name || "",
    photo: m.avatar_url || m.picture || null,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(!isLocalMode);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthCtx = {
    loading,
    session,
    identity: toIdentity(session),
    localMode: isLocalMode,
    async signInWithGoogle() {
      if (!supabase) return;
      await supabase.auth.signInWithOAuth({
        provider: "google",
        // preserve ?invite (and any other query) so an invited user lands back on
        // the same contextual flow after Google auth.
        options: { redirectTo: window.location.origin + window.location.search },
      });
    },
    async signInWithEmail(email: string) {
      if (!supabase) return { error: "local" };
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      return { error: error ? error.message : null };
    },
    async signOut() { if (supabase) await supabase.auth.signOut(); },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
