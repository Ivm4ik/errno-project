/** Organ hotspots. Lists mix crew-visible sensors and doctor-only ones; the API drops the rest. */

import type { TranslationKey } from "@/lib/translations";

export type BodySex = "male" | "female";

export type OrganId = "brain" | "heart" | "lungs" | "blood" | "nerves" | "skin";

export interface OrganDef {
  id: OrganId;
  labelKey: TranslationKey;
  /** GLB under /models/organs/ */
  model: string;
  /** Anchor on a ~1.8 m standing figure (x, y, z) — inside the torso/head. */
  pos: [number, number, number];
  /** Target height of the organ mesh after fit (metres on 1.8 m body). */
  size: number;
  /** Optional Euler rotation in radians (x, y, z). */
  rot?: [number, number, number];
  /** Preferred camera zoom when focused. */
  zoom: number;
  /** Sensors tied to this organ; API already strips role-forbidden ones. */
  sensors: readonly string[];
}

export const ORGANS: readonly OrganDef[] = [
  {
    id: "brain",
    labelKey: "organ.brain",
    model: "/models/organs/brain.glb",
    pos: [0, 1.7, -0.02],
    size: 0.14,
    zoom: 2.45,
    sensors: ["wellbeing", "sleep_quality", "icp", "eeg", "vision_score"],
  },
  {
    id: "heart",
    labelKey: "organ.heart",
    model: "/models/organs/heart.glb",
    pos: [0.06, 1.34, 0.1],
    size: 0.11,
    zoom: 2.35,
    sensors: ["hr", "bp_sys", "bp_dia", "spo2"],
  },
  {
    id: "lungs",
    labelKey: "organ.lungs",
    model: "/models/organs/lungs.glb",
    pos: [0, 1.4, -0.02],
    size: 0.3,
    zoom: 2.25,
    sensors: ["resp", "spo2", "co2"],
  },
  {
    id: "blood",
    labelKey: "organ.blood",
    model: "/models/organs/blood.glb",
    pos: [0.04, 1.02, 0.02],
    size: 0.1,
    zoom: 2.15,
    sensors: ["wbc", "hematocrit", "na", "k", "ca", "creatinine", "glucose"],
  },
  {
    id: "nerves",
    labelKey: "organ.nerves",
    model: "/models/organs/nerves.glb",
    // Marker shifted out on the left shoulder / upper arm.
    pos: [-0.22, 1.38, 0.08],
    size: 0.1,
    // Neuron study model: yaw 90° so it reads horizontally.
    rot: [45, 0, 0],
    zoom: 2.2,
    sensors: ["sleep_hours", "psych_score", "eeg", "eeg_alpha", "eeg_theta", "eeg_beta", "pvt_rt_median", "pvt_lapses"],
  },
  {
    id: "skin",
    labelKey: "organ.skin",
    model: "/models/organs/skin.glb",
    // Marker on the right forearm — subcutaneous sensor site.
    pos: [0.31, 1.05, 0.03],
    size: 0.1,
    zoom: 2.15,
    sensors: ["temp", "lactate", "cortisol"],
  },
] as const;

export const ORGAN_BY_ID = Object.fromEntries(ORGANS.map((o) => [o.id, o])) as Record<OrganId, OrganDef>;

export function bodyUrl(sex: BodySex): string {
  return sex === "female" ? "/models/body-female.glb" : "/models/body-male.glb";
}

export function bodyFallbacks(sex: BodySex): string[] {
  const primary = bodyUrl(sex);
  const other = sex === "female" ? "/models/body-male.glb" : "/models/body-female.glb";
  return [primary, other, "/models/human-muscles-light.glb"];
}
