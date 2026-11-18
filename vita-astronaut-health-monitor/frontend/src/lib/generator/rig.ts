import {
  ACTIVITY_OFFSET,
  METRIC_BY_CODE,
  SCALAR_METRICS,
  baselineOf,
  clipValue,
  round,
  wallPeriodSec,
  type ActivityMode,
  type MetricDef,
} from "./catalog";
import { ECG_FS, ecgChunk } from "./ecg";
import { Rng, hashCode } from "./rng";
import { effectsAt, modeAt, type CrewScript } from "./scenarios";

export interface Sample {
  code: string;
  id: string;
  unit: string;
  value: number;
  quality: number;
}

export interface TickInput {
  /** Run clock in ms (pauses excluded). */
  nowMs: number;
  timeScale: number;
  /** Ship-time seconds since the run began. */
  simSec: number;
  /** Emit every sensor now, ignoring its schedule. */
  force?: boolean;
  /** Real seconds since the scenario began; null when none runs. */
  scenarioT: number | null;
  script: CrewScript | null;
}

export interface TickOutput {
  samples: Sample[];
  ecg: number[];
  /** Mode actually in force (a scenario may override the manual one). */
  mode: ActivityMode;
}

interface Channel {
  /** Free-running value the auto generator drifts around. */
  auto: number;
  lastEmitMs: number;
  faultUntilMs: number;
  faultKind: "dropout" | "stuck" | null;
  stuckValue: number;
}

const FAULT_RATE = 0.02;

/** One simulated astronaut: sensors with schedules, noise, manual holds and optional faults. */
export class Rig {
  readonly astronautId: string;
  /** Manual activity; a scenario can override it while it runs. */
  activity: ActivityMode = "rest";
  /** Whole-body pull away from baseline, -1.5..1.5 (0 nominal, ~0.6 yellow, ~1 red). */
  stress = 0;
  /** Manual values by code. A held sensor stays there until released. */
  hold: Record<string, number> = {};
  disabled = new Set<string>();
  /** Random dropouts and stuck sensors. */
  faults = false;

  private rng: Rng;
  private channels = new Map<string, Channel>();
  private phase = new Map<string, number>();
  private ecgPhase = 0;
  private ecgMs: number | null = null;
  private lastHr: number;

  constructor(astronautId: string, seed = 1) {
    this.astronautId = astronautId;
    this.rng = new Rng(seed + hashCode(astronautId));
    for (const def of SCALAR_METRICS) {
      this.channels.set(def.code, {
        auto: baselineOf(def, astronautId),
        lastEmitMs: Number.NEGATIVE_INFINITY,
        faultUntilMs: 0,
        faultKind: null,
        stuckValue: 0,
      });
      this.phase.set(def.code, (hashCode(def.code) % 7) + this.rng.next());
    }
    this.lastHr = baselineOf(METRIC_BY_CODE.HR!, astronautId);
  }

  /** Forget the schedule so the next tick emits everything (start of a run). */
  restart(): void {
    for (const channel of this.channels.values()) {
      channel.lastEmitMs = Number.NEGATIVE_INFINITY;
      channel.faultUntilMs = 0;
      channel.faultKind = null;
    }
    this.ecgMs = null;
  }

  /** Make one sensor report on the next tick, e.g. right after a manual hold. */
  touch(code: string): void {
    const channel = this.channels.get(code);
    if (channel) channel.lastEmitMs = Number.NEGATIVE_INFINITY;
  }

  /** Back to a calm baseline: no stress, no holds, everything on. */
  reset(): void {
    this.stress = 0;
    this.hold = {};
    this.disabled.clear();
    this.activity = "rest";
    for (const def of SCALAR_METRICS) {
      const channel = this.channels.get(def.code);
      if (channel) channel.auto = baselineOf(def, this.astronautId);
    }
  }

  tick(input: TickInput): TickOutput {
    const scenarioMode = input.scenarioT === null ? null : modeAt(input.script?.modes, input.scenarioT);
    const mode = scenarioMode ?? this.activity;
    const samples: Sample[] = [];
    const realSec = input.nowMs / 1000;

    for (const def of SCALAR_METRICS) {
      if (this.disabled.has(def.code)) continue;
      const channel = this.channels.get(def.code)!;
      const effect = input.scenarioT === null ? null : effectsAt(input.script?.effects ?? [], def.code, input.scenarioT);
      if (!input.force) {
        let periodMs = wallPeriodSec(def.every, input.timeScale) * 1000;
        // A scenario must be seen: sensors it touches report often even if they are rare by nature.
        if (effect && (effect.added !== 0 || effect.hold !== null || effect.dropout)) periodMs = Math.min(periodMs, 3000);
        if (input.nowMs - channel.lastEmitMs < periodMs * 0.92) continue;
      }
      const sample = this.sample(def, channel, input, mode, realSec, effect);
      channel.lastEmitMs = input.nowMs;
      if (!sample) continue;
      if (def.code === "HR") this.lastHr = sample.value;
      samples.push(sample);
    }
    return { samples, ecg: this.ecgSamples(input.nowMs, input.force === true), mode };
  }

