import * as THREE from 'three';
import GUI from 'lil-gui';
import { loadSettings, saveSettings, defaultSettings, type Settings } from './settings';
import {
  HeadTracker,
  MediaPipeFaceSource,
  browserViewport,
  detectDevice,
  devicePresets,
  displayFromDiagonal,
  estimateIpd,
  type CameraMode,
  type DevicePreset,
  type DisplayGeometry,
  type FaceObservation,
  type FilterOptions,
  type ScreenRect,
  type Vec3,
} from 'head-coupled-perspective';
import { applyOffAxis } from 'head-coupled-perspective/three';
import type { DemoScene } from './scenes/types';
import { TargetsScene } from './scenes/targetsScene';
import { CadScene } from './scenes/cadScene';
import { WindowScene } from './scenes/windowScene';

/** Viewing distance used when head coupling is off and as the neutral point for gainZ. */
const NEUTRAL_Z = 0.6;

const settings: Settings = loadSettings();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------- rendering
const canvas = $<HTMLCanvasElement>('view');
const context = canvas.getContext('webgl2', {
  antialias: true,
  powerPreference: 'high-performance',
  // Lets the browser show frames without waiting for the page compositor.
  desynchronized: settings.lowLatencyCanvas,
}) as WebGL2RenderingContext;
// Logarithmic depth keeps precision from 1 cm (window frame) to kilometres (mountains).
const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
let demo: DemoScene | null = null;

function setScene(name: Settings['scene']): void {
  if (demo) {
    scene.remove(demo.root);
    demo.dispose();
  }
  demo = name === 'cad' ? new CadScene(canvas) : name === 'window' ? new WindowScene() : new TargetsScene();
  scene.add(demo.root);
  scene.background = new THREE.Color(demo.background);
  lastLayout = '';
}

/** The UI keeps lengths in centimetres; the library works in metres. */
function display(): DisplayGeometry {
  return {
    width: settings.screenWidthCm / 100,
    height: settings.screenHeightCm / 100,
    cameraOffsetY: settings.cameraAboveScreenCm / 100,
  };
}

function viewport(): ScreenRect {
  return browserViewport(display(), { compensateWindowPosition: settings.compensateWindowPosition });
}

let lastLayout = '';
function layoutIfNeeded(vp: ScreenRect): void {
  const key = `${vp.width.toFixed(4)}x${vp.height.toFixed(4)}`;
  if (key !== lastLayout && demo) {
    demo.layout(vp.width, vp.height);
    lastLayout = key;
  }
  renderer.setSize(innerWidth, innerHeight, false);
}

// ---------------------------------------------------------------- tracking
let source: MediaPipeFaceSource | null = null;
let tracker: HeadTracker | null = null;
let lastObs: FaceObservation | null = null;
let lastObsTime = 0;
const pipelineLatency: number[] = [];
let tracking = false;
const rawHistory: Vec3[] = [];
/** Running iris-based IPD estimates (cm) for the debug overlay. */
const ipdSamples: number[] = [];
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const filteredHistory: Vec3[] = [];
const trackTimes: number[] = [];

function filterOptions(): FilterOptions {
  if (!settings.filterEnabled) return { type: 'none' };
  if (settings.filterType === 'kalman')
    return {
      type: 'kalman',
      accel: settings.kalmanAccel,
      noiseXY: settings.kalmanNoiseXYmm / 1000,
      noiseZ: settings.kalmanNoiseZmm / 1000,
    };
  return { type: 'oneEuro', minCutoff: settings.filterMinCutoff, beta: settings.filterBeta, dCutoff: settings.filterDCutoff };
}

/** Pushes changed settings into the tracker; only real changes reset its filter. */
let lastSync = { filter: '', geometry: '' };
function syncTracker(): void {
  if (!tracker) return;
  const filter = JSON.stringify(filterOptions());
  if (filter !== lastSync.filter) tracker.setFilter(filterOptions());
  const geometry = JSON.stringify([display(), settings.ipdCm, settings.eye, settings.cameraHfovDeg]);
  if (geometry !== lastSync.geometry) {
    tracker.setDisplay(display());
    tracker.setViewer({ ipd: settings.ipdCm / 100, eye: settings.eye });
    tracker.setCamera({ hfovDeg: settings.cameraHfovDeg });
  }
  lastSync = { filter, geometry };
  tracker.prediction.latencyCompensation = settings.latencyCompensation;
  tracker.prediction.extraMs = settings.predictionMs;
}

