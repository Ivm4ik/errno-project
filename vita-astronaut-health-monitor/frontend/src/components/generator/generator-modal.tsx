"use client";

import clsx from "clsx";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, Pause, Play, RotateCcw, Send, Square, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Button, Checkbox, IconButton, Segmented } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth";
import { CREW, TIME_SCALES } from "@/lib/generator/catalog";
import { generator } from "@/lib/generator/engine";
import { useT } from "@/lib/locale";
import { RecordingsTab } from "./recordings-tab";
import { ScenariosTab } from "./scenarios-tab";
import { SensorsTab } from "./sensors-tab";
import { closeGenerator, formatClock, useGenerator, useGeneratorOpen } from "./use-generator";

type Tab = "scenarios" | "sensors" | "recordings";

/**
 * The generator window. A native <dialog>: focus trap, Esc and top layer come for free.
 * It only renders the engine's state, so closing it never stops a run.
 */
export function GeneratorModal() {
  const open = useGeneratorOpen();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const t = useT();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={closeGenerator}
      onClick={(event) => event.target === ref.current && closeGenerator()}
      aria-labelledby={titleId}
      className="surface-pop m-auto h-[min(48rem,calc(100dvh-1.5rem))] w-[min(62rem,calc(100vw-1.5rem))] max-w-none overflow-hidden rounded-2xl p-0 text-ink open:animate-pop-in"
    >
      {open ? <Panel titleId={titleId} title={t("gen.title")} /> : null}
    </dialog>
  );
}

