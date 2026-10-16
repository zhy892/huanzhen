import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, compareRounds, inspectResidual, recommend, restore } from '../core/experiment.ts';
const profile = { name: 'test', instrument: 'test', wavelengthNm: 589.3, resolutionMm: .001, pixelPerMm: null, conditions: 'fixed', diameterFactor: 1, factorUncertainty: 0 };
function round(id, ratios, extra = {}) {
  const samples = ratios.map((ratio, i) => ({ id: `${id}-${i}`, name: 'test', image: new Blob(), metrics: { ratio, angle: 0, centerOffset: .01, clarity: .8, asymmetry: .1, fitQuality: .9, confidence: .8, damaged: false } }));
  return { id, time: '2026-01-01', samples, action: 'view', operation: 'view', confounds: '', readings: [], recommendation: recommend(samples), ...extra };
}
const good = [0.999, 0.998, 1];
test('residual screening refuses absent, insufficient and degenerate repetition', () => {
  assert.equal(inspectResidual([]).status, 'insufficient');
  assert.equal(inspectResidual([round('a', [.96, .96])]).status, 'insufficient');
  assert.equal(inspectResidual([round('a', [.96, .96, .96])]).status, 'insufficient');
  const bad = round('a', good); bad.samples[0].metrics.damaged = true;
  assert.equal(inspectResidual([bad]).status, 'insufficient');
});
test('distinguishes detectable shape residual from unresolved measurement noise', () => {
  assert.equal(inspectResidual([round('a', good)]).status, 'not-detected');
  const result = inspectResidual([round('a', [.96, .961, .959])]);
  assert.equal(result.status, 'detected');
  assert.equal(result.adjustmentResolution, undefined);
});
test('history requires three resolved comparable interventions', () => {
  const rounds = [.89, .91, .93, .95].map((q, i) => round(String(i), [q - .0002, q, q + .0002]));
  const result = inspectResidual(rounds);
  assert.equal(result.status, 'adjustable');
  assert.ok(Math.abs(result.adjustmentResolution - .02) < 1e-12);
  rounds[2].confounds = 'camera moved';
  assert.equal(inspectResidual(rounds).adjustmentResolution, undefined);
});
test('comparison distinguishes positive, negative, noisy and confounded changes', () => {
  const a = round('a', [.94, .941, .939]);
  assert.equal(compareRounds(a, round('b', [.97, .971, .969])).label, '支持该假设');
  assert.equal(compareRounds(a, round('b', [.90, .901, .899])).label, '暂不支持该假设');
  assert.equal(compareRounds(a, round('b', [.94, .942, .938])).label, '变化不足以判断');
  assert.equal(compareRounds(a, round('b', [.97, .971, .969], { confounds: 'light changed' })).label, '条件变化，暂不归因');
  assert.equal(compareRounds(a, round('b', [.97, .971, .969], { operation: 'focus' })).label, '操作不匹配');
});
test('regression recovers physical radius and intercept independently of target values', () => {
  for (const radius of [.5, 1.7, 3.2]) {
    const readings = [5, 10, 15, 20, 25].map(order => ({ order, diameter: Math.sqrt(4 * radius * 589.3e-9 * 1e6 * (order + .3)) }));
    const result = calculate(readings, profile);
    assert.ok(Math.abs(result.radius - radius) < 1e-12);
    assert.ok(result.uB > 0 && result.expanded > 0);
  }
});
test('rejects duplicate levels, nonpositive slope and invalid instrument settings', () => {
  assert.equal(calculate([{ order: 1, diameter: 2 }, { order: 1, diameter: 3 }, { order: 2, diameter: 4 }], profile), null);
  assert.equal(calculate([1, 2, 3].map(order => ({ order, diameter: 5 - order })), profile), null);
  assert.equal(calculate([1, 2, 3].map(order => ({ order, diameter: order })), { ...profile, wavelengthNm: Infinity }), null);
});
test('restoration denies stale declarations, no residual, and missing calibration', () => {
  const r = round('a', [.95, .951, .949]);
  const session = { version: 1, id: 's', created: '', profile, rounds: [r], declarations: [], restorations: [] };
  assert.equal(restore(session).tier, 'unavailable');
  session.declarations.push({ id: 'd', time: '', roundIds: ['a'], result: inspectResidual([r]) });
  assert.equal(restore(session).tier, 'unavailable');
  session.profile = { ...profile, diameterFactor: 1.01, factorUncertainty: .001 };
  r.readings = [5, 10, 15].map(order => ({ order, diameter: Math.sqrt(order * 2.3572) }));
  const correction = restore(session);
  assert.equal(correction.tier, 'bounded');
  assert.ok(Math.abs(correction.after - correction.before * 1.01 ** 2) < 1e-12);
  assert.ok(correction.uncertainty > 0);
  session.rounds.push(round('b', good));
  assert.equal(restore(session).tier, 'unavailable');
});

