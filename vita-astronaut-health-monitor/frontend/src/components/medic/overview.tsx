"use client";

import clsx from "clsx";
import { Activity } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Card, ErrorState, PageHeader, Segmented } from "@/components/ui/primitives";
import { useErrnoAllAlerts, useErrnoAllRangeAlerts, useErrnoAstronauts, useErrnoFleetStatus, useErrnoMetrics } from "@/lib/api/errno";
import { useT } from "@/lib/locale";
import { formatNumber, formatVital, initials, unitOf } from "@/lib/number";
import { isFormPending, isSignalLost } from "@/lib/validate-sensor";
import { bandOf } from "@/lib/zones";
import { TONE_KEY, latestOf, toneOf, type Tone } from "./clinical";
import type { TranslationKey } from "@/lib/translations";

const TONE_STYLE: Record<Tone, string> = {
  Nominal: "bg-nominal/[0.08] text-nominal ring-nominal/20",
  Caution: "bg-caution/[0.09] text-caution ring-caution/25",
  Critical: "bg-critical/[0.09] text-critical ring-critical/25",
  Unknown: "bg-panel-raised text-muted ring-line",
};

const BAR: Record<Tone, string> = {
  Nominal: "bg-nominal",
  Caution: "bg-caution",
  Critical: "bg-critical",
  Unknown: "bg-faint",
};

const TABLE_COLS: TranslationKey[] = [
  "medic.col.astronaut",
  "medic.col.state",
  "medic.col.hr",
  "medic.col.spo2",
  "medic.col.bp",
  "medic.col.temp",
  "medic.col.resp",
  "medic.col.score",
  "medic.col.testsSleep",
];

