/** A 3D point or vector. Metres unless stated otherwise. */
export type Vec3 = [number, number, number];

/**
 * Physical geometry of the display and its camera.
 *
 * Screen space, used throughout the library: origin at the centre of the
 * visible screen area, x to the right and y up as the viewer sees the screen,
 * z from the screen towards the viewer. All lengths in metres.
 */
export interface DisplayGeometry {
  /** Width of the visible screen area. */
  width: number;
  /** Height of the visible screen area. */
  height: number;
  /**
   * Vertical distance from the top edge of the visible area to the camera
   * lens. Positive = above the edge (camera in the bezel), negative = below
   * (camera in a notch).
   */
  cameraOffsetY: number;
  /** Horizontal offset of the camera from the screen centre. Default 0. */
  cameraOffsetX?: number;
}

/**
 * Geometry of the viewer. These are the values a future calibration (for
 * example glasses with known marker spacing) would set.
 */
export interface ViewerGeometry {
  /** Interpupillary distance. Default 0.063 m (adult average). */
  ipd: number;
  /** Which eye the perspective is rendered for. Default 'center'. */
  eye: 'center' | 'left' | 'right';
}

/** Intrinsics of the webcam. */
export interface CameraIntrinsics {
  /** Horizontal field of view in degrees. Typical laptop webcams: 55–75. */
  hfovDeg: number;
}

/**
 * A rectangle in the screen plane (z = 0) given by its centre and size, in
 * screen space. Usually the browser viewport, see {@link browserViewport}.
 */
export interface ScreenRect {
  cx: number;
  cy: number;
  width: number;
  height: number;
}
