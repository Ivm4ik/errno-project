import type { Locale } from "./translations";

const STORAGE_KEY = "errno:locale";
const listeners = new Set<() => void>();

let currentLocale: Locale = "uk";

function notify() {
  listeners.forEach((fn) => fn());
}

export function getLocale(): Locale {
  return currentLocale;
}

export function readStoredLocale(): Locale {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "en" || value === "uk" ? value : "uk";
  } catch {
    return "uk";
  }
}

export function setLocale(locale: Locale) {
  currentLocale = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // session-only if storage blocked
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale === "uk" ? "uk" : "en";
  }
  notify();
}

export function subscribeLocale(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Hydrate module mirror from storage on first client touch. */
export function hydrateLocaleFromStorage() {
  if (typeof window === "undefined") return;
  currentLocale = readStoredLocale();
}
