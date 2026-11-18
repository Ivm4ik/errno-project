"use client";

import dynamic from "next/dynamic";
import { useMemo, useState, type ReactNode } from "react";
import type { BodyMetric } from "./muscle-body";
import { useT } from "@/lib/locale";
import { type BodySex, type OrganId, ORGAN_BY_ID, ORGANS } from "./organs";

const MuscleBody = dynamic(() => import("./muscle-body").then((m) => m.MuscleBody), {
  ssr: false,
  loading: () => <BodyLoading />,
});

export type { BodyMetric };

function BodyLoading() {
  const t = useT();
  return <div className="grid h-full min-h-[360px] place-items-center text-sm text-muted">{t("body.init3d")}</div>;
}

function zoneTone(zone: string | null) {
  if (zone === "red") return "text-critical";
  if (zone === "yellow") return "text-caution";
  return "text-nominal";
}

const SCAN_HEIGHT = "h-[min(52vh,480px)]";

export function BodyHero({
  metrics,
  title,
  subtitle,
  /** Column to the right of the 3D (e.g. daily tasks). */
  side,
  /** Full-width block under the 3D + side row (e.g. vital squares). */
  footer,
}: {
  metrics: BodyMetric[];
  title?: string;
  subtitle?: string;
  side?: ReactNode;
  footer?: ReactNode;
}) {
  const t = useT();
  const [sex, setSex] = useState<BodySex>("male");
  const [organId, setOrganId] = useState<OrganId | null>(null);

  const organ = organId ? ORGAN_BY_ID[organId] : null;
  const organMetrics = useMemo(() => {
    if (!organ) return [];
    const allowed = new Set(organ.sensors);
    return metrics.filter((m) => allowed.has(m.id));
  }, [metrics, organ]);

  const organFallback =
    !side && !organ ? (
      <div className="flex h-full min-h-[160px] flex-col justify-center gap-2 text-sm text-muted">
        <p className="text-ink">{t("body.pickOrgan")}</p>
          <ul className="space-y-1">
          {ORGANS.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => setOrganId(o.id)} className="text-left text-muted hover:text-accent">
                {t(o.labelKey)}
              </button>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  const hasSide = Boolean(side || organFallback);

  return (
    <section className="grid gap-4">
      <div className={`grid gap-4 ${hasSide ? "xl:grid-cols-[minmax(0,1.15fr)_minmax(280px,38%)]" : ""}`}>
        <div className={`relative ${SCAN_HEIGHT} w-full overflow-hidden rounded-2xl border border-line bg-[radial-gradient(ellipse_at_50%_40%,#121820_0%,#0a0d12_70%)] shadow-[var(--shadow-pop)]`}>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[3] flex items-start justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="font-mono text-[10px] tracking-[0.18em] text-accent uppercase">Body scan</p>
              <h2 className="mt-1 truncate text-lg font-semibold tracking-tight text-white">{title ?? t("body.hero")}</h2>
              {subtitle ? <p className="mt-0.5 truncate text-xs text-white/55">{subtitle}</p> : null}
            </div>
          </div>

          <MuscleBody metrics={metrics} sex={sex} organId={organId} onOrganChange={setOrganId} />

          {organ ? (
            <div className="absolute inset-x-3 top-5 z-[5] max-h-[90%] overflow-y-auto rounded-xl border border-line bg-panel/95 p-3 shadow-[var(--shadow-pop)] backdrop-blur-md sm:inset-x-auto sm:right-3 sm:bottom-3 sm:w-[min(260px,70%)]">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-[10px] tracking-[0.16em] text-accent uppercase">{t("body.organLabel")}</p>
                  <h3 className="text-sm font-semibold text-white">{t(organ.labelKey)}</h3>
                </div>
                <button type="button" onClick={() => setOrganId(null)} className="rounded-md border border-white/15 px-2 py-0.5 text-[11px] text-white/60 hover:text-white">
                  {t("body.back")}
                </button>
              </div>
              {organMetrics.length === 0 ? (
                <p className="text-xs text-white/45">{t("body.noRoleMetrics")}</p>
              ) : (
                <ul className="space-y-1.5">
                  {organMetrics.map((m) => (
                    <li key={m.id} className="rounded-lg border border-line bg-panel-raised/60 px-2.5 py-1.5">
                      <p className="text-[10px] text-white/45">{m.name}</p>
                      <p className={`font-mono text-base font-semibold tracking-tight ${zoneTone(m.zone)}`}>
                        {m.value}
                        <span className="ml-1 text-[10px] font-medium text-white/40">{m.unit}</span>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>

        {side ? (
          <aside className={`${SCAN_HEIGHT} overflow-auto rounded-2xl border border-line bg-panel p-4 shadow-[var(--shadow-pop)]`}>
            {side}
          </aside>
        ) : organFallback ? (
          <aside className={`hidden ${SCAN_HEIGHT} overflow-auto rounded-2xl border border-line bg-panel p-4 shadow-[var(--shadow-pop)] lg:block`}>
            {organFallback}
          </aside>
        ) : null}
      </div>

      {footer ? (
        <div className="w-full rounded-2xl border border-line bg-panel p-4 shadow-[var(--shadow-pop)]">{footer}</div>
      ) : null}
    </section>
  );
}
