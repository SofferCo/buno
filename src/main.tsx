import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { LoginScreen } from "./auth/LoginScreen";
import { Onboarding } from "./components/screens/Onboarding";
import { InvitedEntry } from "./components/screens/InvitedEntry";
import { MyDayPreview } from "./components/screens/MyDayPreview";
import { MeetCardPreview } from "./components/card/MeetCardPreview";
import { DashPreview } from "./components/screens/DashPreview";
import { ReportPreview } from "./components/screens/ReportPreview";
import { SettingsPreview } from "./components/screens/SettingsPreview";
import "./styles/index.css";

// Gate: local mode (no env) → straight to the app, Stage-A behavior.
// Configured → session required; the quiet loader avoids a login flash.
function Root() {
  const { loading, session, localMode } = useAuth();
  if (new URLSearchParams(location.search).has("login-preview")) return <LoginScreen />;
  // DESIGN PREVIEW: first-run onboarding prototype, no auth needed (?onboarding=1)
  if (new URLSearchParams(location.search).get("onboarding") === "1") return <Onboarding onDone={() => { location.search = ""; }} />;
  // DESIGN PREVIEW: the "My Day" timeline with mock data, no auth (?myday=1)
  if (new URLSearchParams(location.search).get("myday") === "1") return <MyDayPreview />;
  // DESIGN PREVIEW: a calendar event opened as a task card, no auth (?meet=1)
  if (new URLSearchParams(location.search).get("meet") === "1") return <MeetCardPreview />;
  // DESIGN PREVIEW: the personal dashboard with mock data, no auth (?dash=1)
  if (new URLSearchParams(location.search).get("dash") === "1") return <DashPreview />;
  // DESIGN PREVIEW: a client report with mock data, no auth (?report=1)
  if (new URLSearchParams(location.search).get("report") === "1") return <ReportPreview />;
  // DESIGN PREVIEW: the settings panel with mock data, no auth (?settings=1)
  if (new URLSearchParams(location.search).get("settings") === "1") return <SettingsPreview />;
  if (localMode) return <App />;
  if (loading) return <div className="adk-login-load" />;
  // ANY invite link → the one contextual entry, whether logged out or in. It
  // adapts (Google / one-tap join / switch-account) and hands off to the app via
  // ?welcome after joining — so every path is consistent, never the bare login.
  const inviteTok = new URLSearchParams(location.search).get("invite");
  if (inviteTok) return <InvitedEntry token={inviteTok} />;
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
