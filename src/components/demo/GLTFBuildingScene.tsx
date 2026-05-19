"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { BuildingParams } from "@/lib/building/types";
import { DEFAULT_PARAMS } from "@/lib/building/types";

export type BuildStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "ready";
      generationMs: number;
      bytes: number;
      cached?: boolean;
    }
  | { kind: "error"; message: string };

interface GLTFBuildingSceneProps {
  params: BuildingParams;
  debounceMs?: number;
  onStatusChange?: (s: BuildStatus) => void;
}

// ── Client-side cache + cosmetic-vs-structural split ────────────────────────
//
// The Python pipeline on Vercel takes 1-3s warm to regenerate a building.
// Most slider tweaks don't actually need to hit the server:
//   - Cosmetic changes (wallColor, roofColor) are pure material recolors
//     applied to the existing Three.js scene — no fetch at all.
//   - Structural changes (footprint, style, storeys, roof, ...) DO need a
//     new glb. We keep an LRU cache keyed by the structural-only hash so
//     sliding back across recent values is instant.
//
// The cache is module-scoped so it survives component remounts (e.g. when
// the parent layout briefly unmounts the scene).

const STRUCTURAL_KEYS = [
  "footprint",
  "holes",
  "storeys",
  "storeyHeight",
  "storeyHeights",
  "style",
  "roof",
  "ridgeHeight",
  "rooms",
] as const;

function structuralKey(p: BuildingParams): string {
  return JSON.stringify(STRUCTURAL_KEYS.map((k) => p[k]));
}

const GLB_CACHE = new Map<string, ArrayBuffer>();
const GLB_CACHE_MAX = 24;

function cachePut(key: string, buf: ArrayBuffer) {
  // Touch-on-write LRU: delete-and-reinsert puts the key at the tail.
  if (GLB_CACHE.has(key)) GLB_CACHE.delete(key);
  GLB_CACHE.set(key, buf);
  while (GLB_CACHE.size > GLB_CACHE_MAX) {
    const oldest = GLB_CACHE.keys().next().value;
    if (oldest === undefined) break;
    GLB_CACHE.delete(oldest);
  }
}

function cacheGet(key: string): ArrayBuffer | undefined {
  const buf = GLB_CACHE.get(key);
  if (buf !== undefined) {
    // Touch for LRU
    GLB_CACHE.delete(key);
    GLB_CACHE.set(key, buf);
  }
  return buf;
}

// Prewarm with the canonical default glb shipped as a static asset. Lets the
// initial render skip the Python pipeline entirely on cold start — the static
// file is served from the CDN with immutable caching (see next.config.ts).
const DEFAULT_KEY = structuralKey(DEFAULT_PARAMS);
let prewarmPromise: Promise<void> | null = null;
function prewarmDefault(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (prewarmPromise) return prewarmPromise;
  prewarmPromise = fetch("/default.glb")
    .then((res) => (res.ok ? res.arrayBuffer() : null))
    .then((buf) => {
      if (buf) cachePut(DEFAULT_KEY, buf);
    })
    .catch(() => {
      // Missing or stale default.glb is non-fatal — fall through to /build.
    });
  return prewarmPromise;
}

// Fire-and-forget prewarm on module load — runs once per page session.
if (typeof window !== "undefined") prewarmDefault();

// ── Component ───────────────────────────────────────────────────────────────

export default function GLTFBuildingScene({
  params,
  debounceMs = 300,
  onStatusChange,
}: GLTFBuildingSceneProps) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const requestId = useRef(0);
  const loader = useRef(new GLTFLoader());

  // Keep latest props in refs so the fetch effect doesn't re-fire on
  // cosmetic-only changes (those only deps that actually drive the fetch
  // belong in its dep array — the structural key).
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  const key = useMemo(() => structuralKey(params), [params]);

  // ── Apply current cosmetic colors to the loaded scene. Fires on either
  // (a) a brand-new scene loading, or (b) the user changing a color slider. ──
  useEffect(() => {
    if (!scene) return;
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mat = obj.material as THREE.MeshStandardMaterial | undefined;
      if (!mat || !mat.color) return;
      if (mat.name === "homemaker:wall" && params.wallColor) {
        mat.color.set(params.wallColor);
        mat.needsUpdate = true;
      } else if (mat.name === "homemaker:roof" && params.roofColor) {
        mat.color.set(params.roofColor);
        mat.needsUpdate = true;
      }
    });
  }, [scene, params.wallColor, params.roofColor]);

  // ── Fetch (or cache-hit) a glb whenever structural params change ──
  useEffect(() => {
    const applyGlb = (
      buf: ArrayBuffer,
      genMs: number,
      fromCache: boolean,
      myId: number,
    ) => {
      loader.current.parse(
        buf,
        "",
        (gltf) => {
          if (myId !== requestId.current) return;
          gltf.scene.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
              obj.castShadow = true;
              obj.receiveShadow = true;
              const mat = obj.material as THREE.MeshStandardMaterial;
              if (!mat) return;
              if (mat.name === "homemaker:window") {
                mat.envMapIntensity = 3.0;
                mat.transparent = true;
                mat.depthWrite = false;
              } else {
                mat.envMapIntensity = 0.7;
              }
            }
          });
          setScene((prev) => {
            if (prev) prev.parent?.remove(prev);
            return gltf.scene;
          });
          onStatusChangeRef.current?.({
            kind: "ready",
            generationMs: genMs,
            bytes: buf.byteLength,
            cached: fromCache,
          });
        },
        (err) => {
          const msg =
            err && typeof err === "object" && "message" in err
              ? String((err as { message: unknown }).message)
              : "unknown";
          onStatusChangeRef.current?.({
            kind: "error",
            message: `parse: ${msg}`,
          });
        },
      );
    };

    const handle = window.setTimeout(async () => {
      const myId = ++requestId.current;

      // Cache hit: render synchronously, no network.
      let cached = cacheGet(key);
      if (cached) {
        applyGlb(cached, 0, true, myId);
        return;
      }

      // For the canonical default, wait briefly for the static prewarm to
      // finish before falling through to the Python pipeline. The static glb
      // is served from CDN with immutable caching and avoids cold-start cost.
      if (key === DEFAULT_KEY) {
        await prewarmDefault();
        if (myId !== requestId.current) return;
        cached = cacheGet(key);
        if (cached) {
          applyGlb(cached, 0, true, myId);
          return;
        }
      }

      onStatusChangeRef.current?.({ kind: "loading" });

      fetch("/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(paramsRef.current),
      })
        .then(async (res) => {
          if (myId !== requestId.current) return null;
          if (!res.ok) {
            const text = await res.text();
            throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
          }
          const buf = await res.arrayBuffer();
          const genMs = parseInt(res.headers.get("X-Generation-Ms") || "0", 10);
          return { buf, genMs };
        })
        .then((result) => {
          if (!result || myId !== requestId.current) return;
          cachePut(key, result.buf);
          applyGlb(result.buf, result.genMs, false, myId);
        })
        .catch((err) => {
          if (myId !== requestId.current) return;
          onStatusChangeRef.current?.({
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        });
    }, debounceMs);

    return () => window.clearTimeout(handle);
  }, [key, debounceMs]);

  if (!scene) return null;
  return <primitive object={scene} />;
}
