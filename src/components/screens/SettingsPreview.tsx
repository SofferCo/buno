// DEV-ONLY harness (?settings=1, add &lang=en / &theme=dark) — the settings panel, no auth.
import { useState } from "react";
import { SettingsPanel } from "./SettingsPanel";
import { I18nProvider } from "../../lib/i18n";

export function SettingsPreview() {
  const lang = new URLSearchParams(location.search).get("lang") || "he";
  const [profile, setProfile] = useState<any>({ name: "טל סופר", photo: null, settings: { timeRound: "ceil_hour", dailyCapacity: 6, lang }, assistant: { cards: "draft", calendar: "suggest", outbound: "suggest" } });
  return (
    <I18nProvider lang={profile.settings.lang || "he"}>
    <div className="adk" style={{ minHeight: "100vh" }}>
    <SettingsPanel
      profile={profile} account="talsoff@gmail.com" cloud={false}
      onClose={() => { location.search = ""; }}
      onSetName={(name: string) => setProfile((p: any) => ({ ...p, name }))}
      onSetPhoto={() => {}}
      onSetAssistant={(k: string, v: string) => setProfile((p: any) => ({ ...p, assistant: { ...p.assistant, [k]: v } }))}
      onSetPref={(k: string, v: any) => setProfile((p: any) => ({ ...p, settings: { ...p.settings, [k]: v } }))}
      onSignOut={() => {}} onScanned={() => {}}
    />
    </div>
    </I18nProvider>
  );
}
