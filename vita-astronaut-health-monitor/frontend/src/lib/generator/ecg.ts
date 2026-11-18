import type { Rng } from "./rng";

/** Synthetic Lead-II strip in mV, paced by bpm. A training waveform, not a clinical one. */
export const ECG_FS = 100;

function bump(u: number, start: number, width: number, amp: number): number {
  if (width <= 0) return 0;
  const t = (u - start) / width;
  return t >= 0 && t <= 1 ? amp * Math.sin(t * Math.PI) : 0;
}

/** One sample at normalized beat phase [0, 1): P, Q, R, S and T waves. */
function sampleMv(phase: number): number {
  const u = ((phase % 1) + 1) % 1;
  let y = 0.02 * Math.sin(phase * 2 * Math.PI * 0.25);
  y += bump(u, 0.1, 0.07, 0.16);
  if (u >= 0.22 && u < 0.248) y -= 0.14 * ((u - 0.22) / 0.028);
  y += bump(u, 0.248, 0.032, 1.35);
  y += bump(u, 0.282, 0.04, -0.34);
  y += bump(u, 0.4, 0.18, 0.3);
  return y;
}

/** Next `n` samples. bpm <= 0 is asystole: a flat line, not an invented rhythm. */
export function ecgChunk(phase: number, bpm: number, n: number, rng: Rng): { samples: number[]; phase: number } {
  const noise = 0.01;
  const out: number[] = [];
  if (!Number.isFinite(bpm) || bpm <= 0) {
    for (let i = 0; i < n; i += 1) out.push(Math.round(rng.normal(0, noise * 0.1) * 1e4) / 1e4);
    return { samples: out, phase };
  }
  const rate = Math.max(1, Math.min(220, bpm));
  const step = rate / 60 / ECG_FS;
  let p = phase;
  for (let i = 0; i < n; i += 1) {
    const value = Math.max(-2.5, Math.min(2.5, sampleMv(p) + rng.normal(0, noise * 0.5)));
    out.push(Math.round(value * 1e4) / 1e4);
    p = (p + step) % 1;
  }
  return { samples: out, phase: p };
}
