"use client";

import clsx from "clsx";
import type { LucideIcon } from "lucide-react";

export function MissionTabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (value: T) => void;
  items: { id: T; label: string; hint?: string; icon?: LucideIcon }[];
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-2xl border border-line/80 bg-panel/60 p-1 shadow-[inset_0_0_0_1px_rgb(142_183_255_/_0.04)] backdrop-blur">
      {items.map((item) => {
        const active = item.id === value;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={clsx(
              "group relative min-w-[7.5rem] flex-1 rounded-xl px-3 py-2.5 text-left transition",
              active ? "bg-accent text-accent-ink shadow-[0_0_24px_rgb(142_183_255_/_0.25)]" : "text-muted hover:bg-panel-raised hover:text-ink",
            )}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              {Icon ? <Icon className={clsx("size-4", active ? "opacity-100" : "opacity-70")} /> : null}
              {item.label}
            </span>
            {item.hint ? <span className={clsx("mt-0.5 block text-[11px]", active ? "text-accent-ink/75" : "text-faint")}>{item.hint}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
