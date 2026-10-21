import test from "node:test";
import assert from "node:assert/strict";
import { calibrateForce, effectiveCurvature } from "../core/force-calibration.ts";
function pair(k) {
  return { innerMm: 1, outerMm: Math.sqrt(1 + (5 * 589.3e-3) / k) };
}
function fixture() {
  return {
    screw: "A",
    position: "右上",
    direction: "水平",
    source: "独立卸载参考与尺度测量",
    wavelengthNm: 589.3,
    refractiveIndex: 1,
    interval: 5,
    referenceRadiusM: 1,
    referenceUncertaintyM: 0.001,
    curvatureUncertainty: 0.001,
    validationTolerance: 0.005,
    targetTurns: 0.15,
    targetInnerMm: 1,
    targetOuterMm: pair(1.23).outerMm,
    fixedConditions: true,
    rows: [0, 0.1, 0.2, 0.15].map((turns, i) => ({
      turns,
      ...pair(1.2 + 0.2 * turns),
      validation: i === 3,
    })),
  };
}
test("known quadratic gap recovers unloaded radius, sign and uncertainty", () => {
  const r = calibrateForce(fixture());
  assert.ok(Math.abs(r.radius - 1) < 1e-12);
  assert.ok(Math.abs(r.slope - 0.2) < 1e-12);
  assert.ok(r.amount > 0);
  assert.ok(r.expanded > 0);
});
test("refractive index and units obey reflected dark-ring spacing", () => {
  const p = pair(2);
  assert.ok(Math.abs(effectiveCurvature(p.innerMm, p.outerMm, 5, 589.3, 2) - 1) < 1e-12);
  assert.throws(() => effectiveCurvature(2, 1, 5, 589.3, 1));
  assert.throws(() => effectiveCurvature(1, 2, 1.5, 589.3, 1));
});
test("requires independent anchor, fixed conditions and held-out states", () => {
  for (const patch of [
    { source: "" },
    { fixedConditions: false },
    { referenceRadiusM: 0 },
    { referenceUncertaintyM: 0 },
    { rows: fixture().rows.slice(0, 3) },
  ])
    assert.throws(() => calibrateForce({ ...fixture(), ...patch }));
});
test("rejects extrapolation, failed validation and inconsistent target", () => {
  assert.throws(() => calibrateForce({ ...fixture(), targetTurns: 1 }), /外推/);
  const c = fixture();
  c.rows[3].outerMm = 3;
  assert.throws(() => calibrateForce(c), /验证未通过/);
  assert.throws(() => calibrateForce({ ...fixture(), targetOuterMm: 3 }), /不一致/);
});
test("unstable denominator cannot yield a restored radius", () =>
  assert.throws(() => calibrateForce({ ...fixture(), curvatureUncertainty: 2 }), /分母/));
