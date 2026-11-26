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
  private grid = new THREE.Group();
  private lights = new THREE.Group();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private targetRot = new THREE.Euler(0.35, -0.5, 0);

  constructor(private readonly dom: HTMLElement) {
    this.root.add(this.lights, this.grid, this.model);

    this.lights.add(new THREE.HemisphereLight(0xffffff, 0x8a9099, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(0.4, 0.8, 0.6);
    this.lights.add(sun);

    const steel = new THREE.MeshStandardMaterial({ color: 0xa9b3bf, metalness: 0.6, roughness: 0.35 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x3a6ea5, metalness: 0.2, roughness: 0.5 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.7, roughness: 0.3 });

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
    this.lastY = e.clientY;
  };
  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.targetRot.y += (e.clientX - this.lastX) * 0.01;
    this.targetRot.x += (e.clientY - this.lastY) * 0.01;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };
  private onUp = () => {
    this.dragging = false;
  };

  layout(width: number, height: number): void {
    disposeChildren(this.grid);
    const floorY = -height / 2;
    const size = Math.max(width, 0.8);
    const g = new THREE.GridHelper(size, 40, 0x7d8794, 0xc3cad3);
    g.position.set(0, floorY, -size / 2 + 0.1);
    this.grid.add(g);

    // Model sits centred on the screen plane, slightly above the floor.
    this.model.position.set(0, -height * 0.12, 0);
    this.model.scale.setScalar(Math.min(width / 0.5, height / 0.3) * 0.85);
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 10);
    this.model.rotation.x += (this.targetRot.x - this.model.rotation.x) * k;
    this.model.rotation.y += (this.targetRot.y - this.model.rotation.y) * k;
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
