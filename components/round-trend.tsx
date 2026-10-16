import { deviation, summarize } from '../core/experiment';
import type { Round } from '../core/experiment';
export default function RoundTrend({ rounds }: { rounds: Round[] }) {
  if (!rounds.length) return null;
  return <section className="experiment-panel"><h2>迭代曲线</h2><p>每次分析都会增加一个轮次，包括重复图片与未改善的记录。曲线显示各轮图像指标，重复图片不计入独立测量检验；误差线为本轮样本标准差，并非置信区间。</p>{(['ratio', 'clarity'] as const).map(key => {
    const values = rounds.map(r => summarize(r, key));
    const spreads = rounds.map(r => { const sd = deviation(r.samples.map(s => s.metrics[key])); return Number.isFinite(sd) ? sd : 0; });
    const low = Math.max(0, Math.min(...values.map((v, i) => v - spreads[i])) - .01), high = Math.min(1, Math.max(...values.map((v, i) => v + spreads[i])) + .01);
    const x = (i: number) => 55 + i / Math.max(1, values.length - 1) * 490;
    const y = (v: number) => 125 - (v - low) / Math.max(.001, high - low) * 90;
    return <figure key={key} style={{ margin: '20px 0' }}><figcaption>{key === 'ratio' ? '短长轴比' : '清晰度'} · 纵轴 {low.toFixed(3)}–{high.toFixed(3)}</figcaption><svg viewBox="0 0 600 160" role="img" aria-label={`${key === 'ratio' ? '轴比' : '清晰度'}随轮次变化`}><path d="M55 25V125H550" stroke="#83988a" fill="none" /><polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} stroke="#176d50" strokeWidth="2" fill="none" />{values.map((v, i) => <g key={rounds[i].id}><line x1={x(i)} x2={x(i)} y1={y(Math.min(1, v + spreads[i]))} y2={y(Math.max(0, v - spreads[i]))} stroke="#176d50" strokeWidth="2" /><circle cx={x(i)} cy={y(v)} r="4" fill="#176d50"><title>第 {i + 1} 轮：{v.toFixed(5)}；{rounds[i].action}</title></circle><text x={x(i)} y="146" textAnchor="middle" fontSize="12">{i + 1}</text></g>)}</svg></figure>;
  })}</section>;
}
