"use client";

import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Lock, ShieldAlert } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PenaltyRow } from "@/lib/api/errno";
import { EcgCanvas } from "@/components/mission/ecg-canvas";
import { api, withQuery } from "@/lib/api/client";
import { replaceEcgStrip } from "@/lib/ecg-strip";
import { metricLabel, useLocale, useT } from "@/lib/locale";
import { formatNumber, formatVital } from "@/lib/number";
import type { TranslationKey } from "@/lib/translations";
import { bandOf } from "@/lib/zones";

/** Hospital-style Lead II cardiogram (canvas, batched live strip). */
export function EcgTrace(props: { astronautId?: string; bpm: number; zone?: string | null }) {
  const bootstrapped = useRef(false);
  useEffect(() => {
    const id = props.astronautId;
    if (!id || bootstrapped.current) return;
    bootstrapped.current = true;
    const from = Math.floor(Date.now() / 1000) - 8;
    void api
      .get<{ ts: number; value: number }[]>(withQuery("/readings", { astronaut_id: id, sensor_id: "ecg", from: String(from) }))
      .then((rows) => {
        if (!rows?.length) return;
        replaceEcgStrip(
          id,
          rows.map((row) => ({ t: Number(row.ts), v: Number(row.value) })),
        );
      })
      .catch(() => {
        /* canvas synthesizes until WS fills */
      });
  }, [props.astronautId]);
  return <EcgCanvas key={props.astronautId ?? "ecg"} {...props} />;
}

const STATUS_KEYS = ["status.optimal", "status.canFinish", "status.critical"] as const satisfies readonly TranslationKey[];
const ZONE = { green: "#2ECC8F", yellow: "#F5B642", red: "#FF4D5E" } as const;

