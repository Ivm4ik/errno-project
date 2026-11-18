import type { ErrnoMetric, ErrnoStatus } from "@/lib/api/errno";
import type { TranslationKey } from "@/lib/translations";

export type Tone = "Nominal" | "Caution" | "Critical" | "Unknown";

export const TONE_KEY: Record<Tone, TranslationKey> = {
  Nominal: "medic.tone.nominal",
  Caution: "medic.tone.caution",
  Critical: "medic.tone.critical",
  Unknown: "medic.tone.unknown",
};

export const FIELD_KEY: Record<string, TranslationKey> = {
  value: "medic.field.value",
  min: "medic.field.min",
  max: "medic.field.max",
};

export function latestOf(metrics: ErrnoMetric[] | undefined, astronautId: string, sensorId: string) {
  const metric = metrics?.find((item) => item.id === sensorId);
  const value = metric?.latest.find((item) => item.astronaut_id === astronautId);
  return value ? { metric: metric!, value } : undefined;
}

/** Badge follows the penalty status machine. Out-of-range cells stay red separately. */
export function toneOf(status: ErrnoStatus | undefined, hasVitals: boolean, _outOfRange = 0): Tone {
  if (status?.status === 2 || status?.level === "CALL_DOCTOR_NOW" || status?.help_needed || status?.level === "Act") return "Critical";
  if (status?.status === 1 || status?.level === "ALLOW_FINISH_MISSION" || status?.level === "Watch") return "Caution";
  if (!hasVitals && status?.status == null) return "Unknown";
  return "Nominal";
}
