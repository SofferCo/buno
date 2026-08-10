// UI language (i18n). Strings live in src/locales/<lang>.json, same keys in each.
// Adding a language later = a new JSON + a line in LANGS. Zero UI changes.
//
// buno's OWN wording is never touched here — he writes in the language the user writes
// in, regardless of UI language. This only governs the app chrome.
//
// Safe to migrate incrementally: t() falls back Hebrew → provided fallback → key, so an
// untranslated string simply stays Hebrew (the default). Nothing ever breaks half-done.
import { createContext, useContext } from "react";
import he from "../locales/he.json";
import en from "../locales/en.json";

export const LANGS = [
  { code: "he", name: "עברית", dir: "rtl" as const },
  { code: "en", name: "English", dir: "ltr" as const },
];
const DICTS: Record<string, Record<string, string>> = { he, en };
export const dirFor = (lang: string) => LANGS.find((l) => l.code === lang)?.dir || "rtl";

type T = (key: string, fallback?: string) => string;
// Build a translator for a known language without a provider — used by App-level
// chrome (the rail/floats live ABOVE their own I18nProvider, so useT there would
// only ever see the Hebrew default). Same fallback chain as the provider's t.
export const makeT = (lang: string): T => {
  const dict = DICTS[lang] || he;
  return (key, fallback) => dict[key] ?? (he as Record<string, string>)[key] ?? fallback ?? key;
};
// default (no provider) still resolves to Hebrew, so a component used outside the provider
// shows real text, never a raw key.
const Ctx = createContext<{ lang: string; dir: "rtl" | "ltr"; t: T }>({ lang: "he", dir: "rtl", t: (k, f) => (he as Record<string, string>)[k] ?? f ?? k });
export const useT = () => useContext(Ctx);

export function I18nProvider({ lang, children }: { lang: string; children: any }) {
  const dict = DICTS[lang] || he;
  const t: T = (key, fallback) => dict[key] ?? (he as Record<string, string>)[key] ?? fallback ?? key;
  return <Ctx.Provider value={{ lang, dir: dirFor(lang), t }}>{children}</Ctx.Provider>;
}