test('shared manual ellipse fitting preserves known geometry', async () => {
  const { fitEllipseFromPoints } = await import('../core/analysis.ts');
  const angle = .4;
  const points = Array.from({ length: 40 }, (_, i) => {
    const t = i / 40 * 2 * Math.PI;
    return { x: (250 + 120 * Math.cos(t) * Math.cos(angle) - 84 * Math.sin(t) * Math.sin(angle)) / 512,
      y: (240 + 120 * Math.cos(t) * Math.sin(angle) + 84 * Math.sin(t) * Math.cos(angle)) / 512 };
  });
  const fit = fitEllipseFromPoints(points, 512, 512);
  assert.ok(fit);
  assert.ok(Math.abs(fit.ratio - .7) < 1e-5);
  assert.ok(Math.abs(fit.centerX - 250) < 1e-4);
  assert.ok(Math.abs(fit.centerY - 240) < 1e-4);
});

test('edited readings invalidate a previous completion declaration', () => {
  const r=round('a',[.95,.951,.949]);
  const session={version:1,id:'s',created:'',measurementRevision:1,profile,rounds:[r],declarations:[{id:'d',time:'',roundIds:['a'],measurementRevision:0,result:inspectResidual([r])}],restorations:[]};
  assert.match(restore(session).reason,/缺少对应当前轮次/);
});

test('repeated uploads remain chartable rounds without counting as independent measurements', async () => {
  const { independentSamples } = await import('../core/experiment.ts');
  const a=round('a',[.95,.951,.949]);
  const repeated=round('b',[.95,.951,.949]);
  repeated.samples.forEach((sample,i)=>{sample.contentHash=a.samples[i].id;sample.reused=true;});
  assert.equal([a,repeated].length,2);
  assert.equal(independentSamples(repeated).length,0);
  assert.equal(inspectResidual([a,repeated]).status,'insufficient');
  assert.equal(compareRounds(a,repeated).label,'证据不足');
  const sameBatch=round('c',[.95,.95,.95]);
  sameBatch.samples.forEach(sample=>{sample.contentHash='same-image';});
  assert.equal(independentSamples(sameBatch).length,1);
});

test('local recording supports browsers without secure-context crypto APIs', async () => {
  const { imageFingerprint, newRecordId } = await import('../core/recording.ts');
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  try {
    Object.defineProperty(globalThis,'crypto',{value:{},configurable:true});
    const a=await imageFingerprint(new Blob(['photo-a']));
    assert.equal(a,await imageFingerprint(new Blob(['photo-a'])));
    assert.notEqual(a,await imageFingerprint(new Blob(['photo-b'])));
    assert.equal(new Set(Array.from({length:20},()=>newRecordId())).size,20);
  } finally {if(descriptor)Object.defineProperty(globalThis,'crypto',descriptor);else delete globalThis.crypto;}
});
