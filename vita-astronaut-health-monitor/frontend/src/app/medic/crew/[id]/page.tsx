"use client";

import clsx from "clsx";
import { ArrowLeft, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { RoleGate } from "@/components/auth/role-gate";
import { FIELD_KEY, TONE_KEY, latestOf, toneOf } from "@/components/medic/clinical";
import { metricLabel, useT } from "@/lib/locale";
import { BodyHero } from "@/components/mission/body/body-hero";
import { EcgTrace, TrendChart } from "@/components/mission/widgets";
import { Button, Card, CardTitle, EmptyState, ErrorState, Field, Input, PageHeader, Segmented } from "@/components/ui/primitives";
import { useEditReading, useUpdateErrnoLimit, useErrnoAlerts, useErrnoAstronauts, useErrnoChanges, useErrnoLimits, useErrnoMetrics, useErrnoReadings, useErrnoStatus, submitManualReading, errnoKeys, type ErrnoLimit, type ErrnoMetric } from "@/lib/api/errno";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatNumber, formatVital, formatWhen, initials, unitOf, vitalInput } from "@/lib/number";
import { bandOf, protocol } from "@/lib/zones";
import { confirm } from "@/lib/notify";

const PREVIEW_LIMIT = 4;

function ExpandableList<T>({
  items,
  render,
  as = "ul",
  listClassName,
}: {
  items: T[];
  render: (item: T) => ReactNode;
  as?: "ul" | "ol";
  listClassName?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const List = as;
  const visible = open ? items : items.slice(0, PREVIEW_LIMIT);
  const hidden = items.length - PREVIEW_LIMIT;
  return (
    <div>
      <List className={listClassName}>{visible.map(render)}</List>
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="mt-3 flex w-full flex-col items-center gap-0.5 py-1 text-faint transition-colors hover:text-muted"
          aria-expanded={open}
        >
          <span className="text-[10px] font-medium tracking-wide uppercase">{open ? t("medic.hide") : t("medic.showMore", { count: hidden })}</span>
          <ChevronDown className={clsx("size-4 transition-transform", open && "rotate-180")} />
        </button>
      ) : null}
    </div>
  );
}

export default function AstronautPage() {
  const params = useParams<{ id: string }>();
  return (
    <RoleGate roles={["doctor", "chief"]}>
      <AstronautFile id={params.id} />
    </RoleGate>
  );
}

