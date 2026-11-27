import type { Vec3 } from '../types.ts';

/** A smoothing filter for a 3D point that also estimates its velocity. */
export interface PointFilter {
  /** @param t timestamp in seconds */
  filter(p: Vec3, t: number): Vec3;
  /** Estimated velocity after the last update, units per second. */
  derivative(): Vec3;
  reset(): void;
}

export interface KalmanOptions {
  type: 'kalman';
  /** Standard deviation of head acceleration, m/s². Higher = follows faster, noisier. Default 1.5. */
  accel?: number;
  /** Measurement noise of the eye position in x/y, metres. Default 0.0015. */
  noiseXY?: number;
  /** Measurement noise in z (depth is noisier), metres. Default 0.005. */
  noiseZ?: number;
}

export interface OneEuroOptions {
  type: 'oneEuro';
  /** Cutoff (Hz) while the head is still. Lower = calmer but laggier. Default 1.5. */
  minCutoff?: number;
  /** Cutoff increase per m/s of head speed. Default 40. */
  beta?: number;
  /** Cutoff (Hz) of the speed estimate. Default 4. */
  dCutoff?: number;
}

export interface NoFilterOptions {
  type: 'none';
}

export type FilterOptions = KalmanOptions | OneEuroOptions | NoFilterOptions;
