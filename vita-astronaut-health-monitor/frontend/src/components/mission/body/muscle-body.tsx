"use client";

import { Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { useT } from "@/lib/locale";
import { type BodySex, type OrganId, ORGANS, ORGAN_BY_ID, bodyFallbacks } from "./organs";

export type ZoneLevel = "green" | "yellow" | "red";

export interface BodyMetric {
  id: string;
  name: string;
  zone: string | null;
  value: string;
  unit: string;
  /** Dropped from organ colour fusion when the transducer is dead. */
  signalLost?: boolean;
}

const MARKER: Record<ZoneLevel, string> = {
  green: "border-white/55 bg-white/40",
  yellow: "border-caution bg-caution",
  red: "border-critical bg-critical",
};

function levelOf(zone: string | null): ZoneLevel {
  if (zone === "red") return "red";
  if (zone === "yellow") return "yellow";
  return "green";
}

function organLevel(metrics: BodyMetric[], sensors: readonly string[]): ZoneLevel {
  let worst: ZoneLevel = "green";
  for (const id of sensors) {
    const hit = metrics.find((m) => m.id === id);
    // Sensor fusion: ignore SIGNAL_LOST channels so one dead bracelet cannot paint the organ red.
    if (!hit || hit.signalLost) continue;
    const lv = levelOf(hit.zone);
    if (lv === "red") return "red";
    if (lv === "yellow") worst = "yellow";
  }
  return worst;
}

function fitModel(model: THREE.Object3D, targetHeight = 1.75) {
  model.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) return 1.75;
  const size = box.getSize(new THREE.Vector3());
  const tall = Math.max(size.y, 0.001);
  model.scale.multiplyScalar(targetHeight / tall);
  model.updateWorldMatrix(true, true);
  const box2 = new THREE.Box3().setFromObject(model);
  const center = box2.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box2.min.y;
  return box2.getSize(new THREE.Vector3()).y || targetHeight;
}

/** Scale organ to anatomical size and center its bbox at local origin. */
function fitOrganCentered(model: THREE.Object3D, targetSize: number) {
  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  model.scale.set(1, 1, 1);
  model.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z, 0.001);
  model.scale.multiplyScalar(targetSize / longest);
  model.updateWorldMatrix(true, true);
  const box2 = new THREE.Box3().setFromObject(model);
  const center = box2.getCenter(new THREE.Vector3());
  model.position.sub(center);
}

function prepareMaterials(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const mat = m as THREE.MeshStandardMaterial;
      if (!mat) continue;
      mat.side = THREE.DoubleSide;
      if ("transparent" in mat && mat.transparent && (mat.opacity ?? 1) < 0.05) mat.opacity = 1;
    }
  });
}

function loadUrl(loader: GLTFLoader, url: string): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject);
  });
}

async function loadFirst(loader: GLTFLoader, urls: string[]): Promise<THREE.Group> {
  let last: unknown;
  for (const url of urls) {
    try {
      return await loadUrl(loader, url);
    } catch (e) {
      last = e;
    }
  }
  throw last ?? new Error("no model");
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) m?.dispose?.();
    }
  });
}