export function MedicOverview() {
  const t = useT();
  const crew = useErrnoAstronauts();
  const metrics = useErrnoMetrics();
  const statuses = useErrnoFleetStatus();
  const alerts = useErrnoAllAlerts(true);
  const ranges = useErrnoAllRangeAlerts();
  const people = crew.data ?? [];
  const [attention, setAttention] = useState(false);

  const rows = useMemo(() => {
    const byStatus = new Map((statuses.data ?? []).map((item) => [item.astronaut_id, item]));
    return people.map((person) => {
      const hr = latestOf(metrics.data, person.id, "hr");
      const spo2 = latestOf(metrics.data, person.id, "spo2");
      const sys = latestOf(metrics.data, person.id, "bp_sys");
      const dia = latestOf(metrics.data, person.id, "bp_dia");
      const temp = latestOf(metrics.data, person.id, "temp");
      const resp = latestOf(metrics.data, person.id, "resp");
      const sleepHours = latestOf(metrics.data, person.id, "sleep_hours");
      const sleepQuality = latestOf(metrics.data, person.id, "sleep_quality");
      const psych = latestOf(metrics.data, person.id, "psych_score") ?? latestOf(metrics.data, person.id, "mh_score");
      const out = (metrics.data ?? []).filter((metric) => metric.latest.some((item) => item.astronaut_id === person.id && item.alert)).length;
      const status = byStatus.get(person.id);
      const tone = toneOf(status, Boolean(hr || spo2 || temp), out);
      return { person, hr, spo2, sys, dia, temp, resp, sleepHours, sleepQuality, psych, status, tone, out };
    });
  }, [people, metrics.data, statuses.data]);

  const visible = attention ? rows.filter((row) => row.tone === "Critical" || row.tone === "Caution") : rows;
  const counts = {
    Nominal: rows.filter((row) => row.tone === "Nominal").length,
    Caution: rows.filter((row) => row.tone === "Caution").length,
    Critical: rows.filter((row) => row.tone === "Critical").length,
    Unknown: rows.filter((row) => row.tone === "Unknown").length,
  };
  const scored = rows.map((row) => row.status?.score).filter((score): score is number => score != null);
  const average = scored.length ? scored.reduce((sum, score) => sum + score, 0) / scored.length : null;
  const worst = rows.reduce<{ name: string; score: number } | null>((best, row) => {
    if (row.status?.score == null) return best;
    if (!best || row.status.score < best.score) return { name: row.person.name, score: row.status.score };
    return best;
  }, null);
  const escalated = (alerts.data ?? []).filter((alert) => alert.level === "act").length;
  const open = (alerts.data ?? []).length + (ranges.data ?? []).length;
  const live = (metrics.data ?? []).reduce((sum, metric) => sum + metric.latest.length, 0);

  return (
    <div className="space-y-5">
      {escalated > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-critical/35 bg-critical/[0.08] px-4 py-2.5 text-sm">
          <span className="text-critical">{t("medic.criticalWaiting", { count: escalated })}</span>
          <Link href="/medic/alerts" className="rounded-md border border-critical/30 bg-panel px-3 py-1 text-xs font-medium text-critical hover:bg-critical/10">{t("medic.viewAlerts")}</Link>
        </div>
      )}

      <PageHeader
        eyebrow={t("medic.postEyebrow")}
        title={t("nav.overview")}
        subtitle={t("medic.crewSubtitle", { count: people.length })}
        action={<span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-muted"><span className={clsx("size-2 rounded-full", metrics.isError ? "bg-critical" : metrics.data ? "bg-nominal" : "bg-caution animate-pulse")} />{metrics.data ? t("medic.live") : t("medic.connecting")}</span>}
      />

      {crew.isError && <ErrorState error={crew.error} onRetry={() => void crew.refetch()} />}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t("medic.crewHealth")} value={`${counts.Nominal}`} hint={t("medic.ofNominal", { count: rows.length })}>
          <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-track">
            {(["Critical", "Caution", "Unknown", "Nominal"] as Tone[]).filter((tone) => counts[tone]).map((tone) => (
              <div key={tone} className={BAR[tone]} style={{ width: `${(counts[tone] / Math.max(rows.length, 1)) * 100}%` }} />
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">{t("medic.crewHealthBreakdown", { critical: counts.Critical, caution: counts.Caution, unknown: counts.Unknown })}</p>
        </Stat>
        <Stat label={t("medic.openAlerts")} value={alerts.isPending ? "—" : String(open)} hint={t("medic.alertsBreakdown", { critical: escalated, ranges: (ranges.data ?? []).length })} valueClass={open ? "text-critical" : undefined} />
        <Stat label={t("medic.avgScore")} value={average == null ? "—" : formatNumber(average, 1)} hint={worst ? t("medic.lowestScore", { name: worst.name, score: formatNumber(worst.score, 1) }) : t("medic.scoreAfter")} suffix="/ 100" />
        <Stat label={t("medic.readings")} value={String(live)} hint={t("medic.readingsHint")} icon />
      </div>

      <Card className="p-0">
        <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-5">
          <div>
            <h2 className="text-[13.5px] font-semibold">{t("medic.crewReadings")}</h2>
            <p className="mt-0.5 text-xs text-muted">{t("medic.crewReadingsDesc")}</p>
          </div>
          <Segmented
            label={t("medic.filterCrew")}
            size="sm"
            value={attention ? "attention" : "all"}
            onChange={(value) => setAttention(value === "attention")}
            options={[
              { value: "all", label: t("medic.allCrew", { count: rows.length }) },
              { value: "attention", label: t("medic.needAttention", { count: counts.Critical + counts.Caution }) },
            ]}
          />
        </div>
        {crew.isPending || metrics.isPending ? <p className="px-5 py-10 text-sm text-muted">{t("medic.gatheringReadings")}</p> : visible.length === 0 ? <p className="px-5 py-10 text-sm text-muted">{attention ? t("medic.noOutOfRange") : t("medic.emptyCrew")}</p> : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="text-[11px] font-medium tracking-wide text-faint uppercase">
                <tr className="border-y border-line">
                  {TABLE_COLS.map((key) => (
                    <th key={key} className="px-4 py-2.5 font-medium first:pl-5 last:pr-5">{t(key)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.person.id} className="border-b border-line last:border-0 hover:bg-panel-raised/70">
                    <td className="px-5 py-3">
                      <Link href={`/medic/crew/${row.person.id}`} className="flex items-center gap-3">
                        <span className="grid size-9 place-items-center rounded-full bg-panel-raised text-[12px] font-semibold ring-1 ring-line ring-inset">{initials(row.person.name)}</span>
                        <span>
                          <span className="block font-medium">{row.person.name}</span>
                          <span className="block text-[11px] text-muted">{row.person.role || row.person.id}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-4"><span className={clsx("inline-flex rounded-md px-2 py-0.5 text-[12px] font-medium ring-1 ring-inset", TONE_STYLE[row.tone])}>{t(TONE_KEY[row.tone])}</span></td>
                    <Cell band={mark("hr", row.hr?.value.value, row.hr?.value.alert)} text={cellText("hr", row.hr?.value.value)} />
                    <Cell band={mark("spo2", row.spo2?.value.value, row.spo2?.value.alert)} text={cellText("spo2", row.spo2?.value.value, "%")} />
                    <Cell band={mark("bp_sys", row.sys?.value.value, row.sys?.value.alert || row.dia?.value.alert)} text={row.sys && row.dia ? (isSignalLost("bp_sys", row.sys.value.value) || row.sys.value.value === 0 ? t("vitals.noSignal") : `${formatVital("bp_sys", row.sys.value.value)}/${formatVital("bp_dia", row.dia.value.value)}`) : "—"} />
                    <Cell band={mark("temp", row.temp?.value.value, row.temp?.value.alert)} text={cellText("temp", row.temp?.value.value, "°")} />
                    <Cell band={mark("resp", row.resp?.value.value, row.resp?.value.alert)} text={cellText("resp", row.resp?.value.value)} />
                    <td className="px-4 tnum font-medium">{row.status?.score == null ? "—" : formatNumber(row.status.score, 1)}</td>
                    <td className="px-5 py-2">
                      <div className="space-y-0.5 text-[12px] leading-snug">
                        <p className={clsx("tnum", row.sleepHours?.value.alert && "font-semibold text-critical")}>
                          {row.sleepHours
                            ? `${formatVital("sleep_hours", row.sleepHours.value.value)} ${unitOf("sleep_hours")}`
                            : t("medic.sleepDash")}
                        </p>
                        <p className={clsx("tnum text-muted", row.sleepQuality?.value.alert && "font-semibold text-critical")}>
                          {t("training.qualityShort")} {row.sleepQuality ? formatVital("sleep_quality", row.sleepQuality.value.value) : "—"}
                          {row.psych ? ` · ${t("medic.surveyWord")} ${formatVital(row.psych.metric.id, row.psych.value.value)}${row.psych.metric.id === "psych_score" ? "%" : ""}` : ""}
                        </p>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, hint, suffix, valueClass, icon, children }: { label: string; value: string; hint: string; suffix?: string; valueClass?: string; icon?: boolean; children?: ReactNode }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={clsx("mt-2 flex items-baseline gap-1 text-[28px] leading-none font-semibold tracking-tight tnum", valueClass)}>
        {value}
        {suffix && <span className="text-sm font-medium text-muted">{suffix}</span>}
        {icon && <Activity className="ml-auto size-4 text-accent" />}
      </p>
      {children ?? <p className="mt-2 text-[11px] text-muted">{hint}</p>}
    </Card>
  );
}

function mark(sensor: string, value?: number, alert?: boolean) {
  if (value == null || isFormPending(sensor, value)) return "pending";
  if (value === 0 && isSignalLost(sensor, value)) return "lost";
  if (isSignalLost(sensor, value)) return "anomaly";
  const band = bandOf(sensor, value);
  if (band === "red" || (!band && alert)) return "red";
  if (band === "yellow") return "yellow";
  return "green";
}

function cellText(sensor: string, value?: number, suffix = "") {
  if (value == null || isFormPending(sensor, value)) return "—";
  if (isSignalLost(sensor, value)) return "N/A";
  const n = formatVital(sensor, value);
  if (suffix === "%") return `${n} %`;
  if (suffix === "°") return `${n}°`;
  return n;
}

function Cell({ text, band }: { text: string; band?: string }) {
  return <td className={clsx("px-4 tnum", band === "red" && "font-semibold text-critical", band === "yellow" && "font-semibold text-caution", (band === "lost" || band === "anomaly" || band === "pending") && "text-faint")}>{text}</td>;
}