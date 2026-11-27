/**
 * What a face source reports for one camera frame. Everything the eye
 * position estimate needs, independent of the detector that produced it.
 */
export interface FaceObservation {
  /** performance.now() when the frame was handed to the detector. */
  timestamp: number;
  /**
   * When the camera captured the frame (performance.now() time base). Taken
   * from requestVideoFrameCallback metadata where the browser provides it,
   * otherwise equal to `timestamp`.
   */
  captureTime: number;
  /** Whether captureTime is a real capture timestamp rather than a fallback. */
  hasCaptureTime: boolean;
  /** Time the detector took for this frame, ms. */
  detectMs: number;
  /** Width and height of the camera image in pixels. */
  imageWidth: number;
  imageHeight: number;
  /**
   * Eye centres in pixel coordinates of the (unmirrored) camera image.
   * "Subject left" is the viewer's own left eye, which appears on the right
   * side of the image.
   */
  subjectLeftPx: [number, number];
  subjectRightPx: [number, number];
  /** Head yaw in radians (0 = facing the camera). Used to correct the eye distance. */
  yaw: number;
  /** Detector-specific extras, e.g. the full landmark set for a debug view. */
  landmarks?: ReadonlyArray<{ x: number; y: number; z?: number }>;
}

export type FaceListener = (obs: FaceObservation | null) => void;

/**
 * Anything that delivers face observations: the MediaPipe webcam source, a
 * marker-glasses tracker, a recorded session, a test fixture.
 */
export interface FaceSource {
  /** Starts delivering observations; `null` means no face in this frame. */
  start(listener: FaceListener): Promise<void>;
  stop(): void;
}
