"use client";

import clsx from "clsx";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button, Segmented } from "@/components/ui/primitives";
import { ACTIVITY_MODES, CREW, GROUPS, METRICS, baselineOf, clipValue, round, type MetricDef, type Zone } from "@/lib/generator/catalog";
import { generator, type ChannelView, type CrewView } from "@/lib/generator/engine";
import { metricLabel, useT } from "@/lib/locale";
import { useGenerator } from "./use-generator";

const ZONE_TEXT: Record<Zone, string> = {
  green: "text-nominal",
  yellow: "text-caution",
  red: "text-critical",
};

type Level = "low" | "norm" | "high";

/** Where a held value sits relative to the baseline. */
function levelOf(metric: MetricDef, id: string, held: number | undefined): Level {
  if (held === undefined) return "norm";
  return held < baselineOf(metric, id) ? "low" : "high";
}

/** Value a sensor is pinned to for "low" and "high": well outside its tolerance, still plausible. */
function pinned(metric: MetricDef, id: string, level: Exclude<Level, "norm">): number {
  const base = baselineOf(metric, id);
  const raw = level === "low" ? base - metric.tol * 2.6 : base + metric.tol * 2.6;
  return round(metric, clipValue(metric, raw));
}

export function SensorsTab() {
  const t = useT();
  const gen = useGenerator();
  const [active, setActive] = useState(CREW[0]!.id);
  const crew = gen.crew[active];

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted">{t("gen.sensors.intro")}</p>
      <Segmented
        label={t("gen.sensors.activity")}
        value={active}
        onChange={setActive}
        options={CREW.map((member) => ({ value: member.id, label: t(member.nameKey) }))}
      />
      {crew ? <CrewPanel id={active} crew={crew} /> : null}
    </div>
  );
}

function CrewPanel({ id, crew }: { id: string; crew: CrewView }) {
  const t = useT();

  return (
    <div className="space-y-4">
      <div className="grid gap-4 rounded-xl border border-line bg-panel p-3.5 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
        <div className="space-y-1.5">
          <p className="text-[12px] font-medium text-muted">{t("gen.sensors.activity")}</p>
          <Segmented
            size="sm"
            label={t("gen.sensors.activity")}
            value={crew.activity}
            onChange={(mode) => generator.setActivity(id, mode)}
            options={ACTIVITY_MODES.map((mode) => ({ value: mode, label: t(`gen.activity.${mode}`) }))}
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={`stress-${id}`} className="text-[12px] font-medium text-muted">
              {t("gen.sensors.stress")}
            </label>
            <span className="tnum font-mono text-[11.5px] text-ink">
              {Math.abs(crew.stress) < 0.05 ? t("gen.sensors.stress.calm") : crew.stress.toFixed(2)}
            </span>
          </div>
          <input
            id={`stress-${id}`}
            type="range"
            min={-1.5}
            max={1.5}
            step={0.05}
            value={crew.stress}
            onChange={(event) => generator.setStress(id, Number(event.target.value))}
            className="h-2 w-full cursor-pointer accent-[var(--color-accent)]"
          />
          <p className="text-[11.5px] text-faint">{t("gen.sensors.stress.hint")}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => generator.resetCrew(id)}>
          <RotateCcw className="size-3.5" aria-hidden />
          {t("gen.sensors.resetCrew")}
        </Button>
      </div>

      {GROUPS.map((group) => {
        const metrics = METRICS.filter((metric) => metric.group === group && metric.code !== "ECG");
        if (metrics.length === 0) return null;
        return (
          <section key={group} className="overflow-hidden rounded-xl border border-line bg-panel">
            <h3 className="border-b border-line bg-panel-raised px-3.5 py-2 font-mono text-[10.5px] tracking-[0.14em] text-muted uppercase">
              {t(`gen.group.${group}`)}
            </h3>
            <ul className="divide-y divide-line">
              {metrics.map((metric) => (
                <SensorRow
                  key={metric.code}
                  id={id}
                  metric={metric}
                  view={crew.values[metric.code]}
                  held={crew.hold[metric.code]}
                  off={crew.disabled.includes(metric.code)}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

const LEVEL_TONE: Record<Level, string> = {
  low: "bg-caution text-white",
  norm: "bg-nominal text-white",
  high: "bg-critical-solid text-white",
};

function SensorRow({ id, metric, view, held, off }: { id: string; metric: MetricDef; view: ChannelView | undefined; held: number | undefined; off: boolean }) {
  const t = useT();
  const label = metricLabel(metric.id, metric.name, t);
  const level = levelOf(metric, id, held);

  const choose = (next: Level) => {
    generator.setHold(id, metric.code, next === "norm" ? null : pinned(metric, id, next));
  };

  return (
    <li className={clsx("flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-2.5", off && "opacity-60")}>
      <button
        type="button"
        role="switch"
        aria-checked={!off}
        aria-label={`${label}: ${t("gen.sensors.enabled")}`}
        onClick={() => generator.setEnabled(id, metric.code, off)}
        className={clsx(
          "relative h-6 w-10 shrink-0 rounded-full transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-accent/25 focus-visible:outline-none",
          off ? "bg-track" : "bg-accent",
        )}
      >
        <span
          aria-hidden
          className={clsx("absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform duration-150", !off && "translate-x-4")}
        />
      </button>

      <div className="min-w-0 flex-1 basis-40">
        <p className="truncate text-[13px] font-medium">{label}</p>
        <p className="font-mono text-[10.5px] tracking-wide text-faint uppercase">{metric.code}</p>
      </div>

      <p className={clsx("tnum w-24 text-right font-mono text-[13px] font-semibold", view && !off ? ZONE_TEXT[view.zone] : "text-faint")}>
        {off ? t("gen.sensors.off") : view ? view.value : "–"}
        {!off && view ? <span className="ml-1 text-[10.5px] font-normal text-faint">{metric.unit}</span> : null}
      </p>

      <div role="group" aria-label={label} className={clsx("inline-flex rounded-lg bg-panel-raised p-0.5 ring-1 ring-line ring-inset", off && "pointer-events-none")}>
        {(["low", "norm", "high"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={level === option}
            onClick={() => choose(option)}
            className={clsx(
              "h-7 rounded-md px-3 text-[12px] font-medium transition-colors duration-150",
              level === option ? LEVEL_TONE[option] : "text-muted hover:text-ink",
            )}
          >
            {t(`gen.level.${option}`)}
          </button>
        ))}
      </div>
    </li>
  );
}
