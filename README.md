# head-coupled-perspective

Head-coupled perspective (HCP) for the browser, written in TypeScript. The
webcam estimates where your eyes are, and the 3D scene is rendered with an
off-axis projection so the monitor behaves like a window into the scene.

This is currently an **evaluation prototype**. The question it should answer:
is the effect convincing on a desktop with a plain webcam? Only if it is will
it be turned into a reusable library.

## Run it

```sh
npm install
npm run dev
```

Open the printed URL (http://localhost:5173), click **Webcam starten** and
allow camera access. `npm run dev` copies the MediaPipe WASM runtime into
`public/` and downloads the face landmarker model once (about 3.7 MB).

### On an iPad (or another device on the network)

```sh
npm run dev:lan
```

serves over HTTPS on your local network (cameras need HTTPS). Open the
"Network" URL on the iPad, accept the self-signed certificate warning, and use
the iPad in landscape with the camera at the top. Adding the page to the home
screen gives you a fullscreen view.

## Setup for a fair test

1. Pick your device under **Aufbau → Gerät**. The start screen suggests one
   based on the screen size the browser reports (the exact model is not
   available to web pages). Supported: MacBook Air 13"/15", MacBook Pro
   13"/14"/15"/16", iPad Air 11". Otherwise enter the visible size of your screen (or
   just the diagonal) and how far the camera sits above the top edge.
2. Sit still, measure the distance from your eyes to the screen, enter it
   under *Gemessener Abstand* and press **Abstand kalibrieren**. This solves
   for the webcam's field of view so distances come out right.
3. Press <kbd>F</kbd> for fullscreen. In windowed mode the window position is
   taken into account, but browser chrome can make it slightly off.
4. Close one eye. With both eyes open, stereo vision tells your brain the
   screen is flat, which weakens the effect a lot.

## Camera mode

*Eingabe → Kamera-Modus* requests a resolution and frame rate (default
1280×720 @ 60). The browser may deliver less; the debug overlay shows what the
camera actually runs at. Switching to a different aspect ratio (e.g. 640×480)
changes the field of view, so recalibrate the distance afterwards.

## Keys

| Key | Action |
| --- | --- |
| <kbd>H</kbd> | Head coupling on/off, for A/B comparison with a static view |
| <kbd>G</kbd> | Smoothing filter on/off |
| <kbd>K</kbd> | Switch between One Euro and Kalman filter |
| <kbd>F</kbd> | Fullscreen |
| <kbd>D</kbd> | Debug overlay (camera image, eye position, fps, latency, jitter) |
| <kbd>1</kbd> / <kbd>2</kbd> / <kbd>3</kbd> | Target box / CAD-like model (drag to rotate) / window onto a landscape |

## What to look at

- **Jitter** (debug overlay): standard deviation of the eye position over the
  last 30 frames, raw and filtered. Depth (z) is usually the noisiest axis.
- **Smoothing** (*Glättung*): One Euro filter. Lower *Min. Grenzfrequenz*
  means a calmer image but more lag; higher *Beta* (Hz per m/s of head speed)
  reduces lag for fast moves. <kbd>G</kbd> turns the filter off for comparison.
  *Latenz kompensieren* extrapolates the head position from the camera's
  capture timestamp to the moment of rendering. This hides camera and
  detection latency and the 30 fps stepping of the webcam. *Zusätzl.
  Vorhersage* adds more on top, e.g. for display latency.
- **Kalman filter** (alternative to One Euro): constant-velocity model per
  axis. *Beschleunigung σ* sets how quickly the head may change speed;
  *Messrauschen* should match the raw jitter. Sit still and press
  *Messrauschen aus Jitter* to take it from the measurement. In simulation it
  tracks continuous motion more closely than One Euro, at the cost of slightly
  more jitter at rest and a little overshoot after abrupt stops.
- **Gain** (*Verstärkung*): 1 is physically correct. Values above 1 exaggerate
  the parallax, which can help or hurt.

## How it works

- `src/tracking/faceTracker.ts`: webcam + MediaPipe Face Landmarker, eye
  centres from the eye-corner landmarks, head yaw from the face transform.
- `src/tracking/headPose.ts`: pinhole back-projection to a metric eye
  position in screen space; depth from the interpupillary distance in pixels
  (yaw-corrected).
- `src/tracking/oneEuroFilter.ts`: smoothing.
- `src/projection/offAxis.ts`: asymmetric frustum with the physical screen as
  the window ("generalized perspective projection").
- `src/scenes/`: demo scenes in screen space (metres, screen plane at z = 0).

Prior art: Johnny Lee's Wii Remote head tracking demo (2007), which used two
IR LEDs on glasses and the Wii Remote's IR camera.
