import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { LoginScreen } from "./auth/LoginScreen";
import { Onboarding } from "./components/screens/Onboarding";
import { InvitedEntry } from "./components/screens/InvitedEntry";
import "./styles/index.css";

// Gate: local mode (no env) → straight to the app, Stage-A behavior.
// Configured → session required; the quiet loader avoids a login flash.
function Root() {
  const { loading, session, localMode } = useAuth();
  if (new URLSearchParams(location.search).has("login-preview")) return <LoginScreen />;
  // DESIGN PREVIEW: first-run onboarding prototype, no auth needed (?onboarding=1)
  if (new URLSearchParams(location.search).get("onboarding") === "1") return <Onboarding onDone={() => { location.search = ""; }} />;
  if (localMode) return <App />;
  if (loading) return <div className="adk-login-load" />;
  // logged-out invitee → contextual entry (board behind + "X invited you to ‹board›"),
  // not the generic login page.
  const inviteTok = new URLSearchParams(location.search).get("invite");
  if (!session && inviteTok) return <InvitedEntry token={inviteTok} />;
  if (!session) return <LoginScreen />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <Root />
    </AuthProvider>
  </React.StrictMode>
);
