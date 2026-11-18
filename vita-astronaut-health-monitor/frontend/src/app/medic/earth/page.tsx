"use client";

import { RoleGate } from "@/components/auth/role-gate";
import { EventTimeline, SignalDelayBar } from "@/components/mission/widgets";
import { Card } from "@/components/ui/primitives";
import { useEarthActions, useEarthPackets, usePublicConfig, useWarningLog } from "@/lib/api/errno";
import { useT } from "@/lib/locale";

export default function EarthPage() {
  return (
    <RoleGate roles={["doctor", "chief"]}>
      <Earth />
    </RoleGate>
  );
}

function Earth() {
  const t = useT();
  const config = usePublicConfig();
  const packets = useEarthPackets();
  const actions = useEarthActions();
  const warnings = useWarningLog();
  return (
    <div className="space-y-4">
      <SignalDelayBar label={config.data?.signal_delay_label ?? "0"} />

      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold">{t("medic.earthMessages")}</h2>
        <p className="text-xs text-muted">{t("medic.earthMessagesDesc")}</p>
        {(actions.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">{t("medic.noMessagesYet")}</p>
        ) : (
          <div className="grid gap-2">
            {(actions.data ?? []).map((item) => (
              <div key={item.id} className="rounded-lg border border-line bg-panel/60 px-3 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted">
                  <span>
                    {item.astronaut_id ?? "—"} · {item.actor ?? t("medic.officerFallback")}
                  </span>
                  {item.in_transit ? (
                    <span className="font-mono text-caution">{t("medic.inTransit", { eta: Math.ceil(item.eta_sec) })}</span>
                  ) : (
                    <span className="text-nominal">{t("medic.delivered")}</span>
                  )}
                </div>
                <p className="mt-1 text-sm whitespace-pre-wrap">{item.action || "—"}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-3">
        <h2 className="text-sm font-semibold">{t("medic.telemetryPackets")}</h2>
        {(packets.data ?? []).map((packet) => (
          <Card key={packet.id} className="p-4">
            <p className="text-sm font-medium">{packet.astronaut_id}</p>
            {packet.in_transit ? (
              <p className="mt-2 font-mono text-sm text-caution">{t("medic.signalInTransit", { eta: Math.ceil(packet.eta_sec) })}</p>
            ) : (
              <div className="mt-2 animate-fade-in space-y-1 text-sm">
                {(packet.payload?.surgeon ?? []).map((item) => (
                  <p key={item.metric}>
                    <strong>{item.metric}.</strong> {item.text}
                  </p>
                ))}
                {!packet.payload?.surgeon?.length && <p>{t("medic.packetOpen")}</p>}
              </div>
            )}
          </Card>
        ))}
      </div>
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">{t("medic.warningLog")}</h2>
        <EventTimeline
          events={(warnings.data ?? []).slice(0, 20).map((item) => ({
            ts: item.ts,
            text: `${item.astronaut_id} ${item.metric}: ${item.message}`,
          }))}
        />
      </Card>
    </div>
  );
}