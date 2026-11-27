import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeadTracker } from '../src/tracker.ts';
import type { FaceListener, FaceObservation, FaceSource } from '../src/observation.ts';
import { focalLengthPx } from '../src/eyePosition.ts';

class FakeSource implements FaceSource {
  listener: FaceListener | null = null;
  async start(l: FaceListener) {
    this.listener = l;
  }
  stop() {
    this.listener = null;
  }
}

function obs(x: number, t: number): FaceObservation {
  const f = focalLengthPx(1000, 60);
  const z = 0.6;
  const px = (dx: number): [number, number] => [500 - ((x + dx) * f) / z, 500 + (0.11 * f) / z];
  return {
    timestamp: t, captureTime: t, hasCaptureTime: true, detectMs: 0,
    imageWidth: 1000, imageHeight: 1000,
    subjectLeftPx: px(-0.0315), subjectRightPx: px(0.0315), yaw: 0,
  };
}

test('tracker filters, extrapolates and holds the last position', async () => {
  const source = new FakeSource();
  const tracker = new HeadTracker({ display: { width: 0.3, height: 0.2, cameraOffsetY: 0.01 }, source });
  const updates: unknown[] = [];
  tracker.subscribe((u) => updates.push(u));
  await tracker.resume();
  assert.equal(tracker.getEye(0), null);

  // Head moves right at 0.3 m/s, 30 fps.
  for (let i = 0; i < 60; i++) source.listener!(obs(0.3 * (i / 30), (i * 1000) / 30));
  const tLast = (59 * 1000) / 30;
  const now = tLast + 50;
  const eye = tracker.getEye(now)!;
  assert.ok(Math.abs(eye[0] - 0.3 * (now / 1000)) < 0.01, `x=${eye[0]}`);
  assert.ok(Math.abs(eye[1]) < 1e-6);
  assert.ok(Math.abs(eye[2] - 0.6) < 1e-3);
  assert.equal(updates.length, 60);

  source.listener!(null);
  assert.equal(tracker.hasFace, false);
  assert.notEqual(tracker.getEye(now), null);

  tracker.prediction.latencyCompensation = false;
  source.listener!(obs(0, tLast + 33));
  assert.ok(tracker.calibrateDistance(0.6) !== null);
  assert.ok(Math.abs(tracker.camera.hfovDeg - 60) < 1e-6);
});
