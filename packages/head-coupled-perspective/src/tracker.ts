import { estimateIpd, eyeInScreenSpace, hfovFromDistance, ipdFromDistance } from './eyePosition.ts';
import { createFilter, type FilterOptions, type PointFilter } from './filters/index.ts';
import type { FaceObservation, FaceSource } from './observation.ts';
import { MediaPipeFaceSource, type MediaPipeAssets, type CameraMode } from './sources/mediapipe.ts';
import type { CameraIntrinsics, DisplayGeometry, Vec3, ViewerGeometry } from './types.ts';

export interface PredictionOptions {
  /**
   * Extrapolate the eye position from the camera capture time to the moment
   * it is read. Hides camera and detection latency and the stepping of a
   * 30 fps webcam. Default true.
   */
  latencyCompensation?: boolean;
  /** Additional extrapolation on top, e.g. for display latency, ms. Default 0. */
  extraMs?: number;
  /** Upper bound for the extrapolation, so a stalled camera cannot fling the view away. Default 150 ms. */
  maxMs?: number;
}

export interface HeadTrackerOptions {
  display: DisplayGeometry;
  viewer?: Partial<ViewerGeometry>;
  /** Webcam intrinsics. Default hfovDeg 60. */
  camera?: Partial<CameraIntrinsics>;
  /** Default: constant-velocity Kalman filter, which felt best in the evaluation. */
  filter?: FilterOptions;
  prediction?: PredictionOptions;
  /**
   * Where face observations come from. Default: a {@link MediaPipeFaceSource}
   * configured from `cameraMode` and `assets`.
   */
  source?: FaceSource;
  /** Requested webcam mode for the default source. */
  cameraMode?: CameraMode;
  /** Asset URLs for the default source. */
  assets?: MediaPipeAssets;
}

/** Delivered for every processed frame; `null` fields mean no face was found. */
export interface TrackingUpdate {
  observation: FaceObservation | null;
  /** Unfiltered eye position in screen space. */
  raw: Vec3 | null;
  /** Filtered eye position at capture time. */
  filtered: Vec3 | null;
}

export type TrackingListener = (update: TrackingUpdate) => void;

export const defaultViewer: ViewerGeometry = { ipd: 0.063, eye: 'center' };

/**
 * Turns face observations into a smoothed, latency-compensated eye position
 * in screen space. Rendering code calls {@link getEye} once per frame.
 *
 * ```ts
 * const tracker = await HeadTracker.start({ display: devicePresets[0] });
 * function frame() {
 *   const eye = tracker.getEye() ?? [0, 0, 0.6];
 *   // offAxisFrustum(eye, browserViewport(display)) ...
 * }
 * ```
 */
export class HeadTracker {
  display: DisplayGeometry;
  readonly viewer: ViewerGeometry;
  readonly camera: CameraIntrinsics;
  readonly prediction: Required<PredictionOptions>;
  readonly source: FaceSource;

  private filter: PointFilter;
  private filtered: Vec3 | null = null;
  private lastCaptureTime = 0;
  private lastObs: FaceObservation | null = null;
  private listeners = new Set<TrackingListener>();
  private running = false;
  private faceVisible = false;

  /** Creates the tracker and starts its source (asks for camera permission). */
  static async start(options: HeadTrackerOptions): Promise<HeadTracker> {
    const source = options.source ?? new MediaPipeFaceSource({ camera: options.cameraMode, assets: options.assets });
    const tracker = new HeadTracker({ ...options, source });
    await tracker.resume();
    return tracker;
  }

  /** Creates a stopped tracker around an explicit source; call {@link resume} to start. */
  constructor(options: HeadTrackerOptions & { source: FaceSource }) {
    this.display = { ...options.display };
    this.viewer = { ...defaultViewer, ...options.viewer };
    this.camera = { hfovDeg: 60, ...options.camera };
    this.prediction = { latencyCompensation: true, extraMs: 0, maxMs: 150, ...options.prediction };
    this.filter = createFilter(options.filter ?? { type: 'kalman' });
    this.source = options.source;
  }

  /** Whether a face was found in the most recent frame. */
  get hasFace(): boolean {
    return this.faceVisible;
  }

