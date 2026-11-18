"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { API_BASE_URL } from "@/lib/api/client";
import { pushEcgSamples } from "@/lib/ecg-strip";
import { getAuthToken } from "@/lib/session";
import { getWorkspaceId } from "@/lib/workspace";

type LiveEvent = {
  type: string;
  ts?: number;
  data?: {
    astronaut_id?: string;
    sensor_id?: string;
    value?: number;
    ts?: number;
    samples?: { ts?: number; v: number }[];
  };
};

const LiveCtx = createContext({ online: false });

/** True while /live WebSocket is connected (panel should lean on pushes, not tight poll). */
export function useLiveOnline() {
  return useContext(LiveCtx).online;
}

/** @deprecated use useLiveOnline — kept for top-bar call sites during migrate */
export function useLiveLink(enabled: boolean) {
  const { online } = useContext(LiveCtx);
  return enabled ? online : false;
}

/**
 * Owns the backend /live WebSocket for the session.
 * Scalar readings soft-invalidate errno caches.
 * Cardiogram arrives as batched `ecg_chunk` (ICU pattern — no 100 msg/s thrash).
 */
export function LiveProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const queryClient = useQueryClient();
  const [online, setOnline] = useState(false);
  const bumpTimer = useRef(0);
  const pendingAids = useRef(new Set<string>());

  const flush = useMemo(
    () => () => {
      const aids = [...pendingAids.current];
      pendingAids.current.clear();
      if (aids.length) void queryClient.invalidateQueries({ queryKey: ["errno-metrics"] });
      for (const aid of aids) {
        void queryClient.invalidateQueries({ queryKey: ["errno-sensors-board", aid] });
        void queryClient.invalidateQueries({ queryKey: ["errno-readings", aid] });
        void queryClient.invalidateQueries({ queryKey: ["errno-hud", aid] });
        void queryClient.invalidateQueries({ queryKey: ["errno-status", aid] });
      }
      void queryClient.invalidateQueries({ queryKey: ["errno-alerts"] });
      void queryClient.invalidateQueries({ queryKey: ["errno-packets"] });
    },
    [queryClient],
  );

  useEffect(() => {
    if (!enabled) {
      setOnline(false);
      return;
    }
    let socket: WebSocket | null = null;
    let timer = 0;
    let stop = false;

    const scheduleBump = (astronautId?: string) => {
      if (astronautId) pendingAids.current.add(astronautId);
      window.clearTimeout(bumpTimer.current);
      bumpTimer.current = window.setTimeout(flush, 150);
    };

    const open = () => {
      if (stop) return;
      const token = getAuthToken();
      if (!token) {
        timer = window.setTimeout(open, 1500);
        return;
      }
      const url = `${API_BASE_URL.replace(/^http/, "ws")}/live?token=${encodeURIComponent(token)}&ws=${encodeURIComponent(getWorkspaceId())}`;
      socket = new WebSocket(url);
      socket.onopen = () => setOnline(true);
      socket.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as LiveEvent;
          if (msg.type === "ecg_chunk" && msg.data?.astronaut_id && msg.data.samples?.length) {
            pushEcgSamples(msg.data.astronaut_id, msg.data.samples);
            return;
          }
          // Legacy single-sample ECG (should be rare after batching).
          if (msg.type === "reading" && msg.data?.sensor_id === "ecg" && msg.data.astronaut_id != null && msg.data.value != null) {
            pushEcgSamples(msg.data.astronaut_id, [{ t: Number(msg.data.ts ?? msg.ts ?? 0), v: Number(msg.data.value) }]);
            return;
          }
          if (msg.type === "reading" || msg.type === "alert" || msg.type === "status") {
            scheduleBump(msg.data?.astronaut_id);
          }
        } catch {
          /* ignore malformed */
        }
      };
      socket.onclose = () => {
        setOnline(false);
        if (!stop) timer = window.setTimeout(open, 2000);
      };
      socket.onerror = () => socket?.close();
    };

    open();
    return () => {
      stop = true;
      window.clearTimeout(timer);
      window.clearTimeout(bumpTimer.current);
      socket?.close();
      setOnline(false);
    };
  }, [enabled, flush]);

  const value = useMemo(() => ({ online }), [online]);
  return <LiveCtx.Provider value={value}>{children}</LiveCtx.Provider>;
}
