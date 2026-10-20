import { MIN_DARK_BAND_SUPPORT, measureRingEvidence } from "./ring-evidence.ts";
import { refineRingBand } from "./ring-refinement.ts";
import { angularSupport } from "./ring-tracking.ts";
import type { Region } from "./ring-tracking.ts";
import type { Ellipse, Point } from "./ellipse.ts";
import type { AutoRing } from "./auto-rings.ts";
import { assessFit } from "./fit-quality.ts";

// Fallback seeds score a distributed dark band directly. They do not require
// a dark central spot or assume that the crosshair is the fringe center.
export function searchPhotometricRing(
  view: Float32Array,
  evidence: Float32Array,
  w: number,
  h: number,
  roi: Region,
  center: Point,
  gradientScale: number,
  guide?: { x?: number; y?: number },
): AutoRing[] {
  const size = Math.min(roi.x1 - roi.x0, roi.y1 - roi.y0),
    long = Math.max(roi.x1 - roi.x0, roi.y1 - roi.y0);
  const seeds: Array<{ fit: Ellipse; score: number }> = [];
  for (const dx of [-0.16, -0.08, 0, 0.08, 0.16])
    for (const dy of [-0.08, 0, 0.08])
      for (const scale of Array.from({ length: 23 }, (_, i) => 0.2 + i * 0.02))
        for (const ratio of [0.6, 0.75, 0.85, 0.95, 1])
          for (const angle of ratio === 1 ? [0] : [0, 45, 90, 135]) {
            const fit: Ellipse = {
              centerX: center.x + dx * size,
              centerY: center.y + dy * size,
              semiMajor: long * scale,
              semiMinor: long * scale * ratio,
              ratio,
              angle,
            };
            const signal = measureRingEvidence(
              view,
              w,
              h,
              roi,
              fit,
              guide,
              Math.max(3, gradientScale * 0.1),
              48,
            );
            if (signal.fraction < 0.45) continue;
            seeds.push({ fit, score: signal.fraction ** 2 * signal.contrast });
          }
  const chosen: typeof seeds = [];
  const radiusCounts = new Map<string, number>();
  for (const seed of seeds.sort((a, b) => b.score - a.score)) {
    const bin =
      String(Math.floor(seed.fit.semiMajor / (size * 0.12))) +
      ":" +
      String(Math.round(seed.fit.ratio * 10));
    if ((radiusCounts.get(bin) ?? 0) >= 2) continue;
    if (
      chosen.some(
        (s) =>
          Math.hypot(
            s.fit.centerX - seed.fit.centerX,
            s.fit.centerY - seed.fit.centerY,
          ) <
            size * 0.06 &&
          Math.abs(s.fit.semiMajor - seed.fit.semiMajor) < size * 0.06 &&
          Math.abs(s.fit.semiMinor - seed.fit.semiMinor) < size * 0.06 &&
          Math.abs(s.fit.ratio - seed.fit.ratio) < 0.03 &&
          (seed.fit.ratio > 0.98 ||
            Math.abs(
              Math.sin(((s.fit.angle - seed.fit.angle) * Math.PI) / 180),
            ) < 0.26),
      )
    )
      continue;
    chosen.push(seed);
    radiusCounts.set(bin, (radiusCounts.get(bin) ?? 0) + 1);
    if (chosen.length >= 12) break;
  }
  const rings: AutoRing[] = [];
  for (const seed of chosen) {
    const fitted = refineRingBand(view, w, h, roi, seed.fit, guide);
    if (!fitted) continue;
    const signal = measureRingEvidence(
      evidence,
      w,
      h,
      roi,
      fitted.fit,
      guide,
      Math.max(3, gradientScale * 0.1),
    );
    if (signal.fraction < MIN_DARK_BAND_SUPPORT) continue;
    const observed = angularSupport(
      fitted.inliers.map((i) => fitted.points[i]),
      fitted.fit,
    );
    const contrast = Math.min(
      1,
      fitted.points.reduce((sum, p) => sum + p.magnitude, 0) /
        fitted.points.length /
        Math.max(16, gradientScale * 1.5),
    );
    const assessment = assessFit({
      rms: fitted.rms,
      semiMinor: fitted.fit.semiMinor,
      minDimension: Math.min(w, h),
      coverage: fitted.coverage,
      observedFraction: observed,
      inlierFraction: fitted.inliers.length / fitted.points.length,
      contrast,
      imageEvidence: signal,
    });
    if (assessment.status === "unreliable") continue;
    const duplicate = rings.findIndex(
      (r) =>
        Math.abs(r.fit.semiMajor - fitted.fit.semiMajor) < size * 0.04 &&
        Math.hypot(
          r.fit.centerX - fitted.fit.centerX,
          r.fit.centerY - fitted.fit.centerY,
        ) <
          size * 0.04,
    );
    const candidate = {
      ...fitted,
      score: assessment.quality * signal.fraction ** 2,
      usable: assessment.status === "accepted",
    };
    if (duplicate < 0) rings.push(candidate);
    else if (candidate.score > rings[duplicate].score)
      rings[duplicate] = candidate;
  }
  return rings.sort(
    (a, b) => Number(b.usable) - Number(a.usable) || b.score - a.score,
  );
}
