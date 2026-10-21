export type Point = { x: number; y: number };
export type Ellipse = {
  centerX: number;
  centerY: number;
  semiMajor: number;
  semiMinor: number;
  ratio: number;
  angle: number;
};
export type EllipseResult = {
  fit: Ellipse;
  inliers: number[];
  rms: number;
  coverage: number;
};
const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2 : 0;
};

// Modified Gram–Schmidt with re-orthogonalization avoids squaring the condition
// number as normal equations do. Coordinates are centered and scaled first.
export function leastSquares(rows: number[][], target: number[]): number[] | null {
  if (!rows.length || rows.length < rows[0].length) return null;
  const n = rows[0].length,
    q: number[][] = [],
    r = Array.from({ length: n }, () => Array(n).fill(0));
  for (let j = 0; j < n; j++) {
    const column = rows.map((row) => row[j]);
    for (let pass = 0; pass < 2; pass++)
      for (let k = 0; k < j; k++) {
        const projection = column.reduce((sum, v, i) => sum + v * q[k][i], 0);
        r[k][j] += projection;
        for (let i = 0; i < column.length; i++) column[i] -= projection * q[k][i];
      }
    const norm = Math.hypot(...column);
    if (norm < 1e-9 || !Number.isFinite(norm)) return null;
    r[j][j] = norm;
    q.push(column.map((v) => v / norm));
  }
  const result = q.map((column) => column.reduce((sum, v, i) => sum + v * target[i], 0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = i + 1; j < n; j++) result[i] -= r[i][j] * result[j];
    result[i] /= r[i][i];
  }
  return result.every(Number.isFinite) ? result : null;
}
export function initializeEllipse(points: Point[]): Ellipse | null {
  if (points.length < 5 || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    return null;
  const mx = points.reduce((s, p) => s + p.x, 0) / points.length,
    my = points.reduce((s, p) => s + p.y, 0) / points.length;
  const scale = Math.sqrt(
    points.reduce((s, p) => s + (p.x - mx) ** 2 + (p.y - my) ** 2, 0) / points.length,
  );
  if (scale < 1e-6) return null;
  const normalized = points.map((p) => ({
    x: (p.x - mx) / scale,
    y: (p.y - my) / scale,
  }));
  const solved = leastSquares(
    normalized.map(({ x, y }) => [x * x, x * y, y * y, x, y]),
    points.map(() => 1),
  );
  if (!solved) return null;
  const [a, b, c, d, e] = solved,
    determinant = a * c - (b * b) / 4;
  if (determinant <= 1e-9) return null;
  const x = (b * e - 2 * c * d) / (4 * determinant),
    y = (b * d - 2 * a * e) / (4 * determinant);
  const constant = 1 + a * x * x + b * x * y + c * y * y,
    root = Math.hypot(a - c, b);
  const small = (a + c - root) / 2,
    large = (a + c + root) / 2;
  if (constant <= 0 || small <= 0 || large <= 0) return null;
  const major = Math.sqrt(constant / small) * scale,
    minor = Math.sqrt(constant / large) * scale;
  let angle = ((0.5 * Math.atan2(b, a - c) + Math.PI / 2) * 180) / Math.PI;
  while (angle > 90) angle -= 180;
  while (angle < -90) angle += 180;
  return {
    centerX: mx + x * scale,
    centerY: my + y * scale,
    semiMajor: major,
    semiMinor: minor,
    ratio: minor / major,
    angle,
  };
}
// Signed first-order distance to the conic, in pixels rather than algebraic units.
export function ellipseResidual(point: Point, fit: Ellipse): number {
  const angle = (fit.angle * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const dx = point.x - fit.centerX,
    dy = point.y - fit.centerY,
    u = dx * c + dy * s,
    v = -dx * s + dy * c;
  const a2 = fit.semiMajor ** 2,
    b2 = fit.semiMinor ** 2;
  return ((u * u) / a2 + (v * v) / b2 - 1) / Math.max(1e-10, 2 * Math.hypot(u / a2, v / b2));
}
function parameters(fit: Ellipse) {
  return [
    fit.centerX,
    fit.centerY,
    Math.log(fit.semiMajor),
    Math.log(fit.semiMinor),
    (fit.angle * Math.PI) / 180,
  ];
}
function fromParameters(p: number[]): Ellipse {
  let a = Math.exp(p[2]),
    b = Math.exp(p[3]),
    angle = (p[4] * 180) / Math.PI;
  if (b > a) {
    [a, b] = [b, a];
    angle += 90;
  }
  angle = ((((angle + 90) % 180) + 180) % 180) - 90;
  return {
    centerX: p[0],
    centerY: p[1],
    semiMajor: a,
    semiMinor: b,
    ratio: b / a,
    angle,
  };
}
function refine(points: Point[], initial: Ellipse): Ellipse {
  let p = parameters(initial),
    fit = initial,
    damping = 0.001;
  for (let iteration = 0; iteration < 24; iteration++) {
    const residuals = points.map((point) => ellipseResidual(point, fit));
    const sigma = Math.max(0.25, 1.4826 * median(residuals.map(Math.abs)));
    const rows: number[][] = [],
      target: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const weight = Math.sqrt(Math.min(1, (1.5 * sigma) / Math.max(1e-8, Math.abs(residuals[i]))));
      const jacobian = p.map((_, j) => {
        const shifted = [...p],
          step = j < 2 ? 0.01 : 1e-5;
        shifted[j] += step;
        return (
          ((ellipseResidual(points[i], fromParameters(shifted)) - residuals[i]) / step) * weight
        );
      });
      rows.push(jacobian);
      target.push(-residuals[i] * weight);
    }
    for (let j = 0; j < 5; j++) {
      const row = Array(5).fill(0);
      row[j] = Math.sqrt(damping);
      rows.push(row);
      target.push(0);
    }
    const delta = leastSquares(rows, target);
    if (!delta) break;
    const proposal = p.map(
      (value, j) => value + Math.max(-(j < 2 ? 5 : 0.15), Math.min(j < 2 ? 5 : 0.15, delta[j])),
    );
    const next = fromParameters(proposal);
    const loss = (e: Ellipse) =>
      points.reduce((sum, point) => {
        const d = Math.abs(ellipseResidual(point, e)),
          cut = 1.5 * sigma;
        return sum + (d <= cut ? d * d : 2 * cut * d - cut * cut);
      }, 0);
    if (next.ratio < 0.08 || !Number.isFinite(next.semiMajor) || loss(next) >= loss(fit)) {
      damping *= 8;
      if (damping > 1e7) break;
      continue;
    }
    p = proposal;
    fit = next;
    damping = Math.max(1e-6, damping / 3);
    if (Math.hypot(...delta) < 1e-6) break;
  }
  return fit;
}
export function ellipseCoverage(points: Point[], fit: Ellipse): number {
  if (points.length < 2) return 0;
  const t = (fit.angle * Math.PI) / 180,
    c = Math.cos(t),
    s = Math.sin(t);
  const angles = points
    .map((p) => {
      const x = p.x - fit.centerX,
        y = p.y - fit.centerY;
      return (
        (Math.atan2((-x * s + y * c) / fit.semiMinor, (x * c + y * s) / fit.semiMajor) +
          2 * Math.PI) %
        (2 * Math.PI)
      );
    })
    .sort((a, b) => a - b);
  let gap = angles[0] + 2 * Math.PI - angles.at(-1)!;
  for (let i = 1; i < angles.length; i++) gap = Math.max(gap, angles[i] - angles[i - 1]);
  return 1 - gap / (2 * Math.PI);
}
export function fitRobustEllipse(
  points: Point[],
  width: number,
  height: number,
  pixelTolerance?: number,
): EllipseResult | null {
  if (points.length < 5 || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    return null;
  const valid = (fit: Ellipse | null): fit is Ellipse =>
    !!fit &&
    fit.ratio >= 0.08 &&
    fit.ratio <= 1 &&
    fit.semiMinor >= 2 &&
    fit.semiMajor <= Math.max(width, height) * 1.5 &&
    fit.centerX >= -width * 0.25 &&
    fit.centerX <= width * 1.25 &&
    fit.centerY >= -height * 0.25 &&
    fit.centerY <= height * 1.25;
  const threshold = Math.max(
    1.25,
    Math.min(width, height) * 0.0025,
    Number.isFinite(pixelTolerance) ? Math.min(4.5, Math.max(0, pixelTolerance!)) : 0,
  );
  let best: Ellipse | null = null,
    bestIndices: number[] = [],
    bestLoss = Infinity;
  const consider = (fit: Ellipse | null) => {
    if (!valid(fit)) return;
    const distances = points.map((point) => Math.abs(ellipseResidual(point, fit)));
    const indices = distances.flatMap((d, i) => (d <= threshold ? [i] : []));
    const loss = median(indices.map((i) => distances[i]));
    if (
      indices.length > bestIndices.length ||
      (indices.length === bestIndices.length && loss < bestLoss)
    ) {
      best = fit;
      bestIndices = indices;
      bestLoss = loss;
    }
  };
  consider(initializeEllipse(points));
  let seed = 173;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (
    let trial = 0;
    trial < (points.length <= 8 ? 0 : 80) && bestIndices.length < points.length * 0.97;
    trial++
  ) {
    const indices = new Set<number>();
    while (indices.size < 6) indices.add(Math.floor(random() * points.length));
    consider(initializeEllipse([...indices].map((i) => points[i])));
  }
  if (!best || bestIndices.length < Math.max(5, Math.ceil(points.length * 0.55))) return null;
  let fit: Ellipse = best;
  for (let i = 0; i < 3; i++) {
    fit = refine(
      bestIndices.map((index) => points[index]),
      fit,
    );
    if (!valid(fit)) return null;
    const residuals = points.map((point) => Math.abs(ellipseResidual(point, fit)));
    const cut = Math.min(
      threshold * 2,
      Math.max(threshold, 2.8 * 1.4826 * median(bestIndices.map((index) => residuals[index]))),
    );
    bestIndices = residuals.flatMap((d, index) => (d <= cut ? [index] : []));
    if (bestIndices.length < Math.max(5, Math.ceil(points.length * 0.55))) return null;
  }
  const inliers = bestIndices;
  return {
    fit,
    inliers,
    rms: Math.sqrt(
      inliers.reduce((s, i) => s + ellipseResidual(points[i], fit) ** 2, 0) / inliers.length,
    ),
    coverage: ellipseCoverage(
      inliers.map((i) => points[i]),
      fit,
    ),
  };
}
