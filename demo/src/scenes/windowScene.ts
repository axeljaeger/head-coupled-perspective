import * as THREE from 'three';
import type { DemoScene } from './types';
import { disposeChildren } from './targetsScene';

const GROUND_Y = -8; // the room is on an upper floor, so the view looks down a bit
const REVEAL = 0.12; // depth of the window reveal behind the screen plane
const SKY_ZENITH = new THREE.Color(0x3d78c2);
const SKY_HORIZON = new THREE.Color(0xcfe0ee);

// Small deterministic PRNG so the landscape looks the same every time.
function prng(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Smooth 1D value noise built from a few octaves of random control points. */
function ridgeNoise(rnd: () => number, octaves = 5) {
  const tables = Array.from({ length: octaves }, () => Array.from({ length: 64 }, () => rnd()));
  return (x: number) => {
    let v = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (const t of tables) {
      const p = x * freq * 8;
      const i = Math.floor(p);
      const f = p - i;
      const a = t[((i % 64) + 64) % 64];
      const b = t[(((i + 1) % 64) + 64) % 64];
      v += amp * (a + (b - a) * (f * f * (3 - 2 * f)));
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return v / norm;
  };
}

/** Haze: colours blend into the horizon colour with distance. */
function hazed(base: number, distance: number): THREE.Color {
  const k = 1 - Math.exp(-distance / 600);
  return new THREE.Color(base).lerp(SKY_HORIZON, k);
}

/**
 * Looking out of a window at a landscape far away. The screen is the window
 * opening; most of the effect comes from leaning in and out (the view widens
 * and narrows) and from parallax between near trees and distant mountains.
 */
export class WindowScene implements DemoScene {
  readonly root = new THREE.Group();
  readonly background = SKY_HORIZON.getHex();
  readonly far = 4000;
  private landscape = new THREE.Group();
  private frame = new THREE.Group();
  private clouds = new THREE.Group();

  constructor() {
    this.root.add(this.landscape, this.frame);
    this.buildLandscape();
  }

  private buildLandscape(): void {
    const L = this.landscape;
    L.add(new THREE.HemisphereLight(0xdfefff, 0x5b6b3a, 1.4));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.0);
    sun.position.set(-300, 400, -600);
    L.add(sun);

    // Sky dome with a vertical gradient.
    const skyGeo = new THREE.SphereGeometry(3000, 48, 24);
    const colors: number[] = [];
    const pos = skyGeo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(pos.getY(i) / 3000, 0);
      const c = SKY_HORIZON.clone().lerp(SKY_ZENITH, Math.pow(t, 0.6));
      colors.push(c.r, c.g, c.b);
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    L.add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false })));

    // Sun disc
    const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(40, 32), new THREE.MeshBasicMaterial({ color: 0xfff6dc }));
    sunDisc.position.set(-900, 700, -2400);
    sunDisc.lookAt(0, 0, 0);
    L.add(sunDisc);

    // Ground with a colour gradient into the haze.
    const groundGeo = new THREE.PlaneGeometry(8000, 4000, 1, 64);
    groundGeo.rotateX(-Math.PI / 2);
    groundGeo.translate(0, GROUND_Y, -2000);
    const gc: number[] = [];
    const gp = groundGeo.getAttribute('position');
    for (let i = 0; i < gp.count; i++) {
      const c = hazed(0x6f8f45, -gp.getZ(i));
      gc.push(c.r, c.g, c.b);
    }
    groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(gc, 3));
    L.add(new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ vertexColors: true })));

    // A lake in the middle distance.
    const lake = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64),
      new THREE.MeshStandardMaterial({ color: hazed(0x5f8fb5, 250), roughness: 0.15, metalness: 0.1 }),
    );
    lake.rotation.x = -Math.PI / 2;
    lake.scale.set(260, 90, 1);
    lake.position.set(60, GROUND_Y + 0.05, -260);
    L.add(lake);

    // Mountain ridges, each layer further away, larger and hazier.
    const rnd = prng(42);
    const layers = [
      { z: -420, height: 70, base: 0x56703f, spread: 1600 },
      { z: -900, height: 220, base: 0x55684f, spread: 3200 },
      { z: -1700, height: 520, base: 0x6b7a86, spread: 5200 },
      { z: -2600, height: 900, base: 0x8a9bb0, spread: 7000 },
    ];
    for (const layer of layers) {
      const noise = ridgeNoise(rnd);
      const shape = new THREE.Shape();
      const n = 200;
      shape.moveTo(-layer.spread / 2, GROUND_Y - 5);
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const x = -layer.spread / 2 + u * layer.spread;
        const y = GROUND_Y + Math.pow(noise(u + rnd() * 0.001), 1.6) * layer.height * 1.6;
        shape.lineTo(x, y);
      }
      shape.lineTo(layer.spread / 2, GROUND_Y - 5);
      const mesh = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshBasicMaterial({ color: hazed(layer.base, -layer.z) }),
      );
      mesh.position.z = layer.z;
      L.add(mesh);
    }

    // Trees from a few metres to a few hundred metres away: strong parallax.
    const trunk = new THREE.CylinderGeometry(0.15, 0.2, 1, 6);
    const crown = new THREE.ConeGeometry(1, 1, 8);
    for (let i = 0; i < 90; i++) {
      const dist = 35 + Math.pow(rnd(), 1.6) * 400;
      let x = (rnd() - 0.5) * dist * 2.2;
      // Keep the middle of the view free near the house.
      if (dist < 100 && Math.abs(x) < dist * 0.3) x = Math.sign(x || 1) * dist * (0.3 + rnd() * 0.5);
      const h = 5 + rnd() * 7;
      const tree = new THREE.Group();
      const t = new THREE.Mesh(trunk, new THREE.MeshLambertMaterial({ color: hazed(0x5a4030, dist) }));
      t.scale.set(1, h * 0.3, 1);
      t.position.y = h * 0.15;
      const c = new THREE.Mesh(crown, new THREE.MeshLambertMaterial({ color: hazed(0x2f5a2c, dist) }));
      c.scale.set(h * 0.22, h * 0.8, h * 0.22);
      c.position.y = h * 0.3 + h * 0.4;
      tree.add(t, c);
      tree.position.set(x, GROUND_Y, -dist);
      L.add(tree);
    }

    // A few flat clouds high up, drifting slowly.
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
    for (let i = 0; i < 14; i++) {
      const cloud = new THREE.Group();
      for (let k = 0; k < 5; k++) {
        const puff = new THREE.Mesh(new THREE.CircleGeometry(1, 24), cloudMat);
        puff.scale.set(60 + rnd() * 80, 20 + rnd() * 20, 1);
        puff.position.set(k * 50 - 100, rnd() * 15, 0);
        cloud.add(puff);
      }
      cloud.position.set((rnd() - 0.5) * 4000, 350 + rnd() * 500, -1200 - rnd() * 1500);
      this.clouds.add(cloud);
    }
    L.add(this.clouds);
  }

  layout(width: number, height: number): void {
    disposeChildren(this.frame);
    const w = width / 2;
    const h = height / 2;
    const plaster = new THREE.MeshStandardMaterial({ color: 0xf1ede6, roughness: 0.9 });
    const wood = new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.6 });
    const light = new THREE.DirectionalLight(0xffffff, 0.8);
    light.position.set(0.3, 0.5, 1);
    this.frame.add(light, new THREE.AmbientLight(0xffffff, 0.6));

    // Reveal: four walls from the screen edge back into the wall.
    const side = new THREE.PlaneGeometry(REVEAL, height);
    const left = new THREE.Mesh(side, plaster);
    left.rotation.y = Math.PI / 2;
    left.position.set(-w, 0, -REVEAL / 2);
    const right = new THREE.Mesh(side, plaster);
    right.rotation.y = -Math.PI / 2;
    right.position.set(w, 0, -REVEAL / 2);
    const tb = new THREE.PlaneGeometry(width, REVEAL);
    const top = new THREE.Mesh(tb, plaster);
    top.rotation.x = Math.PI / 2;
    top.position.set(0, h, -REVEAL / 2);
    const bottom = new THREE.Mesh(tb, plaster);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.set(0, -h, -REVEAL / 2);
    this.frame.add(left, right, top, bottom);

    // Casement frame at the back of the reveal, with a cross of glazing bars.
    const bar = Math.min(width, height) * 0.035;
    const depth = 0.04;
    const z = -REVEAL + depth / 2;
    const box = (bw: number, bh: number, x: number, y: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, depth), wood);
      m.position.set(x, y, z);
      this.frame.add(m);
    };
    box(width, bar, 0, h - bar / 2);
    box(width, bar, 0, -h + bar / 2);
    box(bar, height, -w + bar / 2, 0);
    box(bar, height, w - bar / 2, 0);
    box(bar * 0.7, height, 0, 0);
    box(width, bar * 0.7, 0, h * 0.25);
  }

  update(dt: number): void {
    for (const c of this.clouds.children) {
      c.position.x += dt * 4;
      if (c.position.x > 2200) c.position.x = -2200;
    }
  }

  dispose(): void {
    disposeChildren(this.frame);
    disposeChildren(this.landscape);
  }
}
