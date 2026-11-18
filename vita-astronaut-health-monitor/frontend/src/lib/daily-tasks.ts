/** Local daily checklist for astronaut console + /training. */

export type DailyTaskId = "exercise" | "sleep" | "psych" | "hydrate" | "warmup" | "cardio" | "strength";

export type DailyTaskState = Partial<Record<DailyTaskId, boolean>>;

function dayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function dailyTasksStorageKey(astronautId: string) {
  return `errno:daily-tasks:${astronautId}:${dayKey()}`;
}

export function loadDailyTasks(astronautId: string): DailyTaskState {
  if (typeof window === "undefined" || !astronautId) return {};
  try {
    const raw = localStorage.getItem(dailyTasksStorageKey(astronautId));
    if (!raw) return {};
    return JSON.parse(raw) as DailyTaskState;
  } catch {
    return {};
  }
}

export function saveDailyTasks(astronautId: string, state: DailyTaskState) {
  if (typeof window === "undefined" || !astronautId) return;
  localStorage.setItem(dailyTasksStorageKey(astronautId), JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("errno:daily-tasks", { detail: { astronautId } }));
}

export function markDailyTask(astronautId: string, id: DailyTaskId, done = true) {
  const next = { ...loadDailyTasks(astronautId), [id]: done };
  // Completing exercise sub-steps also marks the main exercise task when all three are done.
  if (id === "warmup" || id === "cardio" || id === "strength") {
    const warm = id === "warmup" ? done : !!next.warmup;
    const cardio = id === "cardio" ? done : !!next.cardio;
    const strength = id === "strength" ? done : !!next.strength;
    if (warm && cardio && strength) next.exercise = true;
  }
  saveDailyTasks(astronautId, next);
  return next;
}
