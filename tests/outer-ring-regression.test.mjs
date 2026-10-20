import test from "node:test";
import assert from "node:assert/strict";
import { boxBlur } from "../core/analysis.ts";
import { selectAutomaticRings } from "../core/auto-rings.ts";

import { screen } from "./fixtures/obscured-screen.mjs";

for (const spec of [
  { stains: false, offset: false },
  { stains: true, offset: false },
  { stains: true, offset: true },
]) {
  test(`automatic outer-ring recovery with missing center: ${JSON.stringify(spec)}`, () => {
    const f = screen(spec),
      result = selectAutomaticRings(
        f.gray,
        f.w,
        f.h,
        f.roi,
        { x: 360, y: 270 },
        25,
        f.guide,
      );
    assert.ok(
      result,
      "a visible outer fringe should be recovered without a click",
    );
    const fit = result.selected.fit;
    assert.ok(
      Math.hypot(fit.centerX - f.cx, fit.centerY - f.cy) < 5,
      "center must follow the fringe rather than the crosshair or a stain",
    );
    assert.ok(
      Math.abs(fit.semiMajor - f.a) < 5,
      "do not substitute a stain or a spurious small ring",
    );
    assert.ok(Math.abs(fit.ratio - f.b / f.a) < 0.03);
    assert.equal(result.selection.absoluteOrder, null);
  });
}
test("screen pattern without a ring must not receive an ellipse", () => {
  const f = screen({ textureOnly: true });
  assert.ok(
    selectAutomaticRings(
      f.gray,
      f.w,
      f.h,
      f.roi,
      { x: 360, y: 270 },
      25,
      f.guide,
    ) === null,
    "texture or dirt alone must be rejected",
  );
});

test("dense stains and moire alone must not become a candidate ring", () => {
  const f = screen({ textureOnly: true, stains: true });
  assert.ok(
    selectAutomaticRings(
      f.gray,
      f.w,
      f.h,
      f.roi,
      { x: 360, y: 270 },
      25,
      f.guide,
    ) === null,
    "texture or dirt alone must be rejected",
  );
});

for (const offset of [false, true])
  test(`outer ring survives RGB quantization and a tighter screen crop: offset=${offset}`, () => {
    const f = screen({ stains: true, offset });
    const converted = Float32Array.from(
      f.raw,
      (v) =>
        Math.round(v * 1.4) * 0.299 +
        Math.round(v * 0.8) * 0.587 +
        Math.round(v * 0.15) * 0.114,
    );
    const gray = boxBlur(boxBlur(converted, f.w, f.h, 2), f.w, f.h, 2);
    const roi = { x0: 99, x1: 631, y0: 116, y1: 430 };
    const result = selectAutomaticRings(
      gray,
      f.w,
      f.h,
      roi,
      { x: 360, y: 270 },
      25,
      f.guide,
    );
    assert.ok(
      result,
      "the screen crop must not prevent recovery of the remaining arcs",
    );
    assert.ok(
      Math.hypot(
        result.selected.fit.centerX - f.cx,
        result.selected.fit.centerY - f.cy,
      ) < 5,
    );
    assert.ok(Math.abs(result.selected.fit.semiMajor - f.a) < 5);
    assert.ok(Math.abs(result.selected.fit.ratio - f.b / f.a) < 0.03);
  });
