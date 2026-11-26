import type { FaceLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';
import { createLandmarker, detect, type RawDetection } from './landmarker';
import type { WorkerRequest, WorkerResponse } from './landmarkWorker';

// Eye corner landmarks of the MediaPipe face mesh. Corners are steadier than
// the iris centres because they do not move with gaze.
// "Subject right" is the eye that appears on the left of the (unmirrored) image.
const SUBJECT_RIGHT_EYE = [33, 133];
const SUBJECT_LEFT_EYE = [362, 263];

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
  /** Detection including hand-off to and from the worker, ms. */
  totalMs: number;
  videoWidth: number;
  videoHeight: number;
  /** Eye centres in pixel coordinates of the camera image. */
  subjectLeftPx: [number, number];
  subjectRightPx: [number, number];
  /** Head yaw in radians from the facial transformation matrix (0 = facing the camera). */
  yaw: number;
  landmarks: NormalizedLandmark[];
}

export interface CameraMode {
  width: number;
  height: number;
  fps: number;
}

export type FaceListener = (obs: FaceObservation | null) => void;

/** Webcam + MediaPipe Face Landmarker, delivering one observation per processed video frame. */
export class FaceTracker {
  readonly video: HTMLVideoElement;
  private landmarker: FaceLandmarker | null = null;
  private worker: Worker | null = null;
  private pendingWorker: ((d: RawDetection | null) => void) | null = null;
  private stream: MediaStream | null = null;
  private running = false;
  private busy = false;
  private lastVideoTime = -1;
  /** Frames dropped because detection was still busy with the previous one. */
  droppedFrames = 0;

  constructor(
    private readonly onFace: FaceListener,
    /** Run detection in a Web Worker so it does not block rendering. */
    readonly useWorker = true,
  ) {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
  }

  /** What the camera actually delivers (may differ from what was requested). */
  get actualSettings(): MediaTrackSettings | null {
    return this.stream?.getVideoTracks()[0]?.getSettings() ?? null;
  }

  async start(mode: CameraMode): Promise<void> {
    const baseUrl = new URL(import.meta.env.BASE_URL, location.href).href;
    if (this.useWorker) {
      await this.startWorker(baseUrl);
    } else {
      this.landmarker = await createLandmarker(baseUrl, false);
    }
    await this.openCamera(mode);
    this.running = true;
    this.scheduleNext();
  }

  private startWorker(baseUrl: string): Promise<void> {
    this.worker = new Worker(new URL('./landmarkWorker.ts', import.meta.url), { type: 'module' });
    return new Promise((resolve, reject) => {
      this.worker!.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        if (msg.type === 'ready') resolve();
        else if (msg.type === 'error') reject(new Error(msg.message));
        else if (msg.type === 'result') {
          this.pendingWorker?.(msg.detection);
          this.pendingWorker = null;
        }
      };
      this.worker!.onerror = (e) => reject(new Error(e.message || 'Worker konnte nicht starten'));
      this.post({ type: 'init', baseUrl });
    });
  }

  private post(msg: WorkerRequest, transfer: Transferable[] = []): void {
    this.worker!.postMessage(msg, transfer);
  }

  /** Switches resolution / frame rate while running. */
  async setMode(mode: CameraMode): Promise<void> {
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.openCamera(mode);
    this.lastVideoTime = -1;
  }

  private async openCamera(mode: CameraMode): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: mode.width },
        height: { ideal: mode.height },
        frameRate: { ideal: mode.fps },
        facingMode: 'user',
      },
    });
    this.video.srcObject = this.stream;
    await this.video.play();
  }

  stop(): void {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.worker?.terminate();
    this.worker = null;
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
    if (v.currentTime !== this.lastVideoTime && v.videoWidth > 0) {
      this.lastVideoTime = v.currentTime;
      if (this.busy) {
        // Never queue frames: a stale frame only adds latency.
        this.droppedFrames++;
      } else {
        this.busy = true;
        const t0 = performance.now();
        this.runDetection(t0)
          .then((d) => this.emit(d, t0, captureTime))
          .catch((e) => console.error(e))
          .finally(() => (this.busy = false));
      }
    }
    this.scheduleNext();
  }

  private async runDetection(timestamp: number): Promise<RawDetection | null> {
    if (this.landmarker) return detect(this.landmarker, this.video, timestamp);
    if (!this.worker) return null;
    const image =
      typeof VideoFrame !== 'undefined'
        ? new VideoFrame(this.video, { timestamp: Math.round(timestamp * 1000) })
        : await createImageBitmap(this.video);
    return new Promise((resolve) => {
      this.pendingWorker = resolve;
      this.post({ type: 'frame', image, timestamp }, [image]);
    });
  }

  private emit(d: RawDetection | null, t0: number, captureTime?: number): void {
    const lm = d?.landmarks;
    if (!d || !lm) {
      this.onFace(null);
      return;
    }
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
    // Column-major 4x4; third column is the face's forward axis.
    const m = d.matrix;
    const yaw = m && m.length === 16 ? Math.atan2(m[8], m[10]) : 0;
    this.onFace({
      timestamp: t0,
      captureTime: captureTime ?? t0,
      hasCaptureTime: captureTime !== undefined,
      detectMs: d.detectMs,
      totalMs: performance.now() - t0,
      videoWidth: w,
      videoHeight: h,
      subjectLeftPx: centre(SUBJECT_LEFT_EYE),
      subjectRightPx: centre(SUBJECT_RIGHT_EYE),
      yaw,
      landmarks: lm,
    });
  }
}
