import test from "node:test";
import assert from "node:assert/strict";
import { assessFit } from "../core/fit-quality.ts";
import { builtinDiagnosis, buildAiSuggestions } from "../core/analysis.ts";
const input = {
  rms: 0.4,
  semiMinor: 120,
  minDimension: 540,
  coverage: 0.99,
  observedFraction: 0.97,
  inlierFraction: 0.96,
  contrast: 0.9,
};
test("distributed high-contrast contour can be used for quantitative analysis", () => {
  assert.equal(assessFit(input).status, "accepted");
});
test("well-fitted visible arcs remain reviewable when much of the ring is missing", () => {
  const assessment = assessFit({
    ...input,
    observedFraction: 0.55,
    coverage: 0.8,
  });
  assert.equal(assessment.status, "review");
  assert.ok(assessment.warnings.some((w) => w.includes("模型推测")));
});
test("featureless data and short arcs cannot produce supported ellipses", () => {
  assert.equal(assessFit({ ...input, contrast: 0 }).status, "unreliable");
  assert.equal(
    assessFit({ ...input, observedFraction: 0.25, coverage: 0.4 }).status,
    "unreliable",
  );
  assert.equal(assessFit({ ...input, rms: 14 }).status, "unreliable");
});
test("poor image evidence is not diagnosed as physical instrument damage", () => {
  const metrics = {
    ratio: 0.8,
    angle: 0,
    centerOffset: 0.1,
    clarity: 0.4,
    asymmetry: 0.2,
    fitQuality: 0.65,
    confidence: 0.6,
    damaged: true,
    fitStatus: "review",
    annotatedImage: "",
    fitMethod: "auto",
    detectedScreen: true,
  };
  const diagnosis = builtinDiagnosis(metrics);
  assert.equal(diagnosis.verdict, "拟合待复核");
  assert.deepEqual(diagnosis.causes, []);
  assert.ok(
    buildAiSuggestions(metrics, diagnosis).every((c) => !c.recommended),
  );
});
