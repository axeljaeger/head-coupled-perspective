import type { Vec3 } from '../types.ts';
import { KalmanCV3 } from './kalman.ts';
import { OneEuroFilter3 } from './oneEuro.ts';
import type { FilterOptions, PointFilter } from './types.ts';

export * from './types.ts';
export { KalmanCV1D, KalmanCV3 } from './kalman.ts';
export { OneEuroFilter, OneEuroFilter3 } from './oneEuro.ts';

/** Pass-through filter with zero velocity, for A/B comparison. */
export class NoFilter implements PointFilter {
  filter(p: Vec3): Vec3 {
    return p;
  }
  derivative(): Vec3 {
    return [0, 0, 0];
  }
  reset(): void {}
}

/** Creates a filter from options; omitted parameters get the evaluated defaults. */
export function createFilter(options: FilterOptions): PointFilter {
  switch (options.type) {
    case 'kalman': {
      const f = new KalmanCV3();
      f.configure(options.accel ?? 1.5, options.noiseXY ?? 0.0015, options.noiseZ ?? 0.005);
      return f;
    }
    case 'oneEuro': {
      const f = new OneEuroFilter3();
      f.configure(options.minCutoff ?? 1.5, options.beta ?? 40, options.dCutoff ?? 4);
      return f;
    }
    case 'none':
      return new NoFilter();
  }
}
