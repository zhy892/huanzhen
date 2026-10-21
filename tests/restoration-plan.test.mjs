import test from "node:test";
import assert from "node:assert/strict";
import { buildRestorationPlan } from "../core/restoration-plan.ts";
import { CAUSES } from "../core/analysis.ts";
import { physicalRegression } from "../core/physical-regression.ts";
test("removed causes stay absent and the combined cause treats crosshairs as normal", () => {
  assert.equal(CAUSES.length, 8);
  assert.ok(!CAUSES.some((c) => ["reading", "contamination"].includes(c.id)));
  assert.match(CAUSES.find((c) => c.id === "focus").description, /十字丝正常存在/);
});
test("stored length coefficient cannot affect unselected causes", () => {
  for (const causes of [
    [],
    ["focus"],
    ["pressure"],
    ["tilt", "distortion"],
    ["decenter", "damage", "illumination"],
  ]) {
    const p = buildRestorationPlan(causes, 1.2);
    assert.equal(p.factor, 1);
    assert.ok(!p.steps.some((s) => s.status === "applied"));
  }
});
test("selection drives the actual physical calculation and deselection restores raw readings", () => {
  const data = [5, 10, 15, 20, 25, 30].map((order) => ({
    order,
    diameter: Math.sqrt(2 + 4 * 0.5893 * order),
  }));
  const selected = buildRestorationPlan(["calibration"], 1.2),
    deselected = buildRestorationPlan([], 1.2);
  assert.ok(Math.abs(physicalRegression(data, 589.3, 1, selected.factor).radius - 1.44) < 1e-9);
  assert.ok(Math.abs(physicalRegression(data, 589.3, 1, deselected.factor).radius - 1) < 1e-9);
});
test("invalid calibration and missing geometric calibration never fabricate corrections", () => {
  assert.equal(buildRestorationPlan(["calibration"], NaN).factor, 1);
  assert.equal(buildRestorationPlan(["calibration"], NaN).steps[0].status, "pending");
  const p = buildRestorationPlan(["tilt", "distortion", "pressure", "decenter"], 1.2);
  assert.ok(p.steps.every((s) => s.status === "pending"));
});
test("imaging checks have a separate status and cannot multiply diameters", () => {
  const p = buildRestorationPlan(["focus", "illumination"], 0.8);
  assert.equal(p.factor, 1);
  assert.ok(p.steps.every((s) => s.status === "image"));
  assert.equal(buildRestorationPlan(["calibration", "calibration"], 1.1).steps.length, 1);
});
