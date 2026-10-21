import test from "node:test";
import assert from "node:assert/strict";
import { physicalRegression } from "../core/physical-regression.ts";
const lambda = 589.3,
  rows = Array.from({ length: 12 }, (_, i) => ({
    order: 5 + i * 5,
    diameter: Math.sqrt(2 + 4 * lambda * 0.001 * (5 + i * 5)),
  }));
test("free intercept recovers physical radius and tolerates common order shift", () => {
  for (const offset of [0, 10]) {
    const r = physicalRegression(
      rows.map((v) => ({ ...v, order: v.order + offset })),
      lambda,
    );
    assert.ok(Math.abs(r.radius - 1) < 1e-9);
    assert.ok(Math.abs(r.intercept - (2 - 4 * lambda * 0.001 * offset)) < 1e-8);
  }
});
test("isolated reading error is flagged rather than silently rewriting measurements", () => {
  const input = structuredClone(rows);
  input[6].diameter += 1.8;
  const backup = JSON.stringify(input),
    r = physicalRegression(input, lambda);
  assert.ok(Math.abs(r.radius - 1) < Math.abs(r.ordinaryRadius - 1));
  assert.ok(r.flagged.includes(input[6].order));
  assert.equal(JSON.stringify(input), backup);
});
test("independent scale and refractive index have the correct physical effect", () => {
  assert.ok(Math.abs(physicalRegression(rows, lambda, 1.5, 2).radius - 6) < 1e-8);
});
test("invalid physical data are rejected", () => {
  assert.throws(() => physicalRegression(rows.slice(0, 3), lambda));
  assert.throws(() => physicalRegression([...rows, rows[0]], lambda));
  assert.throws(() =>
    physicalRegression(
      rows.map((r) => ({ ...r, diameter: 10 - r.order * 0.1 })),
      lambda,
    ),
  );
});
