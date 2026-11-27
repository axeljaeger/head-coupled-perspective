# head-coupled-perspective

Head-coupled perspective for the browser: a webcam estimates where the
viewer's eyes are, and the scene is rendered with an off-axis projection so
the screen behaves like a window. Framework-agnostic TypeScript, with an
optional adapter for three.js.

> Status: pre-release. The API may still change; not published on npm yet.

```sh
npm install head-coupled-perspective @mediapipe/tasks-vision
# optional, for the adapter:
npm install three
```

## Quick start (three.js)

```ts
import { HeadTracker, browserViewport, detectDevice, devicePresets } from 'head-coupled-perspective';
import { applyOffAxis } from 'head-coupled-perspective/three';

// Physical screen size and camera position. detectDevice() guesses Apple
// laptops / iPads from the CSS screen size; otherwise pass your own values.
const display = detectDevice()?.preset ?? { width: 0.53, height: 0.30, cameraOffsetY: 0.01 };

const tracker = await HeadTracker.start({ display }); // asks for camera permission

function frame() {
  const rect = browserViewport(display);              // the browser window, in metres
  const eye = tracker.getEye() ?? [rect.cx, rect.cy, 0.6];
  applyOffAxis(camera, eye, rect, 0.01, 20);          // camera: THREE.PerspectiveCamera
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

The scene is laid out in metres around the centre of the browser viewport,
with the glass of the screen at z = 0: objects at z < 0 are behind the
screen, objects at z > 0 pop out.

## Coordinates and units

All lengths are **metres**. *Screen space* has its origin at the centre of the
visible screen area, x to the right and y up as the viewer sees it, and z from
the screen towards the viewer.

## API

### `HeadTracker`

```ts
const tracker = await HeadTracker.start({
  display: { width, height, cameraOffsetY, cameraOffsetX? }, // DisplayGeometry
  viewer: { ipd: 0.063, eye: 'center' },  // 'center' | 'left' | 'right'
  camera: { hfovDeg: 60 },                // webcam horizontal field of view
  filter: { type: 'kalman' },             // see Filters
  prediction: { latencyCompensation: true, extraMs: 0, maxMs: 150 },
  cameraMode: { width: 1280, height: 720, fps: 60 },
  assets: { wasmBaseUrl, modelUrl },      // default: jsDelivr + Google model storage
  source,                                 // optional custom FaceSource
});
```

| Member | |
| --- | --- |
| `getEye(now?)` | Eye position in screen space, extrapolated to `now` (latency compensation). Holds the last position when the face is lost; `null` before the first face. |
| `hasFace` | Whether the latest frame had a face. |
| `subscribe(fn)` | Per-frame `{ observation, raw, filtered }`, e.g. for debug views. Returns an unsubscribe function. |
| `setDisplay(d)`, `setViewer(v)`, `setCamera(c)` | Update geometry at runtime. |
| `setFilter(options)` | Swap or retune the smoothing filter. |
| `measureIpd({ durationMs })` | Measures the viewer's eye distance from the iris size (no tape measure needed) and sets it. |
| `calibrateDistance(d, 'fov' \| 'ipd')` | The viewer sits at a known distance `d`; solves for the camera FOV (default) or the IPD. |
| `stop()`, `resume()` | Stop / restart the camera. |

`new HeadTracker({ ..., source })` creates a stopped tracker around any
`FaceSource`; call `resume()` to start it.

### Calibration hooks

There is deliberately no calibration UI in the library. Everything a
calibration determines goes through three values:

- `viewer.ipd`: scales the depth estimate and the sideways parallax.
  `measureIpd()` estimates it from the iris (adult iris ≈ 11.7 mm).
- `camera.hfovDeg`: the webcam field of view. `calibrateDistance()` solves it
  from one known viewing distance.
- `display`: physical screen size and camera position (presets or manual).

A future calibration (for example glasses with markers at a known spacing)
only needs to call `setViewer` / `setCamera` with what it measured.

### Off-axis projection (no framework)

```ts
import { offAxisFrustum, frustumMatrix, frustumViewMatrix } from 'head-coupled-perspective';

const f = offAxisFrustum(eye, rect, near, far); // { left, right, top, bottom, near, far, position }
const projection = frustumMatrix(f);            // column-major Float32Array(16), OpenGL clip space
const view = frustumViewMatrix(f);              // translation by -position
```

### three.js adapter (`head-coupled-perspective/three`)

- `applyOffAxis(camera, eye, rect, near?, far?)`: positions a
  `PerspectiveCamera` and sets its projection matrix. Returns the frustum.
- `applyFrustum(camera, frustum)`: the same for a precomputed frustum.

### Screen and window

- `devicePresets`, `detectDevice()`: MacBook Air/Pro (13–16") and iPad Air 11"
  geometry; detection matches the CSS screen size, so confirm it with the user.
- `displayFromDiagonal(inches, cameraOffsetY?, aspect?)`: geometry from a diagonal.
- `browserViewport(display, { compensateWindowPosition })`: the browser
  viewport as a `ScreenRect`, compensating the window position when not fullscreen.
- `displayRect(display)`: the whole display as a `ScreenRect`.

### Filters

`{ type: 'kalman', accel?, noiseXY?, noiseZ? }` (default; constant-velocity
model), `{ type: 'oneEuro', minCutoff?, beta?, dCutoff? }`, or
`{ type: 'none' }`. `createFilter(options)` and the filter classes are
exported for use outside the tracker.

### Custom face sources

```ts
interface FaceSource {
  start(listener: (obs: FaceObservation | null) => void): Promise<void>;
  stop(): void;
}
```

A `FaceObservation` carries the two eye centres in camera pixels, the image
size, head yaw, capture timestamp and optionally the iris diameter. Anything
that can produce those (marker glasses, a recorded session, a test fixture)
can drive the tracker. `MediaPipeFaceSource` is the built-in webcam source.

### Hosting the MediaPipe assets yourself

By default the WASM runtime is loaded from jsDelivr and the model
(`face_landmarker.task`, ~3.7 MB) from Google's storage. To serve them
yourself, copy `node_modules/@mediapipe/tasks-vision/wasm` and the model to
your public folder and pass `assets: { wasmBaseUrl, modelUrl }`.

## Tips for a convincing effect

- Close one eye; stereo vision tells the brain the screen is flat.
- Use fullscreen, or keep `compensateWindowPosition` on.
- On Macs, turn Center Stage off: it crops and pans the camera image.

## License

MIT
