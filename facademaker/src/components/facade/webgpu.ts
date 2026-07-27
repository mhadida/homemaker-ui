export type RendererMode = "webgl" | "webgpu" | "webgl2";

/** Pure query-string resolver so the production-safe default is testable.
 * WebGPU remains available for profiling and fixes, but a failed WebGPU
 * multi-view render must never blank the editor for an ordinary visitor. */
export const rendererModeFor = (search: string): RendererMode => {
  const params = new URLSearchParams(search);
  if (params.has("webgl2")) return "webgl2";
  if (params.has("webgpu")) return "webgpu";
  return "webgl";
};

/** Single choke point for "are we on the WebGPURenderer path?".
 *
 * The classic WebGLRenderer is the production default. `?webgpu` opts into
 * native WebGPU and `?webgl2` exercises WebGPURenderer's fallback backend. */
export const isWebGPUPath = (): boolean =>
  typeof window !== "undefined" &&
  rendererModeFor(window.location.search) !== "webgl";

/** `?webgl2` forces WebGPURenderer's WebGL2 backend — the fallback users
 * without native WebGPU get. Same node materials, compiled to GLSL instead
 * of WGSL; exists so that backend can be verified explicitly. */
export const isForcedWebGL2 = (): boolean =>
  typeof window !== "undefined" &&
  rendererModeFor(window.location.search) === "webgl2";
