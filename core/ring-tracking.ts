import {
  fitRobustEllipse,
  initializeEllipse,
  ellipseResidual,
  ellipseCoverage,
} from "./ellipse.ts";
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
  // Remove fine screen texture along the ray at several scales. A broad dark
  // fringe can have almost no prominence in the old 4–16 px window.
  const candidates: Array<RingPoint & { scale: number }> = [];
  const smooth = (input: number[], radius: number) => {
    const sums = new Float64Array(input.length + 1),
      counts = new Uint32Array(input.length + 1);
    for (let i = 0; i < input.length; i++) {
      sums[i + 1] = sums[i] + (Number.isFinite(input[i]) ? input[i] : 0);
      counts[i + 1] = counts[i] + (Number.isFinite(input[i]) ? 1 : 0);
    }
    return input.map((_, i) => {
      const left = Math.max(0, i - radius),
        right = Math.min(input.length, i + radius + 1),
        count = counts[right] - counts[left];
      return count ? (sums[right] - sums[left]) / count : NaN;
    });
  };
  for (const scale of [0, 2, 5]) {
    const values = scale ? smooth(smooth(profile, scale), scale) : profile;
    for (let i = 2; i < values.length - 2; i++) {
      if (!(values[i] < values[i - 1] && values[i] <= values[i + 1])) continue;
      const window = Math.max(
        8,
        Math.min(80, Math.round((minRadius + i) * 0.3)),
      );
      let left = -Infinity,
        right = -Infinity;
      for (let j = Math.max(0, i - window); j < i; j++)
        if (Number.isFinite(values[j])) left = Math.max(left, values[j]);
      for (let j = i + 1; j < Math.min(values.length, i + window + 1); j++)
        if (Number.isFinite(values[j])) right = Math.max(right, values[j]);
      const contrast = Math.min(left, right) - values[i];
      if (!Number.isFinite(contrast) || contrast < contrastFloor) continue;
      const denominator = values[i - 1] - 2 * values[i] + values[i + 1];
      const offset =
        denominator > 1e-8
          ? Math.max(
              -0.5,
              Math.min(
                0.5,
                (0.5 * (values[i - 1] - values[i + 1])) / denominator,
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
        scale,
      });
    }
  }
  // Prefer a stable smoothed trough over multiple texture minima in that trough.
  const merged: RingPoint[] = [];
  for (const candidate of candidates.sort(
    (a, b) =>
      b.magnitude * (1 + b.scale * 0.08) - a.magnitude * (1 + a.scale * 0.08),
  )) {
    const separation = Math.max(4, Math.min(14, candidate.radius * 0.045));
    if (merged.every((p) => Math.abs(p.radius - candidate.radius) > separation))
      merged.push(candidate);
  }
  return merged.sort((a, b) => a.radius - b.radius);
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
  const partial = () =>
    tracePartialRing(
      rays,
      w,
      h,
      roi,
      center,
      gradientScale,
      target,
      prediction,
    );
  if (missing > count * 0.22) return partial();
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
        (target &&
          (Math.abs(ellipseResidual(target, result.fit)) >
            Math.max(7, size * 0.025) ||
            Math.abs(ellipseResidual(rays[0][0], result.fit)) >
              Math.max(2, Math.min(w, h) * 0.004))) ||
        result.coverage < 0.65 ||
        result.inliers.length < evidence.length * 0.72
      )
        continue;
      const residual = result.rms;
      if (residual > Math.max(2.5, result.fit.semiMinor * 0.025)) continue;
      const closure = (path.at(-1)!.radius - path[0].radius) / jump;
      const score =
        (scores[end] - 2 * closure * closure) / count - 0.35 * residual;
      if (score > bestScore) {
        bestScore = score;
        best = evidence;
      }
    }
  }
  return best.length >= count * 0.6
    ? best
    : tracePartialRing(
        observed,
        w,
        h,
        roi,
        center,
        gradientScale,
        target,
        prediction,
      );
}

