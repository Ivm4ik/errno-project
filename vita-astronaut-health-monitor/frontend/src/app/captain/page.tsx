"use client";

import { Activity, LayoutDashboard, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { RoleGate } from "@/components/auth/role-gate";
import { AstronautConsole } from "@/components/mission/astronaut-console";
import { MissionTabs } from "@/components/mission/mission-tabs";
import { LockNote } from "@/components/mission/widgets";
import { SensorBoard } from "@/components/mission/sensor-board";
import { Card } from "@/components/ui/primitives";
import { useIncidents, useReadiness } from "@/lib/api/errno";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/locale";

export default function CaptainPage() {
  return <RoleGate roles={["officer"]}><Watch /></RoleGate>;
}

function Watch() {
  const t = useT();
  const [tab, setTab] = useState<"me" | "crew" | "sensors">("me");
  const { user } = useAuth();
  const id = user?.astronaut_id ?? "";
  const readiness = useReadiness();
  const incidents = useIncidents();
  const critical = (readiness.data ?? []).find((person) => person.readiness === "red-breakglass" && person.astronaut_id !== id);

  return (
    <div className="space-y-5">
      <MissionTabs
        value={tab}
        onChange={setTab}
        items={[
          { id: "me", label: t("captain.tab.me"), hint: t("captain.tab.meHint"), icon: LayoutDashboard },
          { id: "crew", label: t("captain.tab.crew"), hint: t("captain.tab.crewHint"), icon: Users },
          { id: "sensors", label: t("captain.tab.sensors"), hint: t("captain.tab.sensorsHint"), icon: Activity },
        ]}
      />

      {tab === "me" ? <AstronautConsole astronautId={id} /> : null}

      {tab === "crew" ? (
        <div className="space-y-3">
          <LockNote />
          <p className="text-sm text-muted">{t("captain.crewPrivacy")}</p>
          <div className="grid gap-3 md:grid-cols-2">
            {(readiness.data ?? []).map((person) => {
              const open = (incidents.data ?? []).find((item) => item.astronaut_id === person.astronaut_id && item.break_glass && !item.closed_at);
              const self = person.astronaut_id === id;
              return (
                <Card key={person.astronaut_id} className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-medium">{person.name}{self ? t("captain.selfTag") : ""}</p>
                    <p className="text-xs text-muted">
                      {person.readiness === "red-breakglass"
                        ? t("captain.readiness.critical")
                        : person.readiness === "yellow"
                          ? t("captain.readiness.caution")
                          : t("captain.readiness.nominal")}
                    </p>
                  </div>
                  {person.readiness === "red-breakglass" && open ? (
                    <Link className="rounded-lg bg-critical/15 px-3 py-1.5 text-sm text-critical" href={`/captain/incident/${open.id}`}>
                      {self ? t("captain.myData") : t("captain.open")}
                    </Link>
                  ) : null}
                </Card>
              );
            })}
          </div>
        </div>
      ) : null}

      {tab === "sensors" ? (
        <div className="space-y-5">
          <SensorBoard astronautId={id} title={t("captain.sensorsOfficer")} />
          {critical ? (
            <SensorBoard astronautId={critical.astronaut_id} title={t("captain.sensorsCrew", { name: critical.name })} />
          ) : (
            <Card className="p-4 text-sm text-muted">{t("captain.sensorsBreakglassNote")}</Card>
          )}
        </div>
      ) : null}
    </div>
  );
}