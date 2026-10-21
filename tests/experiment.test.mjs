import test from "node:test";
import assert from "node:assert/strict";
import {
  calculate,
  compareRounds,
  inspectResidual,
  recommend,
  restore,
} from "../core/experiment.ts";
const profile = {
  name: "test",
  instrument: "test",
  wavelengthNm: 589.3,
  resolutionMm: 0.001,
  pixelPerMm: null,
  conditions: "fixed",
  diameterFactor: 1,
  factorUncertainty: 0,
};
function round(id, ratios, extra = {}) {
  const samples = ratios.map((ratio, i) => ({
    id: `${id}-${i}`,
    name: "test",
    image: new Blob(),
    metrics: {
      ratio,
      angle: 0,
      centerOffset: 0.01,
      clarity: 0.8,
      asymmetry: 0.1,
      fitQuality: 0.9,
      confidence: 0.8,
      damaged: false,
    },
  }));
  return {
    id,
    time: "2026-01-01",
    samples,
    action: "view",
    operation: "view",
    confounds: "",
    readings: [],
    recommendation: recommend(samples),
    ...extra,
  };
}
const good = [0.999, 0.998, 1];
test("residual screening refuses absent, insufficient and degenerate repetition", () => {
  assert.equal(inspectResidual([]).status, "insufficient");
  assert.equal(inspectResidual([round("a", [0.96, 0.96])]).status, "insufficient");
  assert.equal(inspectResidual([round("a", [0.96, 0.96, 0.96])]).status, "insufficient");
  const bad = round("a", good);
  bad.samples[0].metrics.damaged = true;
  assert.equal(inspectResidual([bad]).status, "insufficient");
});
test("distinguishes detectable shape residual from unresolved measurement noise", () => {
  assert.equal(inspectResidual([round("a", good)]).status, "not-detected");
  const result = inspectResidual([round("a", [0.96, 0.961, 0.959])]);
  assert.equal(result.status, "detected");
  assert.equal(result.adjustmentResolution, undefined);
});
test("history requires three resolved comparable interventions", () => {
  const rounds = [0.89, 0.91, 0.93, 0.95].map((q, i) =>
    round(String(i), [q - 0.0002, q, q + 0.0002]),
  );
  const result = inspectResidual(rounds);
  assert.equal(result.status, "adjustable");
  assert.ok(Math.abs(result.adjustmentResolution - 0.02) < 1e-12);
  rounds[2].confounds = "camera moved";
  assert.equal(inspectResidual(rounds).adjustmentResolution, undefined);
});
test("comparison distinguishes positive, negative, noisy and confounded changes", () => {
  const a = round("a", [0.94, 0.941, 0.939]);
  assert.equal(compareRounds(a, round("b", [0.97, 0.971, 0.969])).label, "支持该假设");
  assert.equal(compareRounds(a, round("b", [0.9, 0.901, 0.899])).label, "暂不支持该假设");
  assert.equal(compareRounds(a, round("b", [0.94, 0.942, 0.938])).label, "变化不足以判断");
  assert.equal(
    compareRounds(a, round("b", [0.97, 0.971, 0.969], { confounds: "light changed" })).label,
    "条件变化，暂不归因",
  );
  assert.equal(
    compareRounds(a, round("b", [0.97, 0.971, 0.969], { operation: "focus" })).label,
    "操作不匹配",
  );
});
test("regression recovers physical radius and intercept independently of target values", () => {
  for (const radius of [0.5, 1.7, 3.2]) {
    const readings = [5, 10, 15, 20, 25].map((order) => ({
      order,
      diameter: Math.sqrt(4 * radius * 589.3e-9 * 1e6 * (order + 0.3)),
    }));
    const result = calculate(readings, profile);
    assert.ok(Math.abs(result.radius - radius) < 1e-12);
    assert.ok(result.uB > 0 && result.expanded > 0);
  }
});
test("rejects duplicate levels, nonpositive slope and invalid instrument settings", () => {
  assert.equal(
    calculate(
      [
        { order: 1, diameter: 2 },
        { order: 1, diameter: 3 },
        { order: 2, diameter: 4 },
      ],
      profile,
    ),
    null,
  );
  assert.equal(
    calculate(
      [1, 2, 3].map((order) => ({ order, diameter: 5 - order })),
      profile,
    ),
    null,
  );
  assert.equal(
    calculate(
      [1, 2, 3].map((order) => ({ order, diameter: order })),
      { ...profile, wavelengthNm: Infinity },
    ),
    null,
  );
});
test("restoration denies stale declarations, no residual, and missing calibration", () => {
  const r = round("a", [0.95, 0.951, 0.949]);
  const session = {
    version: 1,
    id: "s",
    created: "",
    profile,
    rounds: [r],
    declarations: [],
    restorations: [],
  };
  assert.equal(restore(session).tier, "unavailable");
  session.declarations.push({ id: "d", time: "", roundIds: ["a"], result: inspectResidual([r]) });
  assert.equal(restore(session).tier, "unavailable");
  session.profile = { ...profile, diameterFactor: 1.01, factorUncertainty: 0.001 };
  r.readings = [5, 10, 15].map((order) => ({ order, diameter: Math.sqrt(order * 2.3572) }));
  const correction = restore(session);
  assert.equal(correction.tier, "bounded");
  assert.ok(Math.abs(correction.after - correction.before * 1.01 ** 2) < 1e-12);
  assert.ok(correction.uncertainty > 0);
  session.rounds.push(round("b", good));
  assert.equal(restore(session).tier, "unavailable");
});

