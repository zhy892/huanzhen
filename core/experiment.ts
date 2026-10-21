import type { RingSelection } from "./auto-rings.ts";
import type { ForceCalibration } from "./force-calibration.ts";
export type Observation = {
  ratio: number; angle: number; centerOffset: number; clarity: number;
  asymmetry: number; fitQuality: number; confidence: number; damaged: boolean;
  ringSelection?: RingSelection;
  fitValidation?: import("./subpixel-ring.ts").FitValidation;
};
export type Reading = { order: number; diameter: number };
export type Profile = {
  kind?: "experiment" | "simulation";
  name: string; instrument: string; wavelengthNm: number; resolutionMm: number;
  pixelPerMm: number | null; conditions: string; diameterFactor: number;
  factorUncertainty: number;
};
export type Sample = { contentHash?: string; reused?: boolean; id: string; image: Blob; metrics: Observation; name: string };
export type Round = {
  algorithmVersion?: string; id: string; time: string; action: string; operation: string; confounds: string;
  samples: Sample[]; readings: Reading[]; recommendation: Recommendation;
};
export type Recommendation = { id: string; title: string; evidence: string; action: string; expected: string; metric: 'ratio' | 'clarity' | 'centerOffset' | 'asymmetry'; direction: 1 | -1 };
export type Residual = {
  status: 'insufficient' | 'adjustable' | 'detected' | 'not-detected';
  message: string; deviation?: number; uncertainty?: number; repeatability?: number;
  adjustmentResolution?: number; historyCount: number;
};
export type Declaration = { measurementRevision?: number; ruleVersion?: string; id: string; time: string; roundIds: string[]; result: Residual };
export type Restoration = { time: string; declarationId: string; tier: 'restored' | 'bounded' | 'unavailable'; reason: string; before?: number; after?: number; amount?: number; uncertainty?: number };
export type Session = { forceCalibration?: ForceCalibration; measurementRevision?: number; revision?: number; version: 1; id: string; created: string; profile: Profile; rounds: Round[]; declarations: Declaration[]; restorations: Restoration[] };

