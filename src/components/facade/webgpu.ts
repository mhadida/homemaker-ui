/** Single choke point for "are we on the WebGPU renderer path?" during the
 * flag-gated rollout (`?webgpu`). Phase 4 replaces the query flag with a user
 * setting; everything renderer-dependent imports this so the switch happens in
 * one place. */
export const isWebGPUPath = (): boolean =>
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("webgpu");

/** `?webgpu&webgl2` forces WebGPURenderer's WebGL2 backend — the fallback
 * users without WebGPU get. Same node materials, compiled to GLSL instead of
 * WGSL; exists so the fallback can be verified on a WebGPU-capable machine. */
export const isForcedWebGL2 = (): boolean =>
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("webgl2");
