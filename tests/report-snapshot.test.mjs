import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SOFTWARE_VERSION } from "../core/software.ts";
import { captureReport, validateReportInput } from "../core/report-snapshot.ts";

const parameters = {
  wavelengthNm: 589.3,
  refractiveIndex: 1,
  orderInterval: 15,
  lengthFactor: 1.1,
};
const readings = [15, 20, 25, 30, 35, 40].map((order) => ({ order, diameter: Math.sqrt(order) }));
test("saved report preserves the original parameters and values after later edits", () => {
  const p = { ...parameters };
  const values = { radius: 1.74, radiusUncertainty: 0.2, regressionRadius: 1.78, rSquared: 0.999 };
  const saved = captureReport(p, values);
  p.wavelengthNm = 632.8;
  p.refractiveIndex = 1.3;
  p.lengthFactor = 0.8;
  values.radius = 0.9;
  assert.deepEqual(saved.parameters, parameters);
  assert.equal(saved.results.radius, 1.74);
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), saved);
});
test("invalid parameters and inconsistent readings cannot produce a formal report", () => {
  assert.equal(validateReportInput(readings, parameters), null);
  for (const patch of [
    { wavelengthNm: 0 },
    { wavelengthNm: Infinity },
    { refractiveIndex: NaN },
    { refractiveIndex: 0.5 },
    { orderInterval: 12 },
    { lengthFactor: -1 },
  ])
    assert.ok(validateReportInput(readings, { ...parameters, ...patch }));
  assert.ok(validateReportInput(readings.slice(0, 5), parameters));
  assert.ok(
    validateReportInput([...readings.slice(0, 5), { order: 40, diameter: Infinity }], parameters),
  );
  assert.ok(validateReportInput([...readings.slice(0, 5), { order: 40, diameter: 1 }], parameters));
});
test("package and lockfile identify the same software release", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url)));
  assert.equal(pkg.version, SOFTWARE_VERSION);
  assert.equal(lock.version, SOFTWARE_VERSION);
  assert.equal(lock.packages[""].version, SOFTWARE_VERSION);
  assert.deepEqual(lock.packages[""].dependencies, pkg.dependencies);
});
