import test from "node:test";
import assert from "node:assert/strict";
import { fitRobustEllipse, initializeEllipse, ellipseCoverage } from "../core/ellipse.ts";
import { boxBlur, detectGuideLine } from "../core/analysis.ts";
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
const angleError = (a, b) => Math.abs(((((a - b + 90) % 180) + 180) % 180) - 90);
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
      Math.hypot(fit.fit.centerX - (config.cx ?? 256), fit.fit.centerY - (config.cy ?? 250)) <
        0.001,
    );
    assert.ok(Math.abs(fit.fit.ratio - (config.b ?? 78) / (config.a ?? 130)) < 1e-5);
    assert.ok(angleError(fit.fit.angle, ((config.angle ?? 0.65) * 180) / Math.PI) < 0.01);
  }
});
test("local coordinate normalization handles ellipses passing through image center", () => {
  const fit = fitRobustEllipse(points({ cx: 356, cy: 256, a: 100, b: 70, angle: 0 }), 512, 512);
  assert.ok(fit);
  assert.ok(Math.abs(fit.fit.centerX - 356) < 0.001);
  assert.ok(Math.abs(fit.fit.ratio - 0.7) < 1e-5);
});
test("RANSAC rejects isolated points rather than moving the ellipse toward them", () => {
  const data = points({ noise: 1.2 });
  for (let i = 0; i < 45; i++) data.push({ x: 30 + ((i * 83) % 450), y: 20 + ((i * 137) % 470) });
  const result = fitRobustEllipse(data, 512, 512);
  assert.ok(result);
  assert.ok(Math.hypot(result.fit.centerX - 256, result.fit.centerY - 250) < 0.5);
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
  assert.equal(bilinear(new Float32Array([0, 10, 20, 30]), 2, 2, 0.25, 0.75), 17.5);
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
      if (cross && (Math.abs(x - cx) < 3 || Math.abs(y - cy) < 3)) gray[y * w + x] = 20;
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
  assert.ok(Math.hypot(result.fit.centerX - f.cx, result.fit.centerY - f.cy) < 1);
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

function photographedFringes({
  clipped = false,
  stained = false,
  contrast = 38,
  flat = false,
  offcenter = false,
  textureOnly = false,
  inner = true,
} = {}) {
  const w = 720,
    h = 540,
    roi = { x0: 75, x1: 650, y0: 105, y1: 445 };
  const cx = offcenter ? 409 : 375,
    cy = 275,
    a = clipped ? 250 : 145,
    b = clipped ? 190 : 120,
    angle = 0.12;
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (x < roi.x0 || x > roi.x1 || y < roi.y0 || y > roi.y1) {
        gray[y * w + x] = 5;
        continue;
      }
      const dx = x - cx,
        dy = y - cy,
        c = Math.cos(angle),
        s = Math.sin(angle);
      const r = Math.hypot((dx * c + dy * s) / a, (-dx * s + dy * c) / b);
      const theta = Math.atan2(dy, dx);
      const obscured = stained && theta > 0.15 && theta < 0.8;
      const fringe =
        obscured || flat || textureOnly
          ? 0
          : contrast * Math.exp(-(((r - 1) / 0.13) ** 2)) +
            (inner ? contrast * 0.8 * Math.exp(-(((r - 0.58) / 0.12) ** 2)) : 0);
      gray[y * w + x] = flat
        ? 110
        : 145 +
          (14 * x) / w +
          (8 * y) / h -
          fringe +
          3 * Math.sin(x * 2.1) +
          2 * Math.sin(y * 0.73);
      if (!flat && (Math.abs(x - 360) < 1.5 || Math.abs(y - 270) < 1.5)) gray[y * w + x] -= 45;
    }
  const t = 2.4,
    c = Math.cos(angle),
    s = Math.sin(angle);
  return {
    gray,
    w,
    h,
    roi,
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
test("wide low-contrast fringes survive screen texture and narrow crosshairs", () => {
  const f = photographedFringes();
  const path = traceDarkRing(f.gray, f.w, f.h, f.roi, { x: 360, y: 270 }, 35, f.target, undefined, {
    x: 360,
    y: 270,
  });
  assert.ok(path);
  const result = fitRobustEllipse(path, f.w, f.h);
  assert.ok(result);
  assert.ok(Math.hypot(result.fit.centerX - f.cx, result.fit.centerY - f.cy) < 3);
  assert.ok(Math.abs(result.fit.semiMajor - f.a) < 3);
  assert.ok(Math.abs(result.fit.ratio - f.b / f.a) < 0.025);
});
test("denoised screen-clipped and stained arcs recover one ring without adding predicted fit points", () => {
  for (const stained of [false, true]) {
    const f = photographedFringes({ clipped: true, stained });
    const blurred = boxBlur(boxBlur(f.gray, f.w, f.h, 2), f.w, f.h, 2);
    const path = traceDarkRing(
      blurred,
      f.w,
      f.h,
      f.roi,
      { x: 360, y: 270 },
      35,
      f.target,
      undefined,
      { x: 360, y: 270 },
    );
    assert.ok(path, `clipped stained=${stained}`);
    assert.ok(
      path.every(
        (p) =>
          p.observed && p.x >= f.roi.x0 && p.x <= f.roi.x1 && p.y >= f.roi.y0 && p.y <= f.roi.y1,
      ),
    );
    const result = fitRobustEllipse(path, f.w, f.h);
    assert.ok(result);
    assert.ok(Math.hypot(result.fit.centerX - f.cx, result.fit.centerY - f.cy) < 5);
    assert.ok(Math.abs(result.fit.semiMajor - f.a) < 5);
    assert.ok(Math.abs(result.fit.ratio - f.b / f.a) < 0.035);
  }
});

test("a displaced ring center is estimated independently of the crosshair intersection", () => {
  const f = photographedFringes({ offcenter: true });
  const path = traceDarkRing(f.gray, f.w, f.h, f.roi, { x: 360, y: 270 }, 35, f.target, undefined, {
    x: 360,
    y: 270,
  });
  assert.ok(path);
  const result = fitRobustEllipse(path, f.w, f.h);
  assert.ok(result);
  assert.ok(Math.hypot(result.fit.centerX - f.cx, result.fit.centerY - f.cy) < 4);
  assert.ok(Math.abs(result.fit.ratio - f.b / f.a) < 0.03);
});
test("screen texture and a crosshair alone do not establish a ring", () => {
  const f = photographedFringes({ textureOnly: true });
  const path = traceDarkRing(
    f.gray,
    f.w,
    f.h,
    f.roi,
    { x: 360, y: 270 },
    35,
    undefined,
    undefined,
    { x: 360, y: 270 },
  );
  assert.equal(path, null);
});

test("clipped fringe tracking survives grayscale conversion, screen inset and blur", () => {
  for (const stained of [false, true]) {
    const f = photographedFringes({ clipped: true, stained });
    const gray = Float32Array.from(f.gray, (v) =>
      v <= 5
        ? 5
        : Math.round(v * 1.5) * 0.299 + Math.round(v * 0.75) * 0.587 + Math.round(v * 0.12) * 0.114,
    );
    const roi = { x0: 89, x1: 636, y0: 114, y1: 436 };
    const vg = detectGuideLine(gray, f.w, f.h, roi, "vertical"),
      hg = detectGuideLine(gray, f.w, f.h, roi, "horizontal");
    assert.ok(Math.abs(vg.coordinate - 360) < 2 && Math.abs(hg.coordinate - 270) < 2);
    const guide = { x: vg.coordinate, y: hg.coordinate },
      blurred = boxBlur(boxBlur(gray, f.w, f.h, 2), f.w, f.h, 2);
    const path = traceDarkRing(
      blurred,
      f.w,
      f.h,
      roi,
      { x: guide.x, y: guide.y },
      20,
      f.target,
      undefined,
      guide,
    );
    assert.ok(path);
    const result = fitRobustEllipse(path, f.w, f.h);
    assert.ok(result);
    assert.ok(Math.hypot(result.fit.centerX - f.cx, result.fit.centerY - f.cy) < 4);
    assert.ok(Math.abs(result.fit.semiMajor - f.a) < 4);
    assert.ok(Math.abs(result.fit.ratio - f.b / f.a) < 0.03);
  }
});

test("automatic selection recovers a clipped outer fringe without requiring a target click", () => {
  const f = photographedFringes({ clipped: true, inner: false });
  const gray = boxBlur(boxBlur(f.gray, f.w, f.h, 2), f.w, f.h, 2);
  const path = traceDarkRing(gray, f.w, f.h, f.roi, { x: 360, y: 270 }, 35, undefined, undefined, {
    x: 360,
    y: 270,
  });
  assert.ok(path);
  const result = fitRobustEllipse(path, f.w, f.h);
  assert.ok(result);
  assert.ok(Math.hypot(result.fit.centerX - f.cx, result.fit.centerY - f.cy) < 4);
  assert.ok(Math.abs(result.fit.semiMajor - f.a) < 4);
  assert.ok(Math.abs(result.fit.ratio - f.b / f.a) < 0.03);
});
