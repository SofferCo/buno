// buno — the contextual entry for an invite link. ALL paths pass through here
// (logged out, logged in as the invitee, logged in as someone else), so the
// experience is one consistent surface. Behind the floating card sits the REAL
// board outline (column + card titles + counts, no inner content) slightly
// blurred; signing in / joining lifts the blur in a gentle transition.
import { useState, useEffect } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { supabase } from "../../lib/supabase";
import { publicInviteContext, acceptInvite, type InviteContext } from "../../data/invites";

const ROLE_HE: Record<string, string> = { owner: "בעלים", member: "חבר צוות", viewer: "צופה" };

// A real-but-safe board outline, blurred — conveys "this is the board" without
// leaking content. Falls back to a neutral skeleton when the outline is absent.
function Backdrop({ ctx, lifting }: { ctx: InviteContext | null; lifting: boolean }) {
  const cols = ctx?.outline?.length ? ctx.outline : null;
  const color = ctx?.color || "#0E8F8C";
  return (
    <div aria-hidden style={{
      position: "absolute", inset: 0, pointerEvents: "none", display: "flex", gap: 16, padding: 24,
      background: "var(--bg, #f4f5f6)", filter: lifting ? "blur(0px)" : "blur(6px)",
      opacity: lifting ? 0.9 : 0.55, transition: "filter .6s ease, opacity .6s ease",
    }}>
      {(cols || [{ name: "בריף חדש" }, { name: "בעבודה" }, { name: "לבדיקה" }, { name: "הושלם" }] as any).map((col: any, ci: number) => (
        <div key={ci} style={{ flex: 1, background: "var(--surface, #fff)", borderRadius: 14, padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: color, display: "inline-block" }} />
            <div style={{ fontWeight: 800, fontSize: 13 }}>{col.name}{typeof col.count === "number" ? ` · ${col.count}` : ""}</div>
          </div>
          {cols
            ? (col.titles || []).slice(0, 4).map((t: string, i: number) => (
                <div key={i} style={{ background: "var(--surface-2, #eef0f1)", borderRadius: 10, padding: "10px 12px", marginBottom: 10, fontSize: 12.5, fontWeight: 600, color: "#1A1A1A", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t}</div>
              ))
            : Array.from({ length: 3 - (ci % 2) }).map((_, i) => <div key={i} style={{ height: 54, background: "#eef0f1", borderRadius: 10, marginBottom: 10 }} />)}
        </div>
      ))}
    </div>
  );
}

export function InvitedEntry({ token }: { token: string }) {
  const { signInWithGoogle, signOut, session, identity } = useAuth();
  const [ctx, setCtx] = useState<InviteContext | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [joining, setJoining] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (supabase) publicInviteContext(supabase, token).then((c) => { setCtx(c); setLoaded(true); });
    else setLoaded(true);
  }, [token]);

  const myEmail = (identity?.email || "").toLowerCase();
  const invitedEmail = (ctx?.email || "").toLowerCase();
  const emailMatches = !!myEmail && !!invitedEmail && myEmail === invitedEmail;

  // logged in as the invitee → accept here, lift the blur, then land in the app
  // with a ?welcome flag so buno greets in-context.
  async function join() {
    if (!supabase || joining) return;
    setErr(null); setJoining(true);
    try {
      const projectId = await acceptInvite(supabase, token);
      setTimeout(() => { window.location.assign(`/?welcome=${projectId}`); }, 650); // let the blur-lift play
    } catch (e: any) {
      setJoining(false);
      setErr(String(e?.message || "").includes("different email") ? "ההזמנה נשלחה לכתובת אחרת." : "ההצטרפות נכשלה, נסה שוב.");
    }
  }

  const card = (children: React.ReactNode) => (
    <div className="adk" style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
      <Backdrop ctx={ctx} lifting={joining} />
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 16, transition: "opacity .5s ease", opacity: joining ? 0 : 1 }}>
        <div style={{ background: "var(--surface, #fff)", borderRadius: 20, padding: "30px 28px", width: "min(92vw, 400px)", textAlign: "center", boxShadow: "0 30px 70px rgba(0,0,0,.3)" }}>
          <div style={{ fontWeight: 800, fontSize: 22, letterSpacing: "-.5px", marginBottom: 16 }}>buno</div>
          {children}
        </div>
      </div>
    </div>
  );

  if (!loaded) return card(<div style={{ color: "var(--muted)", fontWeight: 600 }}>טוען…</div>);

  if (!ctx) return card(<>
    <p style={{ fontSize: 15, color: "var(--muted)", margin: "0 0 20px" }}>ההזמנה אינה תקפה או שפג תוקפה.</p>
    <button className="adk-btn primary" style={{ width: "100%", justifyContent: "center" }} onClick={() => { location.href = "/"; }}>לכניסה הרגילה</button>
  </>);

  const header = (<>
    <p style={{ fontSize: 16.5, lineHeight: 1.6, margin: "0 0 6px" }}><b>{ctx.inviter}</b> הזמין אותך ללוח</p>
    <p style={{ fontSize: 20, fontWeight: 800, margin: "0 0 4px" }}>{ctx.projectName}</p>
    <p style={{ fontSize: 13.5, color: "var(--muted)", margin: "0 0 22px" }}>בתור {ROLE_HE[ctx.role] || ctx.role}</p>
  </>);

  // (1) logged out → Google
  if (!session) return card(<>
    {header}
    <button className="adk-btn primary" style={{ width: "100%", justifyContent: "center", fontSize: 15, padding: "12px" }} onClick={() => signInWithGoogle()}>המשך עם Google</button>
    <p style={{ fontSize: 11.5, color: "var(--faint)", margin: "16px 0 0" }}>התחבר עם המייל שאליו נשלחה ההזמנה כדי להצטרף.</p>
  </>);

  // (2) logged in as the invited email → one-tap join (no Google step)
  if (emailMatches) return card(<>
    {header}
    {err && <div style={{ fontSize: 12.5, color: "var(--rec)", margin: "0 0 12px" }}>{err}</div>}
    <button className="adk-btn primary" style={{ width: "100%", justifyContent: "center", fontSize: 15, padding: "12px" }} disabled={joining} onClick={join}>
      {joining ? "מצטרף…" : `הצטרף כ־${identity?.email}`}
    </button>
  </>);

  // (3) logged in as someone else → explain + switch account (no dead-end button)
  return card(<>
    {header}
    <div style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--muted)", background: "var(--surface-2, #f4f5f6)", borderRadius: 12, padding: "12px 14px", margin: "0 0 18px", textAlign: "start" }}>
      ההזמנה נשלחה אל <b style={{ color: "var(--ink)" }}>{ctx.email}</b>, ואתה מחובר כ־<b style={{ color: "var(--ink)" }}>{identity?.email}</b>.
    </div>
    <button className="adk-btn primary" style={{ width: "100%", justifyContent: "center", fontSize: 14.5, padding: "12px" }} onClick={() => signOut()}>התנתק והתחבר עם החשבון הנכון</button>
    <p style={{ fontSize: 11.5, color: "var(--faint)", margin: "14px 0 0" }}>הקישור יישמר — אחזיר אותך לכאן אחרי ההתחברות.</p>
  </>);
}
