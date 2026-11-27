import * as THREE from 'three';
import type { DemoScene } from './types';
import { disposeChildren } from './targetsScene';

/** Outline drawn on top of a mesh, the way CAD viewers show model edges. */
function withEdges(mesh: THREE.Mesh, color = 0x1b1f24): THREE.Mesh {
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry, 25),
    new THREE.LineBasicMaterial({ color }),
  );
  mesh.add(edges);
  return mesh;
}

function plateWithHoles(w: number, d: number, t: number, holeR: number): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  const r = 0.008;
  s.moveTo(-w / 2 + r, -d / 2);
  s.lineTo(w / 2 - r, -d / 2);
  s.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
  s.lineTo(w / 2, d / 2 - r);
  s.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
  s.lineTo(-w / 2 + r, d / 2);
  s.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r);
  s.lineTo(-w / 2, -d / 2 + r);
  s.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
  const inset = 0.02;
  for (const [x, y] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const hole = new THREE.Path();
    hole.absarc(x * (w / 2 - inset), y * (d / 2 - inset), holeR, 0, Math.PI * 2, true);
    s.holes.push(hole);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 32 });
  g.rotateX(-Math.PI / 2); // lie flat, thickness along +y
  return g;
}

function gearGeometry(teeth: number, rRoot: number, rTip: number, width: number, bore: number) {
  const s = new THREE.Shape();
  const steps = teeth * 4;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const r = i % 4 === 1 || i % 4 === 2 ? rTip : rRoot;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  const hole = new THREE.Path();
  hole.absarc(0, 0, bore, 0, Math.PI * 2, true);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false, curveSegments: 24 });
  g.translate(0, 0, -width / 2);
  return g;
}

/** Depth of the room behind the glass, metres. */
const ROOM_DEPTH = 0.6;
/** Grid spacing on the room surfaces, metres (like a CAD floor grid). */
const GRID = 0.05;

/**
 * A small mechanical assembly floating in front of the screen, with a room
 * behind the glass as reference.
 *
 * An object right at the glass (z = 0) has no parallax against the screen
 * frame: it only turns with the head and seems glued to the screen centre.
 * Placed in front of the glass, it shifts against the head movement relative
 * to the frame and appears to come out of the screen. The room, whose walls
 * start exactly at the screen edges, ties the virtual space to the physical
 * frame, and the model's shadow on the room shows how far it floats in front.
 * The model is kept small so it is never cut off by the screen edge, which
 * would break the illusion. Drag with the mouse to rotate.
 */
export class CadScene implements DemoScene {
  readonly root = new THREE.Group();
  readonly background = 0xe9edf2;
  private model = new THREE.Group();
  private ground = new THREE.Group();
  private sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private lights = new THREE.Group();
  private dragging = false;
  private lastX = 0;
  // Only yaw is user-controlled; the model stands on the ground and the
  // viewer's head provides the other viewpoints.
  private targetYaw = -0.5;
  /** Position of the model's centre: > 0 in front of the glass (pops out), < 0 behind. Metres. */
  modelZ = 0.08;
  /** Show the room (floor, walls, grid) behind the glass. */
  showRoom = true;

