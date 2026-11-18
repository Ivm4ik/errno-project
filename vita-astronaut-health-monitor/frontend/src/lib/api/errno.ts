"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, withQuery } from "./client";

export interface ErrnoAstronaut { id: string; name: string; role?: string }
export interface ErrnoMetricValue {
  astronaut_id: string;
  value: number;
  ts: number;
  alert: boolean;
  zone?: "green" | "yellow" | "red" | null;
  /** Equipment fault — exclude from clinical red / Health Score. */
  signal_lost?: boolean;
  /** Bounds or fusion contradiction (technical warning, not medical crisis). */
  sensor_anomaly?: boolean;
  form_pending?: boolean;
  anomaly_kind?: "lost" | "bounds" | "fusion" | null;
}
export interface ErrnoMetric {
  id: string;
  name_uk: string;
  group: string;
  mode: string;
  interval_s: number;
  unit: string;
  source: string;
  latest: ErrnoMetricValue[];
}
export interface ErrnoReading { id?: string | number; ts: number; astronaut_id: string; sensor_id: string; value: number; unit?: string; quality?: number; source?: string; min?: number; max?: number; n?: number; alert?: boolean }
export interface ErrnoStatus { astronaut_id: string; score: number | null; health_index?: number | null; level: string; status?: number; help_needed: boolean; systems: Record<string, number>; alerts: ErrnoAlert[]; activity_mode?: string | null; critical_text?: string | null }
export interface HudCard { metric: string; message: string; penalty: number; breathing: string | null }
export interface Hud { astronaut_id: string; status: number; health_index: number; activity_mode: string | null; cards: HudCard[]; critical_text: string | null }
export interface PenaltyRow {
  metric: string;
  value: number | null;
  baseline: number | null;
  deviation: number;
  penalty: number;
  one_sided: boolean;
  suppressed_by_fusion: boolean;
  stale: boolean;
  signal_lost?: boolean;
  sensor_anomaly?: boolean;
  anomaly_kind?: "lost" | "bounds" | "fusion" | null;
}
export interface Readiness { astronaut_id: string; name: string; readiness: "green" | "yellow" | "red-breakglass" }
export interface EarthPacket { id: number; astronaut_id: string; created_at: number; visible_at: number; in_transit: boolean; eta_sec: number; message: string | null; payload: { surgeon?: { metric: string; text: string }[]; breakdown?: PenaltyRow[] } | null }
export interface EarthAction {
  id: number;
  direction: "up" | "down" | string;
  astronaut_id: string | null;
  actor: string | null;
  action: string | null;
  alert_id?: number | null;
  created_at: number;
  arrives_at: number;
  delivered: boolean;
  in_transit: boolean;
  eta_sec: number;
}
export interface PublicConfig { mission: string; signal_delay_sec: number; signal_delay_label: string; disclaimer: string }
export interface ErrnoAlert { id: number | string; ts: number; astronaut_id: string; sensor_id: string; category: "health" | "equipment"; level: "watch" | "act"; message: string; explanation?: string; acknowledged?: boolean }
export interface ErrnoRangeAlert { id: number; ts: number; astronaut_id: string; sensor_id: string; value: number; unit: string; min: number; max: number; alert: true }
export interface ErrnoLimit { astronaut_id: string; sensor_id: string; min: number | null; max: number | null }
export interface ErrnoDiff { sensor_id: string; field: string; from: number | null; to: number | null }
export interface ErrnoChange { id: number; ts: number; actor_login: string; role: string; astronaut_id: string; note: string | null; diff: ErrnoDiff[] }

export const errnoKeys = {
  astronauts: ["errno-astronauts"] as const,
  metrics: ["errno-metrics"] as const,
  status: (id: string) => ["errno-status", id] as const,
  readings: (id: string, sensor: string, resolution: string) => ["errno-readings", id, sensor, resolution] as const,
  alerts: (id: string, active: boolean) => ["errno-alerts", id, active] as const,
};

