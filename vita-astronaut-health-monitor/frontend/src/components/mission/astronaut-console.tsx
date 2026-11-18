"use client";

import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { BodyHero } from "@/components/mission/body/body-hero";
import { DailyTasks } from "@/components/mission/daily-tasks";
import { BreathingTimer, EcgTrace, StatusRing, TrendChart, VitalCard } from "@/components/mission/widgets";
import { Card } from "@/components/ui/primitives";
import { useHud, useErrnoLimits, useErrnoMetrics, useErrnoReadings, useErrnoStatus } from "@/lib/api/errno";
import { metricLabel, useT } from "@/lib/locale";
import { formatVital, formatWhen, unitOf } from "@/lib/number";
import { anomalyKindOf, isSensorFault } from "@/lib/validate-sensor";

const CARD_FOCUS = ["hr", "spo2", "bp_sys", "temp", "resp"] as const;
const CADENCE = ["continuous", "chem", "daily", "rare"] as const;

function cadenceOf(intervalS: number) {
  if (intervalS >= 604_800) return "rare";
  if (intervalS >= 86_400) return "daily";
  if (intervalS >= 1_800) return "chem";
  return "continuous";
}
/** Fallback nominal bands when /limits has not loaded yet. */
const RANGE_FALLBACK: Record<string, { min: number; max: number }> = {
  hr: { min: 50, max: 100 },
  spo2: { min: 95, max: 100 },
  bp_sys: { min: 90, max: 120 },
  temp: { min: 36.1, max: 37.2 },
  resp: { min: 12, max: 20 },
};

