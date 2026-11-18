"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { type DailyTaskId, loadDailyTasks, markDailyTask, type DailyTaskState } from "@/lib/daily-tasks";
import { useT } from "@/lib/locale";
import type { TranslationKey } from "@/lib/translations";

const MAIN_TASKS: { id: DailyTaskId; labelKey: TranslationKey; hintKey: TranslationKey; href?: string }[] = [
  { id: "exercise", labelKey: "tasks.exercise", hintKey: "tasks.exerciseHint", href: "/training#exercise" },
  { id: "sleep", labelKey: "tasks.sleep", hintKey: "tasks.sleepHint", href: "/training#sleep" },
  { id: "psych", labelKey: "tasks.psych", hintKey: "tasks.psychHint", href: "/training#psych" },
  { id: "hydrate", labelKey: "tasks.hydrate", hintKey: "tasks.hydrateHint" },
];

export function DailyTasks({ astronautId }: { astronautId: string }) {
  const t = useT();
  const [state, setState] = useState<DailyTaskState>({});

  useEffect(() => {
    setState(loadDailyTasks(astronautId));
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<{ astronautId?: string }>).detail;
      if (detail?.astronautId && detail.astronautId !== astronautId) return;
      setState(loadDailyTasks(astronautId));
    };
    window.addEventListener("errno:daily-tasks", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("errno:daily-tasks", sync);
      window.removeEventListener("storage", sync);
    };
  }, [astronautId]);

  const doneCount = MAIN_TASKS.filter((task) => state[task.id]).length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0">
        <p className="text-xs font-medium text-muted">{t("tasks.title")}</p>
        <p className="mt-0.5 font-mono text-[10px] text-faint">
          {t("tasks.today", { done: doneCount, total: MAIN_TASKS.length })}
        </p>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-2">
        {MAIN_TASKS.map((task) => {
          const done = !!state[task.id];
          const label = t(task.labelKey);
          return (
            <li key={task.id} className="flex min-h-0 flex-1">
              <div className="flex w-full items-start gap-2.5 rounded-xl border border-line bg-panel-raised/40 px-3 py-2.5">
                <button
                  type="button"
                  aria-pressed={done}
                  aria-label={done ? t("tasks.markUndo", { label }) : t("tasks.markDone", { label })}
                  onClick={() => setState(markDailyTask(astronautId, task.id, !done))}
                  className="mt-0.5 shrink-0 text-ink"
                >
                  {done ? <CheckCircle2 className="size-5 text-nominal" /> : <Circle className="size-5 text-faint" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${done ? "text-muted line-through" : "text-ink"}`}>{label}</p>
                  <p className="mt-0.5 text-[11px] text-muted">{t(task.hintKey)}</p>
                  {task.href ? (
                    <Link href={task.href} className="mt-1 inline-block text-[11px] text-accent hover:underline">
                      {t("tasks.openTraining")}
                    </Link>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}