  constructor(private readonly dom: HTMLElement) {
    this.root.add(this.lights, this.ground, this.model);
    // Start at the target angle so nothing animates when the scene opens.
    this.model.rotation.y = this.targetYaw;

    this.lights.add(new THREE.HemisphereLight(0xffffff, 0x8a9099, 1.6));
    // Light from almost straight above so the shadow sits under the model.
    const sun = this.sun;
    sun.position.set(-0.3, 1, 0.35);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 6;
    sun.shadow.bias = -0.0005;
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -0.3;
    sc.right = sc.top = 0.3;
    sc.near = 0.1;
    sc.far = 2;
    this.lights.add(sun, sun.target);

    const steel = new THREE.MeshStandardMaterial({ color: 0xb4bcc6, metalness: 0.25, roughness: 0.45 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x3a6ea5, metalness: 0.2, roughness: 0.5 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.35, roughness: 0.4 });

    const plate = withEdges(new THREE.Mesh(plateWithHoles(0.24, 0.16, 0.012, 0.007), blue));
    this.model.add(plate);

    // Two bearing blocks
    for (const x of [-0.07, 0.07]) {
      const block = withEdges(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.05), steel));
      block.position.set(x, 0.012 + 0.03, 0);
      this.model.add(block);
    }
    // Shaft through the blocks
    const shaft = withEdges(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 32), steel));
    shaft.rotation.z = Math.PI / 2;
    shaft.position.set(0, 0.052, 0);
    this.model.add(shaft);
    // Gear on the shaft
    const gear = withEdges(new THREE.Mesh(gearGeometry(18, 0.045, 0.052, 0.016, 0.008), brass));
    gear.rotation.y = Math.PI / 2;
    gear.position.set(0, 0.052, 0);
    this.model.add(gear);
    // Bolts in the corner holes
    for (const [x, z] of [
      [-0.1, -0.06],
      [0.1, -0.06],
      [0.1, 0.06],
      [-0.1, 0.06],
    ]) {
      const head = withEdges(new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.006, 6), steel));
      head.position.set(x, 0.015, z);
      this.model.add(head);
    }

    dom.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
  }

  private onDown = (e: PointerEvent) => {
    this.dragging = true;
    this.lastX = e.clientX;
  };
  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.targetYaw += (e.clientX - this.lastX) * 0.01;
    this.lastX = e.clientX;
  };
  private onUp = () => {
    this.dragging = false;
  };

  layout(width: number, height: number): void {
    disposeChildren(this.ground);
    const z = this.modelZ;
    const eyeZ = 0.6;
    // The model appears larger the closer it comes, by eyeZ / (eyeZ - z).
    // Size it so that, seen from straight ahead, it covers about half the
    // screen width and leaves room to move the head without hitting the edge.
    const magnification = eyeZ / Math.max(eyeZ - z, 0.1);
    const scale = (Math.min(width / 0.5, height / 0.3) * 0.5) / magnification;
    this.model.position.set(0, 0, 0);
    this.model.scale.setScalar(scale);
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model);
    const modelH = box.max.y - box.min.y;

    if (this.showRoom) this.buildRoom(width, height);
    else {
      // Shadow-only back plane as the only reference.
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.ShadowMaterial({ opacity: 0.3 }));
      plane.position.set(0, 0, -ROOM_DEPTH);
      plane.receiveShadow = true;
      this.ground.add(plane);
    }

    // Vertically centred, slightly below the middle so its shadow lands on the floor.
    this.model.position.set(0, -modelH / 2 - box.min.y - height * 0.05, z);
    this.model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    // Light from above and in front, so the shadow falls back onto the floor
    // and the back wall of the room and shows how far the model floats.
    this.sun.target.position.set(0, -height / 4, -ROOM_DEPTH);
    this.sun.position.set(-0.2, height / 2 + 0.4, z + 0.8);
    const sc = this.sun.shadow.camera;
    const extent = Math.max(width, height, ROOM_DEPTH) * 1.5;
    sc.left = sc.bottom = -extent;
    sc.right = sc.top = extent;
    sc.far = 4;
    sc.updateProjectionMatrix();
  }

  /** Floor, walls, ceiling and back wall behind the glass, flush with the screen edges. */
  private buildRoom(width: number, height: number): void {
    const w = width / 2;
    const h = height / 2;
    const d = ROOM_DEPTH;
    // Partly self-lit, so walls and ceiling stay light and only the shadow stands out.
    const surface = (color: number) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0, emissive: color, emissiveIntensity: 0.55 });
    const add = (geo: THREE.PlaneGeometry, mat: THREE.Material, pos: THREE.Vector3, rot: THREE.Euler) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(pos);
      m.rotation.copy(rot);
      m.receiveShadow = true;
      this.ground.add(m);
    };
    const floor = surface(0xdfe4ea);
    const wall = surface(0xe9edf2);
    add(new THREE.PlaneGeometry(width, d), floor, new THREE.Vector3(0, -h, -d / 2), new THREE.Euler(-Math.PI / 2, 0, 0));
    add(new THREE.PlaneGeometry(width, d), wall, new THREE.Vector3(0, h, -d / 2), new THREE.Euler(Math.PI / 2, 0, 0));
    add(new THREE.PlaneGeometry(d, height), wall, new THREE.Vector3(-w, 0, -d / 2), new THREE.Euler(0, Math.PI / 2, 0));
    add(new THREE.PlaneGeometry(d, height), wall, new THREE.Vector3(w, 0, -d / 2), new THREE.Euler(0, -Math.PI / 2, 0));
    add(new THREE.PlaneGeometry(width, height), wall, new THREE.Vector3(0, 0, -d), new THREE.Euler());

    // Grid lines: strong on the floor, faint on walls, slightly off the
    // surfaces to avoid z-fighting.
    const e = 0.0005;
    const floorPts: number[] = [];
    const wallPts: number[] = [];
    for (let x = 0; x <= w + 1e-6; x += GRID) {
      for (const sx of x === 0 ? [0] : [-x, x]) {
        floorPts.push(sx, -h + e, 0, sx, -h + e, -d);
        wallPts.push(sx, h - e, 0, sx, h - e, -d, sx, -h, -d + e, sx, h, -d + e);
      }
    }
    for (let zz = 0; zz <= d + 1e-6; zz += GRID) {
      floorPts.push(-w, -h + e, -zz, w, -h + e, -zz);
      wallPts.push(-w + e, -h, -zz, -w + e, h, -zz, w - e, -h, -zz, w - e, h, -zz, -w, h - e, -zz, w, h - e, -zz);
    }
    for (let y = -h; y <= h + 1e-6; y += GRID) {
      wallPts.push(-w + e, y, 0, -w + e, y, -d, w - e, y, 0, w - e, y, -d, -w, y, -d + e, w, y, -d + e);
    }
    const lines = (pts: number[], color: number, opacity: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
    };
    this.ground.add(lines(floorPts, 0x8b96a3, 0.7), lines(wallPts, 0xa7b0ba, 0.45));

    // Darker edges where the room meets the screen frame and in its corners.
    const edgePts = [
      -w, -h, 0, -w, -h, -d, w, -h, 0, w, -h, -d, -w, h, 0, -w, h, -d, w, h, 0, w, h, -d,
      -w, -h, -d, w, -h, -d, w, -h, -d, w, h, -d, w, h, -d, -w, h, -d, -w, h, -d, -w, -h, -d,
    ];
    this.ground.add(lines(edgePts, 0x5d6772, 0.9));
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 10);
    this.model.rotation.y += (this.targetYaw - this.model.rotation.y) * k;
  }

  dispose(): void {
    this.dom.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
    });
  }
}
