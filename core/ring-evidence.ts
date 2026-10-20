import { bilinear } from "./ring-tracking.ts";
import type { Region } from "./ring-tracking.ts";
import type { Ellipse } from "./ellipse.ts";

export const MIN_DARK_BAND_SUPPORT = 0.72;

export type RingEvidence = {
  fraction: number;
  contrast: number;
  visibleSamples: number;
  supportedSamples: number;
};
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};
// Verify fresh, uniformly spaced locations on the ellipse, not just the points
// selected by RANSAC. Both flanks must be brighter in the original analysis view.
export function measureRingEvidence(
  gray: Float32Array,
  w: number,
  h: number,
  roi: Region,
  fit: Ellipse,
  guide?: { x?: number; y?: number },
  contrastFloor = 3,
  sampleCount = 120,
): RingEvidence {
  const phi = (fit.angle * Math.PI) / 180,
    c = Math.cos(phi),
    s = Math.sin(phi),
    span = Math.max(3, Math.min(12, fit.semiMinor * 0.05));
  let best: RingEvidence = {
    fraction: 0,
    contrast: 0,
    visibleSamples: 0,
    supportedSamples: 0,
  };
  for (const band of [
    ...new Set(
      [0.025, 0.05, 0.1, 0.16].map((k) =>
        Math.max(3, Math.min(48, fit.semiMinor * k)),
      ),
    ),
  ]) {
    const contrasts: number[] = [];
    for (let i = 0; i < sampleCount; i++) {
      const theta = (2 * Math.PI * (i + 0.37)) / sampleCount,
        ct = Math.cos(theta),
        st = Math.sin(theta);
      const x = fit.centerX + fit.semiMajor * ct * c - fit.semiMinor * st * s,
        y = fit.centerY + fit.semiMajor * ct * s + fit.semiMinor * st * c;
      if (
        (guide?.x !== undefined && Math.abs(x - guide.x) < 8) ||
        (guide?.y !== undefined && Math.abs(y - guide.y) < 8)
      )
        continue;
      const gx = (ct * c) / fit.semiMajor - (st * s) / fit.semiMinor,
        gy = (ct * s) / fit.semiMajor + (st * c) / fit.semiMinor,
        n = Math.hypot(gx, gy),
        nx = gx / n,
        ny = gy / n;
      const sample = (offset: number) => {
        const values: number[] = [];
        for (const t of [-span, -span / 2, 0, span / 2, span]) {
          const px = x + nx * offset - ny * t,
            py = y + ny * offset + nx * t;
          if (
            px < roi.x0 + 1 ||
            px > roi.x1 - 1 ||
            py < roi.y0 + 1 ||
            py > roi.y1 - 1
          )
            continue;
          const value = bilinear(gray, w, h, px, py);
          if (Number.isFinite(value)) values.push(value);
        }
        return values.length >= 3 ? median(values) : NaN;
      };
      const middle = sample(0),
        left = sample(-band),
        right = sample(band);
      if (![middle, left, right].every(Number.isFinite)) continue;
      contrasts.push(Math.min(left, right) - middle);
    }
    const supported = contrasts.filter((v) => v >= contrastFloor),
      fraction = supported.length / Math.max(1, contrasts.length);
    if (
      contrasts.length >= Math.ceil(sampleCount * 0.2) &&
      supported.length >= Math.ceil(sampleCount / 6) &&
      (fraction > best.fraction ||
        (fraction === best.fraction && median(supported) > best.contrast))
    )
      best = {
        fraction,
        contrast: median(supported),
        visibleSamples: contrasts.length,
        supportedSamples: supported.length,
      };
  }
  return best;
}
