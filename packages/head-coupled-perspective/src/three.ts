import type { PerspectiveCamera } from 'three';
import { offAxisFrustum, type OffAxisFrustum } from './offAxis.ts';
import type { ScreenRect, Vec3 } from './types.ts';

/**
 * Turns a three.js `camera` into an off-axis ("window") camera for an eye at
 * `eye` looking through `rect`. Both are in screen space (metres). The scene
 * is expected in the same units, laid out around the centre of `rect` with
 * the glass at z = 0: z < 0 is behind the screen, z > 0 pops out.
 *
 * Returns the frustum that was applied.
 */
export function applyOffAxis(
  camera: PerspectiveCamera,
  eye: Vec3,
  rect: ScreenRect,
  near = 0.01,
  far = 20,
): OffAxisFrustum {
  const f = offAxisFrustum(eye, rect, near, far);
  applyFrustum(camera, f);
  return f;
}

/** Applies a precomputed frustum to a three.js camera. */
export function applyFrustum(camera: PerspectiveCamera, f: OffAxisFrustum): void {
  camera.position.set(f.position[0], f.position[1], f.position[2]);
  camera.quaternion.identity();
  camera.updateMatrixWorld(true);
  camera.near = f.near;
  camera.far = f.far;
  camera.projectionMatrix.makePerspective(f.left, f.right, f.top, f.bottom, f.near, f.far);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
