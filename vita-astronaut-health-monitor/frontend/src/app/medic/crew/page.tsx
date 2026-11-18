"use client";

import clsx from "clsx";
import Link from "next/link";
import { RoleGate } from "@/components/auth/role-gate";
import { TONE_KEY, latestOf, toneOf, type Tone } from "@/components/medic/clinical";
import { Card, ErrorState, PageHeader } from "@/components/ui/primitives";
import { useErrnoAstronauts, useErrnoFleetStatus, useErrnoMetrics } from "@/lib/api/errno";
import { useT } from "@/lib/locale";
import { formatVital, initials } from "@/lib/number";

const RING: Record<Tone, string> = {
  Nominal: "ring-nominal/30",
  Caution: "ring-caution/40",
  Critical: "ring-critical/40",
  Unknown: "ring-line",
};

export default function CrewPage() {
  return (
    <RoleGate roles={["doctor", "chief"]}>
      <CrewGrid />
    </RoleGate>
  );
}

function CrewGrid() {
  const t = useT();
  const crew = useErrnoAstronauts();
  const metrics = useErrnoMetrics();
  const statuses = useErrnoFleetStatus();
  const byStatus = new Map((statuses.data ?? []).map((item) => [item.astronaut_id, item]));

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t("medic.crew")} title={t("medic.astronauts")} subtitle={t("medic.crewCardSubtitle")} />
      {crew.isError && <ErrorState error={crew.error} onRetry={() => void crew.refetch()} />}
      {crew.isPending ? <p className="text-sm text-muted">{t("medic.loadingCrew")}</p> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(crew.data ?? []).map((person) => {
            const hr = latestOf(metrics.data, person.id, "hr");
            const spo2 = latestOf(metrics.data, person.id, "spo2");
            const temp = latestOf(metrics.data, person.id, "temp");
            const out = (metrics.data ?? []).filter((metric) => metric.latest.some((item) => item.astronaut_id === person.id && item.alert)).length;
            const tone = toneOf(byStatus.get(person.id), Boolean(hr || spo2 || temp), out);
            const score = byStatus.get(person.id)?.score;
            return (
              <Link key={person.id} href={`/medic/crew/${person.id}`}>
                <Card className={clsx("h-full p-4 ring-1 transition-colors hover:bg-panel-raised", RING[tone])}>
                  <div className="flex items-center gap-3">
                    <span className="grid size-11 place-items-center rounded-full bg-panel-raised text-sm font-semibold ring-1 ring-line ring-inset">{initials(person.name)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{person.name}</span>
                      <span className="block text-xs text-muted">{person.role || person.id}</span>
                    </span>
                    <span className="text-xs font-medium text-muted">{t(TONE_KEY[tone])}</span>
                  </div>
                  <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <Tile label={t("medic.col.hr")} value={hr ? formatVital("hr", hr.value.value) : "—"} alert={hr?.value.alert} />
                    <Tile label={t("medic.col.spo2")} value={spo2 ? `${formatVital("spo2", spo2.value.value)}%` : "—"} alert={spo2?.value.alert} />
                    <Tile label={t("medic.tempShort")} value={temp ? `${formatVital("temp", temp.value.value)}°` : "—"} alert={temp?.value.alert} />
                  </dl>
                  <p className="mt-3 text-[11px] text-muted">{t("medic.scoreOutOfRange", { score: score == null ? "—" : score.toLocaleString(undefined, { maximumFractionDigits: 1 }), count: out })}</p>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="rounded-lg bg-panel-raised px-2 py-2">
      <dt className="text-[10px] text-muted">{label}</dt>
      <dd className={clsx("mt-0.5 text-sm font-semibold tnum", alert && "text-critical")}>{value}</dd>
    </div>
  );
}