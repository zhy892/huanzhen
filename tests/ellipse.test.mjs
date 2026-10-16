import test from "node:test";
import assert from "node:assert/strict";
import {
  fitRobustEllipse,
  initializeEllipse,
  ellipseCoverage,
} from "../core/ellipse.ts";
import { bilinear, traceDarkRing } from "../core/ring-tracking.ts";
function points({
  cx = 256,
  cy = 250,
  a = 130,
  b = 78,
  angle = 0.65,
  n = 160,
  noise = 0,
  arc = 2 * Math.PI,
} = {}) {
  let seed = 4;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  };
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * arc;
    return {
      x:
        cx +
        a * Math.cos(t) * Math.cos(angle) -
        b * Math.sin(t) * Math.sin(angle) +
        noise * random(),
      y:
        cy +
        a * Math.cos(t) * Math.sin(angle) +
        b * Math.sin(t) * Math.cos(angle) +
        noise * random(),
    };
  });
}
const angleError = (a, b) =>
  Math.abs(((((a - b + 90) % 180) + 180) % 180) - 90);
test("ellipse fit recovers rotated, translated and near-circular geometry", () => {
  for (const config of [
    {},
    { cx: 115, cy: 170, a: 100, b: 99.5, angle: -0.9 },
    { cx: 150, cy: 170, a: 200, b: 45, angle: 1.2 },
  ]) {
    const data = points(config),
      fit = fitRobustEllipse(data, 700, 600);
    assert.ok(fit);
    assert.ok(
      Math.hypot(
        fit.fit.centerX - (config.cx ?? 256),
        fit.fit.centerY - (config.cy ?? 250),
      ) < 0.001,
    );
    assert.ok(
      Math.abs(fit.fit.ratio - (config.b ?? 78) / (config.a ?? 130)) < 1e-5,
    );
    assert.ok(
      angleError(fit.fit.angle, ((config.angle ?? 0.65) * 180) / Math.PI) <
        0.01,
    );
  }
});
test("local coordinate normalization handles ellipses passing through image center", () => {
  const fit = fitRobustEllipse(
    points({ cx: 356, cy: 256, a: 100, b: 70, angle: 0 }),
    512,
    512,
  );
  assert.ok(fit);
  assert.ok(Math.abs(fit.fit.centerX - 356) < 0.001);
  assert.ok(Math.abs(fit.fit.ratio - 0.7) < 1e-5);
});
test("RANSAC rejects isolated points rather than moving the ellipse toward them", () => {
  const data = points({ noise: 1.2 });
  for (let i = 0; i < 45; i++)
    data.push({ x: 30 + ((i * 83) % 450), y: 20 + ((i * 137) % 470) });
  const result = fitRobustEllipse(data, 512, 512);
  assert.ok(result);
  assert.ok(
    Math.hypot(result.fit.centerX - 256, result.fit.centerY - 250) < 0.5,
  );
  assert.ok(Math.abs(result.fit.ratio - 0.6) < 0.005);
  assert.ok(result.inliers.length < data.length * 0.9);
  assert.ok(result.rms < 0.6);
});
test("coverage and residual respond to poor data instead of reporting fixed quality", () => {
  const full = fitRobustEllipse(points(), 512, 512),
    noisy = fitRobustEllipse(points({ noise: 3 }), 512, 512);
  assert.ok(full && noisy);
  assert.ok(noisy.rms > full.rms + 0.1);
  const arc = points({ arc: Math.PI / 2 });
  const fit = initializeEllipse(arc);
  assert.ok(fit);
  assert.ok(ellipseCoverage(arc, fit) < 0.4);
  assert.equal(
    fitRobustEllipse(
      Array.from({ length: 10 }, (_, i) => ({ x: i, y: 2 * i })),
      512,
      512,
    ),
    null,
  );
  assert.equal(
    fitRobustEllipse(
      points().map((p, i) => (i ? p : { x: NaN, y: 0 })),
      512,
      512,
    ),
    null,
  );
});
test("bilinear sampling preserves fractional positions", () => {
  assert.equal(
    bilinear(new Float32Array([0, 10, 20, 30]), 2, 2, 0.25, 0.75),
    17.5,
  );
});
function fixture({ cross = false, flat = false } = {}) {
  const w = 512,
    h = 512,
    cx = 260,
    cy = 250,
    a = 130,
    b = 91,
    angle = 0.4,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = x - cx,
        dy = y - cy,
        r = Math.hypot((dx * c + dy * s) / a, (-dx * s + dy * c) / b);
      gray[y * w + x] = flat
        ? 120
        : 210 -
          115 * Math.exp(-(((r - 1) / 0.025) ** 2)) -
          170 * Math.exp(-(((r - 1.38) / 0.025) ** 2)) -
          120 * Math.exp(-(((r - 0.65) / 0.025) ** 2)) +
          (8 * x) / w;
      if (cross && (Math.abs(x - cx) < 3 || Math.abs(y - cy) < 3))
        gray[y * w + x] = 20;
    }
  const t = 0.8;
  return {
    gray,
    w,
    h,
    cx,
    cy,
    a,
    b,
    target: {
      x: cx + a * Math.cos(t) * c - b * Math.sin(t) * s,
      y: cy + a * Math.cos(t) * s + b * Math.sin(t) * c,
    },
  };
}
test("targeted dark-centerline tracking stays on one ring despite a stronger neighbor", () => {
  const f = fixture();
  const path = traceDarkRing(
    f.gray,
    f.w,
    f.h,
    { x0: 15, x1: 497, y0: 15, y1: 497 },
    { x: 256, y: 256 },
    40,
    f.target,
  );
  assert.ok(path);
  const result = fitRobustEllipse(path, f.w, f.h);
  assert.ok(result);
  assert.ok(Math.abs(result.fit.semiMajor - f.a) < 1);
  assert.ok(Math.abs(result.fit.ratio - 0.7) < 0.007);
  assert.ok(
    Math.hypot(result.fit.centerX - f.cx, result.fit.centerY - f.cy) < 1,
  );
});
test("tracking masks a narrow crosshair but refuses a featureless image", () => {
  const f = fixture({ cross: true });
  const path = traceDarkRing(
    f.gray,
    f.w,
    f.h,
    { x0: 15, x1: 497, y0: 15, y1: 497 },
    { x: 256, y: 256 },
    40,
    f.target,
    undefined,
    { x: f.cx, y: f.cy },
  );
  assert.ok(path);
  assert.ok(path.every((p) => p.observed));
  const result = fitRobustEllipse(path, f.w, f.h);
  assert.ok(result);
  assert.ok(Math.abs(result.fit.ratio - 0.7) < 0.012);
  const blank = fixture({ flat: true });
  assert.equal(
    traceDarkRing(
      blank.gray,
      512,
      512,
      { x0: 15, x1: 497, y0: 15, y1: 497 },
      { x: 256, y: 256 },
      40,
    ),
    null,
  );
});
