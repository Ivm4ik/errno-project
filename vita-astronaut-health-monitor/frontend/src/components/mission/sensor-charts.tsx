"use client";

import clsx from "clsx";
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip as ChartTooltip,
} from "chart.js";
import { useMemo, useState } from "react";
import { Bar, Doughnut } from "react-chartjs-2";
import { useQuery } from "@tanstack/react-query";
import { TrendChart } from "@/components/mission/widgets";
import { Card } from "@/components/ui/primitives";
import { api, withQuery } from "@/lib/api/client";
import { type ErrnoMetric, type ErrnoReading, useErrnoLimits, useErrnoMetrics } from "@/lib/api/errno";
import { METRICS, type MetricDef, baselineOf, round } from "@/lib/generator/catalog";
import { useLiveOnline } from "@/lib/live";
import { metricLabel, useT } from "@/lib/locale";
import { formatVital, unitOf } from "@/lib/number";
import { useThemeColors } from "@/lib/theme";
import { anomalyKindOf, isSensorFault } from "@/lib/validate-sensor";
import { bandOf } from "@/lib/zones";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  ChartTooltip,
  Legend,
);

const VITALS = ["hr", "spo2", "bp_sys", "temp", "resp"] as const;
const ZONE = { green: "#2ECC8F", yellow: "#F5B642", red: "#FF4D5E", muted: "#6b7c93", accent: "#2dd4bf" } as const;

type LimitRow = { sensor_id: string; min: number | null; max: number | null };
type SeriesPack = {
  metric: ErrnoMetric;
  points: { t: number; value: number }[];
  last: number;
  zone: "green" | "yellow" | "red" | null;
  lost: boolean;
  kind: "lost" | "bounds" | "fusion" | null;
  /** No real reading yet: the pack shows the normal baseline instead. */
  placeholder: boolean;
};

const DEF_BY_ID = Object.fromEntries(METRICS.map((def) => [def.id, def])) as Record<string, MetricDef>;
const PLACEHOLDER_POINTS = 30;

/** Normal state for a sensor with no readings yet: a gentle flat line at its baseline, one point a minute. */
function normalPoints(def: MetricDef, astronautId: string, anchorSec: number) {
  const base = baselineOf(def, astronautId);
  return Array.from({ length: PLACEHOLDER_POINTS }, (_, index) => {
    const ago = PLACEHOLDER_POINTS - 1 - index;
    const wobble = ago === 0 ? 0 : Math.sin(index / 3) * 0.12 * def.tol;
    return { t: anchorSec - ago * 60, value: round(def, base + wobble) };
  });
}

function tone(zone: string | null, lost = false) {
  if (lost || zone == null) return ZONE.muted;
  return zone === "red" ? ZONE.red : zone === "yellow" ? ZONE.yellow : ZONE.green;
}

function bandPct(value: number, limits: LimitRow[], sensor: string) {
  const row = limits.find((item) => item.sensor_id === sensor);
  if (row?.min == null || row?.max == null || row.max === row.min) return null;
  return Math.max(0, Math.min(130, ((value - row.min) / (row.max - row.min)) * 100));
}

function limitOf(limits: LimitRow[], sensor: string) {
  return limits.find((item) => item.sensor_id === sensor) ?? null;
}

