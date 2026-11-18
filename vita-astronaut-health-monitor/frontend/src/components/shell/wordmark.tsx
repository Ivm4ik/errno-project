"use client";

import clsx from "clsx";

/** Mission wordmark. Pass `rail` in the collapsed sidebar so only the ring mark shows. */
export function Wordmark({ className, rail = false }: { className?: string; rail?: boolean }) {
  return (
    <span className={clsx("inline-flex max-w-full items-center overflow-hidden select-none", className)} title="ERRNO">
      <img
        src={rail ? "/brand/errno-mark.png" : "/brand/errno-logo.png"}
        alt="ERRNO"
        className={clsx("errno-logo w-auto", rail ? "h-7" : "h-8")}
      />
    </span>
  );
}
