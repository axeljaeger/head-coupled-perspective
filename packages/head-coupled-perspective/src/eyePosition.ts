import type { FaceObservation } from './observation.ts';
import type { CameraIntrinsics, DisplayGeometry, Vec3, ViewerGeometry } from './types.ts';

/** Focal length of the camera in pixels for a given horizontal FOV. */
export function focalLengthPx(imageWidth: number, hfovDeg: number): number {
  return imageWidth / 2 / Math.tan((hfovDeg * Math.PI) / 180 / 2);
}

/** Eye distance in image pixels, corrected for head yaw. */
export function ipdPx(obs: FaceObservation): number {
  const dx = obs.subjectLeftPx[0] - obs.subjectRightPx[0];
  const dy = obs.subjectLeftPx[1] - obs.subjectRightPx[1];
  // A turned head shortens the projected eye distance by roughly cos(yaw).
  const c = Math.max(Math.cos(obs.yaw), 0.5);
  return Math.hypot(dx, dy) / c;
}

/**
 * Converts a face observation to the viewer's eye position in screen space
 * (see {@link DisplayGeometry}). Depth comes from the known interpupillary
 * distance, x/y from a pinhole back-projection.
 */
export function eyeInScreenSpace(
  obs: FaceObservation,
  display: DisplayGeometry,
  viewer: ViewerGeometry,
  camera: CameraIntrinsics,
): Vec3 {
  const f = focalLengthPx(obs.imageWidth, camera.hfovDeg);
  const z = (f * viewer.ipd) / ipdPx(obs);

  let px: [number, number];
  if (viewer.eye === 'left') px = obs.subjectLeftPx;
  else if (viewer.eye === 'right') px = obs.subjectRightPx;
  else
    px = [
      (obs.subjectLeftPx[0] + obs.subjectRightPx[0]) / 2,
      (obs.subjectLeftPx[1] + obs.subjectRightPx[1]) / 2,
    ];

  // The camera looks at the viewer, so the image is mirrored relative to the
  // viewer's left/right; image y points down.
  const xCam = ((px[0] - obs.imageWidth / 2) * z) / f;
  const yCam = ((px[1] - obs.imageHeight / 2) * z) / f;

  const cameraX = display.cameraOffsetX ?? 0;
  const cameraY = display.height / 2 + display.cameraOffsetY;
  return [cameraX - xCam, cameraY - yCam, z];
}

/**
 * Solves for the camera's horizontal FOV, given that the viewer currently
 * sits `distance` metres from the screen.
 */
export function hfovFromDistance(obs: FaceObservation, viewer: Pick<ViewerGeometry, 'ipd'>, distance: number): number {
  const f = (distance * ipdPx(obs)) / viewer.ipd;
  return (2 * Math.atan(obs.imageWidth / 2 / f) * 180) / Math.PI;
}

/**
 * Solves for the viewer's interpupillary distance, given the camera FOV and
 * that the viewer currently sits `distance` metres from the screen.
 */
export function ipdFromDistance(obs: FaceObservation, camera: CameraIntrinsics, distance: number): number {
  return (distance * ipdPx(obs)) / focalLengthPx(obs.imageWidth, camera.hfovDeg);
}
