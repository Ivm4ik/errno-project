/**
 * What the browser generator can simulate: crew, sensors, baselines and tolerances.
 * Numbers follow the monitoring tables the backend scores against (Astro1 / Astro2).
 */

export type ActivityMode = "rest" | "work" | "sleep" | "exercise" | "eva";
export type SensorGroup = "continuous" | "chem" | "daily" | "rare";

export const ACTIVITY_MODES: ActivityMode[] = ["rest", "work", "sleep", "exercise", "eva"];

/** The ingest API only knows rest, exercise and eva. Sleep and work stay inside the signal. */
export function wireMode(mode: ActivityMode): "rest" | "exercise" | "eva" {
  return mode === "exercise" || mode === "eva" ? mode : "rest";
}

export interface CrewMember {
  id: string;
  /** Key in the translation table. */
  nameKey: string;
  baseline: "A1" | "A2";
}

export const CREW: CrewMember[] = [
  { id: "A1", nameKey: "gen.crew.A1", baseline: "A1" },
  { id: "A2", nameKey: "gen.crew.A2", baseline: "A2" },
];

export interface MetricDef {
  /** Short code used by scenarios and the UI (HR, SPO2, ...). */
  code: string;
  /** Sensor id on the wire. */
  id: string;
  unit: string;
  /** Ship-time seconds between samples. */
  every: number;
  group: SensorGroup;
  /** Baseline for A1 and A2. Anyone else uses A1. */
  base: { A1: number; A2: number };
  /** Tolerance: yellow beyond 1x, red beyond 2x. */
  tol: number;
  /** Hard clip of the simulated value. */
  clip: [number, number];
  decimals: number;
  /** English fallback when the dictionary has no `sensor.<id>` entry. */
  name: string;
}

const same = (value: number) => ({ A1: value, A2: value });