function onUpdate(obs: FaceObservation | null, raw: Vec3 | null, filtered: Vec3 | null): void {
  if (!obs || !raw || !filtered) {
    tracking = false;
    drawDebugVideo(null);
    return;
  }
  tracking = true;
  lastObs = obs;
  lastObsTime = obs.timestamp;
  push(pipelineLatency, performance.now() - obs.captureTime, 30);
  const ipdEstimate = estimateIpd(obs);
  if (ipdEstimate) push(ipdSamples, ipdEstimate * 100, 90);
  push(rawHistory, raw, 30);
  push(filteredHistory, filtered, 30);
  push(trackTimes, obs.timestamp, 30);
  drawDebugVideo(obs);
}

function push<T>(arr: T[], v: T, max: number): void {
  arr.push(v);
  if (arr.length > max) arr.shift();
}

let mouse: [number, number] = [0.5, 0.5];
window.addEventListener('pointermove', (e) => {
  mouse = [e.clientX / innerWidth, e.clientY / innerHeight];
});

/** Eye position in screen space, with the effect gains applied around the viewport centre. */
function currentEye(vp: ScreenRect): Vec3 {
  if (!settings.headCoupling) return [vp.cx, vp.cy, NEUTRAL_Z];

  let e: Vec3;
  if (settings.input === 'mouse') {
    e = [(mouse[0] - 0.5) * vp.width * 1.2 + vp.cx, (0.5 - mouse[1]) * vp.height * 1.2 + vp.cy, NEUTRAL_Z];
  } else {
    e = tracker?.getEye() ?? [vp.cx, vp.cy, NEUTRAL_Z];
  }
  return [
    vp.cx + (e[0] - vp.cx) * settings.gainXY,
    vp.cy + (e[1] - vp.cy) * settings.gainXY,
    NEUTRAL_Z + (e[2] - NEUTRAL_Z) * settings.gainZ,
  ];
}

// ---------------------------------------------------------------- debug view
const debugEl = $('debug');
const debugText = $('debug-text');
const debugCanvas = $<HTMLCanvasElement>('debug-video');
const debugCtx = debugCanvas.getContext('2d')!;

function drawDebugVideo(obs: FaceObservation | null): void {
  if (!settings.showDebug || !source) return;
  const video = source.video;
  if (!video.videoWidth) return;
  const w = debugCanvas.width;
  const h = (w * video.videoHeight) / video.videoWidth;
  if (debugCanvas.height !== Math.round(h)) debugCanvas.height = Math.round(h);
  const sx = w / video.videoWidth;
  debugCtx.save();
  // Mirror so it behaves like a mirror for the viewer.
  debugCtx.translate(w, 0);
  debugCtx.scale(-1, 1);
  debugCtx.drawImage(video, 0, 0, w, h);
  if (!obs) {
    debugCtx.restore();
    return;
  }
  debugCtx.fillStyle = 'rgba(80,255,160,0.7)';
  for (const p of obs.landmarks ?? []) debugCtx.fillRect(p.x * w, p.y * h, 1, 1);
  debugCtx.fillStyle = '#ff4060';
  for (const [x, y] of [obs.subjectLeftPx, obs.subjectRightPx]) {
    debugCtx.beginPath();
    debugCtx.arc(x * sx, y * sx, 3, 0, Math.PI * 2);
    debugCtx.fill();
  }
  debugCtx.restore();
}

function stdDevMm(arr: Vec3[]): Vec3 {
  if (arr.length < 2) return [0, 0, 0];
  const out: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const mean = arr.reduce((s, v) => s + v[k], 0) / arr.length;
    const varc = arr.reduce((s, v) => s + (v[k] - mean) ** 2, 0) / (arr.length - 1);
    out[k] = Math.sqrt(varc) * 1000;
  }
  return out;
}

