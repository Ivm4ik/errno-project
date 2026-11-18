"use client";

import { useState } from "react";
import clsx from "clsx";
import { Activity, LineChart } from "lucide-react";
import { RoleGate } from "@/components/auth/role-gate";
import { SensorBoard } from "@/components/mission/sensor-board";
import { SensorChartsWorkspace } from "@/components/mission/sensor-charts";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/locale";

type PageTab = "charts" | "board";

export default function SensorsPage() {
  return (
    <RoleGate roles={["astronaut", "officer"]}>
      <Panel />
    </RoleGate>
  );
}

function Panel() {
  const t = useT();
  const { user } = useAuth();
  const id = user?.astronaut_id ?? "";
  const [tab, setTab] = useState<PageTab>("charts");
  const boardTitle = user?.role === "officer" ? t("sensors.titleOfficer") : t("sensors.titleAstronaut");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium tracking-wide text-muted uppercase">{t("sensors.chartsEyebrow")}</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">
            {tab === "charts" ? t("sensors.chartsTitle") : boardTitle}
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            {tab === "charts" ? t("sensors.dash.subtitle") : t("sensors.desc")}
          </p>
        </div>
        <div className="inline-flex rounded-xl border border-line bg-panel/70 p-1">
          {(
            [
              { id: "charts" as const, label: t("sensors.page.charts"), icon: LineChart },
              { id: "board" as const, label: t("sensors.page.board"), icon: Activity },
            ]
          ).map(({ id: tabId, label, icon: Icon }) => (
            <button
              key={tabId}
              type="button"
              onClick={() => setTab(tabId)}
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition",
                tab === tabId ? "bg-accent text-accent-ink" : "text-muted hover:text-ink",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "charts" ? <SensorChartsWorkspace astronautId={id} /> : <SensorBoard astronautId={id} title={boardTitle} />}
    </div>
  );
}
