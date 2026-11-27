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

/**
 * A small mechanical assembly on a ground grid. It straddles the screen plane
 * so parts sit both behind and in front of the glass. Drag with the mouse to
 * rotate the model.
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
    const scale = Math.min(width / 0.5, height / 0.3) * 0.85;
    // Put the floor so the model's bounding box is vertically centred on the screen.
    this.model.position.set(0, 0, 0);
    this.model.scale.setScalar(scale);
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model);
    const floorY = -(box.max.y - box.min.y) / 2 - box.min.y;

    // Invisible ground that only shows the soft shadow, so there is no hard
    // floor edge that gets cut off by the screen border.
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.5),
      new THREE.ShadowMaterial({ opacity: 0.3 }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = floorY;
    plane.receiveShadow = true;
    this.ground.add(plane);

    this.model.position.set(0, floorY, -0.02);
    this.model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.sun.target.position.set(0, floorY, 0);
    this.sun.position.set(-0.3, floorY + 1, 0.35);
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
