import { getLocale } from "./locale-store";
import { hasTranslation, translate } from "./translations";
import { isFormPending, isSignalLost } from "./validate-sensor";

export type Band = "green" | "yellow" | "red";

export interface Protocol {
  hud: string;
  officer: string;
  surgeon: string;
}

const PROTOCOL_SENSORS = [
  "hr",
  "resp",
  "spo2",
  "bp_sys",
  "temp",
  "glucose",
  "k",
  "na",
  "lactate",
  "icp",
  "sleep_hours",
] as const;

export function bandOf(sensor: string, value: number | null | undefined): Band | null {
  // No clinical colour for equipment faults or unsubmitted daily forms.
  if (value == null || Number.isNaN(value) || isFormPending(sensor, value) || isSignalLost(sensor, value)) return null;
  if (sensor === "hr") return value < 50 || value > 120 ? "red" : value < 60 || value > 100 ? "yellow" : "green";
  if (sensor === "resp") return value < 10 || value > 24 ? "red" : value < 12 || value > 20 ? "yellow" : "green";
  if (sensor === "spo2") return value <= 90 ? "red" : value < 95 ? "yellow" : "green";
  if (sensor === "bp_sys") return value < 90 || value >= 140 ? "red" : value > 120 ? "yellow" : "green";
  if (sensor === "temp") return value < 35.5 || value >= 38 ? "red" : value < 36.1 || value > 37.2 ? "yellow" : "green";
  if (sensor === "glucose") return value < 55 || value > 125 ? "red" : value < 70 || value > 99 ? "yellow" : "green";
  if (sensor === "ca") return value <= 8 || value > 10.8 ? "red" : value < 8.5 || value > 10.2 ? "yellow" : "green";
  if (sensor === "co2") return value > 1 ? "red" : value >= 0.5 ? "yellow" : "green";
  if (sensor === "eeg") return value > 70 ? "red" : value > 40 ? "yellow" : "green";
  if (sensor === "radiation_dose_rate") return value > 1.5 ? "red" : value >= 0.5 ? "yellow" : "green";
  if (sensor === "k") return value < 3.2 || value >= 5.5 ? "red" : value < 3.5 || value > 5 ? "yellow" : "green";
  if (sensor === "na") return value < 130 || value > 150 ? "red" : value < 135 || value > 145 ? "yellow" : "green";
  if (sensor === "lactate") return value >= 4 ? "red" : value > 2.2 ? "yellow" : "green";
  if (sensor === "icp") return value > 20 ? "red" : value > 15 || value < 7 ? "yellow" : "green";
  if (sensor === "sleep_hours") return value < 5 ? "red" : value < 6.5 || value > 8.5 ? "yellow" : "green";
  return null;
}

export function protocol(sensor: string): Protocol | undefined {
  if (!(PROTOCOL_SENSORS as readonly string[]).includes(sensor)) return undefined;
  const hud = `protocol.${sensor}.hud`;
  const officer = `protocol.${sensor}.officer`;
  const surgeon = `protocol.${sensor}.surgeon`;
  if (!hasTranslation(hud) || !hasTranslation(officer) || !hasTranslation(surgeon)) return undefined;
  const locale = getLocale();
  return {
    hud: translate(locale, hud),
    officer: translate(locale, officer),
    surgeon: translate(locale, surgeon),
  };
}

export function worst(bands: Array<Band | null | undefined>): Band {
  if (bands.includes("red")) return "red";
  if (bands.includes("yellow")) return "yellow";
  return "green";
}
