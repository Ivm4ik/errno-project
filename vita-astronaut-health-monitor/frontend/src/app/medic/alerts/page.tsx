"use client";

import { CheckCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { RoleGate } from "@/components/auth/role-gate";
import { Card, CardTitle, EmptyState, ErrorState, PageHeader } from "@/components/ui/primitives";
import { useAcknowledgeErrnoAlert, useErrnoAllAlerts, useErrnoAllRangeAlerts, useErrnoAstronauts } from "@/lib/api/errno";
import { useT } from "@/lib/locale";
import { formatVital, formatWhen } from "@/lib/number";

export default function AlertsPage() {
  return (
    <RoleGate roles={["doctor", "chief"]}>
      <AlertsBoard />
    </RoleGate>
  );
}

function AlertsBoard() {
  const t = useT();
  const alerts = useErrnoAllAlerts(true);
  const ranges = useErrnoAllRangeAlerts();
  const crew = useErrnoAstronauts();
  const name = new Map((crew.data ?? []).map((person) => [person.id, person.name]));
  const acknowledge = useAcknowledgeErrnoAlert("all");

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t("medic.postEyebrow")} title={t("nav.alerts")} subtitle={t("medic.alertsSubtitle")} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardTitle description={t("medic.clinicalAlertsDesc")}>{t("medic.clinicalAlerts")}</CardTitle>
          {alerts.isPending ? <p className="text-sm text-muted">{t("common.loading")}</p> : alerts.isError ? <ErrorState error={alerts.error} onRetry={() => void alerts.refetch()} /> : alerts.data?.length ? (
            <ul className="divide-y divide-line">
              {alerts.data.map((alert) => (
                <li key={alert.id} className="flex items-start gap-3 py-3">
                  <TriangleAlert className={alert.level === "act" ? "mt-0.5 size-4 text-critical" : "mt-0.5 size-4 text-caution"} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{alert.message}</p>
                    <p className="mt-0.5 text-[11px] text-muted">{name.get(alert.astronaut_id) ?? alert.astronaut_id} · {alert.sensor_id} · {formatWhen(alert.ts)}</p>
                  </div>
                  <button type="button" onClick={() => acknowledge.mutate(alert.id)} className="rounded-lg border border-line px-2.5 py-1.5 text-xs hover:bg-panel-raised">
                    <CheckCheck className="mr-1 inline size-3.5" />{t("medic.confirm")}
                  </button>
                </li>
              ))}
            </ul>
          ) : <EmptyState title={t("medic.noClinicalAlertsEmpty")} />}
        </Card>
        <Card>
          <CardTitle description={t("medic.outOfBoundsDesc")}>{t("medic.outOfBounds")}</CardTitle>
          {ranges.isPending ? <p className="text-sm text-muted">{t("common.loading")}</p> : ranges.isError ? <ErrorState error={ranges.error} onRetry={() => void ranges.refetch()} /> : ranges.data?.length ? (
            <ul className="divide-y divide-line">
              {ranges.data.map((item) => (
                <li key={`${item.astronaut_id}-${item.sensor_id}`} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{name.get(item.astronaut_id) ?? item.astronaut_id}</p>
                    <p className="text-[11px] text-muted">{t("medic.boundsLine", { sensor: item.sensor_id, min: formatVital(item.sensor_id, item.min), max: formatVital(item.sensor_id, item.max) })}</p>
                  </div>
                  <Link href={`/medic/crew/${item.astronaut_id}`} className="text-right">
                    <span className="block text-sm font-semibold text-critical tnum">{formatVital(item.sensor_id, item.value)}</span>
                    <span className="text-[11px] text-muted">{formatWhen(item.ts)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <EmptyState title={t("medic.allInBounds")} />}
        </Card>
      </div>
    </div>
  );
}