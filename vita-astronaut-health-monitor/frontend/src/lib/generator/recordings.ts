import type { ActivityMode } from "./catalog";

/**
 * A run kept in localStorage. Frames hold only what was sent, so a recording of the full
 * ten minutes stays well under the storage quota. ECG is rebuilt from heart rate on replay.
 */
export interface RecFrame {
  /** Milliseconds since the run began. */
  t: number;
  /** Index into `crew`. */
  a: number;
  /** Index into MODES. */
  m: number;
  /** Flat pairs [codeIndex (+1000 when quality was low), value, ...]. */
  v: number[];
}

export interface Recording {
  v: 1;
  id: string;
  name: string;
  createdAt: number;
  durationMs: number;
  timeScale: number;
  scenario: string | null;
  crew: string[];
  codes: string[];
  frames: RecFrame[];
}

export interface RecordingMeta {
  id: string;
  name: string;
  createdAt: number;
  durationMs: number;
  timeScale: number;
  scenario: string | null;
  crew: string[];
  frames: number;
  bytes: number;
}

export const MODES: ActivityMode[] = ["rest", "work", "sleep", "exercise", "eva"];
export const MAX_RECORDINGS = 3;
const KEY = "errno:gen:recordings";

export function loadRecordings(): Recording[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isRecording) : [];
  } catch {
    return [];
  }
}

/** Saves newest first. When the quota is hit the oldest recording goes, then frames are thinned. */
export function saveRecordings(list: Recording[]): Recording[] {
  let items = list.slice(0, MAX_RECORDINGS);
  for (;;) {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
      return items;
    } catch {
      if (items.length > 1) items = items.slice(0, -1);
      else if (items[0] && items[0].frames.length > 40) items = [{ ...items[0], frames: items[0].frames.filter((_, i) => i % 2 === 0) }];
      else return items;
    }
  }
}

export function metaOf(rec: Recording): RecordingMeta {
  return {
    id: rec.id,
    name: rec.name,
    createdAt: rec.createdAt,
    durationMs: rec.durationMs,
    timeScale: rec.timeScale,
    scenario: rec.scenario,
    crew: rec.crew,
    frames: rec.frames.length,
    bytes: JSON.stringify(rec).length,
  };
}

export function isRecording(value: unknown): value is Recording {
  if (!value || typeof value !== "object") return false;
  const rec = value as Partial<Recording>;
  return (
    rec.v === 1 &&
    typeof rec.id === "string" &&
    typeof rec.durationMs === "number" &&
    typeof rec.timeScale === "number" &&
    Array.isArray(rec.crew) &&
    Array.isArray(rec.codes) &&
    Array.isArray(rec.frames) &&
    rec.frames.every((frame) => frame && typeof frame.t === "number" && Array.isArray(frame.v))
  );
}

export function newRecordingId(): string {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
