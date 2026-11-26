import * as THREE from 'three';
import GUI from 'lil-gui';
import { loadSettings, saveSettings, defaultSettings, type Settings } from './settings';
import { FaceTracker, type FaceObservation } from './tracking/faceTracker';
import { OneEuroFilter3 } from './tracking/oneEuroFilter';
import { calibrateHfov, eyeInScreenSpace, type Vec3 } from './tracking/headPose';
import { updateOffAxisCamera } from './projection/offAxis';
import type { DemoScene } from './scenes/types';
import { TargetsScene } from './scenes/targetsScene';
import { CadScene } from './scenes/cadScene';

/** Viewing distance used when head coupling is off and as the neutral point for gainZ. */
const NEUTRAL_Z = 0.6;

const settings: Settings = loadSettings();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------- rendering
const canvas = $<HTMLCanvasElement>('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
let demo: DemoScene | null = null;

function setScene(name: Settings['scene']): void {
  if (demo) {
    scene.remove(demo.root);
    demo.dispose();
  }
  demo = name === 'cad' ? new CadScene(canvas) : new TargetsScene();
  scene.add(demo.root);
  scene.background = new THREE.Color(demo.background);
  lastLayout = '';
}

/** Physical size of the browser viewport and its centre relative to the screen centre, metres. */
function viewport() {
  const pxToM = settings.screenWidthCm / 100 / screen.width;
  const width = innerWidth * pxToM;
  const height = innerHeight * pxToM;
  let cx = 0;
  let cy = 0;
  if (settings.compensateWindowPosition) {
    // Browser chrome is assumed to sit above the content area.
    const leftPx = screenX + (outerWidth - innerWidth) / 2;
    const topPx = screenY + (outerHeight - innerHeight);
    cx = (leftPx + innerWidth / 2 - screen.width / 2) * pxToM;
    cy = -(topPx + innerHeight / 2 - screen.height / 2) * pxToM;
  }
  return { width, height, cx, cy };
}

let lastLayout = '';
function layoutIfNeeded(vp: ReturnType<typeof viewport>): void {
  const key = `${vp.width.toFixed(4)}x${vp.height.toFixed(4)}`;
  if (key !== lastLayout && demo) {
    demo.layout(vp.width, vp.height);
    lastLayout = key;
  }
  renderer.setSize(innerWidth, innerHeight, false);
}

// ---------------------------------------------------------------- tracking
const filter = new OneEuroFilter3();
let filtered: Vec3 | null = null;
let lastObs: FaceObservation | null = null;
let lastObsTime = 0;
let tracking = false;
const rawHistory: Vec3[] = [];
const filteredHistory: Vec3[] = [];
const trackTimes: number[] = [];

function onFace(obs: FaceObservation | null): void {
  if (!obs) {
    tracking = false;
    drawDebugVideo(null);
    return;
  }
  tracking = true;
  lastObs = obs;
  lastObsTime = obs.timestamp;
  const raw = eyeInScreenSpace(obs, settings);
  filter.configure(settings.filterMinCutoff, settings.filterBeta);
  filtered = filter.filter(raw, obs.timestamp / 1000);
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

/** Eye position relative to the centre of the browser viewport. */
function currentEye(vp: ReturnType<typeof viewport>): THREE.Vector3 {
  if (!settings.headCoupling) return new THREE.Vector3(0, 0, NEUTRAL_Z);

  let e: Vec3;
  if (settings.input === 'mouse') {
    e = [(mouse[0] - 0.5) * vp.width * 1.2 + vp.cx, (0.5 - mouse[1]) * vp.height * 1.2 + vp.cy, NEUTRAL_Z];
  } else if (filtered) {
    const d = filter.derivative();
    const p = settings.predictionMs / 1000;
    e = [filtered[0] + d[0] * p, filtered[1] + d[1] * p, filtered[2] + d[2] * p];
  } else {
    e = [vp.cx, vp.cy, NEUTRAL_Z];
  }
  const x = (e[0] - vp.cx) * settings.gainXY;
  const y = (e[1] - vp.cy) * settings.gainXY;
  const z = NEUTRAL_Z + (e[2] - NEUTRAL_Z) * settings.gainZ;
  return new THREE.Vector3(x, y, z);
}

// ---------------------------------------------------------------- debug view
const debugEl = $('debug');
const debugText = $('debug-text');
const debugCanvas = $<HTMLCanvasElement>('debug-video');
const debugCtx = debugCanvas.getContext('2d')!;
let tracker: FaceTracker | null = null;

function drawDebugVideo(obs: FaceObservation | null): void {
  if (!settings.showDebug || !tracker) return;
  const video = tracker.video;
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
  for (const p of obs.landmarks) debugCtx.fillRect(p.x * w, p.y * h, 1, 1);
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
function updateDebugText(eye: THREE.Vector3, vp: ReturnType<typeof viewport>): void {
  if (!settings.showDebug) return;
  debugCanvas.style.display = settings.input === 'webcam' && tracker ? 'block' : 'none';
  const fps = (times: number[]) =>
    times.length > 1 ? ((times.length - 1) * 1000) / (times[times.length - 1] - times[0]) : 0;
  const cm = (v: number) => (v * 100).toFixed(1).padStart(6);
  const mm = (v: Vec3) => v.map((x) => x.toFixed(1)).join(' / ');
  const lines = [
    `Eingabe     ${settings.input === 'mouse' ? 'Maus' : tracking ? 'Webcam: Gesicht erkannt' : 'Webcam: kein Gesicht'}`,
    `Kopplung    ${settings.headCoupling ? 'an' : 'AUS (statisch)'}`,
    `Auge (cm)   x${cm(eye.x)} y${cm(eye.y)} z${cm(eye.z)}`,
    `Fenster     ${(vp.width * 100).toFixed(1)} x ${(vp.height * 100).toFixed(1)} cm`,
    `Render      ${fps(frameTimes).toFixed(0)} fps`,
  ];
  if (settings.input === 'webcam' && lastObs) {
    lines.push(
      `Tracking    ${fps(trackTimes).toFixed(0)} fps, Erkennung ${lastObs.detectMs.toFixed(1)} ms`,
      `Alter       ${(performance.now() - lastObsTime).toFixed(0)} ms seit letztem Frame`,
      `Kamera      ${lastObs.videoWidth}x${lastObs.videoHeight}, FOV ${settings.cameraHfovDeg.toFixed(1)}°`,
      `Gierwinkel  ${((lastObs.yaw * 180) / Math.PI).toFixed(1)}°`,
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
    const a = screen.width / screen.height;
    const hCm = (v * 2.54) / Math.sqrt(1 + a * a);
    settings.screenHeightCm = +hCm.toFixed(1);
    settings.screenWidthCm = +(hCm * a).toFixed(1);
    widthCtl.updateDisplay();
    heightCtl.updateDisplay();
    persist();
  });
/** Known displays: visible panel size in cm and camera position relative to the top edge. */
const presets: Record<string, Pick<Settings, 'screenWidthCm' | 'screenHeightCm' | 'cameraAboveScreenCm'>> = {
  // 2560 x 1664 px at 224 ppi. The camera sits in the notch, i.e. inside the panel area.
  'MacBook Air 13" (M2–M4)': { screenWidthCm: 29.03, screenHeightCm: 18.87, cameraAboveScreenCm: -0.4 },
};
const preset = { name: '' };
setup
  .add(preset, 'name', ['', ...Object.keys(presets)])
  .name('Gerät')
  .onChange((v: string) => {
    const p = presets[v];
    if (!p) return;
    Object.assign(settings, p);
    diag.zoll = diagonalInches();
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    persist();
  });
const widthCtl = setup.add(settings, 'screenWidthCm', 10, 150, 0.1).name('Breite Bild (cm)').onFinishChange(persist);
const heightCtl = setup.add(settings, 'screenHeightCm', 5, 100, 0.1).name('Höhe Bild (cm)').onFinishChange(persist);
setup.add(settings, 'cameraAboveScreenCm', -5, 10, 0.1).name('Kamera über Bildkante (cm)').onFinishChange(persist);
const fovCtl = setup.add(settings, 'cameraHfovDeg', 30, 120, 0.1).name('Kamera-FOV horiz. (°)').onFinishChange(persist);
setup.add(settings, 'ipdCm', 5, 7.5, 0.05).name('Augenabstand (cm)').onFinishChange(persist);
setup.add(settings, 'compensateWindowPosition').name('Fensterposition beachten').onFinishChange(persist);
const calib = {
  abstandCm: 60,
  kalibrieren: () => {
    if (!lastObs) {
      alertInDebug('Kein Gesicht erkannt, Kalibrierung nicht möglich.');
      return;
    }
    settings.cameraHfovDeg = +calibrateHfov(lastObs, settings, calib.abstandCm).toFixed(1);
    fovCtl.updateDisplay();
    filter.reset();
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
input.add(settings, 'eye', { Mitte: 'center', 'Linkes Auge': 'left', 'Rechtes Auge': 'right' }).name('Auge').onFinishChange(persist);

const filt = gui.addFolder('Glättung');
filt.add(settings, 'filterMinCutoff', 0.05, 5, 0.05).name('Min. Grenzfrequenz (Hz)').onFinishChange(persist);
filt.add(settings, 'filterBeta', 0, 1, 0.005).name('Beta (Geschwindigkeit)').onFinishChange(persist);
filt.add(settings, 'predictionMs', 0, 100, 1).name('Vorhersage (ms)').onFinishChange(persist);

const effect = gui.addFolder('Effekt');
const couplingCtl = effect.add(settings, 'headCoupling').name('Kopfkopplung (H)').onChange(persist);
effect.add(settings, 'gainXY', 0, 3, 0.05).name('Verstärkung x/y').onFinishChange(persist);
effect.add(settings, 'gainZ', 0, 3, 0.05).name('Verstärkung z').onFinishChange(persist);
const sceneCtl = effect
  .add(settings, 'scene', { Zielscheiben: 'targets', 'CAD-Modell': 'cad' })
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
      settings.scene = e.key === '1' ? 'targets' : 'cad';
      sceneCtl.updateDisplay();
      setScene(settings.scene);
      persist();
      break;
  }
});

// ---------------------------------------------------------------- start-up
const startEl = $('start');
const startError = $('start-error');

async function startWebcam(): Promise<void> {
  if (tracker) return;
  tracker = new FaceTracker(onFace);
  try {
    await tracker.start();
    settings.input = 'webcam';
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  } catch (e) {
    tracker = null;
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

setScene(settings.scene);
applyDebugVisibility();

let prev = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - prev) / 1000, 0.1);
  prev = now;
  push(frameTimes, now, 60);

  const vp = viewport();
  layoutIfNeeded(vp);
  const eye = currentEye(vp);
  updateOffAxisCamera(camera, eye, vp.width, vp.height);
  demo?.update(dt);
  renderer.render(scene, camera);
  updateDebugText(eye, vp);
  if (debugMessage) debugText.textContent += `\n${debugMessage}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
