// DEV-ONLY harness (?settings=1) — the settings panel with mock data, no auth.
import { useState } from "react";
import { SettingsPanel } from "./SettingsPanel";

export function SettingsPreview() {
  const [profile, setProfile] = useState<any>({ name: "טל סופר", photo: null, settings: { timeRound: "ceil_hour", dailyCapacity: 6 }, assistant: { cards: "draft", calendar: "suggest", outbound: "suggest" } });
  return (
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
  );
}
