import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { LoginScreen } from "./auth/LoginScreen";
import "./styles/index.css";

// Gate: local mode (no env) → straight to the app, Stage-A behavior.
// Configured → session required; the quiet loader avoids a login flash.
function Root() {
  const { loading, session, localMode } = useAuth();
  if (new URLSearchParams(location.search).has("login-preview")) return <LoginScreen />;
  if (localMode) return <App />;
  if (loading) return <div className="adk-login-load" />;
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
