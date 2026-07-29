import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_CADASTRAL_SPAN_DEG,
  parseCadastralRequest,
  PdokCadastralParcelProvider,
} from "./cadastralParcelProvider";

const anchor = { lat0: 52.09385, lon0: 5.1085 };
const bbox = {
  west: 5.1035,
  south: 52.0915,
  east: 5.1135,
  north: 52.0962,
};

const feature = (id: string) => ({
  type: "Feature",
  id,
  properties: { identificatie_lokaal_id: id },
  geometry: {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [5.108, 52.093],
          [5.109, 52.093],
          [5.109, 52.094],
          [5.108, 52.093],
        ],
      ],
    ],
  },
});

describe("parseCadastralRequest", () => {
  it("accepts a small ordered bbox and anchor", () => {
    expect(parseCadastralRequest({ bbox, anchor })).toEqual({ bbox, anchor });
  });

  it("distinguishes malformed and oversized requests", () => {
    expect(parseCadastralRequest(null)).toEqual({ error: "malformed" });
    expect(
      parseCadastralRequest({
        bbox: { ...bbox, east: bbox.west },
        anchor,
      }),
    ).toEqual({ error: "malformed" });
    expect(
      parseCadastralRequest({
        bbox: {
          ...bbox,
          east: bbox.west + MAX_CADASTRAL_SPAN_DEG + 0.001,
        },
        anchor,
      }),
    ).toEqual({ error: "span" });
  });
});

describe("PdokCadastralParcelProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("queries the official BRK collection and follows safe pagination", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          features: [feature("one")],
          links: [
            {
              rel: "next",
              href: "https://api.pdok.nl/kadaster/brk-kadastrale-kaart/ogc/v1/collections/perceel/items?cursor=next&f=json&limit=1000",
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ features: [feature("two")], links: [] }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new PdokCadastralParcelProvider().fetchParcels(
      bbox,
      anchor,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(firstUrl.hostname).toBe("api.pdok.nl");
    expect(firstUrl.searchParams.get("bbox")).toBe(
      `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    );
    expect(firstUrl.searchParams.get("limit")).toBe("1000");
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(result.parcels.map((parcel) => parcel.id)).toEqual(["one", "two"]);
    expect(result.truncated).toBe(false);
  });

  it("rejects pagination outside the official collection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          features: [],
          links: [{ rel: "next", href: "https://example.com/steal" }],
        }),
      }),
    );
    await expect(
      new PdokCadastralParcelProvider().fetchParcels(bbox, anchor),
    ).rejects.toThrow(/unsafe/);
  });

  it("reports HTTP and timeout failures clearly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    );
    await expect(
      new PdokCadastralParcelProvider().fetchParcels(bbox, anchor),
    ).rejects.toThrow(/503/);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(
        new DOMException("timed out", "TimeoutError"),
      ),
    );
    await expect(
      new PdokCadastralParcelProvider().fetchParcels(bbox, anchor),
    ).rejects.toThrow(/timed out/);
  });
});