const frameTimes: number[] = [];
function updateDebugText(eyeAbs: Vec3, vp: ScreenRect): void {
  if (!settings.showDebug) return;
  // Shown relative to the viewport centre, as before.
  const eye = { x: eyeAbs[0] - vp.cx, y: eyeAbs[1] - vp.cy, z: eyeAbs[2] };
  debugCanvas.style.display = settings.input === 'webcam' && tracker ? 'block' : 'none';
  const fps = (times: number[]) =>
    times.length > 1 ? ((times.length - 1) * 1000) / (times[times.length - 1] - times[0]) : 0;
  const num = (v: number, digits: number, width: number) => v.toFixed(digits).padStart(width);
  const cm = (v: number) => num(v * 100, 1, 6);
  const mm = (v: Vec3) => v.map((x) => num(x, 1, 5)).join(' /');
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const lines = [
    `Eingabe     ${settings.input === 'mouse' ? 'Maus' : tracking ? 'Webcam: Gesicht erkannt' : 'Webcam: kein Gesicht'}`,
    `Kopplung    ${settings.headCoupling ? 'an' : 'AUS (statisch)'}, Filter ${settings.filterEnabled ? (settings.filterType === 'kalman' ? 'Kalman' : 'One Euro') : 'AUS'}`,
    `Auge (cm)   x${cm(eye.x)} y${cm(eye.y)} z${cm(eye.z)}`,
    `Fenster     ${(vp.width * 100).toFixed(1)} x ${(vp.height * 100).toFixed(1)} cm`,
    `Render      ${num(fps(frameTimes), 0, 3)} fps`,
  ];
  if (settings.input === 'webcam' && lastObs) {
    lines.push(
      `Tracking    ${num(fps(trackTimes), 0, 3)} fps`,
      `Erkennung   ${num(lastObs.detectMs, 1, 5)} ms ${source?.delegate ?? '?'}`,
      `Latenz      ${num(avg(pipelineLatency), 0, 4)} ms ${lastObs.hasCaptureTime ? 'ab Aufnahme' : 'ab Frame (geschätzt)'}`,
      `Alter       ${num(performance.now() - lastObsTime, 0, 4)} ms seit letztem Frame`,
      `Kamera      ${lastObs.imageWidth}x${lastObs.imageHeight} @ ${num(source?.actualSettings?.frameRate ?? 0, 0, 2)} fps (angefr. ${parseMode(settings.cameraMode).fps})`,
      `Kamera-FOV  ${settings.cameraHfovDeg.toFixed(1)}°`,
      `Gierwinkel  ${num((lastObs.yaw * 180) / Math.PI, 1, 6)}°`,
      `Augenabst.  ${num(settings.ipdCm, 2, 5)} cm, Iris-Schätzung ${num(median(ipdSamples), 2, 5)} cm`,
      `Jitter roh  ${mm(stdDevMm(rawHistory))} mm`,
      `Jitter gef. ${mm(stdDevMm(filteredHistory))} mm`,
    );
  }
  debugText.textContent = lines.join('\n');
}

// ---------------------------------------------------------------- UI
const gui = new GUI({ title: 'Einstellungen' });
const persist = () => saveSettings(settings);

const setup = gui.addFolder('Aufbau');
const diag = { zoll: diagonalInches() };
function diagonalInches(): number {
  return Math.hypot(settings.screenWidthCm, settings.screenHeightCm) / 2.54;
}
setup
  .add(diag, 'zoll', 10, 60, 0.1)
  .name('Diagonale (Zoll)')
  .onFinishChange((v: number) => {
    // Derive width/height from the diagonal and the screen's pixel aspect ratio.
    const d = displayFromDiagonal(v);
    settings.screenHeightCm = +(d.height * 100).toFixed(1);
    settings.screenWidthCm = +(d.width * 100).toFixed(1);
    widthCtl.updateDisplay();
    heightCtl.updateDisplay();
    persist();
  });
