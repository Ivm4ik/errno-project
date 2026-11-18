"use client";

import clsx from "clsx";
import { Play, Square, Timer } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { generator } from "@/lib/generator/engine";
import { SCENARIOS, type Tone } from "@/lib/generator/scenarios";
import { useT } from "@/lib/locale";
import { useGenerator } from "./use-generator";

const TONE_DOT: Record<Tone, string> = {
  ok: "bg-nominal",
  warn: "bg-caution",
  crit: "bg-critical",
};

export function ScenariosTab() {
  const t = useT();
  const gen = useGenerator();
  const blocked = gen.phase === "replaying" || (gen.phase === "idle" && gen.busyElsewhere);

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted">{t("gen.scenarios.intro")}</p>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {SCENARIOS.map((scenario) => {
          const active = gen.scenario?.id === scenario.id;
          const left = active && gen.scenario ? Math.max(0, Math.ceil(gen.scenario.duration - gen.scenario.t)) : 0;
          const progress = active && gen.scenario ? Math.min(1, gen.scenario.t / gen.scenario.duration) : 0;
          return (
            <li
              key={scenario.id}
              className={clsx(
                "relative flex flex-col overflow-hidden rounded-xl border bg-panel p-3.5 transition-colors",
                active ? "border-accent/60 bg-accent/[0.04]" : "border-line",
              )}
            >
              <div className="flex items-center gap-2">
                <span className={clsx("size-2 shrink-0 rounded-full", TONE_DOT[scenario.tone])} aria-hidden />
                <h3 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{t(`gen.scenario.${scenario.id}.name`)}</h3>
              </div>
              <p className="mt-1.5 flex-1 text-[12.5px] leading-snug text-muted">{t(`gen.scenario.${scenario.id}.desc`)}</p>
              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-0.5 font-mono text-[10.5px] tracking-wide text-faint uppercase">
                  <span className="inline-flex items-center gap-1">
                    <Timer className="size-3" aria-hidden />
                    {active ? t("gen.scenarios.left", { n: left }) : t("gen.scenarios.duration", { n: scenario.duration })}
                  </span>
                  <span className="truncate">{t(`gen.scenarios.expect.${scenario.expect}`)}</span>
                </div>
                {active ? (
                  <Button size="sm" variant="secondary" onClick={() => generator.stopScenario()}>
                    <Square className="size-3.5" aria-hidden />
                    {t("gen.scenarios.stop")}
                  </Button>
                ) : (
                  <Button size="sm" disabled={blocked} onClick={() => generator.runScenario(scenario.id)}>
                    <Play className="size-3.5" aria-hidden />
                    {t("gen.scenarios.run")}
                  </Button>
                )}
              </div>
              {active ? (
                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-accent transition-transform duration-500 ease-linear"
                  style={{ transform: `scaleX(${progress})` }}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
