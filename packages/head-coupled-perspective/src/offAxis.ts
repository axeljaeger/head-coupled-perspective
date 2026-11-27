import type { ScreenRect, Vec3 } from './types.ts';

/** An asymmetric viewing frustum, in the convention of glFrustum. */
export interface OffAxisFrustum {
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
  /**
   * Where the virtual camera sits, relative to the centre of `rect`. The
   * camera looks along -z with no rotation.
   */
  position: Vec3;
}

/** Smallest eye distance in front of the screen; the frustum degenerates at z <= 0. */
const MIN_Z = 0.05;

/**
 * Computes the off-axis frustum that turns `rect` (usually the browser
 * viewport) into a window for an eye at `eye`. Both are in screen space;
 * the result is relative to the centre of `rect`, so a scene laid out around
 * the viewport centre at z = 0 appears behind / in front of the glass.
 */
export function offAxisFrustum(eye: Vec3, rect: ScreenRect, near = 0.01, far = 20): OffAxisFrustum {
  const ex = eye[0] - rect.cx;
  const ey = eye[1] - rect.cy;
  const ez = Math.max(eye[2], MIN_Z);
  // Screen edges relative to the eye, scaled onto the near plane.
  const s = near / ez;
  return {
    left: (-rect.width / 2 - ex) * s,
    right: (rect.width / 2 - ex) * s,
    top: (rect.height / 2 - ey) * s,
    bottom: (-rect.height / 2 - ey) * s,
    near,
    far,
    position: [ex, ey, ez],
  };
}

/** Column-major 4x4 OpenGL-style projection matrix (clip z in -1..1) for a frustum. */
export function frustumMatrix(f: OffAxisFrustum, out: Float32Array | number[] = new Float32Array(16)): Float32Array | number[] {
  const { left: l, right: r, top: t, bottom: b, near: n, far: fa } = f;
  for (let i = 0; i < 16; i++) out[i] = 0;
  out[0] = (2 * n) / (r - l);
  out[5] = (2 * n) / (t - b);
  out[8] = (r + l) / (r - l);
  out[9] = (t + b) / (t - b);
  out[10] = -(fa + n) / (fa - n);
  out[11] = -1;
  out[14] = (-2 * fa * n) / (fa - n);
  return out;
}

/** Column-major 4x4 view matrix (world to camera) for a frustum: a pure translation. */
export function frustumViewMatrix(f: OffAxisFrustum, out: Float32Array | number[] = new Float32Array(16)): Float32Array | number[] {
  for (let i = 0; i < 16; i++) out[i] = i % 5 === 0 ? 1 : 0;
  out[12] = -f.position[0];
  out[13] = -f.position[1];
  out[14] = -f.position[2];
  return out;
}
