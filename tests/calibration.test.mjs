import assert from "node:assert/strict";
import test from "node:test";

const STANDARD_RADIUS = 1.0;
const WAVELENGTH_NM = 589.3;
const INTERVAL = 15;
const CALIBRATION_STRENGTH = 0.96;
const DEMO_DATA = {
  5: 4.420,
  10: 6.250,
  15: 7.657,
  20: 8.572,
  25: 9.508,
  30: 10.335,
  35: 11.221,
  40: 11.944,
};

test("standard-radius calibration moves the report sample toward 1.000 m", () => {
  const differences = [15, 20, 25].map((low) => DEMO_DATA[low + INTERVAL] ** 2 - DEMO_DATA[low] ** 2);
  const meanDifference = differences.reduce((sum, value) => sum + value, 0) / differences.length;
  const beforeRadius = (meanDifference * 1e-6) / (4 * INTERVAL * WAVELENGTH_NM * 1e-9);
  const calibrationFactor = (STANDARD_RADIUS / beforeRadius) ** (CALIBRATION_STRENGTH / 2);
  const afterRadius = beforeRadius * calibrationFactor ** 2;
  const beforeError = Math.abs(beforeRadius - STANDARD_RADIUS) / STANDARD_RADIUS * 100;
  const afterError = Math.abs(afterRadius - STANDARD_RADIUS) / STANDARD_RADIUS * 100;
  const improvement = (beforeError - afterError) / beforeError * 100;

  assert.equal(differences.map((value) => value.toFixed(6)).join(","), "48.182576,52.431657,52.257072");
  assert.equal(meanDifference.toFixed(6), "50.957102");
  assert.equal(beforeRadius.toFixed(6), "1.441176");
  assert.equal(calibrationFactor.toFixed(6), "0.839104");
  assert.equal(afterRadius.toFixed(6), "1.014726");
  assert.equal(beforeError.toFixed(4), "44.1176");
  assert.equal(afterError.toFixed(4), "1.4726");
  assert.equal(improvement.toFixed(2), "96.66");
});

test("six report levels retain non-zero residual errors after restoration", () => {
  const beforeRadius = 1.441176018628505;
  const calibrationFactor = (STANDARD_RADIUS / beforeRadius) ** (CALIBRATION_STRENGTH / 2);
  const rows = [15, 20, 25, 30, 35, 40].map((order) => {
    const originalRadius = (DEMO_DATA[order] ** 2 * 1e-6) / (4 * order * WAVELENGTH_NM * 1e-9);
    const restoredRadius = originalRadius * calibrationFactor ** 2;
    return {
      originalError: Math.abs(originalRadius - STANDARD_RADIUS) * 100,
      restoredError: Math.abs(restoredRadius - STANDARD_RADIUS) * 100,
    };
  });

  assert.equal(rows.length, 6);
  assert.ok(rows.every((row) => row.restoredError > 0));
  assert.ok(rows.every((row) => row.restoredError < row.originalError));
});
