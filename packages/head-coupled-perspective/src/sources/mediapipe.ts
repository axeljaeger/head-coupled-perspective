import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { FaceListener, FaceObservation, FaceSource } from '../observation.ts';

// Eye corner landmarks of the MediaPipe face mesh. Corners are steadier than
// the iris centres because they do not move with gaze.
// "Subject right" is the eye that appears on the left of the (unmirrored) image.
const SUBJECT_RIGHT_EYE = [33, 133];
const SUBJECT_LEFT_EYE = [362, 263];
// Iris contour landmarks (pairs of opposite points around each iris centre).
const IRIS_PAIRS_RIGHT = [[469, 471], [470, 472]];
const IRIS_PAIRS_LEFT = [[474, 476], [475, 477]];

/** MediaPipe Tasks Vision version the default asset URLs point to. */
export const MEDIAPIPE_VERSION = '1.2.3';

/** Where the MediaPipe WASM runtime and the face landmarker model are loaded from. */
export interface MediaPipeAssets {
  /** Folder containing the tasks-vision WASM files (vision_wasm_internal.js etc.). Default: jsDelivr. */
  wasmBaseUrl?: string;
  /** URL of face_landmarker.task. Default: Google's model storage. */
  modelUrl?: string;
}

export const defaultMediaPipeAssets: Required<MediaPipeAssets> = {
  wasmBaseUrl: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`,
  modelUrl:
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
};

export interface CameraMode {
  width: number;
  height: number;
  fps: number;
}

export interface MediaPipeSourceOptions {
  /** Requested camera mode; the browser may deliver less. Default 1280x720 @ 60. */
  camera?: CameraMode;
  assets?: MediaPipeAssets;
  /** Prefer the GPU delegate, falling back to CPU. Default true. */
  gpu?: boolean;
  /** Use an existing video element instead of creating a hidden one. */
  video?: HTMLVideoElement;
}

/**
 * Webcam + MediaPipe Face Landmarker on the main thread, delivering one
 * observation per new video frame. Detection runs synchronously in the
 * video frame callback, so frames are never queued (measured on an M4
 * MacBook Air: ~11 ms per frame; a Web Worker roughly doubled the latency).
 */
export class MediaPipeFaceSource implements FaceSource {
  readonly video: HTMLVideoElement;
  /** Which MediaPipe backend ended up running the model. */
  delegate: 'GPU' | 'CPU' | null = null;

  private landmarker: FaceLandmarker | null = null;
  private stream: MediaStream | null = null;
  private listener: FaceListener | null = null;
  private running = false;
  private lastVideoTime = -1;
  private mode: CameraMode;
  private readonly options: MediaPipeSourceOptions;

  constructor(options: MediaPipeSourceOptions = {}) {
    this.options = options;
    this.mode = options.camera ?? { width: 1280, height: 720, fps: 60 };
    this.video = options.video ?? document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
  }

  /** What the camera actually delivers (may differ from what was requested). */
  get actualSettings(): MediaTrackSettings | null {
    return this.stream?.getVideoTracks()[0]?.getSettings() ?? null;
  }

  async start(listener: FaceListener): Promise<void> {
    this.listener = listener;
    if (!this.landmarker) await this.createLandmarker();
    await this.openCamera();
    this.running = true;
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  /** Releases the model as well; the source cannot be restarted afterwards. */
  dispose(): void {
    this.stop();
    this.landmarker?.close();
    this.landmarker = null;
  }

  /** Switches resolution / frame rate while running. */
  async setCameraMode(mode: CameraMode): Promise<void> {
    this.mode = mode;
    if (!this.stream) return;
    this.stream.getTracks().forEach((t) => t.stop());
    await this.openCamera();
    this.lastVideoTime = -1;
  }

  private async createLandmarker(): Promise<void> {
    const assets = { ...defaultMediaPipeAssets, ...this.options.assets };
    const fileset = await FilesetResolver.forVisionTasks(assets.wasmBaseUrl.replace(/\/$/, ''));
    const options = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: assets.modelUrl, delegate },
      runningMode: 'VIDEO' as const,
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: true,
    });
    if (this.options.gpu ?? true) {
      try {
        this.landmarker = await FaceLandmarker.createFromOptions(fileset, options('GPU'));
        this.delegate = 'GPU';
        return;
      } catch (e) {
        console.warn('GPU delegate failed, falling back to CPU', e);
      }
    }
    this.landmarker = await FaceLandmarker.createFromOptions(fileset, options('CPU'));
    this.delegate = 'CPU';
  }

  private async openCamera(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: this.mode.width },
        height: { ideal: this.mode.height },
        frameRate: { ideal: this.mode.fps },
        facingMode: 'user',
      },
    });
    this.video.srcObject = this.stream;
    await this.video.play();
  }

  private scheduleNext(): void {
    if (!this.running) return;
    if ('requestVideoFrameCallback' in this.video) {
      this.video.requestVideoFrameCallback((_now, meta) => this.process(meta.captureTime));
    } else {
      requestAnimationFrame(() => this.process());
    }
  }

  private process(captureTime?: number): void {
    if (!this.running) return;
    const v = this.video;
    if (v.currentTime !== this.lastVideoTime && v.videoWidth > 0 && this.landmarker) {
      this.lastVideoTime = v.currentTime;
      try {
        this.listener?.(this.detect(this.landmarker, captureTime));
      } catch (e) {
        console.error(e);
      }
    }
    this.scheduleNext();
  }

  private detect(landmarker: FaceLandmarker, captureTime?: number): FaceObservation | null {
    const t0 = performance.now();
    const result = landmarker.detectForVideo(this.video, t0);
    const detectMs = performance.now() - t0;
    const lm = result.faceLandmarks[0];
    if (!lm) return null;

    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    const centre = (ids: number[]): [number, number] => {
      let x = 0;
      let y = 0;
      for (const i of ids) {
        x += lm[i].x;
        y += lm[i].y;
      }
      return [(x / ids.length) * w, (y / ids.length) * h];
    };
    // Per eye, the larger of the two contour diameters is the one least
    // shortened by head rotation or eyelids.
    const dist = (a: number, b: number) => Math.hypot((lm[a].x - lm[b].x) * w, (lm[a].y - lm[b].y) * h);
    const iris = (pairs: number[][]) => Math.max(...pairs.map(([a, b]) => dist(a, b)));
    const irisDiameterPx = lm.length >= 478 ? (iris(IRIS_PAIRS_RIGHT) + iris(IRIS_PAIRS_LEFT)) / 2 : undefined;
    // Column-major 4x4; third column is the face's forward axis.
    const m = result.facialTransformationMatrixes?.[0]?.data;
    const yaw = m && m.length === 16 ? Math.atan2(m[8], m[10]) : 0;
    return {
      timestamp: t0,
      captureTime: captureTime ?? t0,
      hasCaptureTime: captureTime !== undefined,
      detectMs,
      imageWidth: w,
      imageHeight: h,
      subjectLeftPx: centre(SUBJECT_LEFT_EYE),
      subjectRightPx: centre(SUBJECT_RIGHT_EYE),
      yaw,
      irisDiameterPx,
      landmarks: lm,
    };
  }
}
