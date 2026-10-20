import i18n, { type InitOptions, type TOptions } from "i18next";
import { initReactI18next, useTranslation as useReactI18nextTranslation } from "react-i18next";

import { DEFAULT_LOCALE, i18nextResources, supportedLocales } from "./locales";

/** A local, per-browser preference. Never store language on the server. */
export const UI_LANGUAGE_STORAGE_KEY = "paperclip.ui.language";
const DEFAULT_DESKTOP_LOCALE = "ar";

function preferredLocale(): string {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const stored = window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
    if (stored && supportedLocales.includes(stored)) return stored;
  } catch {
    // Privacy settings can disable localStorage. Continue in Arabic.
  }
  return DEFAULT_DESKTOP_LOCALE;
}

export function applyDocumentLanguage(locale: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  document.documentElement.dir = /^(ar|fa|he|ur)(?:-|$)/i.test(locale) ? "rtl" : "ltr";
  document.title = locale.startsWith("ar") ? "شركتي — Paperclip" : "Paperclip";
}

const initialLocale = preferredLocale();
applyDocumentLanguage(initialLocale);

const i18nextOptions: InitOptions = {
  resources: i18nextResources,
  lng: initialLocale,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: supportedLocales,
  defaultNS: "translation",
  interpolation: { escapeValue: false },
  returnObjects: false,
  initAsync: false,
};

void i18n.use(initReactI18next).init(i18nextOptions).catch((error: unknown) => {
  console.error("Failed to initialize i18next", error);
});

i18n.on("languageChanged", (language) => {
  applyDocumentLanguage(language);
  try { window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, language); } catch { /* private mode */ }
});

export function t(key: string, options: TOptions = {}) {
  return i18n.t(key, options);
}

export const useTranslation = useReactI18nextTranslation;
export { i18n };
