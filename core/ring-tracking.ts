import { fitRobustEllipse } from "./ellipse.ts";
import type { Point, Ellipse } from "./ellipse.ts";
export type RingPoint = Point & {
  radius: number;
  magnitude: number;
  maxRadius: number;
  observed?: boolean;
};
export type Region = { x0: number; x1: number; y0: number; y1: number };
export function bilinear(
  data: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return NaN;
  const ix = Math.floor(x),
    iy = Math.floor(y),
    jx = Math.min(ix + 1, width - 1),
    jy = Math.min(iy + 1, height - 1),
    fx = x - ix,
    fy = y - iy;
  return (
    (data[iy * width + ix] * (1 - fx) + data[iy * width + jx] * fx) * (1 - fy) +
    (data[jy * width + ix] * (1 - fx) + data[jy * width + jx] * fx) * fy
  );
}
const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
function profileSample(
  gray: Float32Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  c: number,
  s: number,
  r: number,
): number {
  const samples = [-3, -1.5, 0, 1.5, 3]
    .map((t) => bilinear(gray, w, h, cx + c * r - s * t, cy + s * r + c * t))
    .filter(Number.isFinite);
  return samples.length >= 3 ? median(samples) : NaN;
}
export function darkCandidates(
  gray: Float32Array,
  w: number,
  h: number,
  center: Point,
  theta: number,
  minRadius: number,
  maxRadius: number,
  contrastFloor = 2,
): RingPoint[] {
  const c = Math.cos(theta),
    s = Math.sin(theta),
    profile: number[] = [];
  for (let r = minRadius; r <= maxRadius; r++)
    profile.push(profileSample(gray, w, h, center.x, center.y, c, s, r));
  const candidates: RingPoint[] = [];
  for (let i = 2; i < profile.length - 2; i++) {
    if (!(profile[i] < profile[i - 1] && profile[i] <= profile[i + 1]))
      continue;
    const window = Math.max(
      4,
      Math.min(16, Math.round((minRadius + i) * 0.05)),
    );
    const left = Math.max(...profile.slice(Math.max(0, i - window), i)),
      right = Math.max(
        ...profile.slice(i + 1, Math.min(profile.length, i + window + 1)),
      );
    const contrast = Math.min(left, right) - profile[i];
    if (contrast < contrastFloor) continue;
    const denominator = profile[i - 1] - 2 * profile[i] + profile[i + 1];
    const offset =
      denominator > 1e-8
        ? Math.max(
            -0.5,
            Math.min(
              0.5,
              (0.5 * (profile[i - 1] - profile[i + 1])) / denominator,
            ),
          )
        : 0;
    const radius = minRadius + i + offset;
    candidates.push({
      x: center.x + c * radius,
      y: center.y + s * radius,
      radius,
      magnitude: 4 * contrast,
      maxRadius,
      observed: true,
    });
  }
  return candidates;
}
export function traceDarkRing(
  gray: Float32Array,
  w: number,
  h: number,
  roi: Region,
  center: Point,
  gradientScale: number,
  target?: Point,
  prediction?: Ellipse,
  guide?: { x?: number; y?: number },
): RingPoint[] | null {
  const count = 240,
    size = Math.min(roi.x1 - roi.x0, roi.y1 - roi.y0),
    minimum = Math.max(6, size * 0.035);
  const offset = target
    ? Math.atan2(target.y - center.y, target.x - center.x)
    : 0;
  const rays: RingPoint[][] = [];
  for (let i = 0; i < count; i++) {
    const theta = offset + (2 * Math.PI * i) / count,
      c = Math.cos(theta),
      s = Math.sin(theta);
    // A ray running along a crosshair has no reliable ring identity. Mask the
    // direction itself, otherwise another ring can replace the occluded one.
    if (
      (guide?.x !== undefined &&
        Math.abs(center.x - guide.x) < Math.max(12, size * 0.03) &&
        Math.abs(c) < 0.12) ||
      (guide?.y !== undefined &&
        Math.abs(center.y - guide.y) < Math.max(12, size * 0.03) &&
        Math.abs(s) < 0.12)
    ) {
      if (target && i === 0) return null;
      rays.push([]);
      continue;
    }
    const hitX =
      Math.abs(c) < 1e-8
        ? Infinity
        : (c > 0 ? roi.x1 - center.x : roi.x0 - center.x) / c;
    const hitY =
      Math.abs(s) < 1e-8
        ? Infinity
        : (s > 0 ? roi.y1 - center.y : roi.y0 - center.y) / s;
    const maximum = Math.min(hitX, hitY) * 0.96;
    if (maximum < minimum + 8) {
      rays.push([]);
      continue;
    }
    const all = darkCandidates(
      gray,
      w,
      h,
      center,
      theta,
      minimum,
      maximum,
      Math.max(1.5, gradientScale * 0.025),
    ).filter(
      (p) =>
        (guide?.x === undefined || Math.abs(p.x - guide.x) > 6) &&
        (guide?.y === undefined || Math.abs(p.y - guide.y) > 6),
    );
    let selected: RingPoint[] = [];
    for (const candidate of [...all].sort(
      (a, b) => b.magnitude - a.magnitude,
    )) {
      if (selected.every((p) => Math.abs(p.radius - candidate.radius) > 3))
        selected.push(candidate);
      if (selected.length >= 8) break;
    }
    if (prediction) {
      const angle = theta - (prediction.angle * Math.PI) / 180;
      const expected =
        1 /
        Math.hypot(
          Math.cos(angle) / prediction.semiMajor,
          Math.sin(angle) / prediction.semiMinor,
        );
      const nearby = all.filter(
        (p) => Math.abs(p.radius - expected) < Math.max(4, size * 0.025),
      );
      if (nearby.length)
        selected = [
          ...nearby
            .sort(
              (a, b) =>
                Math.abs(a.radius - expected) - Math.abs(b.radius - expected),
            )
            .slice(0, 3),
        ];
    }
    if (target && i === 0 && all.length) {
      const radius = Math.hypot(target.x - center.x, target.y - center.y);
      const nearest = all.reduce((best, p) =>
        Math.abs(p.radius - radius) < Math.abs(best.radius - radius) ? p : best,
      );
      if (Math.abs(nearest.radius - radius) > Math.max(7, size * 0.025))
        return null;
      selected = [nearest];
    }
    rays.push(selected.sort((a, b) => a.radius - b.radius));
  }
  const missing = rays.filter((ray) => !ray.length).length;
  if (missing > count * 0.22) return null;
  // Missing directions carry no image evidence. Interpolated candidates only
  // bridge the path; they are never passed to the geometric fit as observations.
  const observed = rays.map((ray) => [...ray]);
  for (let i = 0; i < count; i++)
    if (!rays[i].length) {
      let before = i,
        after = i;
      for (let step = 1; step < count; step++) {
        if (observed[(i - step + count) % count].length) {
          before = (i - step + count) % count;
          break;
        }
      }
      for (let step = 1; step < count; step++) {
        if (observed[(i + step) % count].length) {
          after = (i + step) % count;
          break;
        }
      }
      const theta = offset + (2 * Math.PI * i) / count;
      const radii = [...observed[before], ...observed[after]]
        .map((p) => p.radius)
        .sort((a, b) => a - b);
      rays[i] = radii
        .filter((r, index) => !index || r - radii[index - 1] > 2)
        .slice(0, 10)
        .map((radius) => ({
          x: center.x + Math.cos(theta) * radius,
          y: center.y + Math.sin(theta) * radius,
          radius,
          magnitude: 0,
          maxRadius: size,
          observed: false,
        }));
    }
  if (!rays[0].length) return null;
  const jump = Math.max(1.5, size * 0.006),
    strength = (p: RingPoint) =>
      3 * Math.log1p(Math.min(5, p.magnitude / Math.max(1, gradientScale)));
  let bestScore = -Infinity,
    best: RingPoint[] = [];
  for (let start = 0; start < rays[0].length; start++) {
    let scores = rays[0].map((p, j) => (j === start ? strength(p) : -Infinity));
    const pointers: number[][] = [rays[0].map(() => -1)];
    for (let i = 1; i < count; i++) {
      const next = rays[i].map(() => -Infinity),
        back = rays[i].map(() => -1);
      for (let j = 0; j < rays[i].length; j++)
        for (let k = 0; k < rays[i - 1].length; k++) {
          const step = (rays[i][j].radius - rays[i - 1][k].radius) / jump;
          const score = scores[k] + strength(rays[i][j]) - 1.8 * step * step;
          if (score > next[j]) {
            next[j] = score;
            back[j] = k;
          }
        }
      scores = next;
      pointers.push(back);
    }
    const ends = scores
      .map((score, end) => ({
        end,
        score:
          score -
          2 * ((rays.at(-1)![end].radius - rays[0][start].radius) / jump) ** 2,
      }))
      .sort((a, b) => b.score - a.score);
    for (const { end } of ends.slice(0, 1)) {
      let cursor = end;
      const path: RingPoint[] = Array(count);
      for (let i = count - 1; i >= 0; i--) {
        if (cursor < 0) break;
        path[i] = rays[i][cursor];
        cursor = pointers[i][cursor];
      }
      if (path.filter(Boolean).length !== count) continue;
      const evidence = path.filter((p) => p.observed),
        result = fitRobustEllipse(evidence, w, h);
      if (
        !result ||
        result.fit.ratio < 0.15 ||
        result.coverage < 0.65 ||
        result.inliers.length < evidence.length * 0.8
      )
        continue;
      const residual = result.rms;
      if (residual > Math.max(2, result.fit.semiMinor * 0.02)) continue;
      const closure = (path.at(-1)!.radius - path[0].radius) / jump;
      const score =
        (scores[end] - 2 * closure * closure) / count - 0.35 * residual;
      if (score > bestScore) {
        bestScore = score;
        best = evidence;
      }
    }
  }
  return best.length >= count * 0.6 ? best : null;
}
