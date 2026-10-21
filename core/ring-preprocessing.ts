import type { Region } from "./ring-tracking.ts";

// A bounded separable filter uses only illuminated pixels. Clamping to the ROI
// prevents the dark bezel from becoming a false fringe after smoothing.
export function smoothRingRegion(
  gray: Float32Array,
  w: number,
  h: number,
  roi: Region,
  radius: number,
  guide?: { x?: number; y?: number },
): Float32Array {
  const source = gray.slice(),
    x0 = Math.max(0, Math.ceil(roi.x0)),
    x1 = Math.min(w - 1, Math.floor(roi.x1)),
    y0 = Math.max(0, Math.ceil(roi.y0)),
    y1 = Math.min(h - 1, Math.floor(roi.y1));
  if (guide?.x !== undefined) {
    const left = Math.max(x0, Math.floor(guide.x) - 7),
      right = Math.min(x1, Math.ceil(guide.x) + 7);
    for (let y = y0; y <= y1; y++)
      for (let x = left + 1; x < right; x++)
        source[y * w + x] =
          source[y * w + left] +
          ((source[y * w + right] - source[y * w + left]) * (x - left)) / (right - left);
  }
  if (guide?.y !== undefined) {
    const top = Math.max(y0, Math.floor(guide.y) - 7),
      bottom = Math.min(y1, Math.ceil(guide.y) + 7);
    for (let x = x0; x <= x1; x++)
      for (let y = top + 1; y < bottom; y++)
        source[y * w + x] =
          source[top * w + x] +
          ((source[bottom * w + x] - source[top * w + x]) * (y - top)) / (bottom - top);
  }
  let current = source;
  const r = Math.max(1, Math.min(12, Math.round(radius)));
  for (let pass = 0; pass < 2; pass++) {
    const horizontal = current.slice(),
      result = current.slice();
    for (let y = y0; y <= y1; y++) {
      const sums = new Float64Array(x1 - x0 + 2);
      for (let x = x0; x <= x1; x++) sums[x - x0 + 1] = sums[x - x0] + current[y * w + x];
      for (let x = x0; x <= x1; x++) {
        const left = Math.max(x0, x - r),
          right = Math.min(x1, x + r);
        horizontal[y * w + x] = (sums[right - x0 + 1] - sums[left - x0]) / (right - left + 1);
      }
    }
    for (let x = x0; x <= x1; x++) {
      const sums = new Float64Array(y1 - y0 + 2);
      for (let y = y0; y <= y1; y++) sums[y - y0 + 1] = sums[y - y0] + horizontal[y * w + x];
      for (let y = y0; y <= y1; y++) {
        const top = Math.max(y0, y - r),
          bottom = Math.min(y1, y + r);
        result[y * w + x] = (sums[bottom - y0 + 1] - sums[top - y0]) / (bottom - top + 1);
      }
    }
    current = result;
  }
  return current;
}
