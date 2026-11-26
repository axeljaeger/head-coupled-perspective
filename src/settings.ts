/** All user-tunable parameters. Lengths are in centimetres for the UI. */
export interface Settings {
  // Physical setup
  screenWidthCm: number;
  screenHeightCm: number;
  /** Vertical distance from the top edge of the screen to the camera lens (positive = above). */
  cameraAboveScreenCm: number;
  /** Horizontal field of view of the webcam. Refined by the distance calibration. */
  cameraHfovDeg: number;
  /** Interpupillary distance of the viewer. */
  ipdCm: number;
  /** Use the browser window position on screen to keep the virtual window aligned. */
  compensateWindowPosition: boolean;

  // Input
  input: 'webcam' | 'mouse';
  eye: 'center' | 'left' | 'right';

  // Filtering
  filterEnabled: boolean;
  filterType: 'oneEuro' | 'kalman';
  /** Kalman: standard deviation of head acceleration (m/s²). Higher = follows faster, noisier. */
  kalmanAccel: number;
  /** Kalman: measurement noise of the eye position, x/y and z (mm). */
  kalmanNoiseXYmm: number;
  kalmanNoiseZmm: number;
  /** Cutoff (Hz) while the head is still. Lower = calmer but laggier. */
  filterMinCutoff: number;
  /** Cutoff increase per m/s of head speed. Higher = less lag on fast moves. */
  filterBeta: number;
  /** Cutoff (Hz) of the speed estimate used for adaptation and prediction. */
  filterDCutoff: number;
  /**
   * Extrapolate the head position from the camera capture time to the moment
   * of rendering. Removes the camera/detection latency and the 30 fps stepping.
   */
  latencyCompensation: boolean;
  /** Additional extrapolation on top, e.g. for display latency. */
  predictionMs: number;

  // Effect strength (1 = physically correct)
  gainXY: number;
  gainZ: number;
  /** Turn head coupling off to compare with a static camera. */
  headCoupling: boolean;

  // Presentation
  scene: 'targets' | 'cad';
  showDebug: boolean;
}

export const defaultSettings: Settings = {
  screenWidthCm: 53.1,
  screenHeightCm: 29.9,
  cameraAboveScreenCm: 1.0,
  cameraHfovDeg: 60,
  ipdCm: 6.3,
  compensateWindowPosition: true,
  input: 'webcam',
  eye: 'center',
  filterEnabled: true,
  filterType: 'oneEuro',
  kalmanAccel: 1.5,
  kalmanNoiseXYmm: 1.5,
  kalmanNoiseZmm: 5,
  filterMinCutoff: 1.5,
  filterBeta: 40,
  filterDCutoff: 4,
  latencyCompensation: true,
  predictionMs: 0,
  gainXY: 1,
  gainZ: 1,
  headCoupling: true,
  scene: 'targets',
  showDebug: true,
};

const STORAGE_KEY = 'hcp-settings-v3';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    // ignore broken storage
  }
  return { ...defaultSettings };
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}
