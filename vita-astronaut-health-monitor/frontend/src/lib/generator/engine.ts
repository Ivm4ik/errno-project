import { API_BASE_URL, workspaceHeaders } from "../api/client";
import {
  CREW,
  MAX_RUN_MS,
  METRIC_BY_CODE,
  SCALAR_METRICS,
  TICK_MS,
  baselineOf,
  round,
  wireMode,
  zoneOf,
  type ActivityMode,
  type Zone,
} from "./catalog";
import { ECG_FS } from "./ecg";
import {
  MAX_RECORDINGS,
  MODES,
  isRecording,
  loadRecordings,
  metaOf,
  newRecordingId,
  saveRecordings,
  type RecFrame,
  type Recording,
  type RecordingMeta,
} from "./recordings";
import { Rig, type Sample } from "./rig";
import { SCENARIO_BY_ID } from "./scenarios";

export type Phase = "idle" | "running" | "paused" | "replaying";
export type Link = "ok" | "lost" | "flushing" | "error";

export interface ChannelView {
  value: number;
  quality: number;
  zone: Zone;
}

export interface CrewView {
  activity: ActivityMode;
  stress: number;
  hold: Record<string, number>;
  disabled: string[];
  values: Record<string, ChannelView>;
}

export interface GeneratorSnapshot {
  ready: boolean;
  phase: Phase;
  elapsedMs: number;
  maxMs: number;
  timeScale: number;
  faults: boolean;
  /** Astronauts the generator drives. */
  targets: string[];
  scenario: { id: string; t: number; duration: number } | null;
  lastScenario: string | null;
  crew: Record<string, CrewView>;
  sent: number;
  failed: number;
  link: Link;
  buffered: number;
  lastError: string | null;
  recordings: RecordingMeta[];
  replay: { id: string; speed: number; progress: number } | null;
  busyElsewhere: boolean;
  /** Set once when a run ends by itself, so the UI can say why. */
  endedBy: "limit" | "error" | "replay" | null;
}

interface Config {
  timeScale: number;
  faults: boolean;
  targets: string[];
  crew: Record<string, { activity: ActivityMode; stress: number; hold: Record<string, number>; disabled: string[] }>;
}

interface Envelope {
  device_id: string;
  astronaut_id: string;
  time_scale: number;
  activity_mode: "rest" | "exercise" | "eva";
  ts_device: number;
  buffered?: boolean;
  readings: { sensor_id: string; value: number; unit: string; quality: number; ts_device: number }[];
}

const CONFIG_KEY = "errno:gen:config";
const CURSOR_KEY = "errno:gen:cursor";
const LOCK_KEY = "errno:gen:lock";
const DEVICE_ID = "web-gen";
const LOCK_TTL_MS = 4000;
const MAX_PENDING = 12;

const EMPTY: GeneratorSnapshot = {
  ready: false,
  phase: "idle",
  elapsedMs: 0,
  maxMs: MAX_RUN_MS,
  timeScale: 60,
  faults: false,
  targets: ["A1", "A2"],
  scenario: null,
  lastScenario: null,
  crew: {},
  sent: 0,
  failed: 0,
  link: "ok",
  buffered: 0,
  lastError: null,
  recordings: [],
  replay: null,
  busyElsewhere: false,
  endedBy: null,
};

/**
 * The browser-side device. One instance per tab; the modal only renders its snapshot,
 * so closing the modal never interrupts a run.
 */
class GeneratorEngine {
  private snap: GeneratorSnapshot = EMPTY;
  private listeners = new Set<() => void>();
  private started = false;

  private rigs = new Map<string, Rig>();
  private views = new Map<string, Record<string, ChannelView>>();
  private config: Config = { timeScale: 60, faults: false, targets: CREW.map((member) => member.id), crew: {} };
  private recordings: Recording[] = [];