// Recover one ellipse from visible arcs when the screen clips the ring or a
// stain removes part of it. Hypotheses are scored only against measured minima;
// neither an image boundary nor a predicted point becomes a fit observation.
function tracePartialRing(
  rays: RingPoint[][],
  w: number,
  h: number,
  roi: Region,
  center: Point,
  gradientScale: number,
  target?: Point,
  prediction?: Ellipse,
): RingPoint[] | null {
  const size = Math.min(roi.x1 - roi.x0, roi.y1 - roi.y0);
  const tolerance = Math.max(4, size * 0.025);
  const candidates = rays.flat();
  if (candidates.length < 80) return null;
  const bins = new Map<number, number>();
  for (const p of candidates) {
    const bin = Math.round(p.radius / Math.max(6, size * 0.025));
    bins.set(bin, (bins.get(bin) ?? 0) + 1);
  }
  const radii = [...bins]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([bin]) => bin * Math.max(6, size * 0.025));
  const centers = prediction
    ? []
    : [
        center,
        { x: center.x + size * 0.16, y: center.y },
        { x: center.x - size * 0.16, y: center.y },
        { x: center.x, y: center.y + size * 0.16 },
        { x: center.x, y: center.y - size * 0.16 },
        { x: center.x + size * 0.08, y: center.y + size * 0.08 },
        { x: center.x - size * 0.08, y: center.y - size * 0.08 },
        { x: center.x + size * 0.08, y: center.y - size * 0.08 },
        { x: center.x - size * 0.08, y: center.y + size * 0.08 },
        { x: center.x + size * 0.04, y: center.y },
        { x: center.x - size * 0.04, y: center.y },
        { x: center.x, y: center.y + size * 0.04 },
        { x: center.x, y: center.y - size * 0.04 },
        { x: center.x + size * 0.08, y: center.y },
        { x: center.x - size * 0.08, y: center.y },
        { x: center.x, y: center.y + size * 0.08 },
        { x: center.x, y: center.y - size * 0.08 },
      ];
  function select(fit: Ellipse, band = tolerance): RingPoint[] {
    return rays.flatMap((ray) => {
      let best: RingPoint | undefined,
        distance = Infinity;
      for (const p of ray) {
        const d = Math.abs(ellipseResidual(p, fit));
        const cost =
          d -
          band * 0.45 * Math.log1p(p.magnitude / Math.max(4, gradientScale));
        if (d < band && cost < distance) {
          best = p;
          distance = cost;
        }
      }
      return best ? [best] : [];
    });
  }
  function plausible(fit: Ellipse) {
    return (
      fit.ratio >= 0.35 &&
      fit.semiMinor >= size * 0.07 &&
      fit.semiMajor < Math.max(roi.x1 - roi.x0, roi.y1 - roi.y0) * 0.85 &&
      Math.hypot(fit.centerX - center.x, fit.centerY - center.y) <
        size * 0.27 &&
      (!target ||
        Math.abs(ellipseResidual(target, fit)) < Math.max(7, size * 0.025))
    );
  }
  const hypotheses: Array<{ fit: Ellipse; score: number }> = prediction
    ? [{ fit: prediction, score: 0 }]
    : [];
  for (const origin of centers) {
    const anchors = target
      ? [Math.hypot(target.x - origin.x, target.y - origin.y)]
      : radii;
    for (const radius of anchors)
      for (const ratio of [1, 0.9, 0.85, 0.8, 0.75, 0.7, 0.6])
        for (const angle of ratio === 1 ? [0] : [0, 45, 90, 135]) {
          const phi = target
            ? Math.atan2(target.y - origin.y, target.x - origin.x) -
              (angle * Math.PI) / 180
            : 0;
          const a = radius * Math.hypot(Math.cos(phi), Math.sin(phi) / ratio);
          let fit: Ellipse = {
            centerX: origin.x,
            centerY: origin.y,
            semiMajor: a,
            semiMinor: a * ratio,
            ratio,
            angle,
          };
          if (!plausible(fit)) continue;
          for (let pass = 0; pass < 3; pass++) {
            const selected = select(fit, tolerance * (2 - pass * 0.5));
            if (selected.length < rays.length * 0.3) break;
            const next = initializeEllipse(selected);
            if (!next || !plausible(next)) break;
            fit = next;
          }
          const selected = select(fit);
          if (
            selected.length < rays.length * 0.3 ||
            ellipseCoverage(selected, fit) < 0.6
          )
            continue;
          const score = selected.reduce(
            (sum, p) =>
              sum +
              1 -
              (Math.abs(ellipseResidual(p, fit)) / tolerance) * 0.6 +
              0.06 * Math.log1p(p.magnitude / Math.max(1, gradientScale)),
            0,
          );
          hypotheses.push({ fit, score });
        }
  }
  let bestEvidence: RingPoint[] | null = null,
    bestSupport = -Infinity;
  const diverse: typeof hypotheses = [];
  for (const item of hypotheses.sort((a, b) => b.score - a.score)) {
    if (
      diverse.some(
        (other) =>
          Math.hypot(
            item.fit.centerX - other.fit.centerX,
            item.fit.centerY - other.fit.centerY,
          ) < 4 &&
          Math.abs(item.fit.semiMajor - other.fit.semiMajor) < 4 &&
          Math.abs(item.fit.semiMinor - other.fit.semiMinor) < 4 &&
          Math.abs(
            Math.sin(((item.fit.angle - other.fit.angle) * Math.PI) / 180),
          ) < 0.1,
      )
    )
      continue;
    diverse.push(item);
    if (diverse.length >= 48) break;
  }
  for (const hypothesis of diverse) {
    let points = select(hypothesis.fit);
    let result = fitRobustEllipse(points, w, h);
    for (let pass = 0; result && pass < 4; pass++) {
      const nextPoints = select(result.fit),
        next = fitRobustEllipse(nextPoints, w, h);
      if (!next || !plausible(next.fit)) break;
      points = nextPoints;
      result = next;
    }
    if (
      !result ||
      !plausible(result.fit) ||
      result.inliers.length < rays.length * 0.3 ||
      result.coverage < 0.6
    )
      continue;
    if (
      target &&
      rays[0][0] &&
      Math.abs(ellipseResidual(rays[0][0], result.fit)) >
        Math.max(2, Math.min(w, h) * 0.004)
    )
      continue;
    const evidence = result.inliers.map((i) => points[i]);
    // Distributed support prevents two short opposing arcs from masquerading
    // as a well-observed ring just because their largest gap is small.
    if (angularSupport(evidence, result.fit) < 0.4) continue;
    if (result.rms > Math.max(2.5, result.fit.semiMinor * 0.025)) continue;
    const support = evidence.length - result.rms * 5;
    if (support > bestSupport) {
      bestEvidence = evidence;
      bestSupport = support;
    }
  }
  return bestEvidence;
}

export function angularSupport(points: Point[], fit: Ellipse): number {
  const occupied = new Set<number>(),
    angle = (fit.angle * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  for (const p of points) {
    const dx = p.x - fit.centerX,
      dy = p.y - fit.centerY;
    const theta =
      (Math.atan2(
        (-dx * s + dy * c) / fit.semiMinor,
        (dx * c + dy * s) / fit.semiMajor,
      ) +
        2 * Math.PI) %
      (2 * Math.PI);
    occupied.add(Math.floor((theta / (2 * Math.PI)) * 36));
  }
  return occupied.size / 36;
}
