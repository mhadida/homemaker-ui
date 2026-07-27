import { describe, expect, it } from "vitest";
import { rendererModeFor } from "./webgpu";

describe("rendererModeFor", () => {
  it("defaults to the production-safe classic WebGL renderer", () => {
    expect(rendererModeFor("")).toBe("webgl");
    expect(rendererModeFor("?stats")).toBe("webgl");
  });

  it("keeps both WebGPURenderer backends available explicitly", () => {
    expect(rendererModeFor("?webgpu")).toBe("webgpu");
    expect(rendererModeFor("?webgl2")).toBe("webgl2");
  });
});
