"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { getLocale, hydrateLocaleFromStorage, readStoredLocale, setLocale, subscribeLocale } from "./locale-store";
import { hasTranslation, translate, type Locale, type TranslationKey } from "./translations";

export type TFunction = (key: TranslationKey | string, vars?: Record<string, string | number>) => string;

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TFunction;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribeLocale, readStoredLocale, () => "uk" as Locale);

  useEffect(() => {
    hydrateLocaleFromStorage();
    setLocale(readStoredLocale());
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "uk" ? "uk" : "en";
  }, [locale]);

  const t = useCallback<TFunction>(
    (key, vars) => translate(locale, key, vars),
    [locale],
  );

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t,
    }),
    [locale, t],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale requires LocaleProvider");
  return ctx;
}

export function useT() {
  return useLocale().t;
}

export { getLocale, setLocale };

/** Translate a sensor id when a dictionary entry exists; otherwise keep API fallback. */
export function metricLabel(id: string, fallback: string, t: TFunction = (key) => translate(getLocale(), key)) {
  const key = `sensor.${id}`;
  return hasTranslation(key) ? t(key) : fallback;
}