export function mean(values: number[]) { return values.reduce((a, b) => a + b, 0) / values.length; }
export function deviation(values: number[]) {
  const m = mean(values);
  return values.length > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1)) : NaN;
}
function critical95(n: number) {
  const table = [NaN, NaN, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262];
  return n <= 10 ? table[n] : n <= 20 ? 2.262 : n <= 30 ? 2.093 : 2.045;
}
export function independentSamples(round: Round): Sample[] {
  const seen = new Set<string>();
  return round.samples.filter(sample => {
    const key = sample.contentHash ?? sample.id;
    if (sample.reused || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
export function summarize(round: Round, key: keyof Observation) {
  return mean(round.samples.map(s => Number(s.metrics[key])));
}
export function recommend(samples: Array<{ metrics: Observation }>): Recommendation {
  const m = (key: keyof Observation) => mean(samples.map(s => Number(s.metrics[key])));
  if (samples.some(s => s.metrics.damaged) || m('clarity') < 0.3) return {
    id: 'focus', title: '先检查成像条件', evidence: '轮廓质量不足，当前不宜推断仪器误差。',
    action: '保持仪器设置，检查对焦与照明；涉及接触面操作时请参照仪器说明或请教教师。',
    expected: '清晰度提高，且轮廓完整性不下降，再检查形状。', metric: 'clarity', direction: 1,
  };
  if(samples.some(s=>s.metrics.ringSelection?.consistency==='inconsistent'))return {
    id:'repeat',title:'复拍核对多环差异',evidence:'可见环的轴比或圆心不一致，不能使用单一几何原因解释。',action:'保持仪器设置和拍摄尺度，复拍排查污斑、反光与局部成像差异。',expected:'先确认多环差异能否重复，再讨论局部形变；不统一补偿读数。',metric:'clarity',direction:1,
  };
  if (m('ratio') < 0.975) return {
    id: 'view', title: '验证观察方向的影响', evidence: `平均短长轴比 ${m('ratio').toFixed(4)}；倾斜、透视和比例失真均可能产生此现象。`,
    action: '本轮仅检查观察方向与实验平面的关系，尽量保持距离、焦距和照明一致。',
    expected: '若轴比增大且清晰度保持，更支持观察方向这一解释；不能据此排除比例失真。', metric: 'ratio', direction: 1,
  };
  if (m('centerOffset') > 0.1) return {
    id: 'center', title: '复核取景与读数轴', evidence: '环心相对成像区域中心存在偏移；这不等同于实际读数轴偏心。',
    action: '检查十字线与实际环心的关系，记录是否改变了取景位置。',
    expected: '偏移减小、轴比与清晰度保持；只有独立确认读数轴后才能判断弦长误差。', metric: 'centerOffset', direction: -1,
  };
  return {
    id: 'repeat', title: '检查同设置重复性', evidence: '当前图像未触发明显形状异常规则，仍需重复测量。',
    action: '保持仪器、拍摄位置和照明不变，重新拍摄并重复读数。',
    expected: '指标与读数波动较小；若发生系统变化，记录环境与操作因素。', metric: 'ratio', direction: 1,
  };
}
export function comparableRingRegions(samples:Sample[]):boolean {
  const selections=samples.map(s=>s.metrics.ringSelection);
  if(selections.every(s=>!s))return true; // Historical records retain their old rules.
  if(selections.some(s=>!s || s.consistency!=="consistent"))return false;
  const scales=selections.map(s=>s!.scaleFraction);
  return scales.every(s=>Number.isFinite(s)&&s>0) && Math.max(...scales)/Math.min(...scales)<1.15;
}
export function compareRounds(a: Round, b: Round) {
  if((a.algorithmVersion??"ring-v1")!==(b.algorithmVersion??"ring-v1")) return {label:"算法版本不同",detail:"旧版与新版的识别方法不同，变化仅供查看，不能归因为仪器调整；请用新版重新建立基线。"};
  if(!comparableRingRegions([...a.samples,...b.samples])) return {label:"选环依据不足以归因",detail:"自动选环的范围发生变化，或缺少多环一致性复核。曲线保留作形状对比，不能将选环差异直接解释为仪器调整效果。"};
  if(b.operation === "unrecorded") return {label:"仅比较变化",detail:"本轮未补充具体操作，已保存指标变化；不自动把变化归因于建议操作。"};
  if (a.confounds || b.confounds) return { label: '条件变化，暂不归因', detail: '存在拍摄或设置变化；保留差异，但不将变化归因于单项调整。' };
  const aSamples=independentSamples(a), bSamples=independentSamples(b);
  if (aSamples.length < 3 || bSamples.length < 3 || [...aSamples, ...bSamples].some(s => s.metrics.damaged)) return { label: '证据不足', detail: '每轮至少需要 3 次独立有效测量；重复图片会保留记录，但不作为独立测量。此数量是初始采集要求，并非精度保证。' };
  if (b.operation !== a.recommendation.id) return { label: '操作不匹配', detail: '本轮未验证上一轮推荐的操作，不能判断该假设是否得到支持。' };
  const key = a.recommendation.metric;
  const av = aSamples.map(s => s.metrics[key]); const bv = bSamples.map(s => s.metrics[key]);
  const delta = (mean(bv) - mean(av)) * a.recommendation.direction;
  const se = Math.sqrt(deviation(av) ** 2 / av.length + deviation(bv) ** 2 / bv.length);
  // Use the smaller sample size for a conservative screening bound.
  const limit = critical95(Math.min(av.length, bv.length)) * se;
  if (Math.abs(delta) <= limit || se === 0) return { label: '变化不足以判断', detail: '变化未超过重复性筛查界限，或重复数据未提供可估计的噪声。' };
  if (delta > 0 && summarize(b, 'clarity') < summarize(a, 'clarity') - 0.05) return { label: '指标变化存在权衡', detail: '目标指标改善但清晰度下降，暂不支持单一原因解释。' };
  return { label: delta > 0 ? '支持该假设' : '暂不支持该假设', detail: '这是基于重复性和预期方向的筛查，仍需独立实验验证，不构成因果证明。' };
}
export function inspectResidual(rounds: Round[]): Residual {
  const last = rounds.at(-1);
  const base = { historyCount: rounds.length };
  const samples=last ? independentSamples(last) : [];
  if (!last || samples.length < 3 || samples.some(s => s.metrics.damaged)) return { ...base, status: 'insufficient', message: '最近一轮需要至少 3 张质量合格的独立照片。各次上传均已记录，重复图片不计入独立测量。' };
  if(!comparableRingRegions(samples)) return {...base,status:"insufficient",message:"本轮自动选环范围不一致或缺少多环复核。请保持拍摄尺度并拍到多条清晰暗环；不能混用不同局部环的轴比估计重复性。记录仍可输出。"};
  const q = samples.map(s => s.metrics.ratio);
  const sd = deviation(q); const residual = 1 - mean(q);
  if (!Number.isFinite(sd) || sd <= 1e-8) return { ...base, status: 'insufficient', message: '重复数据没有可估计的波动。请独立重新拍摄；不能以零波动证明无误差。' };
  const uncertainty = critical95(q.length) * sd / Math.sqrt(q.length);
  const validChanges: number[] = [];
  for (let i = 1; i < rounds.length; i++) {
    const a = {...rounds[i - 1],samples:independentSamples(rounds[i - 1])}, b = {...rounds[i],samples:independentSamples(rounds[i])};
    if (!comparableRingRegions([...a.samples,...b.samples]) || ((a.algorithmVersion??"ring-v1")!==(b.algorithmVersion??"ring-v1")) || a.confounds || b.confounds || b.operation !== 'view' || a.samples.length < 3 || b.samples.length < 3 || [...a.samples, ...b.samples].some(s => s.metrics.damaged)) continue;
    const change = Math.abs(summarize(a, 'ratio') - summarize(b, 'ratio'));
    const noise = critical95(Math.min(a.samples.length, b.samples.length)) * Math.sqrt(deviation(a.samples.map(s => s.metrics.ratio)) ** 2 / a.samples.length + deviation(b.samples.map(s => s.metrics.ratio)) ** 2 / b.samples.length);
    if (change > noise) validChanges.push(change);
  }
  const adjustmentResolution = validChanges.length >= 3 ? Math.min(...validChanges) : undefined;
  const details = { ...base, deviation: residual, uncertainty, repeatability: sd, adjustmentResolution };
  if (residual <= uncertainty) return { ...details, status: 'not-detected', message: '当前轴比偏离未超过重复性筛查界限。仅表示本次未检出形状残余，不证明不存在其他系统误差。' };
  if (adjustmentResolution !== undefined && residual > adjustmentResolution) return { ...details, status: 'adjustable', message: '已检出形状残余，其量级大于历史中可分辨的同类调整变化，建议再次验证观察方向。用户仍可结束实验。' };
  return { ...details, status: 'detected', message: '已检出形状残余。现有记录不能证明已超出人工调整能力；可检查是否有独立标定支持补偿，不能直接把椭圆拉成圆。' };
}
export function calculate(readings: Reading[], profile: Profile) {
  if (readings.length < 3 || new Set(readings.map(r => r.order)).size !== readings.length || readings.some(r => !Number.isFinite(r.order) || r.order < 0 || !Number.isFinite(r.diameter) || r.diameter <= 0)) return null;
  if (!Number.isFinite(profile.wavelengthNm) || !Number.isFinite(profile.resolutionMm) || !(profile.wavelengthNm > 0) || !(profile.resolutionMm > 0)) return null;
  const x = readings.map(r => r.order), y = readings.map(r => r.diameter ** 2);
  const mx = mean(x), my = mean(y), sxx = x.reduce((s, v) => s + (v - mx) ** 2, 0);
  if (!sxx) return null;
  const slope = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0) / sxx;
  if (slope <= 0) return null;
  const intercept = my - slope * mx;
  const residuals = x.map((v, i) => y[i] - intercept - slope * v);
  const variance = residuals.reduce((s, v) => s + v * v, 0) / (x.length - 2);
  const slopeA = Math.sqrt(variance / sxx);
  // Input is a direct diameter reading; resolution is a rounding interval.
  const diameterU = profile.resolutionMm / Math.sqrt(12);
  const slopeB = Math.sqrt(readings.reduce((s, r) => s + ((r.order - mx) / sxx * 2 * r.diameter * diameterU) ** 2, 0));
  const conversion = 1e-6 / (4 * profile.wavelengthNm * 1e-9);
  return { radius: slope * conversion, intercept, slope, residuals, uA: slopeA * conversion, uB: slopeB * conversion, expanded: 2 * Math.hypot(slopeA, slopeB) * conversion };
}
export function restore(session: Session): Restoration {
  const declaration = session.declarations.at(-1);
  const base = { time: new Date().toISOString(), declarationId: declaration?.id ?? '', tier: 'unavailable' as const };
  if (!declaration || (declaration.measurementRevision??0)!==(session.measurementRevision??0) || declaration.roundIds.join(',') !== session.rounds.map(r => r.id).join(',')) return { ...base, reason: '缺少对应当前轮次的完成声明，请重新检验。' };
  if (declaration.result.status !== 'detected' || inspectResidual(session.rounds).status !== 'detected') return { ...base, reason: '当前检验未满足进入残余补偿评估的条件。' };
  const p = session.profile; const measured = calculate(session.rounds.at(-1)!.readings, p);
  if (!measured || !Number.isFinite(p.diameterFactor) || p.diameterFactor <= 0 || p.diameterFactor === 1 || !Number.isFinite(p.factorUncertainty) || p.factorUncertainty <= 0) return { ...base, reason: '没有独立长度标定系数及其标准不确定度，无法给出唯一还原值。轴比残余本身不能确定曲率半径补偿量。' };
  const k = p.diameterFactor; const after = measured.radius * k * k;
  const uncertainty = 2 * Math.hypot(measured.expanded / 2 * k * k, 2 * measured.radius * k * p.factorUncertainty);
  return { ...base, tier: 'bounded', before: measured.radius, after, amount: after - measured.radius, uncertainty, reason: '仅按独立长度标定进行条件性补偿；未补偿图像形状残余。扩展不确定度 k=2，尚未包含波长、相关读数及模型失配，不能宣称完整还原。' };
}

