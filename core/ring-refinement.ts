import { darkCandidates, fitRingEllipse } from "./ring-tracking.ts";
import type { Region, RingPoint } from "./ring-tracking.ts";
import type { Ellipse, EllipseResult } from "./ellipse.ts";

// Retrace around the recovered center, so an initially biased circle/ellipse
// does not permanently anchor wide-trough minima at the wrong radius.
export function refineRingBand(
  gray: Float32Array,
  w: number,
  h: number,
  roi: Region,
  initial: Ellipse,
  guide?: { x?: number; y?: number },
) {
  let fit = initial,
    result: EllipseResult | null = null,
    points: RingPoint[] = [];
  for (let pass = 0; pass < 3; pass++) {
    const next: RingPoint[] = [];
    for (let i = 0; i < 180; i++) {
      const theta = (2 * Math.PI * (i + 0.31)) / 180,
        c = Math.cos(theta),
        s = Math.sin(theta),
        phi = theta - (fit.angle * Math.PI) / 180;
      const expected = 1 / Math.hypot(Math.cos(phi) / fit.semiMajor, Math.sin(phi) / fit.semiMinor);
      const edge = Math.min(
        (c > 0 ? roi.x1 - fit.centerX : roi.x0 - fit.centerX) / c,
        (s > 0 ? roi.y1 - fit.centerY : roi.y0 - fit.centerY) / s,
      );
      const band = Math.max(8, Math.min(24, fit.semiMinor * 0.12));
      const candidates = darkCandidates(
        gray,
        w,
        h,
        { x: fit.centerX, y: fit.centerY },
        theta,
        Math.max(3, expected - band),
        Math.min(edge - 2, expected + band),
        2.5,
      ).filter(
        (p) =>
          (guide?.x === undefined || Math.abs(p.x - guide.x) > 7) &&
          (guide?.y === undefined || Math.abs(p.y - guide.y) > 7),
      );
      if (!candidates.length) continue;
      const best = candidates.reduce((a, b) =>
        a.magnitude - Math.abs(a.radius - expected) > b.magnitude - Math.abs(b.radius - expected)
          ? a
          : b,
      );
      next.push(best);
    }
    if (next.length < (pass === 0 ? 36 : 54)) break;
    const measured = fitRingEllipse(next, w, h);
    if (
      !measured ||
      measured.coverage < 0.6 ||
      Math.abs(measured.fit.semiMajor / initial.semiMajor - 1) > 0.15 ||
      Math.hypot(measured.fit.centerX - initial.centerX, measured.fit.centerY - initial.centerY) >
        Math.min(roi.x1 - roi.x0, roi.y1 - roi.y0) * 0.1
    )
      break;
    fit = measured.fit;
    result = measured;
    points = next;
  }
  return result ? { ...result, points } : null;
}