  private phase: Phase = "idle";
  private elapsedMs = 0;
  private simSec = 0;
  private simBase = 0;
  private lastPerf = 0;
  private forceNext = false;
  private scenarioId: string | null = null;
  private scenarioT = 0;
  private lastScenario: string | null = null;
  private link: Link = "ok";
  private held: Envelope[] = [];
  private pending = new Map<string, number>();
  private chains = new Map<string, Promise<void>>();
  private flushing = false;
  private sent = 0;
  private failed = 0;
  private streak = 0;
  private lastError: string | null = null;
  private endedBy: GeneratorSnapshot["endedBy"] = null;
  private busyElsewhere = false;
  private tabId = "";
  private lockBeatMs = 0;
  private tickCount = 0;

  private recFrames: RecFrame[] = [];
  private recMeta: { id: string; createdAt: number; scenario: string | null } | null = null;
  private recCodes: string[] = SCALAR_METRICS.map((metric) => metric.code);

  private replay: { rec: Recording; clockMs: number; realMs: number; idx: number; speed: number; rigs: Map<string, Rig>; hr: Map<string, number> } | null = null;

  private worker: Worker | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private lockPoll: ReturnType<typeof setInterval> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  // ---- store plumbing ---------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.init();
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): GeneratorSnapshot => this.snap;
  getServerSnapshot = (): GeneratorSnapshot => EMPTY;

  private init(): void {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    this.tabId = Math.random().toString(36).slice(2, 10);
    this.config = this.loadConfig();
    this.recordings = loadRecordings();
    for (const member of CREW) {
      const rig = new Rig(member.id);
      const saved = this.config.crew[member.id];
      if (saved) {
        rig.activity = saved.activity;
        rig.stress = saved.stress;
        rig.hold = { ...saved.hold };
        rig.disabled = new Set(saved.disabled);
      }
      rig.faults = this.config.faults;
      this.rigs.set(member.id, rig);
      this.views.set(member.id, {});
    }
    window.addEventListener("pagehide", () => this.persistOnExit());
    window.addEventListener("storage", (event) => {
      if (event.key === LOCK_KEY) this.refreshLock();
    });
    this.lockPoll = setInterval(() => {
      if (this.phase === "idle") this.refreshLock();
    }, 2000);
    this.refreshLock(false);
    // Defer: subscribe runs inside useSyncExternalStore, which must not trigger a state change.
    queueMicrotask(() => this.publish());
  }

  private publish(): void {
    const crew: Record<string, CrewView> = {};
    for (const member of CREW) {
      const rig = this.rigs.get(member.id);
      if (!rig) continue;
      crew[member.id] = {
        activity: rig.activity,
        stress: rig.stress,
        hold: { ...rig.hold },
        disabled: [...rig.disabled],
        values: this.displayValues(member.id, rig),
      };
    }
    const scenario = this.scenarioId ? SCENARIO_BY_ID[this.scenarioId] : null;
    this.snap = {
      ready: this.started,
      phase: this.phase,
      elapsedMs: this.replay ? this.replay.clockMs : this.elapsedMs,
      maxMs: MAX_RUN_MS,
      timeScale: this.config.timeScale,
      faults: this.config.faults,
      targets: this.config.targets,
      scenario: scenario && this.scenarioId ? { id: this.scenarioId, t: this.scenarioT, duration: scenario.duration } : null,
      lastScenario: this.lastScenario,
      crew,
      sent: this.sent,
      failed: this.failed,
      link: this.link,
      buffered: this.held.length,
      lastError: this.lastError,
      recordings: this.recordings.map(metaOf),
      replay: this.replay
        ? {
            id: this.replay.rec.id,
            speed: this.replay.speed,
            progress: Math.min(1, this.replay.clockMs / Math.max(this.replay.rec.durationMs, 1)),
          }
        : null,
      busyElsewhere: this.busyElsewhere,
      endedBy: this.endedBy,
    };
    for (const listener of this.listeners) listener();
  }

  // ---- config ----------------------------------------------------------------------------

  private loadConfig(): Config {
    const fallback: Config = { timeScale: 60, faults: false, targets: CREW.map((member) => member.id), crew: {} };
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<Config>;
      return {
        timeScale: typeof parsed.timeScale === "number" ? parsed.timeScale : 60,
        faults: parsed.faults === true,
        targets:
          Array.isArray(parsed.targets) && parsed.targets.some((id) => CREW.some((member) => member.id === id))
            ? parsed.targets.filter((id) => CREW.some((member) => member.id === id))
            : CREW.map((member) => member.id),
        crew: parsed.crew && typeof parsed.crew === "object" ? parsed.crew : {},
      };
    } catch {
      return fallback;
    }
  }

  private saveConfigSoon(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const crew: Config["crew"] = {};
      for (const [id, rig] of this.rigs) {
        crew[id] = { activity: rig.activity, stress: rig.stress, hold: rig.hold, disabled: [...rig.disabled] };
      }
      this.config.crew = crew;
      try {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
      } catch {
        // Quota or private mode: the config is a convenience only.
      }
    }, 300);
  }

  private cursor(): number {
    try {
      return Number(localStorage.getItem(CURSOR_KEY)) || 0;
    } catch {
      return 0;
    }
  }

  private saveCursor(): void {
    try {
      localStorage.setItem(CURSOR_KEY, String(this.simBase + this.simSec));
    } catch {
      // Ignore.
    }
  }

  // ---- cross-tab lock ----------------------------------------------------------------------

  private readLock(): { id: string; at: number } | null {
    try {
      const raw = localStorage.getItem(LOCK_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { id?: string; at?: number };
      return typeof parsed.id === "string" && typeof parsed.at === "number" ? { id: parsed.id, at: parsed.at } : null;
    } catch {
      return null;
    }
  }

  private refreshLock(notify = true): void {
    const lock = this.readLock();
    const busy = !!lock && lock.id !== this.tabId && Date.now() - lock.at < LOCK_TTL_MS;
    if (busy !== this.busyElsewhere) {
      this.busyElsewhere = busy;
      if (notify) this.publish();
    }
  }

  private takeLock(): boolean {
    const lock = this.readLock();
    if (lock && lock.id !== this.tabId && Date.now() - lock.at < LOCK_TTL_MS) {
      this.busyElsewhere = true;
      return false;
    }
    this.beat(true);
    return true;
  }

  private beat(force = false): void {
    const now = Date.now();
    if (!force && now - this.lockBeatMs < 1500) return;
    this.lockBeatMs = now;
    try {
      localStorage.setItem(LOCK_KEY, JSON.stringify({ id: this.tabId, at: now }));
    } catch {
      // Ignore.
    }
  }

  private dropLock(): void {
    const lock = this.readLock();
    if (lock && lock.id === this.tabId) {
      try {
        localStorage.removeItem(LOCK_KEY);
      } catch {
        // Ignore.
      }
    }
  }

  // ---- ticking -----------------------------------------------------------------------------

  private startTimer(): void {
    if (this.worker || this.interval) return;
    this.lastPerf = performance.now();
    try {
      // A worker timer is not throttled in a background tab, so the run keeps its pace.
      const url = URL.createObjectURL(new Blob([`setInterval(function(){postMessage(1)},${TICK_MS})`], { type: "text/javascript" }));
      this.worker = new Worker(url);
      URL.revokeObjectURL(url);
      this.worker.onmessage = () => this.onTick();
    } catch {
      this.worker = null;
      this.interval = setInterval(() => this.onTick(), TICK_MS);
    }
  }

  private stopTimer(): void {
    this.worker?.terminate();
    this.worker = null;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  private onTick(): void {
    const perf = performance.now();
    const dt = Math.min(perf - this.lastPerf, 2000);
    this.lastPerf = perf;
    if (this.phase === "running") this.tickLive(dt);
    else if (this.phase === "replaying") this.tickReplay(dt);
    this.publish();
  }

  private tickLive(dt: number): void {
    this.elapsedMs += dt;
    this.simSec += (dt / 1000) * this.config.timeScale;
    this.tickCount += 1;
    this.beat();

    const scenario = this.scenarioId ? SCENARIO_BY_ID[this.scenarioId] : null;
    if (scenario) {
      this.scenarioT += dt / 1000;
      if (this.scenarioT >= scenario.duration) this.finishScenario();
    }
    const active = this.scenarioId ? SCENARIO_BY_ID[this.scenarioId] : null;

    const linkDown = !!active?.linkLoss && this.scenarioT >= active.linkLoss[0] && this.scenarioT < active.linkLoss[1];
    if (linkDown && this.link !== "lost") this.link = "lost";
    if (!linkDown && this.link === "lost") this.flushHeld();

    const ts = this.simBase + this.simSec;
    for (const [id, rig] of this.rigs) {
      if (!this.config.targets.includes(id)) continue;
      const out = rig.tick({
        nowMs: this.elapsedMs,
        timeScale: this.config.timeScale,
        simSec: this.simSec,
        force: this.forceNext,
        scenarioT: active ? this.scenarioT : null,
        script: active ? this.scriptFor(active, id) : null,
      });
      this.absorb(id, out.samples);
      if (out.samples.length === 0 && out.ecg.length === 0) continue;
      this.record(id, out.mode, out.samples);
      const envelope = this.envelope(id, out.mode, ts, out.samples, out.ecg);
      if (this.link === "lost") this.held.push({ ...envelope, buffered: true });
      else this.send(id, envelope);
    }
    this.forceNext = false;

    if (this.tickCount % 20 === 0) this.saveCursor();
    if (this.elapsedMs >= MAX_RUN_MS) this.stop("limit");
  }

  /** With one astronaut chosen the scenario's main script plays on them; with both, A1 and A2 get their own. */
  private scriptFor(scenario: (typeof SCENARIO_BY_ID)[string], id: string) {
    if (this.config.targets.length === 1) return scenario.crew.A1 ?? scenario.crew[id] ?? null;
    return scenario.crew[id] ?? null;
  }

  setTargets(ids: string[]): void {
    this.init();
    const next = CREW.map((member) => member.id).filter((id) => ids.includes(id));
    if (next.length === 0) return;
    this.config.targets = next;
    this.forceNext = this.phase === "running";
    this.saveConfigSoon();
    this.publish();
  }

  private envelope(id: string, mode: ActivityMode, ts: number, samples: Sample[], ecg: number[]): Envelope {
    const scale = this.config.timeScale;
    const readings: Envelope["readings"] = samples.map((sample) => ({
      sensor_id: sample.id,
      value: sample.value,
      unit: sample.unit,
      quality: sample.quality,
      ts_device: ts,
    }));
    const ecgDef = METRIC_BY_CODE.ECG!;
    ecg.forEach((value, index) => {
      readings.push({
        sensor_id: ecgDef.id,
        value,
        unit: ecgDef.unit,
        quality: 1,
        ts_device: ts - ((ecg.length - 1 - index) / ECG_FS) * scale,
      });
    });
    return {
      device_id: DEVICE_ID,
      astronaut_id: id,
      time_scale: scale,
      activity_mode: wireMode(mode),
      ts_device: ts,
      readings,
    };
  }

  /**
   * Values to show in the sensors tab. Before a run has produced a sample, every sensor shows
   * its normal value (or the value it is pinned to), so the panel is never empty.
   */
  private displayValues(id: string, rig: Rig): Record<string, ChannelView> {
    const values: Record<string, ChannelView> = { ...(this.views.get(id) ?? {}) };
    for (const def of SCALAR_METRICS) {
      if (values[def.code]) continue;
      const value = round(def, rig.hold[def.code] ?? baselineOf(def, id));
      values[def.code] = { value, quality: 1, zone: zoneOf(def, id, value) };
    }
    return values;
  }

  private absorb(id: string, samples: Sample[]): void {
    const view = this.views.get(id);
    if (!view) return;
    for (const sample of samples) {
      const def = METRIC_BY_CODE[sample.code];
      if (!def) continue;
      view[sample.code] = { value: sample.value, quality: sample.quality, zone: zoneOf(def, id, sample.value) };
    }
  }

  // ---- sending -----------------------------------------------------------------------------

  private send(id: string, envelope: Envelope): void {
    const queued = this.pending.get(id) ?? 0;
    if (queued >= MAX_PENDING) {
      // The API is slow. Drop strip first: scalars matter more than waveform.
      envelope = { ...envelope, readings: envelope.readings.filter((item) => item.sensor_id !== "ecg") };
      if (envelope.readings.length === 0) return;
    }
    this.pending.set(id, queued + 1);
    const previous = this.chains.get(id) ?? Promise.resolve();
    const next = previous
      .then(() => this.post(envelope))
      .catch((error: unknown) => this.onSendError(error))
      .finally(() => this.pending.set(id, Math.max(0, (this.pending.get(id) ?? 1) - 1)));
    this.chains.set(id, next);
  }

  private async post(envelope: Envelope): Promise<void> {
    const body = JSON.stringify(envelope);
    const request = () =>
      fetch(`${API_BASE_URL}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...workspaceHeaders() },
        body,
      });
    let response: Response;
    try {
      response = await request();
    } catch {
      // A reused keep-alive connection can be closed by the server just as we send. Try once more.
      await new Promise((resolve) => setTimeout(resolve, 150));
      response = await request();
    }
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      response = await request();
    }
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    this.sent += 1;
    this.streak = 0;
    if (this.link === "error") this.link = "ok";
  }

  private onSendError(error: unknown): void {
    this.failed += 1;
    this.streak += 1;
    this.lastError = error instanceof Error ? error.message : "network";
    const status = (error as { status?: number }).status;
    if (this.streak >= 3 && this.link !== "lost") this.link = "error";
    // The sandbox pool is full or the id was refused: nothing will change by retrying.
    if (status === 503 || status === 400) this.stop("error");
    else if (this.streak >= 40) this.stop("error");
  }

  private flushHeld(): void {
    if (this.flushing) return;
    const held = this.held;
    this.held = [];
    if (held.length === 0) {
      this.link = "ok";
      return;
    }
    // One request per few hundred readings, not per tick: the API allows ~20 requests a second.
    const batch: Envelope[] = [];
    for (const envelope of held) {
      const last = batch[batch.length - 1];
      if (last && last.astronaut_id === envelope.astronaut_id && last.readings.length + envelope.readings.length <= 450) {
        last.readings.push(...envelope.readings);
        last.ts_device = envelope.ts_device;
      } else {
        batch.push({ ...envelope, readings: [...envelope.readings] });
      }
    }
    this.flushing = true;
    this.link = "flushing";
    void (async () => {
      for (const envelope of batch) {
        try {
          await this.post(envelope);
        } catch (error) {
          this.onSendError(error);
        }
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      this.flushing = false;
      if (this.link === "flushing") this.link = "ok";
      this.publish();
    })();
  }

  // ---- recording ---------------------------------------------------------------------------

  private record(id: string, mode: ActivityMode, samples: Sample[]): void {
    if (!this.recMeta || samples.length === 0) return;
    const v: number[] = [];
    for (const sample of samples) {
      const index = this.recCodes.indexOf(sample.code);
      if (index < 0) continue;
      v.push(sample.quality < 1 ? index + 1000 : index, sample.value);
    }
    this.recFrames.push({ t: Math.round(this.elapsedMs), a: CREW.findIndex((member) => member.id === id), m: MODES.indexOf(mode), v });
  }

  private finalizeRecording(): void {
    const meta = this.recMeta;
    this.recMeta = null;
    if (!meta || this.recFrames.length === 0 || this.elapsedMs < 3000) {
      this.recFrames = [];
      return;
    }
    const rec: Recording = {
      v: 1,
      id: meta.id,
      name: "",
      createdAt: meta.createdAt,
      durationMs: Math.round(this.elapsedMs),
      timeScale: this.config.timeScale,
      scenario: meta.scenario,
      crew: CREW.map((member) => member.id),
      codes: this.recCodes,
      frames: this.recFrames,
    };
    this.recFrames = [];
    this.recordings = saveRecordings([rec, ...this.recordings]);
  }

  private persistOnExit(): void {
    if (this.phase === "running" || this.phase === "paused") {
      this.finalizeRecording();
      this.saveCursor();
      this.dropLock();
    }
  }

  // ---- public controls ----------------------------------------------------------------------

  /** Begin a run. Returns false when another tab owns the generator. */
  start(scenarioId?: string): boolean {
    this.init();
    if (this.phase === "replaying") this.stopReplay();
    if (this.phase === "running" || this.phase === "paused") {
      if (scenarioId) this.runScenario(scenarioId);
      this.resume();
      return true;
    }
    if (!this.takeLock()) {
      this.publish();
      return false;
    }
    this.phase = "running";
    this.elapsedMs = 0;
    this.simSec = 0;
    this.simBase = Math.max(this.cursor() + 1, Date.now() / 1000);
    this.sent = 0;
    this.failed = 0;
    this.streak = 0;
    this.lastError = null;
    this.endedBy = null;
    this.link = "ok";
    this.held = [];
    this.tickCount = 0;
    this.forceNext = true;
    this.scenarioId = null;
    this.scenarioT = 0;
    this.lastScenario = null;
    for (const rig of this.rigs.values()) rig.restart();
    this.recFrames = [];
    this.recMeta = { id: newRecordingId(), createdAt: Date.now(), scenario: scenarioId ?? null };
    if (scenarioId) {
      this.scenarioId = scenarioId;
      this.lastScenario = scenarioId;
    }
    this.startTimer();
    this.publish();
    return true;
  }

  pause(): void {
    if (this.phase !== "running") return;
    this.phase = "paused";
    this.stopTimer();
    this.saveCursor();
    this.beat(true);
    this.publish();
  }

  resume(): void {
    if (this.phase === "paused") {
      this.phase = "running";
      this.forceNext = true;
      this.startTimer();
      this.publish();
    }
  }

  stop(reason: GeneratorSnapshot["endedBy"] = null): void {
    if (this.phase === "idle") return;
    if (this.phase === "replaying") {
      this.stopReplay(reason);
      return;
    }
    this.phase = "idle";
    this.stopTimer();
    if (this.link === "lost") {
      this.held = [];
      this.link = "ok";
    }
    this.finalizeRecording();
    this.saveCursor();
    this.dropLock();
    this.scenarioId = null;
    this.scenarioT = 0;
    this.endedBy = reason;
    this.publish();
  }

  runScenario(id: string): void {
    if (!SCENARIO_BY_ID[id]) return;
    if (this.phase === "idle" || this.phase === "replaying") {
      this.start(id);
      return;
    }
    this.scenarioId = id;
    this.lastScenario = id;
    this.scenarioT = 0;
    this.forceNext = true;
    this.resume();
    this.publish();
  }

  stopScenario(): void {
    if (!this.scenarioId) return;
    this.finishScenario();
    this.publish();
  }

  private finishScenario(): void {
    this.scenarioId = null;
    this.scenarioT = 0;
    // Report every sensor once so values the scenario pinned snap back to normal.
    this.forceNext = true;
    if (this.link === "lost") this.flushHeld();
  }

  setTimeScale(scale: number): void {
    if (this.phase === "running" || this.phase === "paused") return;
    this.config.timeScale = scale;
    this.saveConfigSoon();
    this.publish();
  }

  setFaults(on: boolean): void {
    this.init();
    this.config.faults = on;
    for (const rig of this.rigs.values()) rig.faults = on;
    this.saveConfigSoon();
    this.publish();
  }

  setActivity(id: string, mode: ActivityMode): void {
    const rig = this.rigs.get(id);
    if (!rig) return;
    rig.activity = mode;
    this.saveConfigSoon();
    this.publish();
  }

  setStress(id: string, value: number): void {
    const rig = this.rigs.get(id);
    if (!rig) return;
    rig.stress = Math.max(-1.5, Math.min(1.5, value));
    this.saveConfigSoon();
    this.publish();
  }

  setHold(id: string, code: string, value: number | null): void {
    const rig = this.rigs.get(id);
    if (!rig) return;
    if (value === null) delete rig.hold[code];
    else rig.hold[code] = value;
    rig.touch(code);
    // Idle: drop the last reading so the panel shows the new hold instead of a stale value.
    if (this.phase === "idle") delete this.views.get(id)?.[code];
    this.saveConfigSoon();
    this.publish();
  }

  setEnabled(id: string, code: string, on: boolean): void {
    const rig = this.rigs.get(id);
    if (!rig) return;
    if (on) rig.disabled.delete(code);
    else rig.disabled.add(code);
    this.saveConfigSoon();
    this.publish();
  }

  resetCrew(id: string): void {
    this.rigs.get(id)?.reset();
    if (this.phase === "idle") this.views.set(id, {});
    this.saveConfigSoon();
    this.publish();
  }

  /** Send every sensor once right now. Works without a run so you can poke the dashboard. */
  pulse(): void {
    this.init();
    if (this.phase === "running") {
      this.forceNext = true;
      return;
    }
    if (this.phase !== "idle" || !this.takeLock()) return;
    const clock = performance.now();
    this.simBase = Math.max(this.cursor() + 1, Date.now() / 1000);
    this.simSec = 0;
    for (const [id, rig] of this.rigs) {
      if (!this.config.targets.includes(id)) continue;
      rig.restart();
      const out = rig.tick({ nowMs: clock, timeScale: this.config.timeScale, simSec: 0, force: true, scenarioT: null, script: null });
      this.absorb(id, out.samples);
      this.send(id, this.envelope(id, out.mode, this.simBase, out.samples, out.ecg));
    }
    this.saveCursor();
    this.dropLock();
    this.publish();
  }

  // ---- recordings & replay ------------------------------------------------------------------

  startReplay(id: string, speed = 1): void {
    this.init();
    const rec = this.recordings.find((item) => item.id === id);
    if (!rec || this.phase !== "idle" || !this.takeLock()) return;
    this.phase = "replaying";
    this.endedBy = null;
    this.simBase = Math.max(this.cursor() + 1, Date.now() / 1000);
    this.simSec = 0;
    this.sent = 0;
    this.failed = 0;
    this.streak = 0;
    this.lastError = null;
    const rigs = new Map<string, Rig>();
    for (const crewId of rec.crew) rigs.set(crewId, new Rig(crewId, 7));
    this.replay = { rec, clockMs: 0, realMs: 0, idx: 0, speed, rigs, hr: new Map() };
    for (const view of this.views.values()) for (const key of Object.keys(view)) delete view[key];
    this.startTimer();
    this.publish();
  }

  setReplaySpeed(speed: number): void {
    if (this.replay) this.replay.speed = speed;
  }

  private tickReplay(dt: number): void {
    const replay = this.replay;
    if (!replay) return;
    this.beat();
    replay.clockMs += dt * replay.speed;
    const rec = replay.rec;
    const grouped = new Map<number, { frames: RecFrame[]; samples: Sample[] }>();

    while (replay.idx < rec.frames.length && rec.frames[replay.idx]!.t <= replay.clockMs) {
      const frame = rec.frames[replay.idx]!;
      replay.idx += 1;
      const bucket = grouped.get(frame.a) ?? { frames: [], samples: [] };
      bucket.frames.push(frame);
      for (let i = 0; i + 1 < frame.v.length; i += 2) {
        const raw = frame.v[i]!;
        const low = raw >= 1000;
        const def = METRIC_BY_CODE[rec.codes[low ? raw - 1000 : raw] ?? ""];
        if (!def) continue;
        bucket.samples.push({ code: def.code, id: def.id, unit: def.unit, value: frame.v[i + 1]!, quality: low ? 0.25 : 1 });
      }
      grouped.set(frame.a, bucket);
    }

    replay.realMs += dt;
    rec.crew.forEach((crewId, index) => {
      const bucket = grouped.get(index);
      const samples = bucket?.samples ?? [];
      const last = bucket?.frames[bucket.frames.length - 1];
      const hrNow = samples.find((sample) => sample.code === "HR")?.value;
      if (hrNow !== undefined) replay.hr.set(crewId, hrNow);
      const hr = replay.hr.get(crewId) ?? null;
      // The strip is paced by wall time, not by the recording clock, so it stays smooth at 4x.
      const ecg = hr === null ? [] : (replay.rigs.get(crewId)?.ecgFor(replay.realMs, hr) ?? []);
      if (samples.length === 0 && ecg.length === 0) return;
      this.absorb(crewId, samples);
      const mode = MODES[last?.m ?? 0] ?? "rest";
      const ts = this.simBase + ((last?.t ?? replay.clockMs) / 1000) * rec.timeScale;
      this.send(crewId, this.envelopeFor(crewId, mode, ts, samples, ecg, rec.timeScale));
    });
    this.simSec = (replay.clockMs / 1000) * rec.timeScale;
    if (replay.clockMs >= rec.durationMs || replay.clockMs >= MAX_RUN_MS) this.stopReplay("replay");
  }

  private envelopeFor(id: string, mode: ActivityMode, ts: number, samples: Sample[], ecg: number[], scale: number): Envelope {
    const saved = this.config.timeScale;
    this.config.timeScale = scale;
    const envelope = this.envelope(id, mode, ts, samples, ecg);
    this.config.timeScale = saved;
    return envelope;
  }

  private stopReplay(reason: GeneratorSnapshot["endedBy"] = null): void {
    if (this.replay) this.saveCursor();
    this.replay = null;
    this.phase = "idle";
    this.stopTimer();
    this.dropLock();
    this.endedBy = reason;
    this.publish();
  }

  deleteRecording(id: string): void {
    this.recordings = this.recordings.filter((item) => item.id !== id);
    saveRecordings(this.recordings);
    this.publish();
  }

  renameRecording(id: string, name: string): void {
    this.recordings = this.recordings.map((item) => (item.id === id ? { ...item, name: name.trim().slice(0, 60) } : item));
    saveRecordings(this.recordings);
    this.publish();
  }

  exportRecording(id: string): string | null {
    const rec = this.recordings.find((item) => item.id === id);
    return rec ? JSON.stringify(rec) : null;
  }

  importRecording(text: string): boolean {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!isRecording(parsed)) return false;
      const rec: Recording = { ...parsed, id: newRecordingId() };
      this.recordings = saveRecordings([rec, ...this.recordings]).slice(0, MAX_RECORDINGS);
      this.publish();
      return true;
    } catch {
      return false;
    }
  }

  /** Forget everything local about this generator, e.g. after the workspace was reset. */
  forgetCursor(): void {
    try {
      localStorage.removeItem(CURSOR_KEY);
    } catch {
      // Ignore.
    }
  }

  clearEnded(): void {
    if (this.endedBy !== null) {
      this.endedBy = null;
      this.publish();
    }
  }
}

export const generator = new GeneratorEngine();