/** Same self-view for astronaut and officer (officer is also crew). */
export function AstronautConsole({ astronautId }: { astronautId: string }) {
  const t = useT();
  const id = astronautId;
  const hud = useHud(id);
  const status = useErrnoStatus(id);
  const metrics = useErrnoMetrics();
  const limits = useErrnoLimits(id);
  const heart = useErrnoReadings(id, "hr");
  const spo2 = useErrnoReadings(id, "spo2");
  const code = hud.data?.status ?? status.data?.status ?? 0;
  const health = hud.data?.health_index ?? status.data?.health_index ?? status.data?.score ?? 100;
  const series = {
    hr: (heart.data ?? []).map((point) => point.value),
    spo2: (spo2.data ?? []).map((point) => point.value),
  };
  const metricRows = metrics.data ?? [];
  const metricById = new Map(metricRows.map((metric) => [metric.id, metric]));
  const latestByMetric = new Map(metricRows.map((metric) => [metric.id, metric.latest.find((item) => item.astronaut_id === id)]));
  const rangeOf = (sensor: string) => {
    const row = limits.data?.find((item) => item.sensor_id === sensor);
    if (row?.min != null && row?.max != null) return { min: row.min, max: row.max };
    return RANGE_FALLBACK[sensor] ?? null;
  };

  // Peer map for client-side fusion fallback (API usually already classified).
  const peers: Record<string, number | undefined> = {};
  for (const metric of metricRows) {
    const hit = latestByMetric.get(metric.id);
    if (hit) peers[metric.id] = hit.value;
  }

  const faultOf = (sensor: string, value: { value: number; signal_lost?: boolean; sensor_anomaly?: boolean; anomaly_kind?: "lost" | "bounds" | "fusion" | null }) => {
    const kind = value.anomaly_kind ?? anomalyKindOf(sensor, value.value, peers);
    const fault = Boolean(value.signal_lost || value.sensor_anomaly || kind || isSensorFault(sensor, value.value, peers));
    return { fault, kind: kind ?? (value.sensor_anomaly ? "bounds" : fault ? "lost" : null) };
  };

  const bodyMetrics = metricRows.flatMap((metric) => {
    if (metric.id === "ecg") return [];
    const value = latestByMetric.get(metric.id);
    if (!value) return [];
    const { fault, kind } = faultOf(metric.id, value);
    return [
      {
        id: metric.id,
        name: metricLabel(metric.id, metric.name_uk, t),
        zone: fault ? null : value.zone ?? null,
        value: fault ? (kind === "lost" ? t("vitals.noSignal") : t("vitals.anomalyShort")) : formatVital(metric.id, value.value),
        unit: unitOf(metric.id, metric.unit),
        signalLost: fault,
      },
    ];
  });
  const rows = CARD_FOCUS.flatMap((sensor) => {
    const metric = metricById.get(sensor);
    const value = latestByMetric.get(sensor);
    return metric && value ? [{ metric, value }] : [];
  });
  const hrNow = rows.find((row) => row.metric.id === "hr")?.value;
  const hrFault = hrNow ? faultOf("hr", hrNow) : { fault: false, kind: null };
  // Real bpm for the cardiogram (red/yellow still draws QRS). Flat only if lost / ≤0.
  const hrRaw = hrNow?.value ?? heart.data?.at(-1)?.value;
  const hrBpm = hrFault.kind === "lost" || hrRaw == null || !Number.isFinite(hrRaw) || hrRaw <= 0 ? 0 : hrRaw;
  const hrZone = hrFault.kind === "lost" ? null : hrNow?.zone ?? null;
  const cadenceRows = metricRows
    .filter((metric) => metric.id !== "ecg" && metric.interval_s > 0)
    .map((metric) => {
      const value = latestByMetric.get(metric.id);
      const { fault, kind } = value ? faultOf(metric.id, value) : { fault: false, kind: null };
      return { metric, value, fault, kind, cadence: cadenceOf(metric.interval_s) };
    });

  const vitalsFooter = (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted">{t("vitals.current")}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {rows.map(({ metric, value }) => {
          const { fault, kind } = faultOf(metric.id, value);
          return (
            <VitalCard
              key={metric.id}
              square
              name={metricLabel(metric.id, metric.name_uk, t)}
              value={fault ? t("vitals.noSignal") : formatVital(metric.id, value.value)}
              unit={unitOf(metric.id, metric.unit)}
              zone={fault ? null : value.zone ?? null}
              points={fault ? [] : series[metric.id as keyof typeof series] ?? [value.value]}
              rawValue={value.value}
              range={rangeOf(metric.id)}
              signalLost={fault}
              sensorAnomaly={kind === "bounds" || kind === "fusion" || Boolean(value.sensor_anomaly)}
              anomalyKind={kind}
            />
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {code === 2 ? (
        <div role="alert" className="flex flex-wrap items-start gap-3 rounded-xl border border-critical/35 bg-critical/[0.08] px-4 py-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-critical/15 text-critical">
            <ShieldAlert className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold tracking-wide text-critical">{t("status.critical")}</p>
            <p className="mt-1 text-sm text-ink">{hud.data?.critical_text}</p>
            <p className="mt-1 text-xs text-muted">{t("vitals.criticalStop")}</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
        <Card className="grid place-items-center rounded-2xl bg-panel/70">
          <StatusRing status={code} health={Number(health)} />
        </Card>
        <div className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-line bg-panel shadow-[var(--shadow-pop)]">
            <EcgTrace astronautId={id} bpm={hrBpm} zone={hrZone} />
          </div>
          <Card className="rounded-2xl p-4">
            <p className="text-sm text-muted">{t("vitals.exerciseNote")}</p>
            {code === 0 ? (
              <p className="mt-2 text-sm text-nominal">{t("vitals.okMessage")}</p>
            ) : (
              <div className="mt-3 space-y-3">
                {(hud.data?.cards ?? []).map((card) => (
                  <div key={card.metric} className="rounded-xl border border-caution/30 bg-panel-raised/40 p-3">
                    <p className="text-xs text-muted">{card.metric}</p>
                    <p className="mt-1 text-sm">{card.message}</p>
                    {card.breathing ? (
                      <div className="mt-2">
                        <BreathingTimer />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <BodyHero
        metrics={bodyMetrics}
        title={t("vitals.myHealth")}
        subtitle={t("vitals.healthSubtitle", { index: Number(health).toFixed(0), mode: hud.data?.activity_mode ?? "rest" })}
        side={<DailyTasks astronautId={id} />}
        footer={vitalsFooter}
      />

      <Card className="rounded-2xl p-4">
        <h2 className="text-sm font-semibold">{t("vitals.schedule")}</h2>
        <div className="mt-4 space-y-5">
          {CADENCE.map((cadence) => {
            const items = cadenceRows.filter((row) => row.cadence === cadence);
            if (!items.length) return null;
            return (
              <section key={cadence}>
                <h3 className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">{t(`vitals.schedule.${cadence}`)}</h3>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {items.map(({ metric, value, fault, kind }) => {
                    const tone = fault ? "text-caution" : value?.zone === "red" ? "text-critical" : value?.zone === "yellow" ? "text-caution" : "text-nominal";
                    const expected = value && metric.interval_s > 1 ? formatWhen(value.ts + metric.interval_s) : null;
                    return (
                      <article key={metric.id} className="rounded-xl border border-line bg-panel-raised/30 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs text-muted">{metricLabel(metric.id, metric.name_uk, t)}</p>
                          <span className="font-mono text-[10px] text-faint">{metric.id}</span>
                        </div>
                        <p className={`mt-1 font-mono text-xl ${tone}`}>
                          {!value ? "—" : fault ? (kind === "lost" ? t("vitals.noSignal") : t("vitals.anomalyShort")) : formatVital(metric.id, value.value)}
                          {value && !fault ? <span className="ml-1 text-xs text-muted">{unitOf(metric.id, metric.unit)}</span> : null}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                          <span>{t("vitals.last")}: {value ? formatWhen(value.ts) : t("vitals.noReading")}</span>
                          <span>{t("vitals.expected")}: {expected ?? (metric.interval_s <= 1 ? t("vitals.schedule.continuous") : "—")}</span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </Card>

      <Card className="rounded-2xl p-4">
        <div className="mb-2 flex items-end justify-between gap-2">
          <h2 className="text-sm font-semibold">{t("vitals.hrTrend")}</h2>
          <Link href="/training" className="text-sm text-accent hover:underline">
            {t("vitals.sleepLink")}
          </Link>
        </div>
        <TrendChart sensor="hr" unit={unitOf("hr")} points={(heart.data ?? []).map((point) => ({ t: point.ts, value: point.value }))} />
      </Card>
    </div>
  );
}
