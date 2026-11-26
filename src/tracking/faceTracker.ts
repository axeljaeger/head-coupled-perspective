import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from '@mediapipe/tasks-vision';

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

/** Webcam + MediaPipe Face Landmarker, delivering one observation per video frame. */
export class FaceTracker {
  readonly video: HTMLVideoElement;
  private landmarker: FaceLandmarker | null = null;
  private stream: MediaStream | null = null;
  private running = false;
  private lastVideoTime = -1;

  constructor(private readonly onFace: FaceListener) {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
  }

  /** What the camera actually delivers (may differ from what was requested). */
  get actualSettings(): MediaTrackSettings | null {
    return this.stream?.getVideoTracks()[0]?.getSettings() ?? null;
  }

  async start(mode: CameraMode): Promise<void> {
    const base = import.meta.env.BASE_URL;
    const fileset = await FilesetResolver.forVisionTasks(`${base}mediapipe/wasm`);
    const options = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: `${base}mediapipe/face_landmarker.task`, delegate },
      runningMode: 'VIDEO' as const,
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
    });
    try {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, options('GPU'));
    } catch (e) {
      console.warn('GPU delegate failed, falling back to CPU', e);
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, options('CPU'));
    }

    await this.openCamera(mode);
    this.running = true;
    this.scheduleNext();
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
    if (!this.running || !this.landmarker) return;
    const v = this.video;
    if (v.currentTime !== this.lastVideoTime && v.videoWidth > 0) {
      this.lastVideoTime = v.currentTime;
      const t0 = performance.now();
      const result = this.landmarker.detectForVideo(v, t0);
      const detectMs = performance.now() - t0;
      const lm = result.faceLandmarks[0];
      if (lm) {
        const w = v.videoWidth;
        const h = v.videoHeight;
        const centre = (ids: number[]): [number, number] => {
          let x = 0;
          let y = 0;
          for (const i of ids) {
            x += lm[i].x;
            y += lm[i].y;
          }
          return [(x / ids.length) * w, (y / ids.length) * h];
        };
        let yaw = 0;
        const m = result.facialTransformationMatrixes?.[0]?.data;
        if (m && m.length === 16) {
          // Column-major 4x4; third column is the face's forward axis.
          yaw = Math.atan2(m[8], m[10]);
        }
        this.onFace({
          timestamp: t0,
          captureTime: captureTime ?? t0,
          hasCaptureTime: captureTime !== undefined,
          detectMs,
          videoWidth: w,
          videoHeight: h,
          subjectLeftPx: centre(SUBJECT_LEFT_EYE),
          subjectRightPx: centre(SUBJECT_RIGHT_EYE),
          yaw,
          landmarks: lm,
        });
      } else {
        this.onFace(null);
      }
    }
    this.scheduleNext();
  }
}