function AstronautFile({ id }: { id: string }) {
  const t = useT();
  const crew = useErrnoAstronauts();
  const metrics = useErrnoMetrics();
  const status = useErrnoStatus(id);
  const limits = useErrnoLimits(id);
  const changes = useErrnoChanges(id);
  const alerts = useErrnoAlerts(id, true);
  const person = crew.data?.find((item) => item.id === id);
  const [tab, setTab] = useState<"overview" | "norms">("overview");
  const groups = useMemo(() => {
    const order: string[] = [];
    const bucket = new Map<string, NonNullable<ReturnType<typeof latestOf>>[]>();
    for (const metric of metrics.data ?? []) {
      const hit = latestOf(metrics.data, id, metric.id);
      const title = metric.group || t("medic.other");
      if (!bucket.has(title)) {
        bucket.set(title, []);
        order.push(title);
      }
      if (hit) bucket.get(title)!.push(hit);
    }
    return order.map((title) => ({ title, items: bucket.get(title)! })).filter((group) => group.items.length);
  }, [metrics.data, id]);
  const [sensorId, setSensorId] = useState("hr");
  const readings = useErrnoReadings(id, sensorId === "ecg" ? "hr" : sensorId);
  const selected = latestOf(metrics.data, id, sensorId);
  const hrLatest = latestOf(metrics.data, id, "hr");
  const hrRaw = hrLatest?.value.value;
  const heartBpm = hrRaw == null || !Number.isFinite(hrRaw) || hrRaw <= 0 ? 0 : hrRaw;
  const out = (metrics.data ?? []).filter((metric) => metric.latest.some((item) => item.astronaut_id === id && item.alert)).length;
  const tone = toneOf(status.data, groups.length > 0, out);
  const names = new Map((metrics.data ?? []).map((metric) => [metric.id, metric.name_uk]));

  return (
    <div className="space-y-5">
      <Link href="/medic/crew" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-ink"><ArrowLeft className="size-3.5" />{t("medic.astronauts")}</Link>
      <PageHeader
        eyebrow={person?.role || t("role.astronaut")}
        title={person?.name || id}
        subtitle={t("medic.scoreSubtitle", { tone: t(TONE_KEY[tone]), score: status.data?.score == null ? "—" : formatNumber(status.data.score, 1) })}
        action={<span className="grid size-12 place-items-center rounded-full bg-panel text-sm font-semibold ring-1 ring-line">{initials(person?.name || id)}</span>}
      />
      <Segmented
        label={t("medic.cardSection")}
        size="sm"
        value={tab}
        onChange={setTab}
        options={[
          { value: "overview", label: t("medic.tab.overview") },
          { value: "norms", label: t("medic.tab.norms") },
        ]}
      />
      {tab === "norms" ? (
        <NormsPanel astronautId={id} metrics={metrics.data ?? []} limits={limits.data ?? []} loading={limits.isPending || metrics.isPending} />
      ) : (
        <>
          {status.data?.help_needed && (
            <p className="rounded-xl border border-critical/35 bg-critical/[0.08] px-4 py-2.5 text-sm text-critical">
              {t("medic.helpBanner")}
            </p>
          )}

          <BodyHero
            title={t("body.hero")}
            subtitle={t("medic.bodySubtitle")}
            metrics={(metrics.data ?? []).flatMap((metric) => {
              const value = metric.latest.find((item) => item.astronaut_id === id);
              if (!value) return [];
              return [
                {
                  id: metric.id,
                  name: metricLabel(metric.id, metric.name_uk, t),
                  zone: value.zone ?? null,
                  value: formatVital(metric.id, value.value),
                  unit: unitOf(metric.id, metric.unit),
                },
              ];
            })}
          />

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {groups.map((group) => (
              <Card key={group.title} className="p-4">
                <h2 className="text-xs font-medium text-muted">{group.title}</h2>
                <ul className="mt-3 space-y-2">
                  {group.items.map(({ metric, value }) => (
                    <li key={metric.id}>
                      <button type="button" onClick={() => setSensorId(metric.id)} className={clsx("flex w-full items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-left", sensorId === metric.id && "bg-accent/[0.06]")}>
                        <span className="text-sm">{metricLabel(metric.id, metric.name_uk, t)}</span>
                        <span className={clsx("text-sm font-semibold tnum", value.alert && "text-critical")}>
                          {formatVital(metric.id, value.value)} <span className="text-[11px] font-medium text-muted">{unitOf(metric.id, metric.unit)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>

          {(sensorId === "hr" || sensorId === "ecg") && selected && (
            <EcgTrace
              astronautId={id}
              bpm={sensorId === "hr" ? selected.value.value : heartBpm}
              zone={selected.value.zone ?? (selected.value.alert ? "red" : "green")}
            />
          )}

          <div className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
            <Card>
              <CardTitle description={selected ? t("medic.rangeAt", { time: formatWhen(selected.value.ts), range: selected.value.alert ? t("medic.outOfRange") : t("medic.inRange") }) : t("medic.pickSensor")}>
                {selected ? metricLabel(selected.metric.id, selected.metric.name_uk, t) : t("medic.history")}
              </CardTitle>
              {selected && <ProtocolNote sensorId={sensorId} value={selected.value.value} />}
              {sensorId === "ecg" ? (
                <p className="text-sm text-muted">Lead II strip above — waveform streams over /live, not the hour trend.</p>
              ) : readings.isPending ? <p className="text-sm text-muted">{t("medic.loadingHistory")}</p> : readings.isError ? <ErrorState error={readings.error} onRetry={() => void readings.refetch()} /> : readings.data?.length ? (
                <TrendChart
                  sensor={sensorId}
                  unit={unitOf(sensorId, selected?.metric.unit)}
                  points={readings.data.map((point) => ({ t: point.ts, value: point.value }))}
                />
              ) : <EmptyState title={t("medic.noHistoryHour")} />}
            </Card>
            <div className="space-y-4">
              <LimitEditor astronautId={id} sensorId={sensorId} min={limits.data?.find((item) => item.sensor_id === sensorId)?.min} max={limits.data?.find((item) => item.sensor_id === sensorId)?.max} />
              <ValueEditor astronautId={id} sensorId={sensorId} readingId={asId(readings.data?.at(-1)?.id)} current={selected?.value.value} />
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardTitle description={t("medic.changeLogDesc")}>{t("medic.changeLog")}</CardTitle>
              {changes.isPending ? <p className="text-sm text-muted">{t("medic.loadingJournal")}</p> : changes.data?.length ? (
                <ExpandableList
                  as="ol"
                  items={changes.data}
                  listClassName="max-h-80 space-y-4 overflow-y-auto"
                  render={(change) => (
                    <li key={change.id} className="border-l-2 border-line pl-3">
                      <p className="text-sm font-medium">{change.actor_login} <span className="font-normal text-muted">· {change.role === "chief" ? t("medic.role.chief") : t("medic.role.doctor")} · {formatWhen(change.ts)}</span></p>
                      {change.note && <p className="mt-0.5 text-xs text-muted">{change.note}</p>}
                      <ul className="mt-1 space-y-0.5 text-xs">
                        {change.diff.map((line) => (
                          <li key={`${change.id}-${line.sensor_id}-${line.field}`} className="tnum">
                            {metricLabel(line.sensor_id, names.get(line.sensor_id) ?? line.sensor_id, t)} · {FIELD_KEY[line.field] ? t(FIELD_KEY[line.field]) : line.field}: {formatVital(line.sensor_id, line.from)} → {formatVital(line.sensor_id, line.to)}
                          </li>
                        ))}
                      </ul>
                    </li>
                  )}
                />
              ) : <p className="text-sm text-muted">{t("medic.noChangesYet")}</p>}
            </Card>
            <Card>
              <CardTitle>{t("medic.activeClinicalAlerts")}</CardTitle>
              {alerts.data?.length ? (
                <ExpandableList
                  items={alerts.data}
                  listClassName="space-y-2"
                  render={(alert) => (
                    <li key={alert.id} className="rounded-lg border border-line px-3 py-2">
                      <p className="text-sm font-medium">{alert.message}</p>
                      <p className="text-[11px] text-muted">{names.get(alert.sensor_id) ?? alert.sensor_id} · {formatWhen(alert.ts)}</p>
                    </li>
                  )}
                />
              ) : <p className="text-sm text-muted">{t("medic.noClinicalAlerts")}</p>}
              <ManualForm astronautId={id} options={(metrics.data ?? []).map((metric) => ({ id: metric.id, label: metricLabel(metric.id, metric.name_uk, t), unit: unitOf(metric.id, metric.unit) }))} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function NormsPanel({
  astronautId,
  metrics,
  limits,
  loading,
}: {
  astronautId: string;
  metrics: ErrnoMetric[];
  limits: ErrnoLimit[];
  loading: boolean;
}) {
  const t = useT();
  const byLimit = useMemo(() => new Map(limits.map((item) => [item.sensor_id, item])), [limits]);
  const groups = useMemo(() => {
    const order: string[] = [];
    const bucket = new Map<string, ErrnoMetric[]>();
    for (const metric of metrics) {
      const title = metric.group || t("medic.other");
      if (!bucket.has(title)) {
        bucket.set(title, []);
        order.push(title);
      }
      bucket.get(title)!.push(metric);
    }
    return order.map((title) => ({ title, items: bucket.get(title)! }));
  }, [metrics, t]);

  return (
    <Card className="p-0">
      <div className="border-b border-line px-5 py-4">
        <h2 className="text-[13.5px] font-semibold">{t("medic.normsTitle")}</h2>
        <p className="mt-0.5 text-xs text-muted">{t("medic.normsDesc")}</p>
      </div>
      {loading ? (
        <p className="px-5 py-8 text-sm text-muted">{t("medic.loadingNorms")}</p>
      ) : (
        <div className="divide-y divide-line">
          {groups.map((group) => (
            <section key={group.title} className="px-5 py-4">
              <h3 className="mb-3 text-[11px] font-medium tracking-wide text-faint uppercase">{group.title}</h3>
              <ul className="space-y-2">
                {group.items.map((metric) => {
                  const bound = byLimit.get(metric.id);
                  return (
                    <NormRow
                      key={metric.id}
                      astronautId={astronautId}
                      metric={metric}
                      min={bound?.min}
                      max={bound?.max}
                    />
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}

function NormRow({
  astronautId,
  metric,
  min,
  max,
}: {
  astronautId: string;
  metric: ErrnoMetric;
  min?: number | null;
  max?: number | null;
}) {
  const t = useT();
  const save = useUpdateErrnoLimit(astronautId);
  const [low, setLow] = useState("");
  const [high, setHigh] = useState("");
  useEffect(() => {
    setLow(min == null ? "" : String(min));
    setHigh(max == null ? "" : String(max));
  }, [metric.id, min, max]);
  const dirty = low !== (min == null ? "" : String(min)) || high !== (max == null ? "" : String(max));
  return (
    <li className="grid items-end gap-2 rounded-xl border border-line bg-panel/40 px-3 py-2.5 sm:grid-cols-[minmax(0,1.2fr)_5.5rem_5.5rem_auto]">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{metricLabel(metric.id, metric.name_uk, t)}</p>
        <p className="font-mono text-[11px] text-faint">
          {metric.id} · {unitOf(metric.id, metric.unit) || metric.unit}
        </p>
      </div>
      <Field label={t("medic.minShort")}>
        <Input type="number" step="any" value={low} onChange={(event) => setLow(event.target.value)} required />
      </Field>
      <Field label={t("medic.maxShort")}>
        <Input type="number" step="any" value={high} onChange={(event) => setHigh(event.target.value)} required />
      </Field>
      <Button
        type="button"
        loading={save.isPending}
        disabled={!dirty || low === "" || high === ""}
        className="sm:mb-0.5"
        onClick={() =>
          save.mutate(
            { sensor_id: metric.id, min: Number(low), max: Number(high) },
            {
              onSuccess: () => confirm.done(t("medic.limitsSaved", { name: metricLabel(metric.id, metric.name_uk, t) })),
              onError: (error) => confirm.failed(t("medic.saveFailed"), error instanceof Error ? error.message : ""),
            },
          )
        }
      >
        {t("medic.save")}
      </Button>
    </li>
  );
}

function ProtocolNote({ sensorId, value }: { sensorId: string; value: number }) {
  const band = bandOf(sensorId, value);
  const text = protocol(sensorId);
  if (!band || band === "green" || !text) return null;
  return <p className={clsx("mb-3 rounded-lg px-3 py-2 text-sm", band === "red" ? "bg-critical/10 text-critical" : "bg-caution/10 text-caution")}>{band === "red" ? text.surgeon : text.hud}</p>;
}

function asId(id: string | number | undefined) {
  if (typeof id === "number" && Number.isFinite(id)) return id;
  if (typeof id === "string" && id !== "" && Number.isFinite(Number(id))) return Number(id);
  return undefined;
}

function LimitEditor({ astronautId, sensorId, min, max }: { astronautId: string; sensorId: string; min?: number | null; max?: number | null }) {
  const t = useT();
  const save = useUpdateErrnoLimit(astronautId);
  const [low, setLow] = useState("");
  const [high, setHigh] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    setLow(min == null ? "" : String(min));
    setHigh(max == null ? "" : String(max));
    setNote("");
  }, [sensorId, min, max]);
  return (
    <Card className="p-4">
      <h2 className="text-[13.5px] font-semibold">{t("medic.boundsTitle")}</h2>
      <p className="mt-0.5 text-xs text-muted">{t("medic.boundsNow", { min: formatVital(sensorId, min), max: formatVital(sensorId, max) })}</p>
      <form className="mt-3 grid grid-cols-2 gap-3" onSubmit={(event) => { event.preventDefault(); save.mutate({ sensor_id: sensorId, min: Number(low), max: Number(high), note: note || undefined }, { onSuccess: () => confirm.done(t("medic.boundsSaved")), onError: (error) => confirm.failed(t("medic.boundsSaveFailed"), error instanceof Error ? error.message : "") }); }}>
        <Field label={t("medic.minimum")}><Input type="number" step="any" value={low} onChange={(event) => setLow(event.target.value)} required /></Field>
        <Field label={t("medic.maximum")}><Input type="number" step="any" value={high} onChange={(event) => setHigh(event.target.value)} required /></Field>
        <div className="col-span-2"><Field label={t("medic.note")}><Input value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("medic.noteWhyChange")} /></Field></div>
        <div className="col-span-2"><Button type="submit" loading={save.isPending} className="w-full">{t("medic.saveBounds")}</Button></div>
      </form>
    </Card>
  );
}

function ValueEditor({ astronautId, sensorId, readingId, current }: { astronautId: string; sensorId: string; readingId?: number; current?: number }) {
  const t = useT();
  const edit = useEditReading(astronautId, sensorId);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => { setValue(vitalInput(sensorId, current)); setNote(""); }, [sensorId, current]);
  return (
    <Card className="p-4">
      <h2 className="text-[13.5px] font-semibold">{t("medic.correctValue")}</h2>
      <p className="mt-0.5 text-xs text-muted">{t("medic.wasValue", { value: formatVital(sensorId, current) })}</p>
      <form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); if (!readingId) return; edit.mutate({ id: readingId, value: Number(value), note: note || undefined }, { onSuccess: () => confirm.done(t("medic.valueChanged")), onError: (error) => confirm.failed(t("medic.valueChangeFailed"), error instanceof Error ? error.message : "") }); }}>
        <Field label={t("medic.newValue")}><Input type="number" step="any" value={value} onChange={(event) => setValue(event.target.value)} required /></Field>
        <Field label={t("medic.note")}><Input value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("medic.noteRerun")} /></Field>
        <Button type="submit" loading={edit.isPending} disabled={!readingId} className="w-full">{t("medic.recordChange")}</Button>
      </form>
    </Card>
  );
}

function ManualForm({ astronautId, options }: { astronautId: string; options: { id: string; label: string; unit: string }[] }) {
  const t = useT();
  const client = useQueryClient();
  const [sensor, setSensor] = useState(options[0]?.id ?? "");
  const [value, setValue] = useState("");
  const unit = options.find((item) => item.id === sensor)?.unit ?? "";
  const manual = useMutation({
    mutationFn: () => submitManualReading({ astronaut_id: astronautId, sensor_id: sensor, value: Number(value), unit }),
    onSuccess: async () => {
      confirm.done(t("medic.readingRecorded"));
      setValue("");
      await client.invalidateQueries({ queryKey: errnoKeys.metrics });
      await client.invalidateQueries({ queryKey: ["errno-changes", astronautId] });
    },
    onError: (error) => confirm.failed(t("medic.readingFailed"), error instanceof Error ? error.message : ""),
  });
  if (!options.length) return null;
  return (
    <form className="mt-5 grid gap-3 border-t border-line pt-4" onSubmit={(event) => { event.preventDefault(); manual.mutate(); }}>
      <h3 className="text-[13.5px] font-semibold">{t("medic.newLabReading")}</h3>
      <Field label={t("medic.sensorField")}>
        <select value={sensor} onChange={(event) => setSensor(event.target.value)} className="h-9 w-full rounded-lg border border-line bg-panel px-3 text-sm">
          {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </Field>
      <Field label={unit ? t("medic.valueWithUnit", { unit }) : t("common.value")}><Input type="number" step="any" value={value} onChange={(event) => setValue(event.target.value)} required /></Field>
      <Button type="submit" loading={manual.isPending}>{t("medic.addReading")}</Button>
    </form>
  );
}
