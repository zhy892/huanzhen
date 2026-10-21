import assert from "node:assert/strict";
import test from "node:test";
import { physicalRegression } from "../core/physical-regression.ts";
import { buildRestorationPlan } from "../core/restoration-plan.ts";

test("unknown apparatus radii remain data-derived without attraction to a reference", () => {
  for (const radius of [0.73, 1.44, 2.8]) {
    const readings = [15, 20, 25, 30, 35, 40].map((order) => ({
      order,
      diameter: Math.sqrt(3.2 + 4 * radius * 0.5893 * order),
    }));
    const copy = structuredClone(readings);
    const raw = physicalRegression(readings, 589.3, 1, buildRestorationPlan([], 1.2).factor);
    const calibrated = physicalRegression(
      readings,
      589.3,
      1,
      buildRestorationPlan(["calibration"], 1.2).factor,
    );
    assert.ok(Math.abs(raw.radius - radius) < 1e-9);
    assert.ok(Math.abs(calibrated.radius - radius * 1.2 ** 2) < 1e-9);
    assert.deepEqual(readings, copy);
  }
});
