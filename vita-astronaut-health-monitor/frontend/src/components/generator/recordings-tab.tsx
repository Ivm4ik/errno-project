"use client";

import { Download, FileUp, Play, Square, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button, Segmented } from "@/components/ui/primitives";
import { generator } from "@/lib/generator/engine";
import type { RecordingMeta } from "@/lib/generator/recordings";
import { useLocale, useT } from "@/lib/locale";
import { formatClock, useGenerator } from "./use-generator";

const SPEEDS = [1, 2, 4] as const;

export function RecordingsTab() {
  const t = useT();
  const { locale } = useLocale();
  const gen = useGenerator();
  const fileRef = useRef<HTMLInputElement>(null);
  const [speed, setSpeed] = useState<number>(1);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const blocked = gen.phase === "running" || gen.phase === "paused" || (gen.phase === "idle" && gen.busyElsewhere);

  const download = (meta: RecordingMeta) => {
    const text = generator.exportRecording(meta.id);
    if (!text) return;
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `errno-run-${new Date(meta.createdAt).toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const ok = file.size < 4_000_000 && generator.importRecording(await file.text());
    setNote({ ok, text: ok ? t("gen.rec.import.done") : t("gen.rec.import.failed") });
  };

  const dateOf = (ms: number) =>
    new Date(ms).toLocaleString(locale === "uk" ? "uk-UA" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-[13px] text-muted">{t("gen.rec.intro")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            size="sm"
            label={t("gen.rec.speed")}
            value={speed}
            onChange={(value) => {
              setSpeed(value);
              generator.setReplaySpeed(value);
            }}
            options={SPEEDS.map((value) => ({ value, label: `${value}×` }))}
          />
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              void onFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
            <FileUp className="size-3.5" aria-hidden />
            {t("gen.rec.import")}
          </Button>
        </div>
      </div>

      {note ? (
        <p role="status" className={note.ok ? "text-[12.5px] text-nominal" : "text-[12.5px] text-critical"}>
          {note.text}
        </p>
      ) : null}

      {gen.recordings.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">{t("gen.rec.empty")}</p>
      ) : (
        <ul className="space-y-3">
          {gen.recordings.map((meta) => {
            const playing = gen.replay?.id === meta.id;
            return (
              <li key={meta.id} className="relative overflow-hidden rounded-xl border border-line bg-panel p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-[13.5px] font-semibold">{meta.name || t("gen.rec.untitled", { date: dateOf(meta.createdAt) })}</h3>
                    <p className="mt-0.5 font-mono text-[11px] tracking-wide text-muted">
                      {formatClock(meta.durationMs)} · {t("gen.rec.scale", { n: meta.timeScale })} · {t("gen.rec.frames", { n: meta.frames })} ·{" "}
                      {Math.max(1, Math.round(meta.bytes / 1024))} KB
                    </p>
                    <p className="mt-0.5 text-[12px] text-faint">
                      {meta.scenario ? t("gen.rec.scenario", { name: t(`gen.scenario.${meta.scenario}.name`) }) : t("gen.rec.free")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {playing ? (
                      <Button size="sm" variant="secondary" onClick={() => generator.stop()}>
                        <Square className="size-3.5" aria-hidden />
                        {t("gen.rec.stopPlay")}
                      </Button>
                    ) : (
                      <Button size="sm" disabled={blocked || gen.phase === "replaying"} onClick={() => generator.startReplay(meta.id, speed)}>
                        <Play className="size-3.5" aria-hidden />
                        {t("gen.rec.play")}
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" onClick={() => download(meta)}>
                      <Download className="size-3.5" aria-hidden />
                      {t("gen.rec.export")}
                    </Button>
                    <Button size="sm" variant="danger" disabled={playing} onClick={() => generator.deleteRecording(meta.id)} aria-label={t("gen.rec.delete")}>
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                </div>
                {playing && gen.replay ? (
                  <>
                    <p className="mt-2 text-[12px] text-accent">{t("gen.rec.replaying", { pct: Math.round(gen.replay.progress * 100) })}</p>
                    <span
                      aria-hidden
                      className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-accent transition-transform duration-500 ease-linear"
                      style={{ transform: `scaleX(${gen.replay.progress})` }}
                    />
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
