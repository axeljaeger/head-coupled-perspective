import type { Settings } from '../settings';
import type { FaceObservation } from './faceTracker';

export type Vec3 = [number, number, number];

/** Focal length of the webcam in pixels for the configured horizontal FOV. */
export function focalLengthPx(videoWidth: number, hfovDeg: number): number {
  return videoWidth / 2 / Math.tan(((hfovDeg * Math.PI) / 180) / 2);
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
 * Converts a face observation to the viewer's eye position in screen space:
 * origin at the centre of the physical screen, x to the right and y up as the
 * viewer sees the screen, z towards the viewer. Metres.
 */
export function eyeInScreenSpace(obs: FaceObservation, s: Settings): Vec3 {
  const f = focalLengthPx(obs.videoWidth, s.cameraHfovDeg);
  const ipdM = s.ipdCm / 100;
  const z = (f * ipdM) / ipdPx(obs);

  let px: [number, number];
  if (s.eye === 'left') px = obs.subjectLeftPx;
  else if (s.eye === 'right') px = obs.subjectRightPx;
  else
    px = [
      (obs.subjectLeftPx[0] + obs.subjectRightPx[0]) / 2,
      (obs.subjectLeftPx[1] + obs.subjectRightPx[1]) / 2,
    ];

  // Pinhole back-projection. The camera looks at the viewer, so the image is
  // mirrored relative to the viewer's left/right; image y points down.
  const xCam = ((px[0] - obs.videoWidth / 2) * z) / f;
  const yCam = ((px[1] - obs.videoHeight / 2) * z) / f;

  const cameraY = s.screenHeightCm / 200 + s.cameraAboveScreenCm / 100;
  return [-xCam, cameraY - yCam, z];
}

/** Average horizontal visible iris diameter of adults, in cm (about 11.7 mm, low spread). */
export const IRIS_DIAMETER_CM = 1.17;

// Iris contour landmarks (four points around each iris centre).
const IRIS_PAIRS = [
  [469, 471],
  [470, 472],
  [474, 476],
  [475, 477],
];

/**
 * Iris diameter in image pixels, or null if the model gave no iris points.
 * Uses the larger of the two contour diameters per eye, which is the one
 * least shortened by head rotation or eyelids.
 */
export function irisDiameterPx(obs: FaceObservation): number | null {
  const lm = obs.landmarks;
  if (lm.length < 478) return null;
  const d = (a: number, b: number) =>
    Math.hypot((lm[a].x - lm[b].x) * obs.videoWidth, (lm[a].y - lm[b].y) * obs.videoHeight);
  const right = Math.max(d(IRIS_PAIRS[0][0], IRIS_PAIRS[0][1]), d(IRIS_PAIRS[1][0], IRIS_PAIRS[1][1]));
  const left = Math.max(d(IRIS_PAIRS[2][0], IRIS_PAIRS[2][1]), d(IRIS_PAIRS[3][0], IRIS_PAIRS[3][1]));
  return (right + left) / 2;
}

/**
 * Estimates the viewer's eye distance from the ratio of eye distance to iris
 * size in the image. Independent of camera FOV and viewing distance.
 */
export function estimateIpdCm(obs: FaceObservation): number | null {
  const iris = irisDiameterPx(obs);
  if (!iris) return null;
  return (IRIS_DIAMETER_CM * ipdPx(obs)) / iris;
}

/**
 * Solves for the camera FOV, given that the viewer currently sits
 * `distanceCm` away from the screen.
 */
export function calibrateHfov(obs: FaceObservation, s: Settings, distanceCm: number): number {
  const f = (distanceCm / 100) * ipdPx(obs) / (s.ipdCm / 100);
  return (2 * Math.atan(obs.videoWidth / 2 / f) * 180) / Math.PI;
}
