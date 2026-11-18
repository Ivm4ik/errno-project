/**
 * Ring-buffer cardiogram strip (ICU / canvas-monitor pattern).
 * Fed by batched /live `ecg_chunk` — canvas drains at ECG_FS so the beam
 * never jumps with each WebSocket batch.
 */

export const ECG_FS = 100;
/** ~5 s window at 100 Hz. */
export const ECG_WINDOW = 500;

type Ring = {
  buf: Float32Array;
  head: number;
  filled: number;
  written: number;
  /** Read cursor for smooth drain (≤ written). */
  read: number;
  version: number;
};

const rings = new Map<string, Ring>();
const listeners = new Set<() => void>();
let notifyRaf = 0;
let dirty = false;

function ringFor(id: string): Ring {
  let r = rings.get(id);
  if (!r) {
    r = { buf: new Float32Array(ECG_WINDOW), head: 0, filled: 0, written: 0, read: 0, version: 0 };
    rings.set(id, r);
  }
  return r;
}

function scheduleNotify() {
  dirty = true;
  if (!notifyRaf) {
    notifyRaf = requestAnimationFrame(() => {
      notifyRaf = 0;
      if (!dirty) return;
      dirty = false;
      for (const listen of listeners) listen();
    });
  }
}

function writeValues(id: string, values: ArrayLike<number>) {
  if (!id || !values.length) return;
  const r = ringFor(id);
  for (let i = 0; i < values.length; i += 1) {
    r.buf[r.head] = Number(values[i]) || 0;
    r.head = (r.head + 1) % ECG_WINDOW;
    if (r.filled < ECG_WINDOW) r.filled += 1;
    r.written += 1;
  }
  // If reader fell off the ring (paused tab), snap forward.
  if (r.written - r.read > ECG_WINDOW) r.read = r.written - ECG_WINDOW;
  r.version += 1;
  scheduleNotify();
}

/** Push mV samples (newest last). */
export function pushEcgSamples(astronautId: string, points: { t?: number; v: number }[]) {
  if (!points.length) return;
  const vals = new Float32Array(points.length);
  for (let i = 0; i < points.length; i += 1) vals[i] = points[i]!.v;
  writeValues(astronautId, vals);
}

export function replaceEcgStrip(astronautId: string, points: { t?: number; v: number }[]) {
  if (!astronautId) return;
  const sorted = [...points].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  const r = ringFor(astronautId);
  r.buf.fill(0);
  r.head = 0;
  r.filled = 0;
  r.written = 0;
  r.read = 0;
  if (!sorted.length) {
    r.version += 1;
    scheduleNotify();
    return;
  }
  const slice = sorted.length > ECG_WINDOW ? sorted.slice(sorted.length - ECG_WINDOW) : sorted;
  writeValues(astronautId, slice.map((p) => p.v));
  // Bootstrap: start reading near the tip so sweep is live immediately.
  r.read = Math.max(0, r.written - 8);
}

export function ecgWritten(astronautId: string): number {
  return rings.get(astronautId)?.written ?? 0;
}

export function ecgFilled(astronautId: string): number {
  return rings.get(astronautId)?.filled ?? 0;
}

export function ecgBuffered(astronautId: string): number {
  const r = rings.get(astronautId);
  return r ? Math.max(0, r.written - r.read) : 0;
}

/**
 * Drain up to `max` samples into `out` at the read cursor.
 * Returns how many were written. Keeps a small jitter pad so WS bursts don't underrun.
 */
export function drainEcgSamples(astronautId: string, out: Float32Array, max: number, keep = 12): number {
  const r = rings.get(astronautId);
  if (!r || max <= 0) return 0;
  const available = Math.max(0, r.written - r.read - keep);
  const n = Math.min(max, available, out.length);
  for (let i = 0; i < n; i += 1) {
    const abs = r.read + i;
    const idx = (r.head - (r.written - abs) + ECG_WINDOW * 4) % ECG_WINDOW;
    out[i] = r.buf[idx]!;
  }
  r.read += n;
  return n;
}

export function ecgVersion(astronautId: string): number {
  return rings.get(astronautId)?.version ?? 0;
}

export function subscribeEcg(listen: () => void) {
  listeners.add(listen);
  return () => {
    listeners.delete(listen);
  };
}
