"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { RoleGate } from "@/components/auth/role-gate";
import { BreakGlassBanner, EmergencyChecklist, PenaltyBreakdown, VitalCard } from "@/components/mission/widgets";
import { Card } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import { useIncidents, useErrnoMetrics } from "@/lib/api/errno";
import { metricLabel, useT } from "@/lib/locale";
import { formatVital, unitOf } from "@/lib/number";
import { anomalyKindOf, isSensorFault } from "@/lib/validate-sensor";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export default function IncidentPage() {
  return <RoleGate roles={["officer"]}><Incident /></RoleGate>;
}

function Incident() {
  const t = useT();
  const params = useParams<{ id: string }>();
  const incidents = useIncidents();
  const incident = (incidents.data ?? []).find((item) => String(item.id) === params.id);
  const metrics = useErrnoMetrics();
  const client = useQueryClient();
  const emergency = useQuery({
    queryKey: ["errno-emergency", incident?.astronaut_id],
    queryFn: () => api.get<{ rows: { metric: string; penalty: number; value: number | null }[]; steps: { id: number; text: string; done: number }[]; protocols: { metric: string; protocol: string }[]; note: string }>(`/emergency/${incident?.astronaut_id}`),
    enabled: Boolean(incident?.astronaut_id),
  });
  const [note, setNote] = useState("");
  if (!incident) return <Card>{t("captain.incidentMissing")}</Card>;
  const id = incident.astronaut_id;
  return (
    <div className="space-y-4">
      <BreakGlassBanner />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(metrics.data ?? []).flatMap((metric) => {
          const value = metric.latest.find((item) => item.astronaut_id === id);
          if (!value) return [];
          const peers: Record<string, number | undefined> = {};
          for (const m of metrics.data ?? []) {
            const hit = m.latest.find((item) => item.astronaut_id === id);
            if (hit) peers[m.id] = hit.value;
          }
          const kind = value.anomaly_kind ?? anomalyKindOf(metric.id, value.value, peers);
          const fault = Boolean(value.signal_lost || value.sensor_anomaly || kind || isSensorFault(metric.id, value.value, peers));
          return [
            <VitalCard
              key={metric.id}
              name={metricLabel(metric.id, metric.name_uk, t)}
              value={fault ? t("vitals.noSignal") : formatVital(metric.id, value.value)}
              unit={unitOf(metric.id, metric.unit)}
              zone={fault ? null : value.zone ?? null}
              points={fault ? [] : [value.value]}
              rawValue={value.value}
              signalLost={fault}
              sensorAnomaly={kind === "bounds" || kind === "fusion"}
              anomalyKind={kind}
            />,
          ];
        })}
      </div>
      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold">{t("captain.penalty")}</h2>
        <PenaltyBreakdown rows={(emergency.data?.rows ?? []).map((row) => ({ ...row, baseline: null, deviation: 0, one_sided: false, suppressed_by_fusion: false, stale: false }))} />
        <ul className="space-y-1 text-sm">{(emergency.data?.protocols ?? []).map((item) => <li key={item.metric}><strong>{item.metric}.</strong> {item.protocol}</li>)}</ul>
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">{t("captain.checklist")}</h2>
        <EmergencyChecklist steps={emergency.data?.steps ?? []} onAdd={async (text) => { await api.post(`/incidents/${incident.id}/steps`, { text, done: false }); await client.invalidateQueries({ queryKey: ["errno-emergency", id] }); }} />
      </Card>
      <Card className="space-y-2 p-4">
        <p className="text-sm text-muted">{emergency.data?.note}</p>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} className="w-full rounded-lg border border-line bg-panel p-2 text-sm" placeholder={t("captain.earthNotePlaceholder")} />
        <div className="flex gap-2">
          <button
            className="rounded-lg border border-line px-3 py-1 text-sm"
            onClick={async () => {
              await api.post("/actions", { astronaut_id: id, alert_id: 0, action: note.trim() || t("captain.officerActionFallback") });
              setNote("");
              await client.invalidateQueries({ queryKey: ["errno-earth-actions"] });
            }}
          >
            {t("captain.sendEarth")}
          </button>
          <button
            className="rounded-lg bg-critical px-3 py-1 text-sm text-white"
            onClick={async () => {
              const text = note.trim();
              if (text) {
                await api.post("/actions", { astronaut_id: id, alert_id: 0, action: text });
              }
              await api.post(`/incidents/${incident.id}/close`);
              setNote("");
              await Promise.all([
                client.invalidateQueries({ queryKey: ["errno-incidents"] }),
                client.invalidateQueries({ queryKey: ["errno-earth-actions"] }),
              ]);
            }}
          >
            {t("captain.closeIncident")}
          </button>
        </div>
      </Card>
    </div>
  );
}