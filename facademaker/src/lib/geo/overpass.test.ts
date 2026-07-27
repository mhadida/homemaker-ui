import { describe, it, expect, vi, afterEach } from "vitest";
import { overpassFetch, overpassCacheKey, makeTtlCache, OVERPASS_ENDPOINTS } from "./overpass";

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const bad = (status: number) => ({ ok: false, status, json: async () => ({}) });

describe("overpassFetch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends an identifying User-Agent (Overpass 406s without one)", async () => {
    const f = vi.fn().mockResolvedValue(ok({ elements: [] }));
    vi.stubGlobal("fetch", f);
    await overpassFetch("[out:json];out;");
    const [, init] = f.mock.calls[0];
    expect(String(init.headers["user-agent"])).toBeTruthy();
  });

  it("fails over to the next mirror on a transient status", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(bad(504))
      .mockResolvedValueOnce(ok({ elements: [{ id: 1 }] }));
    vi.stubGlobal("fetch", f);
    const json = await overpassFetch("q");
    expect(json.elements).toHaveLength(1);
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[0][0]).toBe(OVERPASS_ENDPOINTS[0]);
    expect(f.mock.calls[1][0]).toBe(OVERPASS_ENDPOINTS[1]);
  });

  it("still sends the User-Agent on the failover attempt", async () => {
    const f = vi.fn().mockResolvedValueOnce(bad(429)).mockResolvedValueOnce(ok({}));
    vi.stubGlobal("fetch", f);
    await overpassFetch("q");
    expect(String(f.mock.calls[1][1].headers["user-agent"])).toBeTruthy();
  });

  it("fails fast on a non-transient status (does not try other mirrors)", async () => {
    const f = vi.fn().mockResolvedValue(bad(400));
    vi.stubGlobal("fetch", f);
    await expect(overpassFetch("q")).rejects.toThrow(/400/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("throws an actionable error when every mirror fails transiently", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(bad(504)));
    await expect(overpassFetch("q")).rejects.toThrow(/busy|try again/i);
  });

  it("treats a fetch rejection as transient and moves on", async () => {
    const f = vi.fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(ok({ elements: [] }));
    vi.stubGlobal("fetch", f);
    await expect(overpassFetch("q")).resolves.toBeTruthy();
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("overpassCacheKey", () => {
  const bbox = { west: 4.1, south: 52.1, east: 4.2, north: 52.2 };
  const anchor = { lat0: 52.15, lon0: 4.15 };
  it("is stable for the same area", () => {
    expect(overpassCacheKey(bbox, anchor)).toBe(overpassCacheKey({ ...bbox }, { ...anchor }));
  });
  it("ignores float noise below ~11 cm", () => {
    expect(overpassCacheKey({ ...bbox, west: 4.1 + 1e-9 }, anchor)).toBe(overpassCacheKey(bbox, anchor));
  });
  it("differs for a different area", () => {
    expect(overpassCacheKey({ ...bbox, west: 4.15 }, anchor)).not.toBe(overpassCacheKey(bbox, anchor));
  });
});

describe("makeTtlCache", () => {
  it("returns a stored value and misses after clear", () => {
    const c = makeTtlCache<number>(4, 1000);
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
    c.clear();
    expect(c.get("a")).toBeUndefined();
  });
  it("evicts the oldest entry past maxEntries", () => {
    const c = makeTtlCache<number>(2, 1000);
    c.set("a", 1); c.set("b", 2); c.set("c", 3);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
  });
  it("re-setting a key keeps it fresh against eviction", () => {
    const c = makeTtlCache<number>(2, 1000);
    c.set("a", 1); c.set("b", 2); c.set("a", 9); c.set("c", 3);
    expect(c.get("a")).toBe(9);   // refreshed, so "b" is the oldest
    expect(c.get("b")).toBeUndefined();
  });
  it("expires an entry past its TTL", () => {
    const c = makeTtlCache<number>(4, 1000);
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    c.set("a", 1);
    now.mockReturnValue(1001);
    expect(c.get("a")).toBeUndefined();
    now.mockRestore();
  });
});
