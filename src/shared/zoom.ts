/**
 * Pure zoom math shared by the webview renderers (media/map.js mirrors this).
 * Kept DOM-free so it is unit-testable under node:test.
 */

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 8;
export const FIT_MAX_ZOOM = 1.5;
export const BUTTON_ZOOM_FACTOR = 1.2;
export const WHEEL_ZOOM_FACTOR = 1.1;

export interface PanZoom {
  x: number;
  y: number;
  k: number;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Clamp a zoom level to the usable [MIN_ZOOM, MAX_ZOOM] range. */
export function clampZoom(k: unknown): number {
  const v = num(k, 1);
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v));
}

/** One incremental zoom step (buttons, keyboard, wheel). */
export function stepZoom(current: unknown, factor: unknown): number {
  const k = num(current, 1);
  const f = num(factor, 1);
  if (f <= 0) {
    return clampZoom(k);
  }
  return clampZoom(k * f);
}

/**
 * Zoom anchored at viewport point (cx, cy) so the content under the
 * cursor stays under the cursor. Falls back to plain stepZoom when
 * the anchor is not finite.
 */
export function zoomAt(t: PanZoom, factor: unknown, cx: unknown, cy: unknown): PanZoom {
  const oldK = clampZoom(t.k);
  const nextK = stepZoom(oldK, factor);
  if (typeof cx !== "number" || typeof cy !== "number" || !Number.isFinite(cx) || !Number.isFinite(cy)) {
    return { x: num(t.x, 0), y: num(t.y, 0), k: nextK };
  }
  if (oldK === 0 || nextK === oldK) {
    return { x: num(t.x, 0), y: num(t.y, 0), k: nextK };
  }
  const ratio = nextK / oldK;
  return {
    x: num(cx, 0) - (num(cx, 0) - num(t.x, 0)) * ratio,
    y: num(cy, 0) - (num(cy, 0) - num(t.y, 0)) * ratio,
    k: nextK
  };
}

/** CSS/SVG transform string for a pan/zoom state. */
export function transformString(t: PanZoom): string {
  return `translate(${num(t.x, 0)},${num(t.y, 0)}) scale(${clampZoom(t.k)})`;
}

/**
 * Fit-to-view zoom for a content box inside a viewport (with padding).
 * Mirrors fitToView() in media/map.js.
 */
export function fitZoom(
  viewW: unknown,
  viewH: unknown,
  contentW: unknown,
  contentH: unknown,
  padding = 40
): number {
  const vw = num(viewW, 0);
  const vh = num(viewH, 0);
  const cw = num(contentW, 0);
  const ch = num(contentH, 0);
  if (vw <= 0 || vh <= 0 || cw <= 0 || ch <= 0) {
    return 0.5;
  }
  const k = Math.min((vw - padding) / cw, (vh - padding) / ch, FIT_MAX_ZOOM);
  if (!Number.isFinite(k)) {
    return 0.5;
  }
  return Math.max(MIN_ZOOM, k);
}
