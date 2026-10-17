import test from "node:test";
import assert from "node:assert/strict";
import { selectAutomaticRings } from "../core/auto-rings.ts";
import { builtinDiagnosis, constrainDiagnosis } from "../core/analysis.ts";
function image({ inner = false, different = false, flat = false } = {}) {
  const w = 512,
    h = 512,
    gray = new Float32Array(w * h),
    cx = 260,
    cy = 252;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const r = Math.hypot(x - cx, (y - cy) / 0.8);
      const r3 = Math.hypot(x - cx, (y - cy) / (different ? 0.96 : 0.8));
      gray[y * w + x] = flat
        ? 120
        : 190 -
          75 * Math.exp(-(((r - 140) / 8) ** 2)) -
          95 * Math.exp(-(((r3 - 195) / 8) ** 2)) -
          (inner ? 8 * Math.exp(-(((r - 65) / 15) ** 2)) : 0) +
          2 * Math.sin(x * 0.3) * Math.sin(y * 0.21);
    }
  return {
    w,
    h,
    gray,
    roi: { x0: 10, x1: 502, y0: 10, y1: 502 },
    center: { x: 256, y: 256 },
  };
}
test("automatic fitting selects a clear outer fringe when central fringes are missing or weak", () => {
  for (const inner of [false, true]) {
    const f = image({ inner });
    const result = selectAutomaticRings(f.gray, f.w, f.h, f.roi, f.center, 35);
    assert.ok(result);
    assert.ok(
      [140, 195].some((a) => Math.abs(a - result.selected.fit.semiMajor) < 2),
    );
    assert.ok(Math.abs(result.selected.fit.ratio - 0.8) < 0.015);
    assert.equal(result.selection.absoluteOrder, null);
    assert.equal(result.selection.centerRegionAssessed, false);
    assert.ok(result.selection.candidateCount >= 2);
    assert.equal(result.selection.consistency, "consistent");
  }
});
test("incompatible visible rings do not establish a single global shape", () => {
  const f = image({ different: true });
  const result = selectAutomaticRings(f.gray, f.w, f.h, f.roi, f.center, 35);
  assert.ok(result);
  assert.equal(result.selection.consistency, "inconsistent");
  const diagnosis = builtinDiagnosis({
    ratio: result.selected.fit.ratio,
    fitQuality: 0.9,
    confidence: 0.9,
    damaged: false,
    ringSelection: result.selection,
  });
  assert.match(diagnosis.summary, /不能统一补偿/);
});
test("automatic search does not fit a featureless image", () => {
  const f = image({ flat: true });
  assert.equal(
    selectAutomaticRings(f.gray, f.w, f.h, f.roi, f.center, 35),
    null,
  );
});
test("remote advice cannot infer central damage or reading eccentricity from an outer ring", () => {
  const metrics = {
    ratio: 0.9,
    confidence: 0.8,
    damaged: false,
    ringSelection: { consistency: "single" },
  };
  const diagnosis = constrainDiagnosis(metrics, {
    verdict: "椭圆",
    summary: "已确认中心损坏，应用偏心补偿",
    causes: ["damage", "decenter", "pressure", "tilt", "calibration"],
    confidence: 0.99,
  });
  assert.deepEqual(diagnosis.causes, ["tilt", "calibration"]);
  assert.equal(diagnosis.confidence, 0.8);
  assert.doesNotMatch(diagnosis.summary,/已确认中心损坏|应用偏心补偿/);
  assert.match(diagnosis.summary, /中心接触状态和真实读数偏心未评估/);
});
