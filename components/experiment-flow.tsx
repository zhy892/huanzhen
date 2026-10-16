"use client";
import { useEffect, useRef, useState } from 'react';
import type { Session } from '../core/experiment';
import { calculate, compareRounds, inspectResidual, restore, summarize } from '../core/experiment';
import { exportSession, importSession, listSessions, saveSession } from '../lib/experiment-store';
import { newRecordId } from "../core/recording";
import RoundTrend from './round-trend';
import '../app/experiment/experiment.css';
function Photo({ image, name }: { image: Blob; name: string }) {
  const ref=useRef<HTMLImageElement>(null);
  useEffect(()=>{const url=URL.createObjectURL(image);if(ref.current) ref.current.src=url;return()=>URL.revokeObjectURL(url);},[image]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} alt={name} loading="lazy"/>;
}
export default function ExperimentFlow({ session, onChange, onResume, onClose }: { session: Session | null; onChange: (s: Session) => void; onResume: (s: Session) => void; onClose: () => void }) {
  const [history, setHistory] = useState<Session[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function run(operation: () => Promise<void>) { setBusy(true); setError(''); try { await operation(); } catch(e) { setError(e instanceof Error ? e.message : '保存失败'); } finally { setBusy(false); } }
  const last = session?.rounds.at(-1); const previous = session?.rounds.at(-2);
  const comparison = previous && last ? compareRounds(previous, last) : null;
  const declaration = session?.declarations.at(-1);
  const current = declaration && (declaration.measurementRevision??0)===(session?.measurementRevision??0) && declaration.roundIds.join(',') === session?.rounds.map(r => r.id).join(',');
  return <div className="flow-overlay" role="dialog" aria-modal="true" aria-label="本次实验记录"><div className="flow-dialog experiment-page">
    <header className="flow-dialog-header"><h2>本次实验记录</h2><button type="button" onClick={onClose}>返回分析 ×</button></header>
    <p>分析和复测自动归入本次实验，无需重复建档。记录保存在当前浏览器，请定期导出备份。</p>
    {error && <p role="alert">{error}</p>}
    <div className="flow-tools"><button disabled={busy} type="button" onClick={() => run(async () => setHistory(await listSessions()))}>查看历史实验</button>{session && <><button disabled={busy} type="button" onClick={() => run(() => exportSession(session))}>导出本次实验</button><button type="button" onClick={() => window.print()}>打印实验记录</button></>}<label>恢复已导出的实验档案<input type="file" accept=".json" disabled={busy} onChange={e => { const file=e.target.files?.[0]; if(file) void run(async()=>onChange(await saveSession(await importSession(file)))); }} /></label></div>
    <p className="archive-help">导入只用于恢复此前导出的 JSON 实验档案（照片、轮次和读数），不是上传实验图片或 Word/PDF 报告。它会建立独立副本，不覆盖现有实验。</p>
    {history.map(s => <button key={s.id} type="button" disabled={busy} onClick={() => onResume(s)}>{s.profile.name} · {s.rounds.length} 轮 · 继续实验</button>)}
    {!session && <p>完成首次圆环分析后，记录会自动出现在这里。</p>}
    {session && <><h3>{session.profile.name} · {session.rounds.length} 轮</h3>
      {comparison && <section className="experiment-panel"><h3>本轮对比：{comparison.label}</h3><p>{comparison.detail}</p><p>轴比 {summarize(previous!, 'ratio').toFixed(4)} → {summarize(last!, 'ratio').toFixed(4)}</p></section>}
      <details className="experiment-panel"><summary>实验参数与标定（选填）</summary><form key={session.id} onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);const wavelengthNm=Number(data.get("wavelength")),resolutionMm=Number(data.get("resolution")),diameterFactor=Number(data.get("factor")),factorUncertainty=Number(data.get("uncertainty"));if([wavelengthNm,resolutionMm,diameterFactor].some(v=>!Number.isFinite(v)||v<=0)||!Number.isFinite(factorUncertainty)||factorUncertainty<0) {setError("请填写有效实验参数。");return;} void run(async()=>onChange(await saveSession({...session,measurementRevision:(session.measurementRevision??0)+1,profile:{...session.profile,conditions:String(data.get("conditions")),wavelengthNm,resolutionMm,diameterFactor,factorUncertainty}})));}}><div className="experiment-fields"><label>波长 / nm<input name="wavelength" type="number" step="any" defaultValue={session.profile.wavelengthNm}/></label><label>直径分辨率 / mm<input name="resolution" type="number" step="any" defaultValue={session.profile.resolutionMm}/></label><label>独立长度系数<input name="factor" type="number" step="any" defaultValue={session.profile.diameterFactor}/></label><label>系数标准不确定度<input name="uncertainty" type="number" step="any" defaultValue={session.profile.factorUncertainty}/></label><label>拍摄条件与标定来源<input name="conditions" defaultValue={session.profile.conditions}/></label></div><p>仅填写独立标定依据，不按预期曲率半径倒算系数。</p><button type="submit" disabled={busy}>保存参数</button></form></details>
      <section className="experiment-panel"><h3>调整完成与残余检验</h3><p>你可以随时确认完成。缺少独立重复测量时，系统会提示数据不足。</p><button disabled={busy} type="button" onClick={() => run(async () => onChange(await saveSession({ ...session, declarations: [...session.declarations, { id: newRecordId(), time: new Date().toISOString(), roundIds: session.rounds.map(r=>r.id), ruleVersion:'residual-screen-v1-unvalidated', measurementRevision:session.measurementRevision??0, result:inspectResidual(session.rounds) }] })))}>我已调整完毕</button>
      {declaration && <><p>{current ? '当前检验' : '数据已更新，需重新确认'}：{declaration.result.message}</p>{current && declaration.result.status==='detected' && <button disabled={busy} type="button" onClick={() => run(async () => onChange(await saveSession({ ...session, restorations:[...session.restorations,restore(session)] })))}>评估残余补偿条件</button>}</>}
      {session.restorations.map((r,i)=><p key={i}>{r.reason}</p>)}</section>
      <RoundTrend rounds={session.rounds}/>
      {session.rounds.map((r,i)=><section className="experiment-panel" key={r.id}><h3>第 {i+1} 轮 · {new Date(r.time).toLocaleString()}</h3><p>{r.action}</p><p>条件变化：{r.confounds || '未记录变化'} · {r.samples.length} 张照片 · 平均轴比 {summarize(r,'ratio').toFixed(4)}</p><p>{r.recommendation.title}：{r.recommendation.expected}</p><div className="round-photos">{r.samples.map(s=><figure key={s.id}><Photo image={s.image} name={s.name}/><figcaption>{s.name} · q={s.metrics.ratio.toFixed(4)}{s.reused ? " · 重复图片，已记录" : ""}</figcaption></figure>)}</div><p>{(()=>{const result=calculate(r.readings,session.profile);return result ? `原始读数回归 R=${result.radius.toFixed(6)} m，U=${result.expanded.toFixed(6)} m（k=2，未包含全部系统不确定度）` : "尚未录入足够读数，不从照片形状推断曲率半径。";})()}</p><p>原始读数：{r.readings.length ? r.readings.map(v=>`${v.order}级 ${v.diameter}mm`).join('；') : '未录入'}</p></section>)}
    </>}
  </div></div>;
}
