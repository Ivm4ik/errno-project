"use client";

import clsx from "clsx";
import { Activity, Cable, Cpu, ExternalLink, Waves } from "lucide-react";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardTitle } from "@/components/ui/primitives";
import { api, withQuery } from "@/lib/api/client";
import { useLiveOnline } from "@/lib/live";
import { metricLabel, useT } from "@/lib/locale";
import { formatVital, formatWhen, unitOf } from "@/lib/number";

export interface BoardSensor {
  id: string;
  name_uk: string;
  unit: string;
  group: string;
  value: number | null;
  ts: number | null;
  age_sec: number | null;
  link: "live" | "stale" | "offline";
  source: string | null;
  device_id: string | null;
}

interface BoardResponse {
  astronaut_id: string;
  kind: string;
  demo: boolean;
  summary: { total: number; live: number; stale: number; offline: number };
  sensors: BoardSensor[];
}

const LINK_STYLE = {
  live: { className: "text-nominal", dot: "bg-nominal shadow-[0_0_10px_#2ECC8F]" },
  stale: { className: "text-caution", dot: "bg-caution shadow-[0_0_10px_#F5B642]" },
  offline: { className: "text-faint", dot: "bg-faint" },
} as const;

const GENERATOR_URL = process.env.NEXT_PUBLIC_GENERATOR_URL || "http://127.0.0.1:8100";

/** Read-only status of ship sensors. Generation lives in the separate generator web app. */
export function SensorBoard({ astronautId, title }: { astronautId: string; title?: string }) {
  const t = useT();
  const boardTitle = title ?? t("sensors.title");
  const linkLabel = { live: t("sensors.live"), stale: t("sensors.stale"), offline: t("sensors.offline") };
  const live = useLiveOnline();
  const board = useQuery({
    queryKey: ["errno-sensors-board", astronautId],
    queryFn: () => api.get<BoardResponse>(withQuery("/sensors/board", { astronaut_id: astronautId })),
    enabled: Boolean(astronautId),
    // WebSocket /live pushes invalidate the cache; poll is only a backstop.
    refetchInterval: live ? 12_000 : 2_000,
  });

  const sensors = board.data?.sensors ?? [];
  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, BoardSensor[]>();
    for (const sensor of sensors) {
      if (!map.has(sensor.group)) {
        map.set(sensor.group, []);
        order.push(sensor.group);
      }
      map.get(sensor.group)!.push(sensor);
    }
    return order.map((group) => ({ group, items: map.get(group)! }));
  }, [sensors]);
  const summary = board.data?.summary;

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden p-0">
        <div className="border-b border-line bg-[radial-gradient(circle_at_top_right,rgb(142_183_255_/_0.12),transparent_55%)] px-5 py-4">
          <CardTitle
            description={t("sensors.desc")}
            action={
              <a
                href={GENERATOR_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink"
              >
                <ExternalLink className="size-3.5" /> {t("sensors.openGenerator")}
              </a>
            }
          >
            <span className="inline-flex items-center gap-2"><Cpu className="size-4 text-accent" />{boardTitle}</span>
          </CardTitle>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Stat pill={t("sensors.total")} value={summary?.total ?? 0} />
            <Stat pill="live" value={summary?.live ?? 0} tone="nominal" />
            <Stat pill={t("sensors.stale")} value={summary?.stale ?? 0} tone="caution" />
            <Stat pill={t("sensors.offline")} value={summary?.offline ?? 0} />
          </div>
        </div>

        <div className="space-y-5 p-5">
          {board.isPending ? <p className="text-sm text-muted">{t("sensors.loading")}</p> : null}
          {board.isError ? <p className="text-sm text-critical">{t("sensors.error")}</p> : null}
          {groups.map(({ group, items }) => (
            <section key={group} className="space-y-3">
              <h3 className="flex items-center gap-2 text-xs font-semibold tracking-[0.08em] text-muted uppercase">
                <Waves className="size-3.5" />
                {group}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((sensor) => {
                  const link = LINK_STYLE[sensor.link];
                  return (
                    <article key={sensor.id} className="rounded-2xl border border-line bg-panel/70 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-ink">{metricLabel(sensor.id, sensor.name_uk, t)}</p>
                          <p className="mt-0.5 font-mono text-[11px] text-faint">{sensor.id}</p>
                        </div>
                        <span className={clsx("inline-flex items-center gap-1.5 text-[11px] font-medium", link.className)}>
                          <span className={clsx("size-1.5 rounded-full", link.dot)} />
                          {linkLabel[sensor.link]}
                        </span>
                      </div>
                      <p className="mt-3 font-mono text-2xl tracking-tight text-ink">
                        {sensor.value == null ? "—" : formatVital(sensor.id, sensor.value)}
                        <span className="ml-1 text-xs text-muted">{unitOf(sensor.id, sensor.unit)}</span>
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                        <span className="inline-flex items-center gap-1"><Cable className="size-3" />{sensor.device_id ?? t("sensors.noDevice")}</span>
                        <span className="inline-flex items-center gap-1"><Activity className="size-3" />{sensor.source ?? t("sensors.noSource")}</span>
                        {sensor.ts ? <span>{formatWhen(sensor.ts)}</span> : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Stat({ pill, value, tone }: { pill: string; value: number; tone?: "nominal" | "caution" }) {
  return (
    <span className={clsx(
      "rounded-full px-2.5 py-1 font-medium",
      tone === "nominal" ? "bg-nominal/15 text-nominal" : tone === "caution" ? "bg-caution/15 text-caution" : "bg-panel-raised text-muted",
    )}>
      {pill}: <span className="tnum">{value}</span>
    </span>
  );
}