export function StatusRing({ status, health }: { status: number; health: number }) {
  const t = useT();
  const label = t(STATUS_KEYS[status] ?? "common.noData");
  const tone = status === 2 ? "text-critical" : status === 1 ? "text-caution" : "text-nominal";
  const dash = Math.max(0, Math.min(100, health));
  return (
    <div className="grid place-items-center gap-2">
      <svg viewBox="0 0 120 120" className="size-36 drop-shadow-[0_0_18px_rgb(46_204_143_/_0.18)]" role="img" aria-label={t("vitals.statusRingAria", { status: label, index: dash.toFixed(0) })}>
        <circle cx="60" cy="60" r="46" className="fill-none stroke-line" strokeWidth="8" />
        <circle cx="60" cy="60" r="46" className={clsx("fill-none transition-[stroke-dasharray] duration-700", tone)} stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${dash * 2.89} 289`} transform="rotate(-90 60 60)" />
        <text x="60" y="58" textAnchor="middle" className="fill-ink font-mono text-[22px] font-semibold">{dash.toFixed(0)}</text>
        <text x="60" y="76" textAnchor="middle" className="fill-muted text-[9px]">{t("status.index")}</text>
      </svg>
      <p className={clsx("inline-flex items-center gap-1.5 text-sm font-medium", tone)}>
        {status === 2 ? <ShieldAlert className="size-4" /> : status === 1 ? <AlertTriangle className="size-4" /> : <CheckCircle2 className="size-4" />}
        {label}
      </p>
    </div>
  );
}

export function Sparkline({ points, tone = "nominal", tall = false }: { points: number[]; tone?: "nominal" | "caution" | "critical"; tall?: boolean }) {
  const id = useId();
  const shown = points.slice(-40);
  if (shown.length < 2) return null;
  const min = Math.min(...shown);
  const max = Math.max(...shown);
  const span = Math.max(max - min, 1);
  const h = tall ? 72 : 36;
  const pad = tall ? 58 : 24;
  const coords = shown.map((value, index) => {
    const x = (index / (shown.length - 1)) * 120;
    const y = (h - 6) - ((value - min) / span) * pad;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = coords.map((point, index) => `${index ? "L" : "M"}${point}`).join(" ");
  const color = tone === "critical" ? ZONE.red : tone === "caution" ? ZONE.yellow : ZONE.green;
  return (
    <svg viewBox={`0 0 120 ${h}`} className={clsx("w-full", tall ? "mt-1 h-[4.25rem]" : "mt-2 h-9")} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L120,${h} L0,${h} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={tall ? 2.4 : 1.8} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={coords.at(-1)?.split(",")[0]} cy={coords.at(-1)?.split(",")[1]} r={tall ? 2.8 : 2.2} fill={color} />
    </svg>
  );
}

/** Horizontal scale: limit band + current value marker (for sensors without a spark history). */
export function RangeBar({
  value,
  min,
  max,
  tone = "nominal",
  className,
}: {
  value: number;
  min: number;
  max: number;
  tone?: "nominal" | "caution" | "critical";
  className?: string;
}) {
  const span = Math.max(max - min, 1e-6);
  const pad = span * 0.2;
  const lo = min - pad;
  const hi = max + pad;
  const full = hi - lo;
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  const bandLeft = clamp01((min - lo) / full) * 100;
  const bandRight = clamp01((max - lo) / full) * 100;
  const marker = clamp01((value - lo) / full) * 100;
  const color = tone === "critical" ? ZONE.red : tone === "caution" ? ZONE.yellow : ZONE.green;
  const label = (n: number) => (Math.abs(n) >= 100 || Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1));
  const t = useT();
  return (
    <div
      className={clsx("flex w-full items-center gap-2", className)}
      role="img"
      aria-label={t("vitals.rangeAria", { min: label(min), max: label(max), value: label(value) })}
    >
      <span className="w-7 shrink-0 text-right font-mono text-[11px] font-semibold tabular-nums leading-none text-muted">{label(min)}</span>
      <div className="relative h-3.5 min-w-0 flex-1 overflow-hidden rounded-full bg-track">
        <div
          className="absolute inset-y-0 bg-nominal/40"
          style={{ left: `${bandLeft}%`, width: `${Math.max(bandRight - bandLeft, 2)}%` }}
        />
        <div
          className="absolute inset-y-0.5 rounded-full"
          style={{ left: 0, width: `${marker}%`, background: color, opacity: 0.9 }}
        />
        <div
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel shadow-sm"
          style={{ left: `${marker}%`, background: color }}
        />
      </div>
      <span className="w-7 shrink-0 font-mono text-[11px] font-semibold tabular-nums leading-none text-muted">{label(max)}</span>
    </div>
  );
}

export function VitalCard({
  name,
  value,
  unit,
  zone,
  points,
  rawValue,
  range,
  square = false,
  /** Equipment fault — Graceful Degradation: muted, never clinical red. */
  signalLost = false,
  /** Bounds / fusion contradiction (still technical, not medical crisis). */
  sensorAnomaly = false,
  anomalyKind,
}: {
  name: string;
  value: string;
  unit: string;
  zone: string | null;
  points: number[];
  /** Numeric reading for the range marker. */
  rawValue?: number;
  /** Nominal min/max band from limits. */
  range?: { min: number; max: number } | null;
  /** Compact square tile for the grid under the 3D body. */
  square?: boolean;
  signalLost?: boolean;
  sensorAnomaly?: boolean;
  anomalyKind?: "lost" | "bounds" | "fusion" | null;
}) {
  const t = useT();
  const kind =
    anomalyKind ??
    (rawValue === 0 || (typeof rawValue === "number" && Number.isNaN(rawValue))
      ? "lost"
      : sensorAnomaly
        ? "bounds"
        : signalLost
          ? "lost"
          : null);
  const fault = Boolean(signalLost || sensorAnomaly || kind);
  if (fault) {
    const dropout = kind === "lost" || rawValue === 0;
    return (
      <article
        className={clsx(
          "rounded-xl border shadow-none",
          dropout ? "border-line/70 bg-panel-raised/50 opacity-80" : "border-caution/35 bg-caution/[0.06]",
          square ? "flex flex-col overflow-hidden px-3 pb-2.5 pt-2.5" : "p-4",
        )}
      >
        <p className={clsx(dropout ? "text-faint" : "text-caution/90", square ? "text-[11px] leading-tight" : "text-xs")}>{name}</p>
        <p className={clsx("font-mono tracking-tight", dropout ? "text-faint" : "text-caution", square ? "mt-0.5 text-[1.15rem] leading-snug" : "mt-1 text-lg")}>
          {dropout ? t("vitals.noSignalFull") : t("vitals.anomaly")}
        </p>
        <p className={clsx("mt-1.5 inline-flex items-center gap-1 text-[11px]", dropout ? "text-faint" : "text-caution/90")}>
          <AlertTriangle className="size-3 shrink-0" />
          {t("vitals.anomalyHint")}
        </p>
      </article>
    );
  }

  const tone = zone === "red" ? "critical" : zone === "yellow" ? "caution" : "nominal";
  const text = zone === "red" ? t("zone.red") : zone === "yellow" ? t("zone.yellow") : t("zone.green");
  const hasSpark = points.length >= 2;
  const hasRange = rawValue != null && range != null && Number.isFinite(range.min) && Number.isFinite(range.max);
  const zoneRow = (
    <p className={clsx("inline-flex items-center gap-1", square ? "text-[11px]" : "text-[11px]", tone === "critical" ? "text-critical" : tone === "caution" ? "text-caution" : "text-nominal")}>
      {tone === "critical" ? <ShieldAlert className="size-3" /> : tone === "caution" ? <AlertTriangle className="size-3" /> : <CheckCircle2 className="size-3" />}
      {text}
    </p>
  );

  const chart = hasSpark ? (
    <div className={square ? "-mx-2 mt-1 w-[calc(100%+1rem)]" : undefined}>
      <Sparkline points={points} tone={tone} tall={square} />
    </div>
  ) : hasRange ? (
    <RangeBar value={rawValue} min={range.min} max={range.max} tone={tone} className="mt-2" />
  ) : (
    <p className="mt-1 text-[11px] text-muted">{t("common.noCurve")}</p>
  );
  return (
    <article
      className={clsx(
        "rounded-xl border bg-panel/80 shadow-[0_0_0_1px_rgb(142_183_255_/_0.04)] backdrop-blur transition-colors",
        square ? "flex flex-col overflow-hidden px-3 pb-2.5 pt-2.5" : "p-4",
        zone === "red" ? "border-critical/40" : zone === "yellow" ? "border-caution/35" : "border-line",
      )}
    >
      <p className={clsx("text-muted", square ? "text-[11px] leading-tight" : "text-xs")}>{name}</p>
      <p className={clsx("font-mono tracking-tight text-ink", square ? "mt-0.5 text-[1.65rem] leading-none" : "mt-1 text-2xl")}>
        {value} <span className={clsx("text-muted", square ? "text-[13px]" : "text-xs")}>{unit}</span>
      </p>
      {!square ? (
        <>
          <p className={clsx("mt-1 inline-flex items-center gap-1 text-[11px]", tone === "critical" ? "text-critical" : tone === "caution" ? "text-caution" : "text-nominal")}>
            {tone === "critical" ? <ShieldAlert className="size-3.5" /> : tone === "caution" ? <AlertTriangle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
            {text}
          </p>
          {chart}
        </>
      ) : (
        <>
          <div className="mt-1.5">{zoneRow}</div>
          {chart}
        </>
      )}
    </article>
  );
}

export function TrendChart({
  points,
  sensor,
  unit,
  className,
}: {
  points: { t: string | number; value: number }[];
  sensor?: string;
  unit?: string;
  className?: string;
}) {
  const t = useT();
  const { locale } = useLocale();
  const fillId = useId().replace(/:/g, "");
  if (points.length < 2) return <p className="text-sm text-muted">{t("vitals.notEnoughPoints")}</p>;
  const timeLocale = locale === "uk" ? "uk-UA" : "en-US";
  const raw = points.length > 180 ? points.filter((_, index) => index % Math.ceil(points.length / 180) === 0 || index === points.length - 1) : points;
  const data = raw.slice(-180).map((point, index) => ({
    i: index,
    t: typeof point.t === "number" ? new Date(point.t * 1000).toLocaleTimeString(timeLocale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : String(point.t),
    value: point.value,
  }));
  const values = data.map((row) => row.value);
  const domain = chartDomain(sensor, values);
  const bands = sensor ? zoneBands(sensor) : null;
  const stroke = sensor ? (bandOf(sensor, values.at(-1)) === "red" ? ZONE.red : bandOf(sensor, values.at(-1)) === "yellow" ? ZONE.yellow : ZONE.green) : "#8eb7ff";
  return (
    <div className={className ?? "h-56"}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgb(36 48 68 / 0.9)" strokeDasharray="3 6" vertical={false} />
          {bands?.yellow && <ReferenceArea y1={bands.yellow[0]} y2={bands.yellow[1]} fill={ZONE.yellow} fillOpacity={0.1} />}
          {bands?.redLow != null && <ReferenceArea y1={domain[0]} y2={bands.redLow} fill={ZONE.red} fillOpacity={0.12} />}
          {bands?.redHigh != null && <ReferenceArea y1={bands.redHigh} y2={domain[1]} fill={ZONE.red} fillOpacity={0.12} />}
          <XAxis dataKey="t" hide />
          <YAxis domain={domain} stroke="#93a4bd" width={48} tick={{ fontSize: 11 }} tickFormatter={axisTick} allowDataOverflow />
          <Tooltip
            contentStyle={{ background: "#101828", border: "1px solid #243044", borderRadius: 10, fontSize: 12 }}
            labelStyle={{ color: "#93a4bd" }}
            formatter={(value) => [`${sensor ? formatVital(sensor, Number(value)) : Number(value).toFixed(1)}${unit ? ` ${unit}` : ""}`, t("common.value")]}
          />
          <Area type="monotone" dataKey="value" stroke="none" fill={`url(#${fillId})`} isAnimationActive={false} />
          <Line type="monotone" dataKey="value" stroke={stroke} dot={false} strokeWidth={2} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function axisTick(value: number) {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3;
  return formatNumber(value, digits);
}

function chartDomain(sensor: string | undefined, values: number[]): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (sensor === "hr") return [Math.min(40, min - 5), Math.max(130, max + 5)];
  if (sensor === "spo2") return [Math.min(85, min - 1), 100];
  if (sensor === "temp") return [Math.min(35, min - 0.2), Math.max(39, max + 0.2)];
  if (sensor === "resp") return [Math.min(6, min - 1), Math.max(28, max + 1)];
  if (sensor === "bp_sys") return [Math.min(80, min - 5), Math.max(150, max + 5)];
  const pad = Math.max((max - min) * 0.15, 1);
  return [min - pad, max + pad];
}

function zoneBands(sensor: string) {
  if (sensor === "hr") return { yellow: [100, 120] as [number, number], redLow: 50, redHigh: 120 };
  if (sensor === "spo2") return { yellow: [91, 94] as [number, number], redLow: undefined as number | undefined, redHigh: 90 };
  if (sensor === "temp") return { yellow: [37.3, 37.9] as [number, number], redLow: 35.5, redHigh: 38 };
  if (sensor === "resp") return { yellow: [21, 24] as [number, number], redLow: 10, redHigh: 24 };
  if (sensor === "bp_sys") return { yellow: [121, 139] as [number, number], redLow: 90, redHigh: 140 };
  return null;
}

export function PenaltyBreakdown({ rows }: { rows: PenaltyRow[] }) {
  const t = useT();
  // SIGNAL_LOST rows stay visible as flags but never feed the penalty bar (penalty≡0).
  const visible = rows.filter((row) => row.penalty > 0 || row.stale || row.suppressed_by_fusion || row.signal_lost);
  if (!visible.length) return <p className="text-sm text-muted">{t("vitals.noPenalty")}</p>;
  const scored = visible.filter((row) => !row.signal_lost && row.penalty > 0);
  const total = scored.reduce((sum, row) => sum + row.penalty, 0) || 1;
  return (
    <div className="space-y-3">
      <div className="flex h-3 overflow-hidden rounded-full bg-track">
        {scored.map((row) => (
          <div key={row.metric} title={`${row.metric}: ${row.penalty.toFixed(1)}`} style={{ width: `${(row.penalty / total) * 100}%`, background: row.penalty >= 35 ? ZONE.red : row.penalty > 0 ? ZONE.yellow : ZONE.green }} />
        ))}
      </div>
      <table className="w-full text-left text-xs">
        <thead className="text-muted"><tr><th className="py-1">{t("vitals.metric")}</th><th>{t("common.value")}</th><th>{t("vitals.baseline")}</th><th>{t("vitals.penalty")}</th><th>{t("vitals.flag")}</th></tr></thead>
        <tbody>
          {visible.map((row) => (
            <tr key={row.metric} className="border-t border-line font-mono">
              <td className="py-1.5">{metricLabel(row.metric, row.metric, t)}</td>
              <td>{row.value ?? "—"}</td>
              <td>{row.baseline ?? "—"}</td>
              <td className={row.penalty >= 35 ? "text-critical" : row.penalty > 0 ? "text-caution" : ""}>{row.penalty.toFixed(1)}</td>
              <td className={row.signal_lost || row.sensor_anomaly ? "text-faint" : undefined}>
                {row.sensor_anomaly || row.anomaly_kind === "fusion" || row.anomaly_kind === "bounds"
                  ? t("vitals.anomalyFlag")
                  : row.signal_lost
                    ? t("vitals.signalLostFlag")
                    : row.stale
                      ? t("vitals.flag.stale")
                      : row.suppressed_by_fusion
                        ? t("vitals.flag.exercise")
                        : row.one_sided
                          ? t("vitals.flag.onesided")
                          : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ORGANS: { key: string; sensors: string[]; cx: number; cy: number; r: number; labelKey: TranslationKey }[] = [
  { key: "head", sensors: ["eeg", "icp"], cx: 60, cy: 22, r: 14, labelKey: "body.head" },
  { key: "chest", sensors: ["hr", "resp", "spo2", "bp_sys"], cx: 60, cy: 58, r: 18, labelKey: "body.chest" },
  { key: "abdomen", sensors: ["glucose", "k", "na", "lactate", "temp"], cx: 60, cy: 92, r: 16, labelKey: "body.abdomen" },
];

export function BodyMap({ zones }: { zones: { id?: string; name: string; zone: string | null }[] }) {
  const t = useT();
  const byId = new Map(zones.map((item) => [item.id ?? item.name, item.zone]));
  const tone = (sensors: string[]) => {
    const ranks = sensors.map((id) => byId.get(id)).map((zone) => (zone === "red" ? 2 : zone === "yellow" ? 1 : 0));
    const rank = Math.max(0, ...ranks);
    return rank === 2 ? ZONE.red : rank === 1 ? ZONE.yellow : ZONE.green;
  };
  return (
    <div className="grid gap-3 sm:grid-cols-[140px_1fr] sm:items-center">
      <svg viewBox="0 0 120 140" className="mx-auto h-44 w-28" role="img" aria-label={t("body.map")}>
        <ellipse cx="60" cy="22" rx="16" ry="18" fill="rgb(142 183 255 / 0.08)" stroke="#31445f" strokeWidth="2" />
        <path d="M42 42 C36 58 34 78 38 108 L48 108 C50 88 52 70 54 52 L66 52 C68 70 70 88 72 108 L82 108 C86 78 84 58 78 42 Z" fill="rgb(142 183 255 / 0.08)" stroke="#31445f" strokeWidth="2" />
        {ORGANS.map((organ) => (
          <circle key={organ.key} cx={organ.cx} cy={organ.cy} r={organ.r} fill={tone(organ.sensors)} fillOpacity={0.35} stroke={tone(organ.sensors)} strokeWidth="2" />
        ))}
      </svg>
      <ul className="grid gap-1.5 text-xs">
        {ORGANS.map((organ) => (
          <li key={organ.key} className="flex items-center justify-between gap-2 rounded-lg border border-line/70 px-2 py-1.5">
            <span>{t(organ.labelKey)}</span>
            <span className="font-mono" style={{ color: tone(organ.sensors) }}>{tone(organ.sensors) === ZONE.red ? t("zone.critical") : tone(organ.sensors) === ZONE.yellow ? t("zone.attention") : t("zone.normal")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EventTimeline({ events }: { events: { ts: number; text: string }[] }) {
  const t = useT();
  const { locale } = useLocale();
  const timeLocale = locale === "uk" ? "uk-UA" : "en-US";
  if (!events.length) return <p className="text-sm text-muted">{t("vitals.noEvents")}</p>;
  return (
    <ol className="space-y-2 text-sm">
      {events.map((event) => <li key={`${event.ts}-${event.text}`} className="border-l border-line pl-3"><span className="font-mono text-[11px] text-muted">{new Date(event.ts * 1000).toLocaleTimeString(timeLocale)}</span> {event.text}</li>)}
    </ol>
  );
}

export function SignalDelayBar({ label }: { label: string }) {
  const t = useT();
  return <p className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-ink">{t("vitals.signalDelay", { label })}</p>;
}

export function BreakGlassBanner() {
  const t = useT();
  return (
    <p className="flex items-center gap-2 rounded-lg bg-critical/15 px-3 py-2 text-sm text-critical">
      <ShieldAlert className="size-4" /> {t("vitals.breakGlass")}
    </p>
  );
}

export function EmergencyChecklist({ steps, onAdd }: { steps: { id: number; text: string; done: number }[]; onAdd: (text: string) => void }) {
  const t = useT();
  const [text, setText] = useState("");
  return (
    <div className="space-y-2">
      <ul className="space-y-1 text-sm">
        {steps.map((step) => <li key={step.id} className="flex gap-2"><CheckCircle2 className={clsx("mt-0.5 size-4", step.done ? "text-nominal" : "text-faint")} />{step.text}</li>)}
      </ul>
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (!text.trim()) return; onAdd(text.trim()); setText(""); }}>
        <input value={text} onChange={(event) => setText(event.target.value)} className="flex-1 rounded-lg border border-line bg-panel px-2 py-1 text-sm" placeholder={t("vitals.protocolStep")} />
        <button className="rounded-lg bg-accent px-3 text-sm text-accent-ink" type="submit">{t("vitals.add")}</button>
      </form>
    </div>
  );
}

export function BreathingTimer() {
  const t = useT();
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (left == null) return;
    if (left <= 0) return;
    const timer = window.setTimeout(() => setLeft(left - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [left]);
  const phase = left == null ? null : left > 15 ? t("vitals.inhale") : left > 8 ? t("vitals.hold") : left > 0 ? t("vitals.exhale") : t("vitals.done");
  return (
    <button type="button" className="rounded-lg border border-line px-3 py-1.5 text-xs" onClick={() => setLeft(4 + 7 + 8)}>
      {left == null ? t("vitals.breathing") : left > 0 ? t("vitals.breathingLeft", { phase: phase ?? "", left }) : t("vitals.done")}
    </button>
  );
}

export function LockNote() {
  const t = useT();
  return <p className="flex items-center gap-2 text-sm text-muted"><Lock className="size-4" /> {t("vitals.lockNote")}</p>;
}
