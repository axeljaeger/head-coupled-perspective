// Copies the MediaPipe WASM runtime out of node_modules and downloads the
// face landmarker model once, so the demo runs without a CDN afterwards.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = join(root, 'public/mediapipe/wasm');
const modelDst = join(root, 'public/mediapipe/face_landmarker.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

mkdirSync(wasmDst, { recursive: true });
cpSync(wasmSrc, wasmDst, { recursive: true });

if (!existsSync(modelDst)) {
  console.log('Downloading face landmarker model ...');
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Model download failed: ${res.status}`);
  writeFileSync(modelDst, Buffer.from(await res.arrayBuffer()));
}
