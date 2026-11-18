import type { ActivityMode } from "./catalog";

/**
 * Ready-made situations. Time is in real seconds since the scenario started, so a scenario lasts
 * the same on screen at any ship-time scale. After it ends the crew drifts back to nominal.
 */
export type EffectKind = "step" | "ramp" | "hold" | "dropout" | "spike";

export interface Effect {
  at: number;
  duration: number;
  code: string;
  effect: EffectKind;
  magnitude?: number;
}

export interface ModeWindow {
  at: number;
  duration: number;
  mode: ActivityMode;
}

export interface CrewScript {
  effects: Effect[];
  modes?: ModeWindow[];
}

export type Tone = "ok" | "warn" | "crit";

export interface Scenario {
  id: string;
  tone: Tone;
  /** Real seconds. */
  duration: number;
  /** Which status the backend should reach, for the hint on the card. */
  expect: 0 | 1 | 2;
  crew: Record<string, CrewScript>;
  /** Link to Earth is down inside this window; frames are buffered and flushed afterwards. */
  linkLoss?: [number, number];
}

const whole = (duration: number, mode: ActivityMode): ModeWindow[] => [{ at: 0, duration, mode }];

export const SCENARIOS: Scenario[] = [
  {
    id: "nominal",
    tone: "ok",
    duration: 60,
    expect: 0,
    crew: { A1: { effects: [], modes: whole(60, "work") }, A2: { effects: [], modes: whole(60, "rest") } },
  },
  {
    id: "exercise_false_alarm",
    tone: "ok",
    duration: 60,
    expect: 0,
    crew: { A1: { effects: [], modes: whole(60, "exercise") } },
  },
  {
    id: "mild_warning",
    tone: "warn",
    duration: 45,
    expect: 1,
    crew: { A1: { effects: [{ at: 0, duration: 45, code: "TEMP", effect: "step", magnitude: 1.0 }], modes: whole(45, "rest") } },
  },
  {
    id: "slow_drift",
    tone: "warn",
    duration: 150,
    expect: 2,
    crew: { A1: { effects: [{ at: 0, duration: 150, code: "BP", effect: "ramp", magnitude: 45 }], modes: whole(150, "rest") } },
  },
  {
    id: "cardiac_stress",
    tone: "crit",
    duration: 50,
    expect: 2,
    crew: {
      A1: {
        effects: [
          { at: 0, duration: 50, code: "HR", effect: "step", magnitude: 72 },
          { at: 0, duration: 50, code: "RR", effect: "step", magnitude: 9 },
          { at: 0, duration: 50, code: "BP", effect: "step", magnitude: 22 },
        ],
        modes: whole(50, "rest"),
      },
    },
  },
  {
    id: "solar_storm",
    tone: "crit",
    duration: 120,
    expect: 2,
    crew: {
      A1: {
        effects: [
          { at: 0, duration: 120, code: "RAD", effect: "step", magnitude: 1.8 },
          { at: 20, duration: 100, code: "HR", effect: "ramp", magnitude: 15 },
        ],
        modes: whole(120, "eva"),
      },
    },
  },
  {
    id: "hypoglycemia",
    tone: "crit",
    duration: 60,
    expect: 2,
    crew: { A1: { effects: [{ at: 0, duration: 60, code: "GLU", effect: "hold", magnitude: 40 }], modes: whole(60, "rest") } },
  },
  {
    id: "hyperkalemia",
    tone: "crit",
    duration: 60,
    expect: 2,
    crew: { A1: { effects: [{ at: 0, duration: 60, code: "K", effect: "hold", magnitude: 6.0 }], modes: whole(60, "rest") } },
  },
  {
    id: "co2_leak",
    tone: "crit",
    duration: 60,
    expect: 2,
    crew: { A1: { effects: [{ at: 0, duration: 60, code: "CO2", effect: "hold", magnitude: 1.5 }], modes: whole(60, "rest") } },
  },
  {
    id: "infection",
    tone: "crit",
    duration: 120,
    expect: 2,
    crew: {
      A1: {
        effects: [
          { at: 0, duration: 120, code: "TEMP", effect: "step", magnitude: 1.2 },
          { at: 0, duration: 120, code: "SPO2", effect: "step", magnitude: -4 },
          { at: 40, duration: 80, code: "HR", effect: "step", magnitude: 18 },
        ],
        modes: whole(120, "rest"),
      },
    },
  },
  {
    id: "sleep_loss",
    tone: "warn",
    duration: 60,
    expect: 1,
    crew: {
      A1: {
        effects: [
          { at: 0, duration: 60, code: "SLP", effect: "hold", magnitude: 2.0 },
          { at: 0, duration: 60, code: "SLQ", effect: "hold", magnitude: 1.0 },
        ],
        modes: whole(60, "sleep"),
      },
    },
  },
  {
    id: "comms_loss",
    tone: "warn",
    duration: 80,
    expect: 0,
    linkLoss: [15, 45],
    crew: { A1: { effects: [], modes: whole(80, "rest") }, A2: { effects: [], modes: whole(80, "rest") } },
  },
  {
    id: "multi_astronaut",
    tone: "crit",
    duration: 60,
    expect: 2,
    crew: {
      A1: {
        effects: [
          { at: 0, duration: 60, code: "HR", effect: "step", magnitude: 72 },
          { at: 0, duration: 60, code: "RR", effect: "step", magnitude: 9 },
          { at: 0, duration: 60, code: "BP", effect: "step", magnitude: 22 },
        ],
        modes: whole(60, "rest"),
      },
      A2: { effects: [], modes: whole(60, "exercise") },
    },
  },
];

export const SCENARIO_BY_ID: Record<string, Scenario> = Object.fromEntries(SCENARIOS.map((item) => [item.id, item]));

export interface EffectResult {
  added: number;
  hold: number | null;
  dropout: boolean;
}

/** What the scenario does to one sensor `t` seconds in. */
export function effectsAt(effects: Effect[], code: string, t: number): EffectResult {
  let added = 0;
  let hold: number | null = null;
  let dropout = false;
  for (const item of effects) {
    if (item.code !== code) continue;
    if (!(t >= item.at && t < item.at + item.duration)) continue;
    const magnitude = item.magnitude ?? 0;
    const span = Math.max(item.duration, 1e-9);
    const phase = (t - item.at) / span;
    if (item.effect === "dropout") dropout = true;
    else if (item.effect === "hold") hold = magnitude;
    else if (item.effect === "ramp") added += magnitude * phase;
    else if (item.effect === "spike") added += t < item.at + Math.min(8, item.duration) ? magnitude : 0;
    else added += magnitude;
  }
  return { added, hold, dropout };
}

export function modeAt(modes: ModeWindow[] | undefined, t: number): ActivityMode | null {
  for (const item of modes ?? []) {
    if (t >= item.at && t < item.at + item.duration) return item.mode;
  }
  return null;
}
