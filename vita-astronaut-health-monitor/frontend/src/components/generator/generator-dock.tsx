"use client";

import clsx from "clsx";
import { Activity } from "lucide-react";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/locale";
import { formatClock, openGenerator, useGenerator, useGeneratorOpen } from "./use-generator";

const SEEN_KEY = "errno:gen:seen";

/** The floating button that is always on screen. One tap opens the generator. */
export function GeneratorDock() {
  const t = useT();
  const open = useGeneratorOpen();
  const gen = useGenerator();
  const { user } = useAuth();
  const live = gen.phase === "running" || gen.phase === "replaying";

  // Show the generator once, right after the first sign-in in this browser, so it is found.
  useEffect(() => {
    if (!user) return;
    let seen = true;
    try {
      seen = localStorage.getItem(SEEN_KEY) === "1";
      if (!seen) localStorage.setItem(SEEN_KEY, "1");
    } catch {
      seen = true;
    }
    if (seen) return;
    const timer = setTimeout(openGenerator, 700);
    return () => clearTimeout(timer);
  }, [user]);

  if (open) return null;

  return (
    <button
      type="button"
      onClick={openGenerator}
      aria-label={t("gen.dock.open")}
      title={t("gen.dock.open")}
      className={clsx(
        "fixed right-4 z-40 flex h-11 items-center gap-2 rounded-full border bg-panel pr-4 pl-3 text-[13px] font-medium shadow-[var(--shadow-pop)] transition-[transform,border-color] duration-150",
        "bottom-[76px] lg:bottom-4 hover:border-accent/60 active:scale-95 focus-visible:ring-[3px] focus-visible:ring-accent/25 focus-visible:outline-none",
        live ? "border-accent/60 text-ink" : "border-line text-ink",
      )}
    >
      <span className={clsx("relative grid size-6 place-items-center rounded-full bg-accent/10 text-accent", live && "animate-pulse-soft")}>
        <Activity className="size-3.5" aria-hidden />
      </span>
      <span className="hidden sm:inline">{t("gen.dock")}</span>
      {gen.phase !== "idle" ? (
        <span className="tnum font-mono text-[12px] text-muted">{formatClock(gen.elapsedMs)}</span>
      ) : null}
    </button>
  );
}
