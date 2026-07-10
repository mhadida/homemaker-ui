"use client";

import { Suspense, useCallback, useEffect, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import SceneContents from "./SceneContents";
import type { FacadeParams, LotContext } from "@/lib/facade/types";
import { FACADE_DEFAULT_VIEW } from "@/lib/facade/types";
import type { ViewSettings } from "@/lib/building/types";

interface FacadeViewerProps {
  params: FacadeParams;
  context: LotContext;
  view?: ViewSettings;
}

/** Exposes a capture function that renders a fresh frame then downloads a
 * PNG. Rendering immediately before toDataURL avoids needing
 * preserveDrawingBuffer (which costs performance every frame). */
function CaptureBridge({ bind }: { bind: (fn: () => void) => void }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    bind(() => {
      gl.render(scene, camera);
      const src = gl.domElement;
      // The sky is a CSS gradient behind the (alpha) canvas — composite it in,
      // or the exported PNG gets a transparent sky.
      const out = document.createElement("canvas");
      out.width = src.width;
      out.height = src.height;
      const ctx = out.getContext("2d")!;
      const grad = ctx.createLinearGradient(0, 0, 0, out.height);
      grad.addColorStop(0, "#8ea4b8");
      grad.addColorStop(0.55, "#a8b0b3");
      grad.addColorStop(1, "#b8ad9c");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(src, 0, 0);
      const a = document.createElement("a");
      a.href = out.toDataURL("image/png");
      a.download = "facade.png";
      a.click();
    });
  }, [gl, scene, camera, bind]);
  return null;
}

export default function FacadeViewer({
  params,
  context,
  view = FACADE_DEFAULT_VIEW,
}: FacadeViewerProps) {
  const captureRef = useRef<(() => void) | null>(null);
  const bindCapture = useCallback((fn: () => void) => {
    captureRef.current = fn;
  }, []);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        background:
          "linear-gradient(to bottom, #8ea4b8 0%, #a8b0b3 55%, #b8ad9c 100%)",
      }}
    >
      <Canvas
        shadows
        camera={{ position: [6, 5, 14], fov: 40, near: 0.1, far: 200 }}
        gl={{ alpha: true, antialias: true }}
        dpr={[1, 2]}
      >
        <Suspense fallback={null}>
          <SceneContents params={params} context={context} view={view} />
        </Suspense>
        <CaptureBridge bind={bindCapture} />
      </Canvas>

      <button
        type="button"
        onClick={() => captureRef.current?.()}
        className="absolute top-3 right-3 rounded-lg bg-black/55 backdrop-blur-md px-3 py-1.5 text-[11px] text-white/85 hover:bg-black/70 transition-colors"
      >
        Save image
      </button>
    </div>
  );
}