export const METRICS: MetricDef[] = [
  // Continuous
  { code: "HR", id: "hr", unit: "bpm", every: 1, group: "continuous", base: { A1: 80, A2: 78 }, tol: 12, clip: [0, 300], decimals: 1, name: "Heart rate" },
  { code: "ECG", id: "ecg", unit: "mV", every: 0.1, group: "continuous", base: same(0), tol: 0.4, clip: [-2.5, 2.5], decimals: 4, name: "ECG Lead II" },
  { code: "SPO2", id: "spo2", unit: "%", every: 1, group: "continuous", base: { A1: 98, A2: 97 }, tol: 2, clip: [0, 100], decimals: 1, name: "Blood oxygen" },
  { code: "RR", id: "resp", unit: "breaths/min", every: 1, group: "continuous", base: { A1: 16, A2: 15 }, tol: 3, clip: [0, 80], decimals: 1, name: "Respiration" },
  { code: "TEMP", id: "temp", unit: "C", every: 1, group: "continuous", base: { A1: 36.6, A2: 36.7 }, tol: 0.4, clip: [25, 48], decimals: 2, name: "Body temperature" },
  { code: "EEG", id: "eeg", unit: "index", every: 1, group: "continuous", base: { A1: 20, A2: 18 }, tol: 10, clip: [0, 100], decimals: 1, name: "EEG fatigue index" },
  { code: "ICP", id: "icp", unit: "mmHg", every: 1, group: "continuous", base: { A1: 11, A2: 10 }, tol: 2.5, clip: [0, 40], decimals: 1, name: "Intracranial pressure" },
  { code: "CO2", id: "co2", unit: "%", every: 1, group: "continuous", base: { A1: 0.3, A2: 0.28 }, tol: 0.15, clip: [0, 10], decimals: 3, name: "Cabin CO2" },
  { code: "RAD", id: "radiation_dose_rate", unit: "mSv/day", every: 1, group: "continuous", base: { A1: 0.2, A2: 0.25 }, tol: 0.15, clip: [0, 50], decimals: 3, name: "Radiation dose rate" },
  { code: "ACT", id: "activity", unit: "counts/min", every: 1, group: "continuous", base: { A1: 220, A2: 200 }, tol: 40, clip: [0, 5000], decimals: 0, name: "Activity" },
  { code: "HRV", id: "hrv_rmssd", unit: "ms", every: 1, group: "continuous", base: same(45), tol: 10, clip: [1, 300], decimals: 1, name: "Heart rate variability" },
  { code: "EEGA", id: "eeg_alpha", unit: "relative", every: 1, group: "continuous", base: same(0.35), tol: 0.06, clip: [0, 1], decimals: 3, name: "EEG alpha" },
  { code: "EEGT", id: "eeg_theta", unit: "relative", every: 1, group: "continuous", base: same(0.25), tol: 0.06, clip: [0, 1], decimals: 3, name: "EEG theta" },
  { code: "EEGB", id: "eeg_beta", unit: "relative", every: 1, group: "continuous", base: same(0.2), tol: 0.05, clip: [0, 1], decimals: 3, name: "EEG beta" },
  // Subcutaneous chemistry, every 30 minutes
  { code: "LAC", id: "lactate", unit: "mmol/L", every: 1800, group: "chem", base: { A1: 1.2, A2: 1.0 }, tol: 0.6, clip: [0, 20], decimals: 2, name: "Lactate" },
  { code: "GLU", id: "glucose", unit: "mg/dL", every: 1800, group: "chem", base: { A1: 85, A2: 88 }, tol: 10, clip: [10, 540], decimals: 1, name: "Glucose" },
  { code: "K", id: "k", unit: "mmol/L", every: 1800, group: "chem", base: { A1: 4.2, A2: 4.18 }, tol: 0.4, clip: [1, 9], decimals: 2, name: "Potassium" },
  { code: "NA", id: "na", unit: "mmol/L", every: 1800, group: "chem", base: { A1: 140, A2: 138 }, tol: 3, clip: [100, 180], decimals: 1, name: "Sodium" },
  { code: "CA", id: "ca", unit: "mg/dL", every: 1800, group: "chem", base: { A1: 9.4, A2: 9.2 }, tol: 0.5, clip: [4, 16], decimals: 2, name: "Calcium" },
  { code: "CORT", id: "cortisol", unit: "relative", every: 1800, group: "chem", base: same(300), tol: 40, clip: [0, 900], decimals: 0, name: "Cortisol" },
  // Daily
  { code: "BP", id: "bp_sys", unit: "mmHg", every: 86400, group: "daily", base: { A1: 110, A2: 108 }, tol: 10, clip: [40, 260], decimals: 0, name: "Systolic pressure" },
  { code: "BPD", id: "bp_dia", unit: "mmHg", every: 86400, group: "daily", base: { A1: 70, A2: 68 }, tol: 8, clip: [20, 160], decimals: 0, name: "Diastolic pressure" },
  { code: "WELL", id: "wellbeing", unit: "1-10", every: 86400, group: "daily", base: same(7), tol: 1.5, clip: [1, 10], decimals: 1, name: "Wellbeing" },
  { code: "SLP", id: "sleep_hours", unit: "h", every: 86400, group: "daily", base: { A1: 7.5, A2: 7.2 }, tol: 0.8, clip: [0, 16], decimals: 1, name: "Sleep duration" },
  { code: "SLQ", id: "sleep_quality", unit: "1-10", every: 86400, group: "daily", base: same(7), tol: 1.5, clip: [1, 10], decimals: 1, name: "Sleep quality" },
  { code: "RADC", id: "radiation_career", unit: "mSv", every: 86400, group: "daily", base: { A1: 80, A2: 75 }, tol: 5, clip: [0, 800], decimals: 2, name: "Accumulated dose" },
  { code: "PSY", id: "psych_score", unit: "0-100", every: 86400, group: "daily", base: same(75), tol: 8, clip: [0, 100], decimals: 0, name: "Psychological state" },
  // Rare: blood, ultrasound, cognitive tests
  { code: "WBC", id: "wbc", unit: "10^9/L", every: 604800, group: "rare", base: { A1: 6.5, A2: 6.2 }, tol: 1.0, clip: [0.5, 50], decimals: 2, name: "White blood cells" },
  { code: "HCT", id: "hematocrit", unit: "%", every: 604800, group: "rare", base: { A1: 42, A2: 41 }, tol: 2, clip: [10, 70], decimals: 1, name: "Hematocrit" },
  { code: "CREA", id: "creatinine", unit: "umol/L", every: 604800, group: "rare", base: { A1: 80, A2: 78 }, tol: 8, clip: [20, 400], decimals: 0, name: "Creatinine" },
  { code: "US", id: "ultrasound", unit: "index", every: 1814400, group: "rare", base: { A1: 92, A2: 90 }, tol: 6, clip: [0, 100], decimals: 0, name: "Muscle/bone ultrasound" },
  { code: "PVT", id: "pvt_rt_median", unit: "ms", every: 604800, group: "rare", base: same(240), tol: 25, clip: [100, 800], decimals: 0, name: "Reaction time" },
  { code: "PVL", id: "pvt_lapses", unit: "count", every: 604800, group: "rare", base: same(0), tol: 1, clip: [0, 20], decimals: 0, name: "PVT lapses" },
  { code: "VIS", id: "vision_score", unit: "0-100", every: 604800, group: "rare", base: same(90), tol: 6, clip: [0, 100], decimals: 0, name: "Vision" },
];