const preset = { name: settings.deviceName };
const presetCtl = setup
  .add(preset, 'name', ['', ...devicePresets.map((d) => d.name)])
  .name('Gerät')
  .onChange((v: string) => applyDevice(devicePresets.find((d) => d.name === v)));
function applyDevice(d: DevicePreset | undefined): void {
  if (!d) return;
  settings.screenWidthCm = +(d.width * 100).toFixed(2);
  settings.screenHeightCm = +(d.height * 100).toFixed(2);
  settings.cameraAboveScreenCm = +(d.cameraOffsetY * 100).toFixed(2);
  settings.deviceName = d.name;
  preset.name = d.name;
  diag.zoll = diagonalInches();
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  persist();
}
const widthCtl = setup.add(settings, 'screenWidthCm', 10, 150, 0.1).name('Breite Bild (cm)').onFinishChange(persist);
const heightCtl = setup.add(settings, 'screenHeightCm', 5, 100, 0.1).name('Höhe Bild (cm)').onFinishChange(persist);
setup.add(settings, 'cameraAboveScreenCm', -5, 10, 0.1).name('Kamera über Bildkante (cm)').onFinishChange(persist);
const fovCtl = setup.add(settings, 'cameraHfovDeg', 30, 120, 0.1).name('Kamera-FOV horiz. (°)').onFinishChange(persist);
const ipdCtl = setup.add(settings, 'ipdCm', 5, 7.5, 0.05).name('Augenabstand (cm)').onFinishChange(persist);
setup
  .add(
    {
      measureIpd: async () => {
        if (!tracker) return alertInDebug('Erst die Webcam starten.');
        alertInDebug('Augenabstand wird gemessen: 3 s geradeaus in die Kamera schauen …');
        syncTracker();
        try {
          const ipd = await tracker.measureIpd({ durationMs: 3000 });
          settings.ipdCm = +(ipd * 100).toFixed(2);
          ipdCtl.updateDisplay();
          persist();
          alertInDebug(`Augenabstand gemessen: ${settings.ipdCm.toFixed(2)} cm`);
        } catch {
          alertInDebug('Zu wenig Messwerte, bitte wiederholen.');
        }
      },
    },
    'measureIpd',
  )
  .name('Augenabstand messen (Iris)');
setup.add(settings, 'compensateWindowPosition').name('Fensterposition beachten').onFinishChange(persist);
const calib = {
  abstandCm: 60,
  kalibrieren: () => {
    syncTracker();
    const hfov = tracker?.calibrateDistance(calib.abstandCm / 100);
    if (hfov == null) {
      alertInDebug('Kein Gesicht erkannt, Kalibrierung nicht möglich.');
      return;
    }
    settings.cameraHfovDeg = +hfov.toFixed(1);
    fovCtl.updateDisplay();
    persist();
  },
};
setup.add(calib, 'abstandCm', 20, 200, 1).name('Gemessener Abstand (cm)');
setup.add(calib, 'kalibrieren').name('Abstand kalibrieren');

const input = gui.addFolder('Eingabe');
input
  .add(settings, 'input', { Webcam: 'webcam', Maus: 'mouse' })
  .name('Quelle')
  .onChange(async (v: Settings['input']) => {
    persist();
    if (v === 'webcam') await startWebcam();
  });
input
  .add(settings, 'cameraMode', ['640x480@30', '640x480@60', '1280x720@30', '1280x720@60', '1920x1080@30', '1920x1080@60'])
  .name('Kamera-Modus')
  .onChange(async () => {
    persist();
    if (source && tracker) {
      await source.setCameraMode(parseMode(settings.cameraMode));
      tracker.setFilter(filterOptions());
    }
  });
input
  .add(settings, 'lowLatencyCanvas')
  .name('Low-Latency-Canvas (neu laden)')
  .onChange(persist);
input.add(settings, 'eye', { Mitte: 'center', 'Linkes Auge': 'left', 'Rechtes Auge': 'right' }).name('Auge').onFinishChange(persist);

