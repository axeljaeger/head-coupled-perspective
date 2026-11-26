import type { Object3D } from 'three';

/** A demo scene laid out in screen space (metres, screen plane at z = 0). */
export interface DemoScene {
  readonly root: Object3D;
  readonly background: number;
  /** Called whenever the physical size of the visible window changes. */
  layout(width: number, height: number): void;
  update(dtSeconds: number): void;
  dispose(): void;
}
