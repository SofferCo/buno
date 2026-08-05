// buno — the contextual entry for someone arriving from an invite link, LOGGED OUT.
// A blurred skeleton board sits behind (real board data is RLS-protected pre-auth,
// so the backdrop is a placeholder — the real board loads after they sign in and the
// invite auto-accepts) + a centered floating card: "‹inviter› invited you to ‹board›".
import { useState, useEffect } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { supabase } from "../../lib/supabase";
import { publicInviteSummary } from "../../data/invites";

const ROLE_HE: Record<string, string> = { owner: "בעלים", member: "חבר צוות", viewer: "צופה" };

export function InvitedEntry({ token }: { token: string }) {
  const { signInWithGoogle } = useAuth();
  const [sum, setSum] = useState<{ projectName: string; inviter: string; role: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { if (supabase) publicInviteSummary(supabase, token).then((s) => { setSum(s); setLoaded(true); }); else setLoaded(true); }, [token]);

  return (
    <div className="adk" style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
      {/* blurred skeleton board behind — conveys "a board is here" without leaking data */}
      <div aria-hidden style={{ position: "absolute", inset: 0, filter: "blur(7px)", opacity: 0.5, pointerEvents: "none", display: "flex", gap: 16, padding: 24, background: "var(--bg, #f4f5f6)" }}>
        {["בריף חדש", "בעבודה", "לבדיקה", "הושלם"].map((_, ci) => (
          <div key={ci} style={{ flex: 1, background: "var(--surface, #fff)", borderRadius: 14, padding: 12 }}>
            <div style={{ height: 12, width: "55%", background: "#e6e8ea", borderRadius: 6, marginBottom: 14 }} />
            {Array.from({ length: 3 - (ci % 2) }).map((__, i) => <div key={i} style={{ height: 54, background: "#eef0f1", borderRadius: 10, marginBottom: 10 }} />)}
          </div>
        ))}
      </div>

      {/* centered floating entry card */}
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 16 }}>
        <div style={{ background: "var(--surface, #fff)", borderRadius: 20, padding: "30px 28px", width: "min(92vw, 400px)", textAlign: "center", boxShadow: "0 30px 70px rgba(0,0,0,.3)" }}>
          <div style={{ fontWeight: 800, fontSize: 22, letterSpacing: "-.5px", marginBottom: 16 }}>buno</div>
          {!loaded ? <div style={{ color: "var(--muted)", fontWeight: 600 }}>טוען…</div>
            : sum ? <>
              <p style={{ fontSize: 16.5, lineHeight: 1.6, margin: "0 0 6px" }}><b>{sum.inviter}</b> הזמין אותך ללוח</p>
              <p style={{ fontSize: 20, fontWeight: 800, margin: "0 0 4px" }}>{sum.projectName}</p>
              <p style={{ fontSize: 13.5, color: "var(--muted)", margin: "0 0 22px" }}>בתור {ROLE_HE[sum.role] || sum.role}</p>
              <button className="adk-btn primary" style={{ width: "100%", justifyContent: "center", fontSize: 15, padding: "12px" }} onClick={() => signInWithGoogle()}>המשך עם Google</button>
              <p style={{ fontSize: 11.5, color: "var(--faint)", margin: "16px 0 0" }}>התחבר עם המייל שאליו נשלחה ההזמנה כדי להצטרף.</p>
            </> : <>
              <p style={{ fontSize: 15, color: "var(--muted)", margin: "0 0 20px" }}>ההזמנה אינה תקפה או שפג תוקפה.</p>
              <button className="adk-btn primary" style={{ width: "100%", justifyContent: "center" }} onClick={() => { location.search = ""; }}>לכניסה הרגילה</button>
            </>}
        </div>
      </div>
    </div>
  );
}
