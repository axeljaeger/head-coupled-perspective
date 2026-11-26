import type { Settings } from './settings';

export type DeviceGeometry = Pick<Settings, 'screenWidthCm' | 'screenHeightCm' | 'cameraAboveScreenCm'>;

export interface DevicePreset extends DeviceGeometry {
  name: string;
  /** CSS screen sizes (landscape, width x height) this device reports at its scaling options. */
  cssSizes: [number, number][];
  /** The size macOS/iPadOS uses by default; a match here is the most likely. */
  defaultCss: [number, number];
  kind: 'mac' | 'ipad';
  note?: string;
}

// Panel sizes are computed from native resolution and pixel density.
// Notched MacBooks: the camera sits inside the notch, slightly below the top
// edge of the panel, hence a small negative offset.
export const devicePresets: DevicePreset[] = [
  {
    name: 'MacBook Air 13" (M2–M4)',
    kind: 'mac',
    screenWidthCm: 29.03, // 2560 px @ 224 ppi
    screenHeightCm: 18.87, // 1664 px
    cameraAboveScreenCm: -0.4,
    defaultCss: [1470, 956],
    cssSizes: [[1024, 665], [1280, 832], [1470, 956], [1710, 1112]],
  },
  {
    name: 'MacBook Air 15" (M2–M4)',
    kind: 'mac',
    screenWidthCm: 32.66, // 2880 px @ 224 ppi
    screenHeightCm: 21.14, // 1864 px
    cameraAboveScreenCm: -0.4,
    defaultCss: [1710, 1112],
    cssSizes: [[1280, 828], [1440, 932], [1710, 1112], [1920, 1243]],
  },
  {
    name: 'MacBook Pro 14" (M1–M5)',
    kind: 'mac',
    screenWidthCm: 30.24, // 3024 px @ 254 ppi
    screenHeightCm: 19.64, // 1964 px
    cameraAboveScreenCm: -0.4,
    defaultCss: [1512, 982],
    cssSizes: [[1147, 745], [1352, 878], [1512, 982], [1800, 1169]],
  },
  {
    name: 'MacBook Pro 16" (M1–M5)',
    kind: 'mac',
    screenWidthCm: 34.56, // 3456 px @ 254 ppi
    screenHeightCm: 22.34, // 2234 px
    cameraAboveScreenCm: -0.4,
    defaultCss: [1728, 1117],
    cssSizes: [[1312, 848], [1496, 967], [1728, 1117], [2056, 1329]],
  },
  {
    name: 'iPad Air 11" (M2/M3), quer',
    kind: 'ipad',
    screenWidthCm: 22.71, // 2360 px @ 264 ppi
    screenHeightCm: 15.78, // 1640 px
    // Front camera sits centred in the bezel of the long edge (landscape top).
    cameraAboveScreenCm: 0.5,
    defaultCss: [1180, 820],
    cssSizes: [[1180, 820]],
    note: 'Querformat, Kamera oben',
  },
];

export interface DetectionResult {
  preset: DevicePreset;
  /** 'exact' = default scaling matched, 'scaled' = a non-default scaling option matched. */
  confidence: 'exact' | 'scaled';
  /** Other presets that report the same CSS size. */
  alternatives: DevicePreset[];
}

function isIPad(): boolean {
  // iPadOS Safari pretends to be a Mac; touch support gives it away.
  return /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isMac(): boolean {
  return /Mac/.test(navigator.platform) && navigator.maxTouchPoints <= 1;
}

/**
 * Best guess of the device from what the browser exposes. The exact model is
 * not available to web pages, so this matches the CSS screen size against
 * the known scaling options of each device.
 */
export function detectDevice(): DetectionResult | null {
  if (devicePixelRatio < 2) return null; // all presets are Retina panels
  const kind = isIPad() ? 'ipad' : isMac() ? 'mac' : null;
  if (!kind) return null;
  const w = Math.max(screen.width, screen.height);
  const h = Math.min(screen.width, screen.height);
  const same = (s: [number, number]) => Math.abs(s[0] - w) <= 2 && Math.abs(s[1] - h) <= 2;
  const candidates = devicePresets.filter((p) => p.kind === kind && p.cssSizes.some(same));
  if (candidates.length === 0) return null;
  const exact = candidates.find((p) => same(p.defaultCss));
  const preset = exact ?? candidates[0];
  return {
    preset,
    confidence: exact ? 'exact' : 'scaled',
    alternatives: candidates.filter((p) => p !== preset),
  };
}