/** One-screen telemetry dashboard — KPI row, bars, trend, donut. */
export function SensorChartsWorkspace({ astronautId }: { astronautId: string }) {
  const t = useT();
  const colors = useThemeColors();
  const [focus, setFocus] = useState("hr");
  const metrics = useErrnoMetrics();
  const live = useLiveOnline();
  const limitsQ = useErrnoLimits(astronautId);
  const limits = limitsQ.data ?? [];
  const readings = useQuery({
    queryKey: ["errno-readings", astronautId, "all", "hour"],
    queryFn: () => api.get<ErrnoReading[]>(withQuery("/readings", { astronaut_id: astronautId })),
    enabled: Boolean(astronautId),
    refetchInterval: live ? 15_000 : 2_500,
  });

  const [anchorSec] = useState(() => Math.floor(Date.now() / 1000));

  const series = useMemo(() => {
    const byId = new Map<string, { t: number; value: number }[]>();
    for (const row of readings.data ?? []) {
      const points = byId.get(row.sensor_id) ?? [];
      points.push({ t: row.ts, value: row.value });
      byId.set(row.sensor_id, points);
    }
    for (const points of byId.values()) points.sort((a, b) => a.t - b.t);

    const peers: Record<string, number | undefined> = {};
    for (const metric of metrics.data ?? []) {
      const latest = metric.latest.find((item) => item.astronaut_id === astronautId);
      if (latest) peers[metric.id] = latest.value;
    }

    // Backend list first; catalog sensors the backend does not list yet are added so the charts are never empty.
    const listed = metrics.data ?? [];
    const known = new Set(listed.map((metric) => metric.id));
    const extra: ErrnoMetric[] = METRICS.filter((def) => def.code !== "ECG" && !known.has(def.id)).map((def) => ({
      id: def.id,
      name_uk: def.name,
      group: def.group,
      mode: "",
      interval_s: def.every,
      unit: def.unit,
      source: "demo",
      latest: [],
    }));

    return [...listed, ...extra].flatMap((metric): SeriesPack[] => {
      if (metric.id === "ecg") return [];
      const points = byId.get(metric.id) ?? [];
      const latest = metric.latest.find((item) => item.astronaut_id === astronautId);
      const last = points.at(-1)?.value ?? latest?.value;
      if (last == null) {
        // No reading yet: show the normal state so the charts are never blank.
        const def = DEF_BY_ID[metric.id];
        if (!def) return [];
        const base = round(def, baselineOf(def, astronautId));
        return [{
          metric,
          points: normalPoints(def, astronautId, anchorSec),
          last: base,
          zone: bandOf(metric.id, base),
          lost: false,
          kind: null,
          placeholder: true,
        }];
      }
      const kind = latest?.anomaly_kind ?? anomalyKindOf(metric.id, last, peers);
      const lost = Boolean(latest?.signal_lost || latest?.sensor_anomaly || kind || isSensorFault(metric.id, last, peers));
      // Allow KPI even with 1 point; charts need 2+.
      return [{
        metric,
        points,
        last,
        zone: lost ? null : bandOf(metric.id, last),
        lost,
        kind: kind ?? null,
        placeholder: false,
      }];
    });
  }, [metrics.data, readings.data, astronautId, anchorSec]);
  const hasPlaceholder = series.some((item) => item.placeholder);

  const vitals = useMemo(
    () => VITALS.map((id) => series.find((item) => item.metric.id === id)).filter(Boolean) as SeriesPack[],
    [series],
  );
  const focusPack = series.find((item) => item.metric.id === focus) ?? vitals[0] ?? series[0] ?? null;
  const zoneCounts = useMemo(() => {
    let green = 0;
    let yellow = 0;
    let red = 0;
    let lost = 0;
    for (const item of series) {
      if (item.lost) lost += 1;
      else if (item.zone === "red") red += 1;
      else if (item.zone === "yellow") yellow += 1;
      else green += 1;
    }
    return { green, yellow, red, lost, total: series.length };
  }, [series]);

  if (readings.isPending && !series.length) {
    return <p className="text-sm text-muted">{t("sensors.loadingCurves")}</p>;
  }
  if (readings.isError) {
    return <p className="text-sm text-critical">{t("sensors.readingsError")}</p>;
  }
  if (!series.length) {
    return <Card className="p-6 text-sm text-muted">{t("sensors.chartsEmpty")}</Card>;
  }

  const barLabels = vitals.map((item) => metricLabel(item.metric.id, item.metric.name_uk, t));
  const barValues = vitals.map((item) => bandPct(item.last, limits, item.metric.id) ?? 50);

  return (
    <div className="space-y-4">
      {hasPlaceholder ? (
        <p className="rounded-lg border border-line bg-panel/70 px-3.5 py-2 text-[12px] text-muted">{t("sensors.dash.demoNorm")}</p>
      ) : null}
      {/* Metric chips — like filter row on BI dashboards */}
      <div className="flex flex-wrap gap-2">
        {(vitals.length ? vitals : series.slice(0, 8)).map((item) => {
          const active = focusPack?.metric.id === item.metric.id;
          return (
            <button
              key={item.metric.id}
              type="button"
              onClick={() => setFocus(item.metric.id)}
              className={clsx(
                "rounded-lg border px-3 py-1.5 text-[12px] font-medium transition",
                active
                  ? "border-accent/40 bg-accent/15 text-accent"
                  : "border-line bg-panel/70 text-muted hover:border-line-strong hover:text-ink",
              )}
            >
              {metricLabel(item.metric.id, item.metric.name_uk, t)}
            </button>
          );
        })}
      </div>

      {/* KPI row: gauges + progress metrics */}
      <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
        <Card className="flex flex-col items-center justify-center gap-2 p-4">
          <SemiGauge
            value={zoneCounts.total ? Math.round((zoneCounts.green / zoneCounts.total) * 100) : 0}
            label={t("sensors.dash.inNorm")}
          />
        </Card>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {vitals.slice(0, 3).map((item) => {
            const pct = bandPct(item.last, limits, item.metric.id);
            const lim = limitOf(limits, item.metric.id);
            return (
              <button
                key={item.metric.id}
                type="button"
                onClick={() => setFocus(item.metric.id)}
                className={clsx(
                  "rounded-xl border bg-panel/80 p-3.5 text-left transition hover:bg-panel-raised/50",
                  focusPack?.metric.id === item.metric.id ? "border-accent/35" : "border-line",
                )}
              >
                <p className="text-[11px] font-medium tracking-wide text-muted uppercase">
                  {metricLabel(item.metric.id, item.metric.name_uk, t)}
                </p>
                <p className="mt-1.5 font-mono text-2xl tracking-tight text-ink" style={{ color: tone(item.zone, item.lost) }}>
                  {item.lost
                    ? (item.kind === "bounds" || item.kind === "fusion" ? t("vitals.anomalyShort") : t("vitals.noSignal"))
                    : formatVital(item.metric.id, item.last)}
                  {!item.lost ? <span className="ml-1 text-xs text-muted">{unitOf(item.metric.id, item.metric.unit)}</span> : null}
                </p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-track">
                  <div
                    className="h-full rounded-full transition-[width]"
                    style={{
                      width: item.lost ? "0%" : `${Math.min(100, pct ?? 0)}%`,
                      background: tone(item.zone, item.lost),
                    }}
                  />
                </div>
                <p className="mt-1.5 font-mono text-[10px] text-faint">
                  {pct != null ? `${pct.toFixed(0)}%` : "—"}
                  {lim?.min != null && lim.max != null ? ` · ${lim.min}–${lim.max}` : ""}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Middle: side stats + horizontal bars */}
      <div className="grid gap-3 lg:grid-cols-[200px_1fr]">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          {(vitals.length > 3 ? vitals.slice(3) : vitals.slice(0, 2)).map((item) => {
            const prev = item.points.length >= 2 ? item.points[item.points.length - 2]!.value : item.last;
            const delta = item.last - prev;
            const up = delta >= 0;
            return (
              <Card key={`stat-${item.metric.id}`} className="p-3.5">
                <p className="text-[11px] text-muted">{metricLabel(item.metric.id, item.metric.name_uk, t)}</p>
                <p className="mt-1 font-mono text-xl text-ink">{formatVital(item.metric.id, item.last)}</p>
                <p className={clsx("mt-1 text-[11px] font-medium", up ? "text-nominal" : "text-critical")}>
                  {up ? "+" : ""}
                  {formatVital(item.metric.id, delta)}
                </p>
              </Card>
            );
          })}
        </div>
        <Card className="p-4">
          <p className="text-[13px] font-semibold text-ink">{t("sensors.dash.bandTitle")}</p>
          <p className="mt-0.5 text-[11px] text-muted">{t("sensors.dash.bandHint")}</p>
          <div className="mt-3 h-56">
            <Bar
              data={{
                labels: barLabels,
                datasets: [
                  {
                    data: barValues,
                    backgroundColor: vitals.map((item) => tone(item.zone, item.lost)),
                    borderRadius: 6,
                    barThickness: 14,
                  },
                ],
              }}
              options={{
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  x: {
                    min: 0,
                    max: 130,
                    ticks: { color: colors.muted, callback: (v) => `${v}%`, font: { size: 10 } },
                    grid: { color: colors.grid },
                  },
                  y: {
                    ticks: { color: colors.ink, font: { size: 11 } },
                    grid: { display: false },
                  },
                },
              }}
            />
          </div>
        </Card>
      </div>

      {/* Bottom: big trend + donut */}
      <div className="grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-hidden p-0">
          <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line px-4 py-3">
            <div>
              <p className="text-[13px] font-semibold text-ink">{t("sensors.dash.trendTitle")}</p>
              <p className="text-[11px] text-muted">
                {focusPack ? metricLabel(focusPack.metric.id, focusPack.metric.name_uk, t) : "—"} · {t("sensors.focusWindow")}
              </p>
            </div>
            {focusPack ? (
              <p className="font-mono text-xl" style={{ color: tone(focusPack.zone, focusPack.lost) }}>
                {focusPack.lost
                  ? (focusPack.kind === "bounds" || focusPack.kind === "fusion" ? t("vitals.anomaly") : t("vitals.noSignalFull"))
                  : formatVital(focusPack.metric.id, focusPack.last)}
                {!focusPack.lost ? (
                  <span className="ml-1 text-xs text-muted">{unitOf(focusPack.metric.id, focusPack.metric.unit)}</span>
                ) : null}
              </p>
            ) : null}
          </div>
          <div className="px-2 pb-3 pt-1 sm:px-3">
            {focusPack && focusPack.points.length >= 2 ? (
              <TrendChart
                className="h-64"
                sensor={focusPack.metric.id}
                unit={unitOf(focusPack.metric.id, focusPack.metric.unit)}
                points={focusPack.points}
              />
            ) : (
              <p className="p-6 text-sm text-muted">{t("vitals.notEnoughPoints")}</p>
            )}
          </div>
        </Card>

        <Card className="flex flex-col p-4">
          <p className="text-[13px] font-semibold text-ink">{t("sensors.dash.zonesTitle")}</p>
          <p className="mt-0.5 text-[11px] text-muted">{t("sensors.dash.zonesHint")}</p>
          <div className="relative mx-auto mt-4 aspect-square w-full max-w-[220px]">
            <Doughnut
              data={{
                labels: [t("zone.green"), t("zone.yellow"), t("zone.red")],
                datasets: [
                  {
                    data: [zoneCounts.green, zoneCounts.yellow, zoneCounts.red],
                    backgroundColor: [ZONE.green, ZONE.yellow, ZONE.red],
                    borderWidth: 0,
                    hoverOffset: 4,
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: true,
                cutout: "72%",
                layout: { padding: 0 },
                plugins: {
                  legend: { display: false },
                  tooltip: { enabled: true },
                },
              }}
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="flex -translate-y-px flex-col items-center justify-center leading-none">
                <p className="font-mono text-2xl font-semibold tabular-nums text-ink">{zoneCounts.total}</p>
                <p className="mt-1 text-[10px] leading-none text-muted">{t("sensors.dash.sensors")}</p>
              </div>
            </div>
          </div>
          <ul className="mt-auto space-y-1.5 pt-3 text-[12px]">
            {(
              [
                ["green", zoneCounts.green, ZONE.green, t("zone.green")],
                ["yellow", zoneCounts.yellow, ZONE.yellow, t("zone.yellow")],
                ["red", zoneCounts.red, ZONE.red, t("zone.red")],
              ] as const
            ).map(([key, count, color, label]) => (
              <li key={key} className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-muted">
                  <span className="size-2 rounded-full" style={{ background: color }} />
                  {label}
                </span>
                <span className="font-mono text-ink">{count}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function SemiGauge({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  const r = 54;
  const c = 2 * Math.PI * r;
  const half = c / 2;
  const filled = (clamped / 100) * half;
  return (
    <div className="w-full text-center">
      <svg viewBox="0 0 140 90" className="mx-auto h-28 w-full max-w-[200px]" aria-hidden>
        <path
          d="M 16 78 A 54 54 0 0 1 124 78"
          fill="none"
          stroke="var(--color-track)"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <path
          d="M 16 78 A 54 54 0 0 1 124 78"
          fill="none"
          stroke={ZONE.accent}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${half}`}
        />
        <text x="70" y="72" textAnchor="middle" className="fill-ink" style={{ fontSize: 28, fontFamily: "var(--font-mono)" }}>
          {clamped}%
        </text>
      </svg>
      <p className="text-[11px] font-medium text-muted">{label}</p>
    </div>
  );
}
