import { ellipseResidual } from "./ellipse.ts";
import type { Ellipse } from "./ellipse.ts";
import { bilinear, angularSupport, fitRingEllipse } from "./ring-tracking.ts";
import type { Region, RingPoint } from "./ring-tracking.ts";
const median = (a: number[]) => {
  const s = [...a].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : Infinity;
};
export type FitValidation = {
  method: string;
  testedPoints: number;
  heldOutRms: number;
  beforeHeldOutRms: number;
  ratioRange: [number, number];
  centerSpreadPx: number;
  adopted: boolean;
};
// Locate observed trough centers along the ellipse NORMAL, rather than a ray
// from a possibly biased center. Tangential medians suppress isolated dirt.
export function refineSubpixelRing(
  gray: Float32Array,
  w: number,
  h: number,
  roi: Region,
  initial: Ellipse,
  guide?: { x?: number; y?: number },
) {
  const phi = (initial.angle * Math.PI) / 180,
    c = Math.cos(phi),
    s = Math.sin(phi),
    points: RingPoint[] = [];
  const band = Math.max(8, Math.min(24, initial.semiMinor * 0.12)),
    step = 0.5;
  for (let i = 0; i < 240; i++) {
    const t = (2 * Math.PI * (i + 0.17)) / 240,
      ct = Math.cos(t),
      st = Math.sin(t);
    const x = initial.centerX + initial.semiMajor * ct * c - initial.semiMinor * st * s,
      y = initial.centerY + initial.semiMajor * ct * s + initial.semiMinor * st * c;
    if (
      (guide?.x !== undefined && Math.abs(x - guide.x) < 9) ||
      (guide?.y !== undefined && Math.abs(y - guide.y) < 9)
    )
      continue;
    const gx = (ct * c) / initial.semiMajor - (st * s) / initial.semiMinor,
      gy = (ct * s) / initial.semiMajor + (st * c) / initial.semiMinor,
      n = Math.hypot(gx, gy),
      nx = gx / n,
      ny = gy / n;
    const values: number[] = [],
      offsets: number[] = [];
    for (let d = -band; d <= band; d += step) {
      const samples = [-4, -2, 0, 2, 4]
        .map((a) => {
          const px = x + nx * d - ny * a,
            py = y + ny * d + nx * a;
          return px > roi.x0 + 1 && px < roi.x1 - 1 && py > roi.y0 + 1 && py < roi.y1 - 1
            ? bilinear(gray, w, h, px, py)
            : NaN;
        })
        .filter(Number.isFinite);
      values.push(samples.length >= 3 ? median(samples) : NaN);
      offsets.push(d);
    }
    if (values.some((v) => !Number.isFinite(v))) continue;
    const slope = (values.at(-1)! - values[0]) / (offsets.at(-1)! - offsets[0]);
    const flattened = values.map((v, j) => v - slope * offsets[j]);
    let k = 1;
    for (let j = 2; j < values.length - 1; j++) if (flattened[j] < flattened[k]) k = j;
    const contrast = Math.min(flattened[0], flattened.at(-1)!) - flattened[k];
    const curvature = flattened[k - 1] - 2 * flattened[k] + flattened[k + 1];
    if (k < 2 || k > values.length - 3 || contrast < 1.5 || curvature <= 1e-5) continue;
    const d =
      offsets[k] +
      step *
        Math.max(-0.5, Math.min(0.5, (0.5 * (flattened[k - 1] - flattened[k + 1])) / curvature));
    points.push({
      x: x + nx * d,
      y: y + ny * d,
      radius: Math.hypot(x + nx * d - initial.centerX, y + ny * d - initial.centerY),
      magnitude: contrast,
      maxRadius: Math.max(w, h),
    });
  }
  if (points.length < 90 || angularSupport(points, initial) < 0.5) return null;
  const fit = fitRingEllipse(points, w, h);
  if (!fit) return null;
  const sector = (p: RingPoint) =>
    Math.floor(
      (((Math.atan2(p.y - initial.centerY, p.x - initial.centerX) + 2 * Math.PI) % (2 * Math.PI)) /
        (2 * Math.PI)) *
        12,
    );
  const models = [],
    held: number[] = [],
    before: number[] = [];
  for (let fold = 0; fold < 3; fold++) {
    const train = points.filter((p) => sector(p) % 3 !== fold),
      test = points.filter((p) => sector(p) % 3 === fold),
      m = fitRingEllipse(train, w, h);
    if (!m || test.length < 15) return null;
    models.push(m.fit);
    for (const p of test) {
      held.push(ellipseResidual(p, m.fit));
      before.push(ellipseResidual(p, initial));
    }
  }
  const rms = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
  const heldOutRms = rms(held),
    beforeHeldOutRms = rms(before);
  const ratioRange: [number, number] = [
    Math.min(...models.map((m) => m.ratio)),
    Math.max(...models.map((m) => m.ratio)),
  ];
  const centerSpreadPx = Math.max(
    ...models.map((m) => Math.hypot(m.centerX - fit.fit.centerX, m.centerY - fit.fit.centerY)),
  );
  const adopted =
    heldOutRms <= beforeHeldOutRms * 0.98 &&
    ratioRange[1] - ratioRange[0] < 0.035 &&
    centerSpreadPx < 4 &&
    Math.abs(fit.fit.ratio - initial.ratio) < 0.035 &&
    Math.hypot(fit.fit.centerX - initial.centerX, fit.fit.centerY - initial.centerY) < 4;
  const validation: FitValidation = {
    method: "法向亚像素暗纹中心 + 12 分区三折留出",
    testedPoints: held.length,
    heldOutRms,
    beforeHeldOutRms,
    ratioRange,
    centerSpreadPx,
    adopted,
  };
  return { ...fit, points, validation };
}
