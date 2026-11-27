import type { DisplayGeometry } from './types.ts';

export interface DevicePreset extends DisplayGeometry {
  name: string;
  /** CSS screen sizes (landscape, width x height) this device reports at its scaling options. */
  cssSizes: [number, number][];
  /** The size macOS/iPadOS uses by default; a match here is the most likely. */
  defaultCss: [number, number];
  kind: 'mac' | 'ipad';
  note?: string;
}

// All lengths in metres. Panel sizes are computed from native resolution and pixel density.
// Notched MacBooks: the camera sits inside the notch, slightly below the top
// edge of the panel, hence a small negative offset.
export const devicePresets: DevicePreset[] = [
  {
    name: 'MacBook Air 13" (M2–M4)',
    kind: 'mac',
    width: 0.2903, // 2560 px @ 224 ppi
    height: 0.1887, // 1664 px
    cameraOffsetY: -0.004,
    defaultCss: [1470, 956],
    cssSizes: [[1024, 665], [1280, 832], [1470, 956], [1710, 1112]],
  },
  {
    name: 'MacBook Air 15" (M2–M4)',
    kind: 'mac',
    width: 0.3266, // 2880 px @ 224 ppi
    height: 0.2114, // 1864 px
    cameraOffsetY: -0.004,
    defaultCss: [1710, 1112],
    cssSizes: [[1280, 828], [1440, 932], [1710, 1112], [1920, 1243]],
  },
  {
    // Same 2560 x 1600 panel as the MacBook Air 13" up to M1.
    name: 'MacBook Pro 13" (2016–2022) / Air 13" up to M1',
    kind: 'mac',
    width: 0.2864, // 2560 px @ 227 ppi
    height: 0.179, // 1600 px
    cameraOffsetY: 0.006, // camera in the bezel above the panel
    defaultCss: [1440, 900],
    cssSizes: [[1024, 640], [1280, 800], [1440, 900], [1680, 1050]],
  },
  {
    name: 'MacBook Pro 15" (2016–2019)',
    kind: 'mac',
    width: 0.3325, // 2880 px @ 220 ppi
    height: 0.2078, // 1800 px
    cameraOffsetY: 0.006,
    defaultCss: [1680, 1050],
    cssSizes: [[1024, 640], [1280, 800], [1440, 900], [1680, 1050], [1920, 1200]],
  },
  {
    name: 'MacBook Pro 14" (M1–M5)',
    kind: 'mac',
    width: 0.3024, // 3024 px @ 254 ppi
    height: 0.1964, // 1964 px
    cameraOffsetY: -0.004,
    defaultCss: [1512, 982],
    cssSizes: [[1147, 745], [1352, 878], [1512, 982], [1800, 1169]],
  },
  {
    name: 'MacBook Pro 16" (M1–M5)',
    kind: 'mac',
    width: 0.3456, // 3456 px @ 254 ppi
    height: 0.2234, // 2234 px
    cameraOffsetY: -0.004,
    defaultCss: [1728, 1117],
    cssSizes: [[1312, 848], [1496, 967], [1728, 1117], [2056, 1329]],
  },
  {
    name: 'iPad Air 11" (M2/M3), landscape',
    kind: 'ipad',
    width: 0.2271, // 2360 px @ 264 ppi
    height: 0.1578, // 1640 px
    // Front camera sits centred in the bezel of the long edge (landscape top).
    cameraOffsetY: 0.005,
    defaultCss: [1180, 820],
    cssSizes: [[1180, 820]],
    note: 'Landscape, camera at the top',
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
  if (typeof navigator === 'undefined') return false;
  // iPadOS Safari pretends to be a Mac; touch support gives it away.
  return /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac/.test(navigator.platform) && navigator.maxTouchPoints <= 1;
}

/**
 * Best guess of the device from what the browser exposes. The exact model is
 * not available to web pages, so this matches the CSS screen size against
 * the known scaling options of each device.
 */
export function detectDevice(): DetectionResult | null {
  if (typeof screen === 'undefined' || devicePixelRatio < 2) return null; // all presets are Retina panels
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

/**
 * Display geometry from a diagonal, for screens without a preset. The aspect
 * ratio defaults to the one the browser reports for the screen.
 */
export function displayFromDiagonal(
  diagonalInches: number,
  cameraOffsetY = 0.01,
  aspect = typeof screen !== 'undefined' ? screen.width / screen.height : 16 / 9,
): DisplayGeometry {
  const height = (diagonalInches * 0.0254) / Math.sqrt(1 + aspect * aspect);
  return { width: height * aspect, height, cameraOffsetY };
}
