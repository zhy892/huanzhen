import test from "node:test";
import assert from "node:assert/strict";
import { CAUSES, buildCauseSuggestions, builtinDiagnosis } from "../core/analysis.ts";
const base = {
  ratio: 0.95,
  angle: 0,
  clarity: 0.3,
  asymmetry: 0.4,
  confidence: 0.6,
  fitQuality: 0.6,
  centerOffset: 0.2,
  damaged: true,
  fitStatus: "review",
  fitResidualPx: 1,
  fitObservedFraction: 0.5,
  ringSelection: { consistency: "single", checkedRingCount: 1 },
};
for (const [name, patch] of [
  ["partial photo", {}],
  ["nearly circular", { ratio: 0.999, damaged: false, fitStatus: "accepted" }],
  [
    "inconsistent rings",
    { ringSelection: { consistency: "inconsistent", ratioSpread: 0.08, checkedRingCount: 3 } },
  ],
])
  test(`all common causes stay visible for ${name}`, () => {
    const m = { ...base, ...patch },
      s = buildCauseSuggestions(m, builtinDiagnosis(m));
    assert.equal(s.length, CAUSES.length);
    assert.equal(new Set(s.map((c) => c.id)).size, CAUSES.length);
    assert.ok(s.every((c) => c.evidence && c.advice && c.status));
    assert.ok(s.filter((c) => c.recommended).length <= 3);
    assert.equal(s.find((c) => c.id === "damage").status, "无法凭本图确认");
  });
