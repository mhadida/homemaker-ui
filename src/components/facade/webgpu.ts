/** Single choke point for "are we on the WebGPU renderer path?".
 *
 * WebGPU is the DEFAULT renderer (native Metal on Mac — measured ~3× the
 * classic WebGL frame rate; three auto-falls back to its WebGL2 backend where
 * WebGPU is unavailable). `?webgl` opts back into the classic WebGLRenderer
 * as a rollout escape hatch; everything renderer-dependent imports this so
 * the switch happens in one place. */
export const isWebGPUPath = (): boolean =>
  typeof window !== "undefined" &&
  !new URLSearchParams(window.location.search).has("webgl");

/** `?webgl2` forces WebGPURenderer's WebGL2 backend — the fallback users
 * without WebGPU get. Same node materials, compiled to GLSL instead of WGSL;
 * exists so the fallback can be verified on a WebGPU-capable machine. */
export const isForcedWebGL2 = (): boolean =>
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("webgl2");
