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
        // readBBox assumes a north-up, pitch-0 map (it unprojects the static
        // framing box's screen corners directly) — lock out every rotate/
        // pitch gesture so that assumption always holds.
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });
      m.touchZoomRotate.disableRotation();
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
          {/* NOT `absolute inset-0`: maplibre-gl.css defines `.maplibregl-map
              { position: relative }` and applies that class to this element
              at construction. Both `.absolute` (Tailwind) and `.maplibregl-map`
              are single-class selectors, so specificity ties and source order
              decides — maplibre's stylesheet is imported after Tailwind, so it
              wins, `position` never becomes `absolute`, and `inset-0` (which
              only applies under absolute/fixed positioning) is dropped
              entirely. The div then collapses to 0 height around its
              absolutely-positioned canvas children, and readBBox() (which
              unprojects clientHeight-derived pixel rows) degenerates to
              south === north. Filling the parent's definite height in normal
              flow sidesteps the specificity fight altogether. */}
          <div ref={mapEl} className="h-full w-full" />
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
