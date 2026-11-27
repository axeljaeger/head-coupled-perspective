import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offAxisFrustum, frustumMatrix } from '../src/offAxis.ts';
import { eyeInScreenSpace, hfovFromDistance, ipdFromDistance, focalLengthPx } from '../src/eyePosition.ts';
import { createFilter } from '../src/filters/index.ts';
import type { FaceObservation } from '../src/observation.ts';
import type { DisplayGeometry, ViewerGeometry } from '../src/types.ts';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('centred eye gives a symmetric frustum', () => {
  const f = offAxisFrustum([0, 0, 0.6], { cx: 0, cy: 0, width: 0.3, height: 0.2 }, 0.01, 10);
  close(f.left, -f.right);
  close(f.top, -f.bottom);
  close(f.right, (0.15 * 0.01) / 0.6);
});

test('frustum is relative to the rect centre', () => {
  const f = offAxisFrustum([0.1, 0.05, 0.5], { cx: 0.1, cy: 0.05, width: 0.3, height: 0.2 });
  assert.deepEqual(f.position, [0, 0, 0.5]);
  close(f.left, -f.right);
});

test('eye to the right shifts the frustum left', () => {
  const f = offAxisFrustum([0.1, 0, 0.5], { cx: 0, cy: 0, width: 0.3, height: 0.2 });
  assert.ok(Math.abs(f.left) > Math.abs(f.right));
});

test('eye behind the screen is clamped', () => {
  const f = offAxisFrustum([0, 0, -1], { cx: 0, cy: 0, width: 0.3, height: 0.2 });
  assert.equal(f.position[2], 0.05);
});

test('frustumMatrix matches the glFrustum layout', () => {
  const m = frustumMatrix({ left: -1, right: 1, top: 1, bottom: -1, near: 1, far: 3, position: [0, 0, 1] });
  close(m[0], 1);
  close(m[5], 1);
  close(m[10], -2);
  close(m[11], -1);
  close(m[14], -3);
});

const display: DisplayGeometry = { width: 0.3, height: 0.2, cameraOffsetY: 0.01 };
const viewer: ViewerGeometry = { ipd: 0.063, eye: 'center' };
const camera = { hfovDeg: 60 };

/** A synthetic observation of a viewer at screen-space position p. */
function observe(p: [number, number, number]): FaceObservation {
  const w = 1280;
  const h = 720;
  const f = focalLengthPx(w, camera.hfovDeg);
  const camY = display.height / 2 + display.cameraOffsetY;
  const toPx = (x: number, y: number): [number, number] => [w / 2 - (x * f) / p[2], h / 2 + ((camY - y) * f) / p[2]];
  return {
    timestamp: 0,
    captureTime: 0,
    hasCaptureTime: true,
    detectMs: 0,
    imageWidth: w,
    imageHeight: h,
    subjectLeftPx: toPx(p[0] - viewer.ipd / 2, p[1]),
    subjectRightPx: toPx(p[0] + viewer.ipd / 2, p[1]),
    yaw: 0,
  };
}

test('eye position round-trips through a synthetic camera', () => {
  const e = eyeInScreenSpace(observe([0.05, -0.02, 0.55]), display, viewer, camera);
  close(e[0], 0.05);
  close(e[1], -0.02);
  close(e[2], 0.55);
});

test('distance calibration recovers FOV and IPD', () => {
  const obs = observe([0, 0, 0.7]);
  close(hfovFromDistance(obs, viewer, 0.7), 60, 1e-6);
  close(ipdFromDistance(obs, camera, 0.7), 0.063, 1e-9);
});

test('filters converge on a constant signal', () => {
  for (const type of ['kalman', 'oneEuro', 'none'] as const) {
    const f = createFilter({ type });
    let out: number[] = [];
    for (let i = 0; i < 120; i++) out = f.filter([0.1, 0.2, 0.6], i / 30);
    close(out[0], 0.1, 1e-4);
    close(out[2], 0.6, 1e-4);
  }
});

test('kalman estimates velocity of a linear motion', () => {
  const f = createFilter({ type: 'kalman' });
  for (let i = 0; i < 90; i++) f.filter([0.2 * (i / 30), 0, 0.6], i / 30);
  close(f.derivative()[0], 0.2, 0.01);
});

test('iris-based IPD estimate', async () => {
  const { estimateIpd, IRIS_DIAMETER } = await import('../src/eyePosition.ts');
  const obs = observe([0, 0, 0.6]);
  assert.equal(estimateIpd(obs), null);
  const f = focalLengthPx(obs.imageWidth, camera.hfovDeg);
  close(estimateIpd({ ...obs, irisDiameterPx: (IRIS_DIAMETER * f) / 0.6 })!, viewer.ipd);
});
