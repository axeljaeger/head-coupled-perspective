import type { DisplayGeometry, ScreenRect } from './types.ts';

export interface BrowserViewportOptions {
  /**
   * Take the window position on screen into account, so the virtual window
   * stays aligned when the browser is not fullscreen. Browser chrome is
   * assumed to sit above the content area. Default true.
   */
  compensateWindowPosition?: boolean;
}

/**
 * Physical size of the browser viewport and its centre relative to the
 * screen centre, in screen space. Assumes the page fills the window and the
 * display is the screen the browser reports.
 */
export function browserViewport(display: DisplayGeometry, options: BrowserViewportOptions = {}): ScreenRect {
  const pxToM = display.width / screen.width;
  const width = innerWidth * pxToM;
  const height = innerHeight * pxToM;
  let cx = 0;
  let cy = 0;
  if (options.compensateWindowPosition ?? true) {
    const leftPx = screenX + (outerWidth - innerWidth) / 2;
    const topPx = screenY + (outerHeight - innerHeight);
    cx = (leftPx + innerWidth / 2 - screen.width / 2) * pxToM;
    cy = -(topPx + innerHeight / 2 - screen.height / 2) * pxToM;
  }
  return { cx, cy, width, height };
}

/** The whole display as a rectangle, e.g. for fullscreen or non-browser use. */
export function displayRect(display: DisplayGeometry): ScreenRect {
  return { cx: 0, cy: 0, width: display.width, height: display.height };
}