export function MuscleBody({
  metrics,
  sex,
  organId,
  onOrganChange,
}: {
  metrics: BodyMetric[];
  sex: BodySex;
  organId: OrganId | null;
  onOrganChange: (id: OrganId | null) => void;
}) {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const host = useRef<HTMLDivElement>(null);
  const markers = useRef(new Map<string, HTMLElement>());
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;
  const organRef = useRef(organId);
  organRef.current = organId;
  const onOrganRef = useRef(onOrganChange);
  onOrganRef.current = onOrganChange;

  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("");
  const api = useRef<{
    zoomBy: (f: number) => void;
    focusOrgan: (id: OrganId | null) => void;
    reloadBody: (sex: BodySex) => void;
  } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setClearColor(0x0a0d12, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    el.prepend(renderer.domElement);
    renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:grab";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
    const root = new THREE.Group();
    scene.add(root);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x1b2433, 1.15));
    const key = new THREE.DirectionalLight(0xfff2e8, 2.2);
    key.position.set(2.2, 4, 3);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x9db7ff, 0.9);
    fill.position.set(-3, 1.4, -1);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 1.1);
    rim.position.set(0, 2, -3.5);
    scene.add(rim);

    const bodySlot = new THREE.Group();
    const organSlot = new THREE.Group();
    root.add(bodySlot, organSlot);

    const loader = new GLTFLoader();
    let zoom = 1;
    let zoomTo = 1;
    let focusY = 0;
    let focusTo = 0;
    let focusX = 0;
    let focusXTo = 0;
    let baseDist = 3.2;
    let userRot = 0.35;
    let velocity = 0;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let disposed = false;
    let bodyHeight = 1.75;
    let bodyLoad = 0;
    let organLoad = 0;
    const organCache = new Map<string, THREE.Group>();

    const clamp = () => {
      zoomTo = Math.min(2.8, Math.max(0.85, zoomTo));
      focusTo = Math.min(0.55, Math.max(-0.35, focusTo));
      focusXTo = Math.min(0.35, Math.max(-0.35, focusXTo));
    };

    const clearSlot = (slot: THREE.Group) => {
      while (slot.children.length) {
        const child = slot.children[0];
        slot.remove(child);
      }
    };

    const mountBody = async (nextSex: BodySex) => {
      const ticket = ++bodyLoad;
      setStatus(tRef.current("body.loadingBody"));
      try {
        const model = await loadFirst(loader, bodyFallbacks(nextSex));
        if (disposed || ticket !== bodyLoad) {
          disposeObject(model);
          return;
        }
        prepareMaterials(model);
        clearSlot(bodySlot);
        bodySlot.add(model);
        bodyHeight = fitModel(model, 1.75);
        setReady(true);
        setStatus("");
        resize();
      } catch (e) {
        console.error(e);
        if (ticket === bodyLoad) setStatus(tRef.current("body.bodyLoadFail"));
      }
    };

    const placeOrganMesh = (id: OrganId, mesh: THREE.Group) => {
      clearSlot(organSlot);
      const def = ORGAN_BY_ID[id];
      const holder = new THREE.Group();
      const clone = mesh.clone(true);
      prepareMaterials(clone);
      const target = def.size * (bodyHeight / 1.75);
      fitOrganCentered(clone, target);
      holder.add(clone);
      if (def.rot) holder.rotation.set(def.rot[0], def.rot[1], def.rot[2]);
      const y = (def.pos[1] / 1.8) * bodyHeight;
      const x = (def.pos[0] / 1.8) * bodyHeight;
      const z = (def.pos[2] / 1.8) * bodyHeight;
      holder.position.set(x, y, z);
      organSlot.add(holder);
      bodySlot.traverse((obj) => {
        const meshObj = obj as THREE.Mesh;
        if (!meshObj.isMesh) return;
        const mats = Array.isArray(meshObj.material) ? meshObj.material : [meshObj.material];
        for (const m of mats) {
          const mat = m as THREE.MeshStandardMaterial;
          if (mat && "opacity" in mat) {
            mat.transparent = true;
            mat.opacity = 0.28;
            mat.depthWrite = false;
            mat.needsUpdate = true;
          }
        }
      });
    };

    const restoreBodyOpacity = () => {
      bodySlot.traverse((obj) => {
        const meshObj = obj as THREE.Mesh;
        if (!meshObj.isMesh) return;
        const mats = Array.isArray(meshObj.material) ? meshObj.material : [meshObj.material];
        for (const m of mats) {
          const mat = m as THREE.MeshStandardMaterial;
          if (mat && "opacity" in mat) {
            mat.opacity = 1;
            mat.transparent = false;
            mat.depthWrite = true;
            mat.needsUpdate = true;
          }
        }
      });
    };

    const focusOrgan = (id: OrganId | null) => {
      if (!id) {
        clearSlot(organSlot);
        restoreBodyOpacity();
        zoomTo = 1;
        focusTo = 0;
        focusXTo = 0;
        clamp();
        return;
      }
      const def = ORGAN_BY_ID[id];
      zoomTo = def.zoom;
      focusTo = def.pos[1] / 1.8 - 0.55;
      focusXTo = (def.pos[0] / 1.8) * 0.6;
      clamp();

      const ticket = ++organLoad;
      const cached = organCache.get(id);
      if (cached) {
        placeOrganMesh(id, cached);
        return;
      }
      setStatus(tRef.current("body.loadingOrgan", { organ: tRef.current(def.labelKey) }));
      void loadUrl(loader, def.model)
        .then((sceneGraph) => {
          if (disposed) return;
          organCache.set(id, sceneGraph);
          if (ticket !== organLoad || organRef.current !== id) return;
          placeOrganMesh(id, sceneGraph);
          setStatus("");
        })
        .catch((e) => {
          console.error(e);
          if (ticket === organLoad) setStatus(tRef.current("body.organLoadFail", { organ: tRef.current(def.labelKey) }));
        });
    };

    void mountBody(sex);
    if (organId) focusOrgan(organId);

    const canvas = renderer.domElement;
    const down = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      velocity = (e.clientX - lastX) * 0.007;
      userRot += velocity;
      focusTo += ((e.clientY - lastY) / (el.clientHeight || 1)) * 0.8;
      clamp();
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const up = () => {
      dragging = false;
      canvas.style.cursor = "grab";
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomTo *= Math.exp(-e.deltaY * 0.0013);
      clamp();
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", wheel, { passive: false });

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      baseDist = Math.max(2.8, bodyHeight * 1.9);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const clock = new THREE.Clock();
    const v = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (document.hidden || el.clientHeight === 0) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      if (!dragging) {
        userRot += velocity;
        velocity *= 0.92;
        if (!reduce && !organRef.current) userRot += dt * 0.06;
      }
      const ease = reduce ? 1 : Math.min(1, dt * 7);
      zoom += (zoomTo - zoom) * ease;
      focusY += (focusTo - focusY) * ease;
      focusX += (focusXTo - focusX) * ease;

      const lookY = bodyHeight * 0.55 + focusY;
      camera.position.set(focusX * bodyHeight * 0.35, lookY + 0.08, baseDist / zoom);
      camera.lookAt(focusX * bodyHeight * 0.2, lookY, 0);
      root.rotation.y = userRot;

      renderer.render(scene, camera);

      const w = el.clientWidth;
      const h = el.clientHeight;
      camera.getWorldDirection(camDir);
      for (const def of ORGANS) {
        const node = markers.current.get(def.id);
        if (!node) continue;
        const y = (def.pos[1] / 1.8) * bodyHeight;
        const x = (def.pos[0] / 1.8) * bodyHeight;
        const z = (def.pos[2] / 1.8) * bodyHeight;
        v.set(x, y, z);
        root.localToWorld(v);
        const front = v.clone().sub(camera.position).dot(camDir) > 0;
        v.project(camera);
        node.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
        node.style.visibility = Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2 ? "visible" : "hidden";
        node.style.opacity = front ? "1" : "0.22";
      }
    };
    frame();

    api.current = {
      zoomBy: (f) => {
        zoomTo *= f;
        clamp();
      },
      focusOrgan,
      reloadBody: (next) => {
        void mountBody(next);
      },
    };

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel);
      for (const mesh of organCache.values()) disposeObject(mesh);
      organCache.clear();
      renderer.dispose();
      canvas.remove();
      api.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.current?.reloadBody(sex);
  }, [sex]);

  useEffect(() => {
    api.current?.focusOrgan(organId);
  }, [organId]);

  return (
    <div ref={host} className="relative h-full min-h-[360px] w-full overflow-hidden" role="group" aria-label={t("body.map3dAria")}>
      {!ready ? (
        <p className="pointer-events-none absolute inset-0 z-[2] grid place-items-center text-sm text-white/70" role="status">
          {status || t("body.init3d")}
        </p>
      ) : status ? (
        <p className="pointer-events-none absolute top-16 left-1/2 z-[2] -translate-x-1/2 rounded-full border border-white/10 bg-black/70 px-3 py-1 text-xs text-white/70" role="status">
          {status}
        </p>
      ) : null}

      {ORGANS.map((def) => {
        const level = organLevel(metrics, def.sensors);
        const active = organId === def.id;
        return (
          <button
            key={def.id}
            type="button"
            ref={(node) => {
              if (node) markers.current.set(def.id, node);
              else markers.current.delete(def.id);
            }}
            onClick={() => onOrganChange(active ? null : def.id)}
            aria-pressed={active}
            aria-label={t(def.labelKey)}
            title={t(def.labelKey)}
            className="absolute top-0 left-0 -mt-5 -ml-5 flex size-10 items-center justify-center"
          >
            <span
              className={`size-3 rounded-full border shadow-[0_0_14px_currentColor] transition ${MARKER[level]} ${active ? "scale-150 ring-2 ring-white/80" : ""}`}
            />
          </button>
        );
      })}

      <div className="absolute top-1/2 left-3 z-[3] flex -translate-y-1/2 flex-col gap-1.5">
        <button type="button" aria-label="Zoom in" onClick={() => api.current?.zoomBy(1.3)} className="grid size-10 place-items-center rounded-lg border border-white/15 bg-black/55 text-white hover:border-white/40">
          <Plus className="size-4" />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => api.current?.zoomBy(1 / 1.3)} className="grid size-10 place-items-center rounded-lg border border-white/15 bg-black/55 text-white hover:border-white/40">
          <Minus className="size-4" />
        </button>
      </div>

      <p className="pointer-events-none absolute inset-x-0 bottom-3 z-[3] text-center text-[10px] text-white/35">{t("body.hintControls")}</p>
    </div>
  );
}