const filt = gui.addFolder('Glättung');
const filterCtl = filt.add(settings, 'filterEnabled').name('Filter an (G)').onChange(persist);
filt
  .add(settings, 'filterType', { 'One Euro': 'oneEuro', Kalman: 'kalman' })
  .name('Filtertyp (K)')
  .onChange(() => {
    showFilterParams();
    persist();
  });
const oneEuroCtls = [
  filt.add(settings, 'filterMinCutoff', 0.1, 20, 0.1).name('Min. Grenzfrequenz (Hz)').onFinishChange(persist),
  filt.add(settings, 'filterBeta', 0, 200, 1).name('Beta (Hz pro m/s)').onFinishChange(persist),
  filt.add(settings, 'filterDCutoff', 0.5, 15, 0.5).name('Grenzfreq. Tempo (Hz)').onFinishChange(persist),
];
const kalmanCtls = [
  filt.add(settings, 'kalmanAccel', 0.1, 20, 0.1).name('Beschleunigung σ (m/s²)').onFinishChange(persist),
  filt.add(settings, 'kalmanNoiseXYmm', 0.1, 20, 0.1).name('Messrauschen x/y (mm)').onFinishChange(persist),
  filt.add(settings, 'kalmanNoiseZmm', 0.1, 50, 0.1).name('Messrauschen z (mm)').onFinishChange(persist),
  filt
    .add(
      {
        fromJitter: () => {
          // Sit still, then take the observed raw jitter as measurement noise.
          const sd = stdDevMm(rawHistory);
          if (rawHistory.length < 10) return alertInDebug('Zu wenig Messwerte, erst Gesicht erkennen lassen.');
          settings.kalmanNoiseXYmm = +Math.max((sd[0] + sd[1]) / 2, 0.1).toFixed(1);
          settings.kalmanNoiseZmm = +Math.max(sd[2], 0.1).toFixed(1);
          gui.controllersRecursive().forEach((c) => c.updateDisplay());
          persist();
        },
      },
      'fromJitter',
    )
    .name('Messrauschen aus Jitter (still sitzen)'),
];
function showFilterParams(): void {
  const k = settings.filterType === 'kalman';
  oneEuroCtls.forEach((c) => c.show(!k));
  kalmanCtls.forEach((c) => c.show(k));
}
filt.add(settings, 'latencyCompensation').name('Latenz kompensieren').onChange(persist);
filt.add(settings, 'predictionMs', 0, 100, 1).name('Zusätzl. Vorhersage (ms)').onFinishChange(persist);

const effect = gui.addFolder('Effekt');
const couplingCtl = effect.add(settings, 'headCoupling').name('Kopfkopplung (H)').onChange(persist);
effect.add(settings, 'gainXY', 0, 3, 0.05).name('Verstärkung x/y').onFinishChange(persist);
effect.add(settings, 'gainZ', 0, 3, 0.05).name('Verstärkung z').onFinishChange(persist);
const sceneCtl = effect
  .add(settings, 'scene', { Zielscheiben: 'targets', 'CAD-Modell': 'cad', Fenster: 'window' })
  .name('Szene')
  .onChange((v: Settings['scene']) => {
    setScene(v);
    persist();
  });
const debugCtl = gui.add(settings, 'showDebug').name('Debug-Anzeige (D)').onChange(applyDebugVisibility);
gui.add(
  {
    reset: () => {
      Object.assign(settings, defaultSettings);
      diag.zoll = diagonalInches();
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      setScene(settings.scene);
      applyDebugVisibility();
      persist();
    },
  },
  'reset',
).name('Zurücksetzen');

function applyDebugVisibility(): void {
  debugEl.classList.toggle('hidden', !settings.showDebug);
  persist();
}

