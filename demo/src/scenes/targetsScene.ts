import * as THREE from 'three';
import type { DemoScene } from './types';

const DEPTH = 0.5; // how far the box reaches behind the screen
const GRID_STEPS = 10;

function ringTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const rings = ['#d62828', '#ffffff', '#d62828', '#ffffff', '#d62828'];
  rings.forEach((col, i) => {
    g.beginPath();
    g.arc(size / 2, size / 2, (size / 2) * (1 - i / rings.length), 0, Math.PI * 2);
    g.fillStyle = col;
    g.fill();
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A gridded box behind the screen with targets floating at different depths. */
export class TargetsScene implements DemoScene {
  readonly root = new THREE.Group();
  readonly background = 0x05070d;
  private box = new THREE.Group();
  private targets = new THREE.Group();
  private texture = ringTexture();
  private time = 0;
  private seeds: { x: number; y: number; z: number; r: number; phase: number }[] = [];

  constructor() {
    this.root.add(this.box, this.targets);
    // Deterministic layout so screenshots and comparisons are repeatable.
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 9; i++) {
      this.seeds.push({
        x: rnd() * 0.84 - 0.42,
        y: rnd() * 0.7 - 0.35,
        z: i < 3 ? 0.04 + rnd() * 0.1 : -0.05 - rnd() * 0.4, // three pop out of the screen
        r: 0.012 + rnd() * 0.01,
        phase: rnd() * Math.PI * 2,
      });
    }
  }

  layout(width: number, height: number): void {
    disposeChildren(this.box);
    disposeChildren(this.targets);

    // Grid lines on the four walls and the back.
    const pts: number[] = [];
    const w = width / 2;
    const h = height / 2;
    for (let i = 0; i <= GRID_STEPS; i++) {
      const z = -(DEPTH * i) / GRID_STEPS;
      // depth rings
      pts.push(-w, -h, z, w, -h, z, w, -h, z, w, h, z, w, h, z, -w, h, z, -w, h, z, -w, -h, z);
      const fx = -w + (2 * w * i) / GRID_STEPS;
      const fy = -h + (2 * h * i) / GRID_STEPS;
      // lines running into the depth on floor/ceiling and side walls
      pts.push(fx, -h, 0, fx, -h, -DEPTH, fx, h, 0, fx, h, -DEPTH);
      pts.push(-w, fy, 0, -w, fy, -DEPTH, w, fy, 0, w, fy, -DEPTH);
      // back wall grid
      pts.push(fx, -h, -DEPTH, fx, h, -DEPTH, -w, fy, -DEPTH, w, fy, -DEPTH);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.box.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x3fa7ff })));

    const disc = new THREE.CircleGeometry(1, 48);
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, side: THREE.DoubleSide });
    const stringMat = new THREE.LineBasicMaterial({ color: 0x9aa4b2 });
    for (const t of this.seeds) {
      const target = new THREE.Group();
      const m = new THREE.Mesh(disc, mat);
      m.scale.setScalar(t.r);
      target.add(m);
      target.position.set(t.x * width, t.y * height, t.z);
      target.userData = t;
      // A string to the back wall makes the depth easy to read.
      const sg = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -DEPTH - t.z),
      ]);
      target.add(new THREE.Line(sg, stringMat));
      this.targets.add(target);
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const target of this.targets.children) {
      const t = target.userData as (typeof this.seeds)[number];
      target.rotation.z = Math.sin(this.time * 0.5 + t.phase) * 0.2;
    }
  }

  dispose(): void {
    disposeChildren(this.box);
    disposeChildren(this.targets);
    this.texture.dispose();
  }
}

export function disposeChildren(group: THREE.Object3D): void {
  for (const child of [...group.children]) {
    child.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    group.remove(child);
  }
}
