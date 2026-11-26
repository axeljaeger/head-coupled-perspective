/**
 * Constant-velocity Kalman filter for one axis. State is [position, velocity];
 * the process noise models random (white) acceleration of the head.
 */
export class KalmanCV1D {
  private p = 0;
  private v = 0;
  // Covariance [[a, b], [b, c]]
  private a = 1;
  private b = 0;
  private c = 1;
  private lastT: number | null = null;

  constructor(
    /** Standard deviation of head acceleration, units/s². */
    public accelStd = 3,
    /** Standard deviation of the measurement noise, units. */
    public measStd = 0.002,
  ) {}

  get derivative(): number {
    return this.v;
  }

  reset(): void {
    this.lastT = null;
  }

  /** @param t timestamp in seconds */
  filter(z: number, t: number): number {
    const r = this.measStd * this.measStd;
    if (this.lastT === null || t <= this.lastT || t - this.lastT > 0.5) {
      // (Re)initialise: trust the measurement, velocity unknown.
      this.p = z;
      this.v = 0;
      this.a = r;
      this.b = 0;
      this.c = 1;
      this.lastT = t;
      return z;
    }
    const dt = t - this.lastT;
    this.lastT = t;

    // Predict
    const q = this.accelStd * this.accelStd;
    const dt2 = dt * dt;
    this.p += this.v * dt;
    const a = this.a + 2 * dt * this.b + dt2 * this.c + (q * dt2 * dt2) / 4;
    const b = this.b + dt * this.c + (q * dt2 * dt) / 2;
    const c = this.c + q * dt2;

    // Update with position measurement
    const s = a + r;
    const k0 = a / s;
    const k1 = b / s;
    const y = z - this.p;
    this.p += k0 * y;
    this.v += k1 * y;
    this.a = (1 - k0) * a;
    this.b = (1 - k0) * b;
    this.c = c - k1 * b;
    return this.p;
  }
}

/** Three independent constant-velocity Kalman filters for a 3D point. */
export class KalmanCV3 {
  readonly fx = new KalmanCV1D();
  readonly fy = new KalmanCV1D();
  readonly fz = new KalmanCV1D();

  configure(accelStd: number, measStdXY: number, measStdZ: number): void {
    for (const f of [this.fx, this.fy, this.fz]) f.accelStd = accelStd;
    this.fx.measStd = measStdXY;
    this.fy.measStd = measStdXY;
    this.fz.measStd = measStdZ;
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
  }

  filter(p: [number, number, number], t: number): [number, number, number] {
    return [this.fx.filter(p[0], t), this.fy.filter(p[1], t), this.fz.filter(p[2], t)];
  }

  derivative(): [number, number, number] {
    return [this.fx.derivative, this.fy.derivative, this.fz.derivative];
  }
}
