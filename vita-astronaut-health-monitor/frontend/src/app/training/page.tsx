"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BedDouble, Brain, CheckCircle2, Circle, Dumbbell } from "lucide-react";
import { RoleGate } from "@/components/auth/role-gate";
import { Button, Card, ErrorState, Field, Input, PageHeader } from "@/components/ui/primitives";
import { submitPsychCheckIn, submitSleepCheckIn, useErrnoMetrics, errnoKeys } from "@/lib/api/errno";
import { useAuth } from "@/lib/auth";
import { type DailyTaskId, loadDailyTasks, markDailyTask, type DailyTaskState } from "@/lib/daily-tasks";
import { confirm } from "@/lib/notify";
import { metricLabel, useT } from "@/lib/locale";
import { formatVital, unitOf } from "@/lib/number";
import type { TranslationKey } from "@/lib/translations";

const PSYCH_QUESTIONS: { key: string; labelKey: TranslationKey; hintKey: TranslationKey }[] = [
  { key: "mood", labelKey: "training.q.mood", hintKey: "training.q.moodHint" },
  { key: "stress", labelKey: "training.q.stress", hintKey: "training.q.stressHint" },
  { key: "recovery", labelKey: "training.q.recovery", hintKey: "training.q.recoveryHint" },
  { key: "crew", labelKey: "training.q.crew", hintKey: "training.q.crewHint" },
];

const EXERCISE_STEPS: { id: DailyTaskId; labelKey: TranslationKey; detailKey: TranslationKey }[] = [
  { id: "warmup", labelKey: "training.warmup", detailKey: "training.warmupDetail" },
  { id: "cardio", labelKey: "training.cardio", detailKey: "training.cardioDetail" },
  { id: "strength", labelKey: "training.strength", detailKey: "training.strengthDetail" },
];

export default function TrainingPage() {
  return (
    <RoleGate roles={["astronaut", "officer"]}>
      <TrainingWorkspace />
    </RoleGate>
  );
}

