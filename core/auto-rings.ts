import {
  angularSupport,
  darkCandidates,
  traceDarkRing,
} from "./ring-tracking.ts";
import type { Region, RingPoint } from "./ring-tracking.ts";
import { fitRobustEllipse } from "./ellipse.ts";
import type { Point, EllipseResult } from "./ellipse.ts";
import { assessFit } from "./fit-quality.ts";

export type RingSelection = {
  absoluteOrder: null;
  candidateCount: number;
  checkedRingCount: number;
  consistency: "single" | "consistent" | "inconsistent";
  ratioSpread: number;
  centerSpread: number;
  scaleFraction: number;
  centerRegionAssessed: false;
};
export type AutoRing = EllipseResult & {
  points: RingPoint[];
  score: number;
  usable: boolean;
};
export function selectAutomaticRings(
  gray: Float32Array,
  w: number,
  h: number,
  roi: Region,
  center: Point,
  gradientScale: number,
  guide?: { x?: number; y?: number },
) {
  const pool: RingPoint[][] = [];
  const size = Math.min(roi.x1 - roi.x0, roi.y1 - roi.y0);
  traceDarkRing(
    gray,
    w,
    h,
    roi,
    center,
    gradientScale,
    undefined,
    undefined,
    guide,
    pool,
  );
  function rank(): AutoRing[] {
    const rings: AutoRing[] = [];
    for (const points of pool) {
      const result = fitRobustEllipse(points, w, h);
      if (
        !result ||
        result.fit.semiMinor < size * 0.09 ||
        result.coverage < 0.6
      )
        continue;
      const duplicate = rings.findIndex(
        (r) =>
          Math.abs(r.fit.semiMajor - result.fit.semiMajor) <
            Math.max(5, result.fit.semiMajor * 0.09) &&
          Math.hypot(
            r.fit.centerX - result.fit.centerX,
            r.fit.centerY - result.fit.centerY,
          ) <
            size * 0.06,
      );
      const observed = angularSupport(
        result.inliers.map((i) => points[i]),
        result.fit,
      );
      const contrast = Math.min(
        1,
        points.reduce((sum, p) => sum + p.magnitude, 0) /
          points.length /
          Math.max(16, gradientScale * 1.5),
      );
      const assessment = assessFit({
        rms: result.rms,
        semiMinor: result.fit.semiMinor,
        minDimension: Math.min(w, h),
        coverage: result.coverage,
        observedFraction: observed,
        inlierFraction: result.inliers.length / points.length,
        contrast,
      });
      if (assessment.status === "unreliable") continue;
      const score =
        assessment.quality * Math.min(1, result.fit.semiMinor / (size * 0.15));
      const candidate = {
        ...result,
        points,
        score,
        usable: assessment.status === "accepted",
      };
      if (duplicate < 0) rings.push(candidate);
      else if (
        Number(candidate.usable) > Number(rings[duplicate].usable) ||
        (candidate.usable === rings[duplicate].usable &&
          candidate.score > rings[duplicate].score)
      )
        rings[duplicate] = candidate;
    }
    return rings.sort(
      (a, b) =>
        Number(b.usable) - Number(a.usable) ||
        b.score - a.score ||
        b.fit.semiMajor - a.fit.semiMajor,
    );
  }
  let rings = rank();
  // Machine-generated seeds search additional radial bands, including outer
  // fringes when the central dark spot is absent. These are not user clicks.
  if (rings.length < 2 || !rings[0]?.usable) {
    const seeds: RingPoint[] = [];
    for (const angle of [
      Math.PI / 4,
      (3 * Math.PI) / 4,
      (5 * Math.PI) / 4,
      (7 * Math.PI) / 4,
    ]) {
      const c = Math.cos(angle),
        s = Math.sin(angle);
      const edge =
        Math.min(
          (c > 0 ? roi.x1 - center.x : roi.x0 - center.x) / c,
          (s > 0 ? roi.y1 - center.y : roi.y0 - center.y) / s,
        ) * 0.96;
      seeds.push(
        ...darkCandidates(
          gray,
          w,
          h,
          center,
          angle,
          size * 0.1,
          edge,
          Math.max(2, gradientScale * 0.04),
        ).filter(
          (p) =>
            (guide?.x === undefined || Math.abs(p.x - guide.x) > 6) &&
            (guide?.y === undefined || Math.abs(p.y - guide.y) > 6),
        ),
      );
    }
    const tried: number[] = [];
    for (const seed of seeds.sort((a, b) => b.magnitude - a.magnitude)) {
      if (tried.some((r) => Math.abs(r - seed.radius) < size * 0.08)) continue;
      if (
        rings.some(
          (r) =>
            Math.abs(
              Math.hypot(seed.x - r.fit.centerX, seed.y - r.fit.centerY) -
                r.fit.semiMajor,
            ) < 4 && r.fit.ratio > 0.98,
        )
      )
        continue;
      tried.push(seed.radius);
      traceDarkRing(
        gray,
        w,
        h,
        roi,
        center,
        gradientScale,
        seed,
        undefined,
        guide,
        pool,
      );
      if (tried.length >= 3) break;
    }
    rings = rank();
  }
  if (!rings.length) return null;
  const selected = rings[0],
    checked = rings.filter((r) => r.usable && r.score >= 0.6);
  const ratios = checked.map((r) => r.fit.ratio);
  const ratioSpread =
    ratios.length > 1 ? Math.max(...ratios) - Math.min(...ratios) : 0;
  const centerSpread = checked.reduce(
    (max, r) =>
      Math.max(
        max,
        Math.hypot(
          r.fit.centerX - selected.fit.centerX,
          r.fit.centerY - selected.fit.centerY,
        ) / size,
      ),
    0,
  );
  const selection: RingSelection = {
    absoluteOrder: null,
    candidateCount: rings.length,
    checkedRingCount: checked.length,
    consistency:
      checked.length < 2
        ? "single"
        : ratioSpread > 0.025 || centerSpread > 0.035
          ? "inconsistent"
          : "consistent",
    ratioSpread,
    centerSpread,
    scaleFraction:
      Math.sqrt(selected.fit.semiMajor * selected.fit.semiMinor) / size,
    centerRegionAssessed: false,
  };
  return { selected, rings, selection };
}
