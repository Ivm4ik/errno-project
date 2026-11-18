/**
 * Sensor Sanity + Cross-Validation — mirrors backend/scoring/validate.py.
 * Equipment faults never paint clinical red or feed Health Score.
 */

export const SIGNAL_OK = "OK" as const;
export const SIGNAL_LOST = "SIGNAL_LOST" as const;
export const SENSOR_ANOMALY = "SENSOR_ANOMALY" as const;
export const FORM_PENDING = "FORM_PENDING" as const;
export type SignalStatus = typeof SIGNAL_OK | typeof SIGNAL_LOST | typeof SENSOR_ANOMALY | typeof FORM_PENDING;
export type AnomalyKind = "lost" | "bounds" | "fusion";

const FORM_EMPTY_ZERO = new Set([
  "SLP_DUR", "sleep_hours", "SLP_QUAL", "sleep_quality", "SLP_EFF", "sleep_efficiency",
  "MH_SCORE", "mh_score", "psych_score", "wellbeing", "WELL",
]);

const SURVIVAL: Record<string, [number, number]> = {
  hr: [25, 240],
  HR: [25, 240],
  temp: [32, 43],
  TEMP: [32, 43],
  resp: [4, 60],
  RR: [4, 60],
  spo2: [50, 100],
  SPO2: [50, 100],
  bp_sys: [40, 260],
  BP: [40, 260],
  bp_dia: [30, 150],
  BPD: [30, 150],
  glucose: [18, 540],
  GLU: [18, 540],
  lactate: [0, 20],
  LAC: [0, 20],
  icp: [0, 40],
  ICP: [0, 40],
  k: [1, 9],
  K: [1, 9],
  na: [100, 180],
  NA: [100, 180],
  ca: [4, 16],
  CA: [4, 16],
  co2: [0, 10],
  CO2: [0, 10],
  eeg: [0, 100],
  EEG: [0, 100],
  radiation_dose_rate: [0, 50],
  RAD: [0, 50],
};

const ZERO_MEANS_LOST = new Set([
  "hr", "HR", "spo2", "SPO2", "resp", "RR",
  "bp_sys", "BP", "bp_dia", "BPD", "temp", "TEMP",
]);

const FUSION_PEERS = new Set([
  "hr", "HR", "spo2", "SPO2", "resp", "RR",
  "bp_sys", "BP", "bp_dia", "BPD", "temp", "TEMP",
]);

const GREEN: Record<string, [number, number]> = {
  hr: [60, 100], HR: [60, 100],
  spo2: [95, 100], SPO2: [95, 100],
  bp_sys: [90, 120], BP: [90, 120],
  bp_dia: [60, 80], BPD: [60, 80],
  resp: [12, 20], RR: [12, 20],
  temp: [36.1, 37.2], TEMP: [36.1, 37.2],
};

const EXTREME: Record<string, [number, number]> = {
  hr: [50, 160], HR: [50, 160],
  spo2: [90, 100], SPO2: [90, 100],
  bp_sys: [85, 160], BP: [85, 160],
  bp_dia: [45, 100], BPD: [45, 100],
  resp: [8, 28], RR: [8, 28],
  temp: [35, 39], TEMP: [35, 39],
};

export function isFault(status: SignalStatus): boolean {
  return status === SIGNAL_LOST || status === SENSOR_ANOMALY;
}

export function isFormPending(metric: string, value: number | null | undefined): boolean {
  if (!FORM_EMPTY_ZERO.has(metric)) return false;
  if (value == null || Number.isNaN(value)) return true;
  return value <= 0;
}

export function validateSensorData(
  metric: string,
  value: number | null | undefined,
  plausible?: [number, number] | null,
): SignalStatus {
  if (isFormPending(metric, value)) return FORM_PENDING;
  if (value == null || Number.isNaN(value)) return SIGNAL_LOST;
  if (value === 0 && ZERO_MEANS_LOST.has(metric)) return SIGNAL_LOST;
  const bounds = plausible && plausible.length === 2 ? plausible : SURVIVAL[metric];
  if (bounds) {
    const [lo, hi] = bounds;
    if (value < lo || value > hi) return SENSOR_ANOMALY;
  }
  return SIGNAL_OK;
}

function isClinicalExtreme(metric: string, value: number): boolean {
  const band = EXTREME[metric];
  if (!band) return false;
  const [lo, hi] = band;
  if (metric === "spo2" || metric === "SPO2") return value <= lo;
  return value < lo || value > hi;
}

function isGreenVital(metric: string, value: number): boolean {
  const band = GREEN[metric];
  if (!band) return false;
  return value >= band[0] && value <= band[1];
}

export function classifySensor(
  metric: string,
  value: number | null | undefined,
  peers?: Record<string, number | null | undefined> | null,
  plausible?: [number, number] | null,
): SignalStatus {
  const status = validateSensorData(metric, value, plausible);
  if (status !== SIGNAL_OK || value == null || Number.isNaN(value)) return status;
  if (!peers || !FUSION_PEERS.has(metric) || !isClinicalExtreme(metric, value)) return SIGNAL_OK;

  let greenPeers = 0;
  for (const [key, raw] of Object.entries(peers)) {
    if (key === metric || !FUSION_PEERS.has(key) || raw == null || Number.isNaN(raw)) continue;
    if (validateSensorData(key, raw) !== SIGNAL_OK) continue;
    if (isClinicalExtreme(key, raw)) return SIGNAL_OK;
    if (!isGreenVital(key, raw)) return SIGNAL_OK;
    greenPeers += 1;
  }
  return greenPeers >= 2 ? SENSOR_ANOMALY : SIGNAL_OK;
}

export function anomalyKindOf(
  metric: string,
  value: number | null | undefined,
  peers?: Record<string, number | null | undefined> | null,
): AnomalyKind | null {
  const full = classifySensor(metric, value, peers);
  if (full === SIGNAL_LOST) return "lost";
  if (full !== SENSOR_ANOMALY) return null;
  return validateSensorData(metric, value) === SIGNAL_OK ? "fusion" : "bounds";
}

export function isSignalLost(
  metric: string,
  value: number | null | undefined,
  plausible?: [number, number] | null,
): boolean {
  return isFault(validateSensorData(metric, value, plausible));
}

export function isSensorFault(
  metric: string,
  value: number | null | undefined,
  peers?: Record<string, number | null | undefined> | null,
): boolean {
  return isFault(classifySensor(metric, value, peers));
}