function TrainingWorkspace() {
  const t = useT();
  const { user } = useAuth();
  const astronautId = user?.astronaut_id ?? "";
  const metrics = useErrnoMetrics();
  const client = useQueryClient();
  const [hours, setHours] = useState("");
  const [quality, setQuality] = useState("");
  const [answers, setAnswers] = useState(["", "", "", ""]);
  const [tasks, setTasks] = useState<DailyTaskState>({});

  useEffect(() => {
    setTasks(loadDailyTasks(astronautId));
    const sync = () => setTasks(loadDailyTasks(astronautId));
    window.addEventListener("errno:daily-tasks", sync);
    return () => window.removeEventListener("errno:daily-tasks", sync);
  }, [astronautId]);

  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    if (!hash) return;
    const el = document.getElementById(hash);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const sleep = useMutation({
    mutationFn: () => submitSleepCheckIn({ astronaut_id: astronautId, hours: Number(hours), quality: Number(quality) }),
    onSuccess: async () => {
      confirm.done(t("training.sleepSaved"));
      setHours("");
      setQuality("");
      setTasks(markDailyTask(astronautId, "sleep", true));
      await client.invalidateQueries({ queryKey: errnoKeys.metrics });
    },
    onError: (error) => confirm.failed(t("training.sleepFail"), error instanceof Error ? error.message : ""),
  });
  const psych = useMutation({
    mutationFn: () => submitPsychCheckIn({ astronaut_id: astronautId, answers: answers.map(Number) }),
    onSuccess: async () => {
      confirm.done(t("training.psychSaved"));
      setAnswers(["", "", "", ""]);
      setTasks(markDailyTask(astronautId, "psych", true));
      await client.invalidateQueries({ queryKey: errnoKeys.metrics });
    },
    onError: (error) => confirm.failed(t("training.psychFail"), error instanceof Error ? error.message : ""),
  });

  const rows = (metrics.data ?? []).flatMap((metric) => {
    const value = metric.latest.find((item) => item.astronaut_id === astronautId);
    return value ? [{ metric, value }] : [];
  });
  const lastSleepHours = rows.find((row) => row.metric.id === "sleep_hours");
  const lastSleepQuality = rows.find((row) => row.metric.id === "sleep_quality");
  const lastMh = rows.find((row) => row.metric.id === "mh_score");
  const lastPsych = rows.find((row) => row.metric.id === "psych_score");

  const toggleExercise = (id: DailyTaskId) => {
    setTasks(markDailyTask(astronautId, id, !tasks[id]));
  };

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t("training.eyebrow")} title={t("training.title")} subtitle={t("training.subtitle")} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="text-[13.5px] font-semibold">{t("training.now")}</h2>
          {metrics.isPending ? (
            <p className="mt-3 text-sm text-muted">{t("common.loading")}</p>
          ) : metrics.isError ? (
            <ErrorState error={metrics.error} onRetry={() => void metrics.refetch()} />
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {rows.map(({ metric, value }) => (
                <li key={metric.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                  <span className="text-muted">{metricLabel(metric.id, metric.name_uk, t)}</span>
                  <span className="font-semibold tnum">
                    {formatVital(metric.id, value.value)}{" "}
                    <span className="text-xs font-medium text-muted">{unitOf(metric.id, metric.unit)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card id="exercise" className="scroll-mt-24">
          <div className="mb-3 flex items-center gap-2">
            <Dumbbell className="size-4 text-accent" />
            <h2 className="text-[13.5px] font-semibold">{t("training.exercise")}</h2>
          </div>
          <p className="text-xs text-muted">{t("training.exerciseNote")}</p>
          <ul className="mt-3 space-y-2">
            {EXERCISE_STEPS.map((step) => {
              const done = !!tasks[step.id];
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    onClick={() => toggleExercise(step.id)}
                    className="flex w-full items-start gap-2.5 rounded-xl border border-line bg-panel-raised/30 px-3 py-2.5 text-left hover:border-accent/35"
                  >
                    {done ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-nominal" /> : <Circle className="mt-0.5 size-5 shrink-0 text-faint" />}
                    <span>
                      <span className={`block text-sm font-medium ${done ? "text-muted line-through" : "text-ink"}`}>{t(step.labelKey)}</span>
                      <span className="mt-0.5 block text-[11px] text-muted">{t(step.detailKey)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {tasks.exercise ? <p className="mt-3 text-xs text-nominal">{t("training.exerciseDone")}</p> : null}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card id="sleep" className="relative scroll-mt-24 overflow-hidden">
          <div className="mb-3 flex items-center gap-2">
            <BedDouble className="size-4 text-accent" />
            <h2 className="text-[13.5px] font-semibold">{t("training.sleepTitle")}</h2>
          </div>
          <p className="text-xs text-muted">{t("training.sleepNorm")}</p>
          {(lastSleepHours || lastSleepQuality) && (
            <p className="mt-2 rounded-lg border border-line bg-panel-raised/30 px-3 py-2 text-xs text-muted">
              {t("training.lastRecord")}{" "}
              {lastSleepHours ? (
                <span className="text-ink">
                  {formatVital("sleep_hours", lastSleepHours.value.value)} {unitOf("sleep_hours", lastSleepHours.metric.unit)}
                </span>
              ) : (
                "—"
              )}
              {` · ${t("training.qualityShort")} `}
              {lastSleepQuality ? (
                <span className="text-ink">{formatVital("sleep_quality", lastSleepQuality.value.value)}</span>
              ) : (
                "—"
              )}
            </p>
          )}
          <form
            className="mt-3 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (tasks.sleep) return;
              sleep.mutate();
            }}
          >
            <fieldset disabled={!!tasks.sleep} className="space-y-3 disabled:pointer-events-none">
              <Field label={t("training.hours")}>
                <Input type="number" min="0.5" max="24" step="0.1" value={hours} onChange={(event) => setHours(event.target.value)} required />
              </Field>
              <Field label={t("training.quality")}>
                <Input type="number" min="1" max="10" step="1" value={quality} onChange={(event) => setQuality(event.target.value)} required />
              </Field>
            </fieldset>
            <Button type="submit" loading={sleep.isPending} disabled={!!tasks.sleep} className="w-full">
              {t("training.saveSleep")}
            </Button>
          </form>
          {tasks.sleep ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] bg-panel/55 px-6 backdrop-blur-md">
              <p className="max-w-sm text-center text-sm font-medium leading-relaxed text-ink">
                {t("training.sleepDone")}
                <span className="mt-2 block text-xs font-normal text-muted">{t("training.contactOfficer")}</span>
              </p>
            </div>
          ) : null}
        </Card>

        <Card id="psych" className="relative scroll-mt-24 overflow-hidden">
          <div className="mb-3 flex items-center gap-2">
            <Brain className="size-4 text-accent" />
            <h2 className="text-[13.5px] font-semibold">{t("training.psychState")}</h2>
          </div>
          {(lastMh || lastPsych) && (
            <p className="mt-2 rounded-lg border border-line bg-panel-raised/30 px-3 py-2 text-xs text-muted">
              {t("training.lastScore")}{" "}
              <span className="text-ink">
                {lastMh ? formatVital("mh_score", lastMh.value.value) : "—"}/20
              </span>
              {lastPsych ? (
                <>
                  {" "}
                  · <span className="text-ink">{formatVital("psych_score", lastPsych.value.value)}%</span>
                </>
              ) : null}
            </p>
          )}
          <form
            className="mt-3 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (tasks.psych) return;
              psych.mutate();
            }}
          >
            <fieldset disabled={!!tasks.psych} className="grid gap-3 sm:grid-cols-2 disabled:pointer-events-none">
              {PSYCH_QUESTIONS.map((question, index) => (
                <Field key={question.key} label={t(question.labelKey)} hint={t(question.hintKey)}>
                  <Input
                    type="number"
                    min="0"
                    max="5"
                    step="1"
                    value={answers[index]}
                    onChange={(event) =>
                      setAnswers((current) => current.map((item, i) => (i === index ? event.target.value : item)))
                    }
                    required
                  />
                </Field>
              ))}
            </fieldset>
            <Button type="submit" loading={psych.isPending} disabled={!!tasks.psych} className="w-full">
              {t("training.sendPsych")}
            </Button>
          </form>
          {tasks.psych ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] bg-panel/55 px-6 backdrop-blur-md">
              <p className="max-w-sm text-center text-sm font-medium leading-relaxed text-ink">
                {t("training.psychDone")}
                <span className="mt-2 block text-xs font-normal text-muted">{t("training.contactOfficer")}</span>
              </p>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
