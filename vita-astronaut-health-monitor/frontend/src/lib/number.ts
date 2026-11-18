import { getLocale } from "./locale-store";
import { translate } from "./translations";

const DIGITS: Record<string, number> = {
  hr: 0,
  resp: 0,
  activity: 0,
  bp_sys: 0,
  bp_dia: 0,
  pvt_lapses: 0,
  pvt_rt_median: 0,
  cortisol: 0,
  na: 0,
  creatinine: 0,
  psych_score: 0,
  mh_score: 1,
  vision_score: 0,
  hematocrit: 0,
  spo2: 1,
  temp: 1,
  sleep_hours: 1,
  sleep_quality: 1,
  wellbeing: 1,
  glucose: 1,
  lactate: 1,
  icp: 1,
  wbc: 1,
  k: 1,
  eeg_alpha: 2,
  eeg_theta: 2,
  eeg_beta: 2,
};

const UNIT_KEYS: Record<string, string> = {
  hr: "unit.hr",
  resp: "unit.resp",
  spo2: "%",
  temp: "°C",
  bp_sys: "unit.bp",
  bp_dia: "unit.bp",
  icp: "unit.bp",
  sleep_hours: "unit.hours",
  glucose: "unit.mgdl",
  ca: "unit.mgdl",
  co2: "%",
  eeg: "unit.index",
  radiation_dose_rate: "unit.msv",
  lactate: "unit.mmol",
  wbc: "unit.wbc",
  na: "unit.mmol",
  k: "unit.mmol",
  creatinine: "unit.umol",
  hematocrit: "%",
  activity: "unit.activity",
  eeg_alpha: "unit.rel",
  eeg_theta: "unit.rel",
  eeg_beta: "unit.rel",
  cortisol: "unit.rel",
  psych_score: "%",
  mh_score: "/20",
  wellbeing: "unit.points",
  sleep_quality: "unit.points",
  vision_score: "unit.points",
  pvt_rt_median: "ms",
  pvt_lapses: "unit.lapses",
};

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(digits: number) {
  const locale = getLocale() === "en" ? "en-US" : "uk-UA";
  const key = `${locale}:${digits}`;
  let format = formatters.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    formatters.set(key, format);
  }
  return format;
}

export function formatNumber(value: number | null | undefined, digits = 1) {
  if (value == null || Number.isNaN(value)) return "—";
  return formatter(digits).format(value);
}

export function formatVital(sensor: string, value: number | null | undefined) {
  return formatNumber(value, DIGITS[sensor] ?? 1);
}

export function vitalInput(sensor: string, value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "";
  const digits = DIGITS[sensor] ?? 1;
  const factor = 10 ** digits;
  return (Math.round(value * factor) / factor).toFixed(digits);
}

export function unitOf(sensor: string, fallback = "") {
  const entry = UNIT_KEYS[sensor];
  if (!entry) return fallback;
  if (entry.startsWith("unit.")) return translate(getLocale(), entry);
  return entry;
}

export function formatWhen(ts: number) {
  const locale = getLocale() === "en" ? "en-US" : "uk-UA";
  return new Date(ts * 1000).toLocaleString(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatClock(ts: number) {
  const locale = getLocale() === "en" ? "en-US" : "uk-UA";
  return new Date(ts * 1000).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "—";
}
