// buno — login screen, in the frame language: gray canvas, white shell flush
// to the left+bottom, only the top-right corner rounded. Google OAuth +
// email magic-link. Hebrew RTL, masculine, no English in UI copy.
import { useState } from "react";
import { useAuth } from "./AuthProvider";

export function LoginScreen() {
  const { signInWithGoogle, signInWithEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendLink() {
    const e = email.trim();
    if (!e || busy) return;
    setBusy(true); setErr(null);
    const { error } = await signInWithEmail(e);
    setBusy(false);
    if (error) setErr("שליחת הקישור נכשלה. בדוק את הכתובת ונסה שוב.");
    else setSent(true);
  }

  return (
    <div className="adk">
      <div className="adk-shell adk-login-shell">
        <div className="adk-login">
          <div className="adk-login-mark">buno</div>
          <div className="adk-login-sub">הלוח שלך, הלקוחות שלך, והעוזר שעובד בשבילך.</div>

          <button className="adk-login-google" onClick={signInWithGoogle}>
            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.2 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.2 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 42.6 44 37 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>
            המשך עם Google
          </button>

          <div className="adk-login-or"><span>או</span></div>

          {sent ? (
            <div className="adk-login-sent">
              ✓ שלחנו קישור התחברות אל <b>{email.trim()}</b>. פתח את המייל ולחץ על הקישור.
            </div>
          ) : (
            <>
              <div className="adk-login-mail">
                <input
                  type="email" dir="ltr" value={email} placeholder="name@email.com"
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") sendLink(); }}
                />
                <button className="adk-btn primary" disabled={busy} onClick={sendLink}>
                  {busy ? "שולח…" : "שלח קישור"}
                </button>
              </div>
              <div className="adk-login-hint">בלי סיסמה — קישור חד־פעמי למייל.</div>
              {err && <div className="adk-login-err">{err}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
