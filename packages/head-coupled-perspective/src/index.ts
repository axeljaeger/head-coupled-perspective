export type { Vec3, DisplayGeometry, ViewerGeometry, CameraIntrinsics, ScreenRect } from './types.ts';
export type { FaceObservation, FaceListener, FaceSource } from './observation.ts';
export {
  focalLengthPx,
  ipdPx,
  eyeInScreenSpace,
  hfovFromDistance,
  ipdFromDistance,
  estimateIpd,
  IRIS_DIAMETER,
} from './eyePosition.ts';
export { offAxisFrustum, frustumMatrix, frustumViewMatrix, type OffAxisFrustum } from './offAxis.ts';
export { browserViewport, displayRect, type BrowserViewportOptions } from './viewport.ts';
export { devicePresets, detectDevice, displayFromDiagonal, type DevicePreset, type DetectionResult } from './devices.ts';
export * from './filters/index.ts';
export {
  HeadTracker,
  defaultViewer,
  type HeadTrackerOptions,
  type PredictionOptions,
  type TrackingUpdate,
  type TrackingListener,
} from './tracker.ts';
export {
  MediaPipeFaceSource,
  MEDIAPIPE_VERSION,
  defaultMediaPipeAssets,
  type MediaPipeAssets,
  type MediaPipeSourceOptions,
  type CameraMode,
} from './sources/mediapipe.ts';