let debugMessage = '';
function alertInDebug(msg: string): void {
  debugMessage = msg;
  setTimeout(() => (debugMessage = ''), 4000);
}

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  switch (e.key.toLowerCase()) {
    case 'h':
      settings.headCoupling = !settings.headCoupling;
      couplingCtl.updateDisplay();
      persist();
      break;
    case 'k':
      settings.filterType = settings.filterType === 'kalman' ? 'oneEuro' : 'kalman';
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      showFilterParams();
      persist();
      break;
    case 'g':
      settings.filterEnabled = !settings.filterEnabled;
      filterCtl.updateDisplay();
      persist();
      break;
    case 'f':
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
      break;
    case 'd':
      settings.showDebug = !settings.showDebug;
      debugCtl.updateDisplay();
      applyDebugVisibility();
      break;
    case '1':
    case '2':
    case '3':
      settings.scene = e.key === '1' ? 'targets' : e.key === '2' ? 'cad' : 'window';
      sceneCtl.updateDisplay();
      setScene(settings.scene);
      persist();
      break;
  }
});

// ---------------------------------------------------------------- start-up
const startEl = $('start');
const startError = $('start-error');

function parseMode(m: string): CameraMode {
  const match = /^(\d+)x(\d+)@(\d+)$/.exec(m);
  if (!match) return { width: 1280, height: 720, fps: 60 };
  return { width: +match[1], height: +match[2], fps: +match[3] };
}

async function startWebcam(): Promise<void> {
  if (tracker) return;
  // Assets are served locally by the demo (see scripts/fetch-assets.mjs).
  const base = new URL(import.meta.env.BASE_URL, location.href).href;
  source = new MediaPipeFaceSource({
    camera: parseMode(settings.cameraMode),
    assets: { wasmBaseUrl: `${base}mediapipe/wasm`, modelUrl: `${base}mediapipe/face_landmarker.task` },
  });
  tracker = new HeadTracker({ display: display(), filter: filterOptions(), source });
  tracker.subscribe((u) => onUpdate(u.observation, u.raw, u.filtered));
  lastSync = { filter: '', geometry: '' };
  syncTracker();
  try {
    await tracker.resume();
    settings.input = 'webcam';
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  } catch (e) {
    tracker = null;
    source = null;
    settings.input = 'mouse';
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    throw e;
  }
}

$('start-webcam').addEventListener('click', async () => {
  startError.textContent = 'Lade Modell und Webcam …';
  try {
    await startWebcam();
    startError.textContent = '';
    startEl.classList.add('hidden');
  } catch (e) {
    startError.textContent = `Webcam konnte nicht gestartet werden: ${(e as Error).message}`;
  }
  persist();
});
$('start-mouse').addEventListener('click', () => {
  settings.input = 'mouse';
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  startEl.classList.add('hidden');
  persist();
});

// Suggest a device preset; the user confirms, since the guess can be wrong.
const detected = detectDevice();
const suggestion = $('device-suggestion');
if (detected && detected.preset.name !== settings.deviceName) {
  const alt = detected.alternatives.length
    ? ` (oder ${detected.alternatives.map((a) => a.name).join(', ')})`
    : '';
  const hint = detected.confidence === 'scaled' ? ' Die Bildschirmskalierung ist nicht die Standardeinstellung, daher unsicher.' : '';
  suggestion.innerHTML = '';
  const text = document.createElement('span');
  text.textContent = `Erkannt: ${detected.preset.name}${alt}.${hint} `;
  const btn = document.createElement('button');
  btn.className = 'secondary';
  btn.textContent = 'Übernehmen';
  btn.onclick = () => {
    applyDevice(detected.preset);
    suggestion.textContent = `${detected.preset.name} übernommen.`;
  };
  suggestion.append(text, btn);
} else if (settings.deviceName) {
  suggestion.textContent = `Gerät: ${settings.deviceName}`;
}
void presetCtl;

setScene(settings.scene);
applyDebugVisibility();
showFilterParams();

let prev = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - prev) / 1000, 0.1);
  prev = now;
  push(frameTimes, now, 60);

  const vp = viewport();
  layoutIfNeeded(vp);
  const eye = currentEye(vp);
  syncTracker();
  applyOffAxis(camera, eye, vp, 0.01, demo?.far ?? 20);
  demo?.update(dt);
  renderer.render(scene, camera);
  updateDebugText(eye, vp);
  if (debugMessage) debugText.textContent += `\n${debugMessage}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