test("edited readings invalidate a previous completion declaration", () => {
  const r = round("a", [0.95, 0.951, 0.949]);
  const session = {
    version: 1,
    id: "s",
    created: "",
    measurementRevision: 1,
    profile,
    rounds: [r],
    declarations: [
      { id: "d", time: "", roundIds: ["a"], measurementRevision: 0, result: inspectResidual([r]) },
    ],
    restorations: [],
  };
  assert.match(restore(session).reason, /缺少对应当前轮次/);
});

test("repeated uploads remain chartable rounds without counting as independent measurements", async () => {
  const { independentSamples } = await import("../core/experiment.ts");
  const a = round("a", [0.95, 0.951, 0.949]);
  const repeated = round("b", [0.95, 0.951, 0.949]);
  repeated.samples.forEach((sample, i) => {
    sample.contentHash = a.samples[i].id;
    sample.reused = true;
  });
  assert.equal([a, repeated].length, 2);
  assert.equal(independentSamples(repeated).length, 0);
  assert.equal(inspectResidual([a, repeated]).status, "insufficient");
  assert.equal(compareRounds(a, repeated).label, "证据不足");
  const sameBatch = round("c", [0.95, 0.95, 0.95]);
  sameBatch.samples.forEach((sample) => {
    sample.contentHash = "same-image";
  });
  assert.equal(independentSamples(sameBatch).length, 1);
});

test("local recording supports browsers without secure-context crypto APIs", async () => {
  const { imageFingerprint, newRecordId } = await import("../core/recording.ts");
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  try {
    Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
    const a = await imageFingerprint(new Blob(["photo-a"]));
    assert.equal(a, await imageFingerprint(new Blob(["photo-a"])));
    assert.notEqual(a, await imageFingerprint(new Blob(["photo-b"])));
    assert.equal(new Set(Array.from({ length: 20 }, () => newRecordId())).size, 20);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    else delete globalThis.crypto;
  }
});

test("different fitting versions do not establish an intervention effect", () => {
  const a = round("a", [0.94, 0.941, 0.939], { algorithmVersion: "ring-v1" });
  const b = round("b", [0.98, 0.981, 0.979], { algorithmVersion: "ring-v2" });
  assert.equal(compareRounds(a, b).label, "算法版本不同");
  assert.equal(compareRounds({ ...a, algorithmVersion: undefined }, b).label, "算法版本不同");
});

test("unknown common order offset does not change regression curvature radius", () => {
  const p = { wavelengthNm: 589.3, resolutionMm: 0.001 };
  const data = [0, 5, 10, 15, 20].map((order) => ({
    order,
    diameter: Math.sqrt(6 + order * 0.0024),
  }));
  const a = calculate(data, p),
    b = calculate(
      data.map((r) => ({ ...r, order: r.order + 23 })),
      p,
    );
  assert.ok(a && b);
  assert.ok(Math.abs(a.radius - b.radius) < 1e-12);
  assert.notEqual(a.intercept, b.intercept);
});
test("automatic ring changes and inconsistent shapes are not interpreted as intervention effects", () => {
  const selection = {
    absoluteOrder: null,
    candidateCount: 2,
    checkedRingCount: 2,
    consistency: "consistent",
    ratioSpread: 0.002,
    centerSpread: 0.002,
    scaleFraction: 0.3,
    centerRegionAssessed: false,
  };
  const a = round("a", [0.94, 0.941, 0.939], { algorithmVersion: "ring-v4" }),
    b = round("b", [0.98, 0.981, 0.979], { algorithmVersion: "ring-v4" });
  for (const r of [a, b])
    r.samples.forEach((s) => {
      s.metrics.ringSelection = { ...selection };
    });
  b.samples.forEach((s) => {
    s.metrics.ringSelection.scaleFraction = 0.45;
  });
  assert.equal(compareRounds(a, b).label, "选环依据不足以归因");
  b.samples[0].metrics.ringSelection.scaleFraction = 0.3;
  assert.equal(inspectResidual([b]).status, "insufficient");
  b.samples.forEach((s) => {
    s.metrics.ringSelection = { ...selection, consistency: "single" };
  });
  assert.equal(inspectResidual([b]).status, "insufficient");
  b.samples.forEach((s) => {
    s.metrics.ringSelection = { ...selection, consistency: "inconsistent" };
  });
  assert.equal(inspectResidual([b]).status, "insufficient");
});