export function useErrnoAstronauts() {
  return useQuery({ queryKey: errnoKeys.astronauts, queryFn: () => api.get<ErrnoAstronaut[]>("/astronauts"), refetchInterval: 60_000 });
}

export function useErrnoMetrics() {
  return useQuery({ queryKey: errnoKeys.metrics, queryFn: () => api.get<ErrnoMetric[]>("/metrics"), refetchInterval: 15_000 });
}

export function useErrnoFleetStatus() {
  return useQuery({ queryKey: ["errno-status", "all"], queryFn: () => api.get<ErrnoStatus[]>("/status"), refetchInterval: 10_000 });
}

export function useErrnoAllAlerts(active = true) {
  return useQuery({ queryKey: ["errno-alerts", "all", active], queryFn: () => api.get<ErrnoAlert[]>(withQuery("/alerts", { active })), refetchInterval: 10_000 });
}

export function useErrnoAllRangeAlerts() {
  return useQuery({ queryKey: ["errno-range-alerts", "all"], queryFn: () => api.get<ErrnoRangeAlert[]>("/range-alerts"), refetchInterval: 10_000 });
}

export function useHeartSparks(ids: string[]) {
  const from = Math.floor(Date.now() / 1000) - 3600;
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: ["errno-readings", id, "hr", "spark"],
      queryFn: () => api.get<ErrnoReading[]>(withQuery("/readings", { astronaut_id: id, sensor_id: "hr", from })),
      refetchInterval: 20_000,
    })),
  });
}

export function useHealthSparks(ids: string[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: ["errno-status-spark", id],
      queryFn: () => api.get<{ ts: number; health_index: number }[]>(withQuery("/status/spark", { astronaut_id: id })),
      enabled: Boolean(id),
      refetchInterval: 20_000,
    })),
  });
}

export function useErrnoStatus(astronautId: string) {
  return useQuery({ queryKey: errnoKeys.status(astronautId), queryFn: () => api.get<ErrnoStatus>(withQuery("/status", { astronaut_id: astronautId })), enabled: Boolean(astronautId), refetchInterval: 10_000 });
}

export function useErrnoReadings(astronautId: string, sensorId: string) {
  // Soft poll as backstop; /live WebSocket invalidates the same query keys on push.
  return useQuery({
    queryKey: errnoKeys.readings(astronautId, sensorId, "raw"),
    queryFn: () => api.get<ErrnoReading[]>(withQuery("/readings", { astronaut_id: astronautId, sensor_id: sensorId })),
    enabled: Boolean(astronautId && sensorId),
    refetchInterval: 4_000,
  });
}

export function useErrnoAlerts(astronautId: string, active = true) {
  return useQuery({
    queryKey: errnoKeys.alerts(astronautId, active),
    queryFn: () => api.get<ErrnoAlert[]>(withQuery("/alerts", { astronaut_id: astronautId, active })),
    enabled: Boolean(astronautId),
    refetchInterval: 10_000,
  });
}

export function useErrnoRangeAlerts(astronautId: string) {
  return useQuery({ queryKey: ["errno-range-alerts", astronautId], queryFn: () => api.get<ErrnoRangeAlert[]>(withQuery("/range-alerts", { astronaut_id: astronautId })), enabled: Boolean(astronautId), refetchInterval: 10_000 });
}

export function useErrnoLimits(astronautId: string) {
  return useQuery({ queryKey: ["errno-limits", astronautId], queryFn: () => api.get<ErrnoLimit[]>(withQuery("/limits", { astronaut_id: astronautId })), enabled: Boolean(astronautId), refetchInterval: 60_000 });
}

export function useErrnoChanges(astronautId: string) {
  return useQuery({ queryKey: ["errno-changes", astronautId], queryFn: () => api.get<ErrnoChange[]>(withQuery("/changes", { astronaut_id: astronautId })), enabled: Boolean(astronautId), refetchInterval: 30_000 });
}

