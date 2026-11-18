"use client";

/**
 * Bedside Lead-II cardiogram — μGui / Philips-style SWEEP:
 * write cursor + erase gap, sample clock from dt (not frame count),
 * static grid layer, RAF never restarts on bpm/zone updates.
 */

import { useEffect, useRef } from "react";
import { drainEcgSamples, ECG_FS, ECG_WINDOW, ecgBuffered } from "@/lib/ecg-strip";
import { useT } from "@/lib/locale";

const ZONE = { green: "#2ECC8F", yellow: "#F5B642", red: "#FF4D5E" } as const;
const ERASE = 18;
const SAMPLE_MS = 1000 / ECG_FS;

export function EcgCanvas({
  astronautId,
  bpm,
  zone = "green",
}: {
  astronautId?: string;
  bpm: number;
  zone?: string | null;
}) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rate = Number.isFinite(bpm) ? Math.max(0, Math.min(220, bpm)) : 0;
  const color = zone === "red" ? ZONE.red : zone === "yellow" ? ZONE.yellow : ZONE.green;

  const rateRef = useRef(rate);
  const colorRef = useRef(color);
  const aidRef = useRef(astronautId ?? "");
  rateRef.current = rate;
  colorRef.current = color;
  aidRef.current = astronautId ?? "";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Trace + “not drawn yet” mask (NaN = erase gap / unscanned).
    const trace = new Float32Array(ECG_WINDOW);
    const seen = new Uint8Array(ECG_WINDOW);
    const drainBuf = new Float32Array(32);
    let sweep = 0;
    let phase = 0;
    let lastMv = 0;
    let liveLatched = false;
    let acc = 0;
    let raf = 0;
    let last = performance.now();

    // Cached ECG paper grid (redraw only on resize).
    let grid: OffscreenCanvas | HTMLCanvasElement | null = null;
    let gridW = 0;
    let gridH = 0;

    const ensureGrid = (w: number, h: number, dpr: number) => {
      if (grid && gridW === w && gridH === h) return grid;
      const g =
        typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : document.createElement("canvas");
      g.width = w;
      g.height = h;
      const gctx = g.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!gctx) return null;
      gctx.fillStyle = "#0a1210";
      gctx.fillRect(0, 0, w, h);
      const step = 8 * dpr;
      const big = 40 * dpr;
      gctx.strokeStyle = "rgba(46,204,143,0.07)";
      gctx.lineWidth = 1;
      gctx.beginPath();
      for (let x = 0; x <= w; x += step) {
        gctx.moveTo(x + 0.5, 0);
        gctx.lineTo(x + 0.5, h);
      }
      for (let y = 0; y <= h; y += step) {
        gctx.moveTo(0, y + 0.5);
        gctx.lineTo(w, y + 0.5);
      }
      gctx.stroke();
      gctx.strokeStyle = "rgba(46,204,143,0.14)";
      gctx.beginPath();
      for (let x = 0; x <= w; x += big) {
        gctx.moveTo(x + 0.5, 0);
        gctx.lineTo(x + 0.5, h);
      }
      for (let y = 0; y <= h; y += big) {
        gctx.moveTo(0, y + 0.5);
        gctx.lineTo(w, y + 0.5);
      }
      gctx.stroke();
      gctx.strokeStyle = "rgba(46,204,143,0.18)";
      gctx.beginPath();
      gctx.moveTo(0, h * 0.5);
      gctx.lineTo(w, h * 0.5);
      gctx.stroke();
      grid = g;
      gridW = w;
      gridH = h;
      return g;
    };

    const synthSample = (bpmNow: number) => {
      if (bpmNow <= 0) return 0;
      const step = bpmNow / 60 / ECG_FS;
      phase = (phase + step) % 1;
      const u = phase;
      let y = 0.02 * Math.sin(phase * Math.PI * 2 * 0.25);
      if (u > 0.1 && u < 0.18) y += 0.18 * Math.sin(((u - 0.1) / 0.08) * Math.PI);
      else if (u >= 0.22 && u < 0.25) y -= 0.12 * ((u - 0.22) / 0.03);
      else if (u >= 0.25 && u < 0.295) y += 1.25 * Math.sin(((u - 0.25) / 0.045) * Math.PI);
      else if (u >= 0.295 && u < 0.345) y -= 0.32 * Math.sin(((u - 0.295) / 0.05) * Math.PI);
      else if (u >= 0.42 && u < 0.58) y += 0.32 * Math.sin(((u - 0.42) / 0.16) * Math.PI);
      return y;
    };

    const writeSample = (v: number) => {
      const i = sweep % ECG_WINDOW;
      trace[i] = v;
      seen[i] = 1;
      lastMv = v;
      for (let k = 1; k <= ERASE; k += 1) {
        const j = (i + k) % ECG_WINDOW;
        seen[j] = 0;
      }
      sweep = (sweep + 1) % ECG_WINDOW;
    };

    const draw = (now: number) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = canvas.clientWidth || 640;
      const cssH = canvas.clientHeight || 176;
      const w = Math.max(1, Math.floor(cssW * dpr));
      const h = Math.max(1, Math.floor(cssH * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      let dt = now - last;
      last = now;
      if (dt > 200) dt = 200;
      if (dt < 0) dt = 0;

      const bpmNow = rateRef.current;
      const stroke = colorRef.current;
      const aid = aidRef.current;

      // Fixed sample clock — paper speed independent of refresh rate.
      acc += dt;
      while (acc >= SAMPLE_MS) {
        acc -= SAMPLE_MS;
        if (bpmNow <= 0) {
          liveLatched = false;
          writeSample(0);
          continue;
        }
        // Drain live at ECG_FS. On brief WS gaps hold last mV (no fake QRS).
        // Synth only before the first live chunk so the beam still runs.
        const pad = ecgBuffered(aid) > 40 ? 12 : 0;
        const n = drainEcgSamples(aid, drainBuf, 1, pad);
        if (n > 0) {
          liveLatched = true;
          writeSample(drainBuf[0]!);
        } else if (liveLatched) {
          writeSample(lastMv);
        } else {
          writeSample(synthSample(bpmNow));
        }
      }

      const paper = ensureGrid(w, h, dpr);
      if (paper) ctx.drawImage(paper, 0, 0);
      else {
        ctx.fillStyle = "#0a1210";
        ctx.fillRect(0, 0, w, h);
      }

      const mid = h * 0.5;
      const scale = h * 0.26;
      const px = w / ECG_WINDOW;

      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(1.5, 2 * dpr);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // Two path segments around the erase gap (classic sweep).
      const gapStart = sweep % ECG_WINDOW;
      const gapEnd = (gapStart + ERASE) % ECG_WINDOW;

      const strokeSpan = (from: number, to: number) => {
        if (to <= from) return;
        ctx.beginPath();
        let started = false;
        for (let i = from; i < to; i += 1) {
          if (!seen[i]) {
            started = false;
            continue;
          }
          const x = i * px;
          const y = mid - trace[i]! * scale;
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        if (started) ctx.stroke();
      };

      if (gapEnd > gapStart) {
        strokeSpan(0, gapStart);
        strokeSpan(gapEnd, ECG_WINDOW);
      } else {
        // Gap wraps around the right edge.
        strokeSpan(gapEnd, gapStart);
      }

      // Beam cursor
      if (bpmNow > 0 && !reduced) {
        const sx = (sweep % ECG_WINDOW) * px;
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        ctx.moveTo(sx, 3 * dpr);
        ctx.lineTo(sx, h - 3 * dpr);
        ctx.stroke();
      }

      if (!reduced) raf = requestAnimationFrame(draw);
      else {
        // Still paint once when motion is reduced.
      }
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
    };
    // Remount only when astronaut changes; bpm/zone stay in refs (no beam hitch).
  }, [astronautId]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-[#0a1210]">
      <div className="relative flex items-center justify-between gap-3 px-3 pt-2.5 text-[11px] text-muted">
        <div className="min-w-0">
          <p className="font-semibold tracking-wide text-ink">{t("vitals.ecg")}</p>
          <p className="text-[10px] text-faint">Lead II · 25 mm/s · sweep · mV</p>
        </div>
        <span className="shrink-0 font-mono tabular-nums" style={{ color }}>
          {rate.toFixed(0)} {t("vitals.bpm")}
          {rate <= 0 ? " · asystole" : ""}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="relative h-44 w-full"
        role="img"
        aria-label={t("vitals.ecgAria", { rate: rate.toFixed(0) })}
      />
    </div>
  );
}
