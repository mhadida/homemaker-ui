"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { BuildingParams } from "@/lib/building/types";

interface GLTFBuildingSceneProps {
  params: BuildingParams;
  debounceMs?: number;
  onStatusChange?: (s: BuildStatus) => void;
}

export type BuildStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; generationMs: number; bytes: number }
  | { kind: "error"; message: string };

export default function GLTFBuildingScene({
  params,
  debounceMs = 300,
  onStatusChange,
}: GLTFBuildingSceneProps) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const requestId = useRef(0);
  const loader = useRef(new GLTFLoader());

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const myId = ++requestId.current;
      onStatusChange?.({ kind: "loading" });

      // `/build` is the Python Vercel Function service (see vercel.json).
      // It's served by Next.js's API route in `npm run dev` via a rewrite,
      // and directly by Vercel in production + `vercel dev -L`.
      fetch("/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
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
          loader.current.parse(
            result.buf,
            "",
            (gltf) => {
              if (myId !== requestId.current) return;
              gltf.scene.traverse((obj) => {
                if (obj instanceof THREE.Mesh) {
                  obj.castShadow = true;
                  obj.receiveShadow = true;
                  const mat = obj.material as THREE.MeshStandardMaterial;
                  if (mat) {
                    // Strong HDRI reflection on glass; subtle everywhere else.
                    if (mat.name === "homemaker:window") {
                      mat.envMapIntensity = 3.0;
                      mat.transparent = true;
                      mat.depthWrite = false;
                    } else {
                      mat.envMapIntensity = 0.7;
                    }
                  }
                }
              });
              setScene((prev) => {
                if (prev) prev.parent?.remove(prev);
                return gltf.scene;
              });
              onStatusChange?.({
                kind: "ready",
                generationMs: result.genMs,
                bytes: result.buf.byteLength,
              });
            },
            (err) => {
              const msg =
                err && typeof err === "object" && "message" in err
                  ? String((err as { message: unknown }).message)
                  : "unknown";
              onStatusChange?.({
                kind: "error",
                message: `parse: ${msg}`,
              });
            },
          );
        })
        .catch((err) => {
          if (myId !== requestId.current) return;
          onStatusChange?.({
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        });
    }, debounceMs);

    return () => window.clearTimeout(handle);
  }, [JSON.stringify(params), debounceMs, onStatusChange]);

  if (!scene) return null;
  return <primitive object={scene} />;
}
