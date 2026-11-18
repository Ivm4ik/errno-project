"use client";

import clsx from "clsx";
import { Menu, Radio } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { IconButton } from "@/components/ui/primitives";
import { usePublicConfig } from "@/lib/api/errno";
import { useAuth } from "@/lib/auth";
import { useLocale } from "@/lib/locale";
import { useLiveLink } from "@/lib/live";
import type { Locale } from "@/lib/translations";
import { SettingsMenu } from "./settings-menu";
import { Wordmark } from "./wordmark";

const ROLE_KEY = {
  astronaut: "role.astronaut",
  officer: "role.officer",
  doctor: "role.doctor",
  chief: "role.chief",
} as const;

export function TopBar({ onOpenNav }: { onOpenNav: () => void }) {
  const { user } = useAuth();
  const config = usePublicConfig();
  const online = useLiveLink(Boolean(user));
  const met = useMet();
  const delay = config.data?.signal_delay_label ?? "20:00";
  const { locale, setLocale, t } = useLocale();
  return (
    <div className="sticky top-0 z-20">
      <header className="glass-blur flex h-14 items-center gap-3 border-b border-line px-4 sm:px-6 lg:px-8">
        <IconButton onClick={onOpenNav} aria-label={t("common.openMenu")} className="-ml-1.5 lg:hidden">
          <Menu />
        </IconButton>
        <Link href="/" className="lg:hidden" aria-label="ERRNO">
          <Wordmark />
        </Link>
        <div className="hidden min-w-0 lg:block">
          <p className="truncate text-[13px] font-semibold tracking-wide text-ink">{config.data?.mission ?? t("top.missionFallback")}</p>
          <p className="font-mono text-[10px] tracking-wider text-faint uppercase">{t("top.missionControl")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <LanguageToggle locale={locale} setLocale={setLocale} ariaLabel={t("lang.switch")} />
          <span className="hidden rounded-md border border-line bg-panel-raised/80 px-2 py-1 font-mono text-[11px] text-muted sm:inline-flex">MET {met}</span>
          <span className="hidden items-center gap-1 rounded-md border border-accent/25 bg-accent/10 px-2 py-1 font-mono text-[11px] text-accent sm:inline-flex">
            <Radio className="size-3" /> T+{delay}
          </span>
          <span className="hidden text-xs text-muted md:inline">{user ? t(ROLE_KEY[user.role]) : ""}</span>
          <span className="inline-flex items-center gap-1.5 text-xs">
            <span className={online ? "size-2 rounded-full bg-nominal shadow-[0_0_8px_var(--color-nominal)]" : "size-2 rounded-full bg-critical"} />
            <span className="hidden sm:inline">{online ? "UPLINK" : "NO LINK"}</span>
          </span>
          <SettingsMenu />
        </div>
      </header>
    </div>
  );
}

function LanguageToggle({
  locale,
  setLocale,
  ariaLabel,
}: {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex rounded-md border border-line bg-panel-raised/80 p-0.5 font-mono text-[11px]"
    >
      {(["uk", "en"] as const).map((code) => (
        <button
          key={code}
          type="button"
          aria-pressed={locale === code}
          onClick={() => setLocale(code)}
          className={clsx(
            "rounded px-1.5 py-0.5 font-medium transition-colors",
            locale === code ? "bg-accent/15 text-accent" : "text-muted hover:text-ink",
          )}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function useMet() {
  const [text, setText] = useState("00:00:00");
  useEffect(() => {
    const key = "errno:met-start";
    const stored = sessionStorage.getItem(key);
    const start = stored ? Number(stored) : Date.now();
    if (!stored) sessionStorage.setItem(key, String(start));
    const tick = () => {
      const seconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
      const hh = String(Math.floor(seconds / 3600)).padStart(2, "0");
      const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
      const ss = String(seconds % 60).padStart(2, "0");
      setText(`${hh}:${mm}:${ss}`);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return text;
}