  private sample(
    def: MetricDef,
    channel: Channel,
    input: TickInput,
    mode: ActivityMode,
    realSec: number,
    effect: { added: number; hold: number | null; dropout: boolean } | null,
  ): Sample | null {
    const base = baselineOf(def, this.astronautId);
    const tol = def.tol;
    let quality = 1;

    // Random faults: a dropout skips the sample, a stuck sensor repeats its value at low quality.
    if (this.faults && channel.faultKind === null && this.rng.chance(FAULT_RATE)) {
      channel.faultKind = this.rng.chance(0.45) ? "dropout" : "stuck";
      channel.faultUntilMs = input.nowMs + this.rng.uniform(2, 10) * 1000;
      channel.stuckValue = channel.auto;
    }
    if (channel.faultKind !== null && input.nowMs >= channel.faultUntilMs) channel.faultKind = null;
    if (channel.faultKind === "dropout") return null;

    // Free-running value toward the target the stress and activity set.
    const pull = Math.max(-1.5, Math.min(1.5, this.stress));
    const target = base + pull * tol * 2.5 + (ACTIVITY_OFFSET[mode][def.code] ?? 0);
    let noise = this.rng.normal(0, 0.25 * tol);
    let circ = 0.08 * tol * Math.sin((2 * Math.PI * input.simSec) / 600 + (this.phase.get(def.code) ?? 0));
    if (def.code === "EEG") {
      noise = this.rng.normal(0, 0.35) + 0.24 * Math.sin(2 * Math.PI * 10 * realSec);
      circ = 3 * Math.sin((2 * Math.PI * input.simSec) / 3600);
    } else if (def.code === "HR") {
      noise = this.rng.normal(0, 0.45) + 1.8 * Math.sin(2 * Math.PI * 0.2 * realSec);
    }
    let auto = clipValue(def, channel.auto + 0.35 * (target - channel.auto) + noise + circ);
    if (def.code === "RADC") auto = clipValue(def, auto + Math.abs(this.rng.normal(0, 0.002)));
    channel.auto = auto;

    let value = auto;
    const held = this.hold[def.code];
    if (held !== undefined) value = held + this.rng.normal(0, 0.02 * tol);
    if (effect) {
      if (effect.hold !== null) value = effect.hold + this.rng.normal(0, 0.02 * tol);
      value += effect.added;
      if (effect.dropout) quality = 0.2;
    }
    if (channel.faultKind === "stuck") {
      value = channel.stuckValue;
      quality = 0.25;
    }
    return {
      code: def.code,
      id: def.id,
      unit: def.unit,
      value: round(def, clipValue(def, value)),
      quality,
    };
  }

  /** Strip for a replay: paced by the recorded heart rate instead of the rig's own. */
  ecgFor(nowMs: number, hr: number | null): number[] {
    if (hr !== null) this.lastHr = hr;
    return this.ecgSamples(nowMs, false);
  }

  /** ECG samples owed since the last call, at 100 Hz, paced by the current heart rate. */
  private ecgSamples(nowMs: number, force: boolean): number[] {
    if (this.disabled.has("ECG")) {
      this.ecgMs = nowMs;
      return [];
    }
    const stepMs = 1000 / ECG_FS;
    if (this.ecgMs === null) this.ecgMs = nowMs - (force ? 250 : 500);
    let owed = Math.floor((nowMs - this.ecgMs) / stepMs);
    if (owed < 1) return [];
    if (owed > 100) {
      // Tab slept. Do not flood the API with a backlog of strip.
      owed = 50;
      this.ecgMs = nowMs - owed * stepMs;
    }
    this.ecgMs += owed * stepMs;
    const chunk = ecgChunk(this.ecgPhase, this.lastHr, owed, this.rng);
    this.ecgPhase = chunk.phase;
    return chunk.samples;
  }
}