export const METRIC_BY_CODE: Record<string, MetricDef> = Object.fromEntries(METRICS.map((metric) => [metric.code, metric]));
export const SCALAR_METRICS = METRICS.filter((metric) => metric.code !== "ECG");
export const GROUPS: SensorGroup[] = ["continuous", "chem", "daily", "rare"];

/** Physiological offsets per activity. Exercise lifts HR, RR and lactate; the backend forgives that. */
export const ACTIVITY_OFFSET: Record<ActivityMode, Record<string, number>> = {
  sleep: { HR: -8, RR: -2, TEMP: -0.1, ACT: -150 },
  rest: {},
  work: { ACT: 80 },
  exercise: { HR: 45, RR: 8, LAC: 1.4, ACT: 400 },
  eva: { HR: 12, RR: 2, CO2: 0.04, ACT: 180 },
};

export function baselineOf(def: MetricDef, astronautId: string): number {
  return astronautId === "A2" ? def.base.A2 : def.base.A1;
}

export type Zone = "green" | "yellow" | "red";

/** Yellow beyond one tolerance from the baseline, red beyond two. */
export function zoneOf(def: MetricDef, astronautId: string, value: number): Zone {
  const delta = Math.abs(value - baselineOf(def, astronautId));
  if (delta > def.tol * 2) return "red";
  if (delta > def.tol) return "yellow";
  return "green";
}

export function clipValue(def: MetricDef, value: number): number {
  const [low, high] = def.clip;
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, value));
}

export function round(def: MetricDef, value: number): number {
  const factor = 10 ** def.decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Real seconds between two samples. Ship periods are compressed by the time scale, but rare
 * channels are capped so a demo still sees them: chemistry 5-30 s, daily 45-90 s.
 */
export function wallPeriodSec(every: number, timeScale: number): number {
  const scale = Math.max(timeScale, 1);
  const raw = every / scale;
  const clamp = (low: number, high: number) => Math.max(low, Math.min(raw, high));
  if (every >= 86400) return clamp(45, 90);
  if (every >= 3600) return clamp(8, 40);
  if (every >= 1800) return clamp(5, 30);
  return Math.max(0.25, raw);
}

export const TIME_SCALES = [1, 10, 60, 120] as const;
export const MAX_RUN_MS = 10 * 60 * 1000;
export const TICK_MS = 500;