  /** The most recent observation with a face, e.g. for a debug view. */
  get lastObservation(): FaceObservation | null {
    return this.lastObs;
  }

  async resume(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.source.start((obs) => this.onObservation(obs));
    } catch (e) {
      this.running = false;
      throw e;
    }
  }

  stop(): void {
    this.running = false;
    this.source.stop();
    this.faceVisible = false;
    this.filtered = null;
  }

  /** Subscribes to per-frame updates. Returns an unsubscribe function. */
  subscribe(listener: TrackingListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * The viewer's eye position in screen space, extrapolated to `now`
   * (performance.now() time base). When the face is lost, the last position
   * is held. `null` until the first face has been seen.
   */
  getEye(now = performance.now()): Vec3 | null {
    const f = this.filtered;
    if (!f) return null;
    const p = this.prediction;
    const age = p.latencyCompensation ? Math.min(Math.max(now - this.lastCaptureTime, 0), p.maxMs) : 0;
    const t = (age + p.extraMs) / 1000;
    const d = this.filter.derivative();
    return [f[0] + d[0] * t, f[1] + d[1] * t, f[2] + d[2] * t];
  }

  /** Replaces the smoothing filter, e.g. to tune it at runtime. */
  setFilter(options: FilterOptions): void {
    this.filter = createFilter(options);
  }

  setDisplay(display: DisplayGeometry): void {
    this.display = { ...display };
    this.filter.reset();
  }

  /** Updates viewer geometry, e.g. from a calibration. */
  setViewer(viewer: Partial<ViewerGeometry>): void {
    Object.assign(this.viewer, viewer);
    this.filter.reset();
  }

  setCamera(camera: Partial<CameraIntrinsics>): void {
    Object.assign(this.camera, camera);
    this.filter.reset();
  }

  /**
   * Calibrates against a known viewing distance: the viewer sits still at
   * `distance` metres from the screen. By default this solves for the camera
   * FOV (keeping the IPD); with `solveFor: 'ipd'` it solves for the viewer's
   * IPD instead (keeping the FOV). Returns the solved value, or `null` if no
   * face is currently tracked.
   */
  calibrateDistance(distance: number, solveFor: 'fov' | 'ipd' = 'fov'): number | null {
    const obs = this.lastObs;
    if (!obs || !this.hasFace) return null;
    if (solveFor === 'fov') {
      const hfovDeg = hfovFromDistance(obs, this.viewer, distance);
      this.setCamera({ hfovDeg });
      return hfovDeg;
    }
    const ipd = ipdFromDistance(obs, this.camera, distance);
    this.setViewer({ ipd });
    return ipd;
  }

  /**
   * Measures the viewer's IPD from the iris size, without a tape measure:
   * the viewer looks straight at the camera for `durationMs`. Sets and
   * returns the median. Rejects if the source gives no iris size or too few
   * frames had a face.
   */
  measureIpd(options: { durationMs?: number; minSamples?: number } = {}): Promise<number> {
    const { durationMs = 3000, minSamples = 20 } = options;
    const samples: number[] = [];
    const unsubscribe = this.subscribe(({ observation }) => {
      const ipd = observation && estimateIpd(observation);
      if (ipd) samples.push(ipd);
    });
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        unsubscribe();
        if (samples.length < minSamples) {
          reject(new Error(`Only ${samples.length} IPD samples, need ${minSamples}`));
          return;
        }
        const ipd = median(samples);
        this.setViewer({ ipd });
        resolve(ipd);
      }, durationMs);
    });
  }

  private onObservation(obs: FaceObservation | null): void {
    if (!obs) {
      this.faceVisible = false;
      this.emit({ observation: null, raw: null, filtered: null });
      return;
    }
    const raw = eyeInScreenSpace(obs, this.display, this.viewer, this.camera);
    // Filter on capture time so irregular delivery does not distort the speed estimate.
    const filtered = this.filter.filter(raw, obs.captureTime / 1000);
    this.filtered = filtered;
    this.faceVisible = true;
    this.lastObs = obs;
    this.lastCaptureTime = obs.captureTime;
    this.emit({ observation: obs, raw, filtered });
  }

  private emit(update: TrackingUpdate): void {
    for (const l of this.listeners) l(update);
  }
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
