import type { GeoAnchor, LngLatBBox } from "./project";
import {
  pdokToCadastralParcels,
  type CadastralParcelFetchResult,
  type PdokParcelFeature,
} from "./cadastralParcels";

const PDOK_ORIGIN = "https://api.pdok.nl";
const PDOK_ITEMS_PATH =
  "/kadaster/brk-kadastrale-kaart/ogc/v1/collections/perceel/items";
const PDOK_ITEMS_URL = `${PDOK_ORIGIN}${PDOK_ITEMS_PATH}`;
const PAGE_SIZE = 1000;
export const MAX_CADASTRAL_PARCELS = 8000;
export const MAX_CADASTRAL_SPAN_DEG = 0.05;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export type CadastralRequestError = "malformed" | "span";

export function parseCadastralRequest(
  body: unknown,
):
  | { bbox: LngLatBBox; anchor: GeoAnchor }
  | { error: CadastralRequestError } {
  if (typeof body !== "object" || body === null) return { error: "malformed" };
  const bbox = (body as { bbox?: Partial<LngLatBBox> }).bbox;
  const anchor = (body as { anchor?: Partial<GeoAnchor> }).anchor;
  if (!bbox || !anchor) return { error: "malformed" };
  if (
    !finite(bbox.west) ||
    !finite(bbox.south) ||
    !finite(bbox.east) ||
    !finite(bbox.north) ||
    !finite(anchor.lat0) ||
    !finite(anchor.lon0)
  )
    return { error: "malformed" };
  if (bbox.west >= bbox.east || bbox.south >= bbox.north)
    return { error: "malformed" };
  if (
    bbox.east - bbox.west > MAX_CADASTRAL_SPAN_DEG ||
    bbox.north - bbox.south > MAX_CADASTRAL_SPAN_DEG
  )
    return { error: "span" };
  return {
    bbox: {
      west: bbox.west,
      south: bbox.south,
      east: bbox.east,
      north: bbox.north,
    },
    anchor: { lat0: anchor.lat0, lon0: anchor.lon0 },
  };
}

interface PdokPage {
  features?: PdokParcelFeature[];
  links?: { rel?: unknown; href?: unknown }[];
}

function safeNextUrl(page: PdokPage): string | null {
  const href = page.links?.find((link) => link.rel === "next")?.href;
  if (typeof href !== "string") return null;
  const url = new URL(href);
  if (url.origin !== PDOK_ORIGIN || url.pathname !== PDOK_ITEMS_PATH)
    throw new Error("PDOK returned an unsafe parcel pagination URL.");
  return url.toString();
}

function firstPageUrl(bbox: LngLatBBox): string {
  const url = new URL(PDOK_ITEMS_URL);
  url.searchParams.set(
    "bbox",
    `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
  );
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("f", "json");
  return url.toString();
}

export interface CadastralParcelProvider {
  fetchParcels(
    bbox: LngLatBBox,
    anchor: GeoAnchor,
  ): Promise<CadastralParcelFetchResult>;
}

/** Official Dutch BRK cadastral parcel adapter.
 *
 * The PDOK collection is public, CC BY 4.0, and requires no API key. The
 * Kadastrale Kaart is authoritative reference data but its published geometry
 * is explicitly indicative: survey measurements cannot be derived from it.
 */
export class PdokCadastralParcelProvider
  implements CadastralParcelProvider
{
  async fetchParcels(
    bbox: LngLatBBox,
    anchor: GeoAnchor,
  ): Promise<CadastralParcelFetchResult> {
    const features: PdokParcelFeature[] = [];
    const seen = new Set<string>();
    let next: string | null = firstPageUrl(bbox);

    while (next && features.length < MAX_CADASTRAL_PARCELS) {
      if (seen.has(next)) throw new Error("PDOK parcel pagination looped.");
      seen.add(next);
      let response: Response;
      try {
        response = await fetch(next, {
          headers: {
            accept: "application/geo+json, application/json",
            "user-agent": "Facademaker/1.0 (+https://github.com/brunopostle/homemaker)",
          },
          signal: AbortSignal.timeout(20_000),
        });
      } catch (error) {
        if (
          error instanceof DOMException &&
          (error.name === "TimeoutError" || error.name === "AbortError")
        )
          throw new Error("PDOK parcel request timed out — try a smaller area.");
        throw error;
      }
      if (!response.ok)
        throw new Error(`PDOK parcel request failed (HTTP ${response.status}).`);
      const page = (await response.json()) as PdokPage;
      features.push(...(Array.isArray(page.features) ? page.features : []));
      next = safeNextUrl(page);
    }

    const truncated =
      next !== null || features.length > MAX_CADASTRAL_PARCELS;
    return {
      parcels: pdokToCadastralParcels(
        features.slice(0, MAX_CADASTRAL_PARCELS),
        anchor,
      ),
      truncated,
    };
  }
}
