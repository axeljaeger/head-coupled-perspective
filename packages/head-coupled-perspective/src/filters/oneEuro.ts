import type { Vec3 } from '../types.ts';
import type { PointFilter } from './types.ts';

/**
 * One Euro Filter (Casiez, Roussel, Vogel 2012): low lag for fast motion,
 * strong smoothing when the signal is nearly still.
 */
export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private lastT: number | null = null;

  minCutoff: number;
  beta: number;
  dCutoff: number;

  constructor(minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  /** Filtered derivative of the last update, in units per second. */
  get derivative(): number {
    return this.dx;
  }

  reset(): void {
    this.x = null;
    this.lastT = null;
    this.dx = 0;
  }

  /** @param t timestamp in seconds */
  filter(value: number, t: number): number {
    if (this.x === null || this.lastT === null || t <= this.lastT) {
      this.x = value;
      this.lastT = t;
      return value;
    }
    const dt = t - this.lastT;
    this.lastT = t;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/** Three independent One Euro filters for a 3D point. */
export class OneEuroFilter3 implements PointFilter {
  readonly fx = new OneEuroFilter();
  readonly fy = new OneEuroFilter();
  readonly fz = new OneEuroFilter();

  configure(minCutoff: number, beta: number, dCutoff = 1): void {
    for (const f of [this.fx, this.fy, this.fz]) {
      f.minCutoff = minCutoff;
      f.beta = beta;
      f.dCutoff = dCutoff;
    }
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
  }

  filter(p: Vec3, t: number): Vec3 {
    return [this.fx.filter(p[0], t), this.fy.filter(p[1], t), this.fz.filter(p[2], t)];
  }

  derivative(): Vec3 {
    return [this.fx.derivative, this.fy.derivative, this.fz.derivative];
  }
}