function Panel({ titleId, title }: { titleId: string; title: string }) {
  const t = useT();
  const gen = useGenerator();
  const [tab, setTab] = useState<Tab>("scenarios");
  const live = gen.phase !== "idle";
  const progress = Math.min(1, gen.elapsedMs / gen.maxMs);

  useEffect(() => {
    if (gen.endedBy) {
      const timer = setTimeout(() => generator.clearEnded(), 12000);
      return () => clearTimeout(timer);
    }
  }, [gen.endedBy]);

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-line bg-panel-raised/60 px-5 pt-4 pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
              <Activity className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 id={titleId} className="text-[16px] font-semibold tracking-tight">
                {title}
              </h2>
              <p className="truncate text-[12.5px] text-muted">{t("gen.subtitle")}</p>
            </div>
          </div>
          <IconButton onClick={closeGenerator} aria-label={t("gen.close")} className="-mt-1 -mr-1">
            <X />
          </IconButton>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="min-w-44 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-[12px] font-medium">
                <StatusDot phase={gen.phase} />
                {t(`gen.status.${gen.phase}`)}
              </span>
              <span className="tnum font-mono text-[15px] font-semibold">
                {formatClock(gen.elapsedMs)}
                <span className="text-[12px] font-normal text-faint"> / {formatClock(gen.maxMs)}</span>
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
              <div className="h-full origin-left rounded-full bg-accent transition-transform duration-500 ease-linear" style={{ transform: `scaleX(${progress})`, width: "100%" }} />
            </div>
            <p className="mt-1 text-[11.5px] text-faint">{t("gen.limit")}</p>
          </div>

          <div className="space-y-1">
            <p className="text-[11.5px] font-medium text-muted">{t("gen.target.title")}</p>
            <Segmented
              size="sm"
              label={t("gen.target.title")}
              value={gen.targets.length > 1 ? "both" : (gen.targets[0] ?? "both")}
              onChange={(value) => generator.setTargets(value === "both" ? CREW.map((member) => member.id) : [value])}
              options={[
                ...CREW.map((member) => ({ value: member.id, label: t(member.nameKey) })),
                { value: "both", label: t("gen.target.both") },
              ]}
            />
          </div>

          <div className="space-y-1">
            <p className="text-[11.5px] font-medium text-muted">{t("gen.timeScale")}</p>
            <div className={clsx(live && "pointer-events-none opacity-50")} aria-disabled={live} title={live ? t("gen.timeScale.locked") : undefined}>
              <Segmented
                size="sm"
                label={t("gen.timeScale")}
                value={gen.timeScale}
                onChange={(value) => generator.setTimeScale(value)}
                options={TIME_SCALES.map((value) => ({ value: value as number, label: t("gen.timeScale.value", { n: value }) }))}
              />
            </div>
          </div>
        </div>
      </header>

      <div className="shrink-0 border-b border-line px-5 py-2.5">
        <Segmented
          label={title}
          value={tab}
          onChange={setTab}
          options={[
            { value: "scenarios", label: t("gen.tab.scenarios") },
            { value: "sensors", label: t("gen.tab.sensors") },
            { value: "recordings", label: t("gen.tab.recordings"), count: gen.recordings.length || undefined },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {tab === "scenarios" ? <ScenariosTab /> : tab === "sensors" ? <SensorsTab /> : <RecordingsTab />}
      </div>

      <Footer />
    </div>
  );
}

function StatusDot({ phase }: { phase: string }) {
  return (
    <span
      aria-hidden
      className={clsx(
        "size-2 rounded-full",
        phase === "running" || phase === "replaying" ? "animate-blink bg-nominal" : phase === "paused" ? "bg-caution" : "bg-faint",
      )}
    />
  );
}

function Footer() {
  const t = useT();
  const gen = useGenerator();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { logout } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState(false);

  const running = gen.phase === "running";
  const paused = gen.phase === "paused";
  const replaying = gen.phase === "replaying";
  const blocked = gen.phase === "idle" && gen.busyElsewhere;
  const message = blocked
    ? { tone: "warn", text: t("gen.busy") }
    : gen.endedBy
      ? { tone: gen.endedBy === "error" ? "bad" : "info", text: t(`gen.ended.${gen.endedBy}`) }
      : gen.link === "lost"
        ? { tone: "warn", text: t("gen.link.lost") }
        : gen.link === "flushing"
          ? { tone: "info", text: t("gen.link.flushing") }
          : gen.link === "error"
            ? { tone: "bad", text: t("gen.error.server") }
            : null;

  const reset = async () => {
    setResetting(true);
    setResetError(false);
    try {
      generator.stop();
      await api.delete("/workspace");
      generator.forgetCursor();
      logout();
      queryClient.clear();
      setConfirm(false);
      closeGenerator();
      router.replace("/login");
    } catch {
      setResetError(true);
    } finally {
      setResetting(false);
    }
  };

  return (
    <footer className="shrink-0 border-t border-line bg-panel-raised/60 px-5 py-3">
      {message ? (
        <p
          role="status"
          className={clsx(
            "mb-2.5 rounded-lg px-3 py-1.5 text-[12.5px]",
            message.tone === "bad" ? "bg-critical/10 text-critical" : message.tone === "warn" ? "bg-caution/10 text-caution" : "bg-accent/10 text-accent",
          )}
        >
          {message.text}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <Button variant="secondary" onClick={() => generator.pause()}>
            <Pause className="size-4" aria-hidden />
            {t("gen.pause")}
          </Button>
        ) : paused ? (
          <Button onClick={() => generator.resume()}>
            <Play className="size-4" aria-hidden />
            {t("gen.resume")}
          </Button>
        ) : (
          <Button disabled={replaying || blocked} onClick={() => generator.start()}>
            <Play className="size-4" aria-hidden />
            {t("gen.start")}
          </Button>
        )}
        <Button variant="secondary" disabled={gen.phase === "idle"} onClick={() => generator.stop()}>
          <Square className="size-4" aria-hidden />
          {t("gen.stop")}
        </Button>
        <Button variant="secondary" disabled={replaying || paused || blocked} onClick={() => generator.pulse()} title={t("gen.pulse.hint")}>
          <Send className="size-4" aria-hidden />
          {t("gen.pulse")}
        </Button>

        <label className="ml-1 inline-flex items-center gap-2 text-[12.5px] text-muted" title={t("gen.faults.hint")}>
          <Checkbox checked={gen.faults} onChange={(on) => generator.setFaults(on)} label={t("gen.faults")} />
          {t("gen.faults")}
        </label>

        <div className="ml-auto flex items-center gap-3">
          {gen.phase !== "idle" || gen.sent > 0 ? (
            <span className="hidden font-mono text-[11px] text-faint md:inline">
              {t("gen.stats", { sent: gen.sent })}
              {gen.failed > 0 ? ` · ${t("gen.stats.failed", { failed: gen.failed })}${gen.lastError ? ` (${gen.lastError})` : ""}` : ""}
              {gen.buffered > 0 ? ` · ${t("gen.stats.buffered", { n: gen.buffered })}` : ""}
            </span>
          ) : null}
          <Button variant="danger" size="sm" onClick={() => setConfirm(true)}>
            <RotateCcw className="size-3.5" aria-hidden />
            {t("gen.reset")}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirm}
        title={t("gen.reset.title")}
        message={
          <>
            <p>{t("gen.reset.body")}</p>
            {resetError ? <p className="mt-2 text-critical">{t("gen.reset.failed")}</p> : null}
          </>
        }
        confirmLabel={t("gen.reset.confirm")}
        loading={resetting}
        onConfirm={() => void reset()}
        onCancel={() => setConfirm(false)}
      />
    </footer>
  );
}
