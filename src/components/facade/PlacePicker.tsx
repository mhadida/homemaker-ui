"use client";
import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LngLatBBox } from "@/lib/geo/project";

/** Modal map picker. The user frames an area inside a fixed centre box (the
 * middle 60% of the map) and loads it; readBBox unprojects the box corners. */
export default function PlacePicker({
  onLoad,
  onCancel,
  loading,
  error,
}: {
  onLoad: (bbox: LngLatBBox) => void;
  onCancel: () => void;
  loading: boolean;
  error: string | null;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  // maplibre's Map type isn't imported statically (dynamic import below); the
  // ref is intentionally loosely typed.
  const mapRef = useRef<{ unproject: (p: [number, number]) => { lng: number; lat: number }; remove: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let map: { remove: () => void } | null = null;
    (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (cancelled || !mapEl.current) return;
      const m = new maplibregl.Map({
        container: mapEl.current,
        style: "https://tiles.openfreemap.org/styles/liberty",
        center: [4.9041, 52.3676], // Amsterdam
        zoom: 14,
      });
      mapRef.current = m as unknown as typeof mapRef.current;
      map = m;
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, []);

  const readBBox = (): LngLatBBox | null => {
    const map = mapRef.current;
    const el = mapEl.current;
    if (!map || !el) return null;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const mx = w * 0.2;
    const my = h * 0.2;
    const nw = map.unproject([mx, my]);
    const se = map.unproject([w - mx, h - my]);
    return { west: nw.lng, north: nw.lat, east: se.lng, south: se.lat };
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-[720px] max-w-[92vw] rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3 shadow-xl">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold">Load a place</span>
          <button
            type="button"
            onClick={onCancel}
            className="text-[11px] px-2 py-0.5 rounded border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--foreground)]/30 transition-colors"
          >
            Cancel
          </button>
        </div>
        <div className="relative h-[420px] w-full overflow-hidden rounded">
          <div ref={mapEl} className="absolute inset-0" />
          {/* fixed centre framing box (middle 60%) */}
          <div className="pointer-events-none absolute inset-[20%] border-2 border-[var(--accent)] rounded-sm" />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-[var(--muted)]">
            Pan &amp; zoom so the box frames your area.
          </span>
          <div className="flex items-center gap-2">
            {error && (
              <span className="text-[11px] text-red-400" role="alert">
                {error}
              </span>
            )}
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                const bbox = readBBox();
                if (bbox) onLoad(bbox);
              }}
              className="text-[11px] px-3 py-1 rounded border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors disabled:opacity-50"
            >
              {loading ? "Loading terrain…" : "Load this area"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
