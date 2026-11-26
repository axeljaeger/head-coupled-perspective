import type { PerspectiveCamera, Vector3 } from 'three';

/**
 * Turns `camera` into an off-axis ("window") camera for a viewer whose eye is
 * at `eye`. The physical screen is the rectangle of size width x height
 * centred at the origin in the z = 0 plane; +z points from the screen towards
 * the viewer. All units are metres.
 */
export function updateOffAxisCamera(
  camera: PerspectiveCamera,
  eye: Vector3,
  width: number,
  height: number,
  near = 0.01,
  far = 20,
): void {
  // Keep the eye in front of the screen; the frustum degenerates at z <= 0.
  const ez = Math.max(eye.z, 0.05);

  camera.position.set(eye.x, eye.y, ez);
  camera.quaternion.identity();
  camera.updateMatrixWorld(true);

  // Screen edges relative to the eye, scaled onto the near plane.
  const s = near / ez;
  const left = (-width / 2 - eye.x) * s;
  const right = (width / 2 - eye.x) * s;
  const top = (height / 2 - eye.y) * s;
  const bottom = (-height / 2 - eye.y) * s;

  camera.near = near;
  camera.far = far;
  camera.projectionMatrix.makePerspective(left, right, top, bottom, near, far);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
