"use client";

import { useSyncExternalStore } from "react";
import { generator, type GeneratorSnapshot } from "@/lib/generator/engine";

/** Live state of the browser generator. The run itself lives outside React, so it survives the modal. */
export function useGenerator(): GeneratorSnapshot {
  return useSyncExternalStore(generator.subscribe, generator.getSnapshot, generator.getServerSnapshot);
}

// ---- modal open state ---------------------------------------------------------------

let isOpen = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function openGenerator() {
  if (isOpen) return;
  isOpen = true;
  emit();
}

export function closeGenerator() {
  if (!isOpen) return;
  isOpen = false;
  emit();
}

export function useGeneratorOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => isOpen,
    () => false,
  );
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