export function useUpdateErrnoLimit(astronautId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { sensor_id: string; min: number; max: number; note?: string }) => api.put("/limits", { astronaut_id: astronautId, ...body }),
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: ["errno-limits", astronautId] }),
      client.invalidateQueries({ queryKey: errnoKeys.metrics }),
      client.invalidateQueries({ queryKey: ["errno-range-alerts"] }),
      client.invalidateQueries({ queryKey: ["errno-changes", astronautId] }),
    ]),
  });
}

export function useLogErrnoAction() {
  return useMutation({ mutationFn: submitErrnoAction });
}

export function useAcknowledgeErrnoAlert(astronautId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string | number) => api.post<{ ok: boolean }>(`/alerts/${id}/ack`),
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: ["errno-alerts", astronautId] }),
      client.invalidateQueries({ queryKey: errnoKeys.status(astronautId) }),
    ]),
  });
}

export function submitSleepCheckIn(body: { astronaut_id: string; hours: number; quality: number }) {
  return api.post<{ accepted: number }>("/forms/sleep", body);
}

export function submitPsychCheckIn(body: { astronaut_id: string; answers: number[] }) {
  return api.post<{ accepted: number }>("/forms/psych", body);
}

export function submitErrnoAction(body: { astronaut_id: string; alert_id: string | number; action: string }) {
  return api.post<{ id: number }>("/actions", body);
}

export function useEditReading(astronautId: string, sensorId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { id: number; value: number; note?: string }) => api.put(`/readings/${body.id}`, { value: body.value, note: body.note }),
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: errnoKeys.readings(astronautId, sensorId, "raw") }),
      client.invalidateQueries({ queryKey: errnoKeys.metrics }),
      client.invalidateQueries({ queryKey: ["errno-changes", astronautId] }),
      client.invalidateQueries({ queryKey: ["errno-range-alerts"] }),
      client.invalidateQueries({ queryKey: ["errno-status"] }),
    ]),
  });
}

export function useHud(astronautId: string) {
  return useQuery({ queryKey: ["errno-hud", astronautId], queryFn: () => api.get<Hud>(withQuery("/hud", { astronaut_id: astronautId })), enabled: Boolean(astronautId), refetchInterval: 5_000 });
}

export function usePenalties(astronautId: string) {
  return useQuery({ queryKey: ["errno-penalties", astronautId], queryFn: () => api.get<{ rows: PenaltyRow[]; health_index: number; total: number }>(withQuery("/penalties", { astronaut_id: astronautId })), enabled: Boolean(astronautId), refetchInterval: 5_000 });
}

export function useReadiness() {
  return useQuery({ queryKey: ["errno-readiness"], queryFn: () => api.get<Readiness[]>("/crew/readiness"), refetchInterval: 5_000 });
}

export function useIncidents() {
  return useQuery({ queryKey: ["errno-incidents"], queryFn: () => api.get<{ id: number; astronaut_id: string; opened_at: number; closed_at: number | null; break_glass: number }[]>("/incidents"), refetchInterval: 5_000 });
}

export function useEarthPackets() {
  return useQuery({ queryKey: ["errno-packets"], queryFn: () => api.get<EarthPacket[]>("/earth/packets"), refetchInterval: 2_000 });
}

export function useEarthActions() {
  return useQuery({ queryKey: ["errno-earth-actions"], queryFn: () => api.get<EarthAction[]>("/earth/actions"), refetchInterval: 3_000 });
}

export function useWarningLog() {
  return useQuery({ queryKey: ["errno-warnings"], queryFn: () => api.get<{ ts: number; astronaut_id: string; metric: string; penalty: number; message: string }[]>("/earth/warning-log"), refetchInterval: 10_000 });
}

export function usePublicConfig() {
  return useQuery({ queryKey: ["errno-config"], queryFn: () => api.get<PublicConfig>("/config/public"), staleTime: 60_000 });
}

export function submitManualReading(body: { astronaut_id: string; sensor_id: string; value: number; unit: string }) {
  return api.post<{ accepted: number }>("/readings/manual", body);
}
