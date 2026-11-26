/// <reference lib="webworker" />
// Runs the Face Landmarker off the main thread so rendering is never blocked
// by detection.
import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import { createLandmarker, detect } from './landmarker';

export type WorkerRequest =
  | { type: 'init'; baseUrl: string }
  | { type: 'frame'; image: VideoFrame | ImageBitmap; timestamp: number };

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'result'; detection: import('./landmarker').RawDetection };

let landmarker: FaceLandmarker | null = null;
const post = (msg: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    try {
      landmarker = await createLandmarker(msg.baseUrl, true);
      post({ type: 'ready' });
    } catch (err) {
      post({ type: 'error', message: String((err as Error)?.message ?? err) });
    }
  } else if (msg.type === 'frame') {
    try {
      if (!landmarker) return;
      post({ type: 'result', detection: detect(landmarker, msg.image, msg.timestamp) });
    } finally {
      msg.image.close();
    }
  }
};
