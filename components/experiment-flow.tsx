"use client";
import { useEffect, useRef, useState } from 'react';
import type { Session } from '../core/experiment';
import { calculate, compareRounds, inspectResidual, restore, summarize } from '../core/experiment';
import { exportSession, listSessions, saveSession } from '../lib/experiment-store';
import { newRecordId } from "../core/recording";
import RoundTrend from './round-trend';
import '../app/experiment/experiment.css';
function Photo({ image, name }: { image: Blob; name: string }) {
  const ref=useRef<HTMLImageElement>(null);
  useEffect(()=>{const url=URL.createObjectURL(image);if(ref.current) ref.current.src=url;return()=>URL.revokeObjectURL(url);},[image]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} alt={name} loading="lazy"/>;
}
export default function ExperimentFlow({ session, onChange, onResume, onClose, embedded = false, notice = "" }: { embedded?: boolean; notice?: string; session: Session | null; onChange: (s: Session) => void; onResume: (s: Session) => void; onClose: () => void }) {
  const recordDetails = useRef<HTMLDetailsElement>(null);
  function outputRecord() {
    void run(async () => {
      if (recordDetails.current) recordDetails.current.open = true;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const images = Array.from(recordDetails.current?.querySelectorAll('img') ?? []);
      // Load offscreen round photos before decoding them for the printed record.
      images.forEach(image => { image.loading = 'eager'; });
      await Promise.all(images.map(image => image.decode().catch(() => undefined)));
      window.print();
    });
  }
  const [history, setHistory] = useState<Session[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function run(operation: () => Promise<void>) { setBusy(true); setError(''); try { await operation(); } catch(e) { setError(e instanceof Error ? e.message : '保存失败'); } finally { setBusy(false); } }
  const last = session?.rounds.at(-1); const previous = session?.rounds.at(-2);
  const comparison = previous && last ? compareRounds(previous, last) : null;
  const declaration = session?.declarations.at(-1);
  const current = declaration && (declaration.measurementRevision??0)===(session?.measurementRevision??0) && declaration.roundIds.join(',') === session?.rounds.map(r => r.id).join(',');
  return <section className={embedded ? "experiment-dock experiment-page" : "flow-overlay"} role={embedded ? "region" : "dialog"} aria-modal={embedded ? undefined : true} aria-label="本次实验记录"><div className={embedded ? "experiment-dock-inner" : "flow-dialog experiment-page"}>
    <header className="flow-dialog-header"><div><p className="dock-eyebrow">实验进程</p><h2>本次实验{session ? ` · ${session.rounds.length} 轮` : "记录"}</h2></div>{session && session.rounds.length > 0 && <button type="button" disabled={busy} onClick={outputRecord}>输出实验记录</button>}{!embedded && <button type="button" onClick={onClose}>返回分析 ×</button>}</header>
    <p className="dock-description">完成一次分析即可查看和输出实验记录，不限制照片数量；复测会自动续记。</p>
    {notice && <p className="flow-save-note" role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    {session && <>
      {comparison && <p className="dock-comparison"><b>本轮对比：{comparison.label}</b> · 轴比 {summarize(previous!, 'ratio').toFixed(4)} → {summarize(last!, 'ratio').toFixed(4)}<br/><small>{comparison.detail}</small></p>}
      <RoundTrend rounds={session.rounds}/>
      <section className="dock-completion"><div><h3>调整到满意后，再检验残余</h3><p>残余检验为可选步骤；样本不足不影响实验记录输出。</p></div><button disabled={busy} type="button" onClick={() => run(async () => onChange(await saveSession({ ...session, declarations: [...session.declarations, { id: newRecordId(), time: new Date().toISOString(), roundIds: session.rounds.map(r=>r.id), ruleVersion:'residual-screen-v1-unvalidated', measurementRevision:session.measurementRevision??0, result:inspectResidual(session.rounds) }] })))}>我已调整完毕，检验残余</button></section>
      {declaration && <div className="dock-residual" role="status"><b>{current ? '当前检验' : '数据已更新，需重新确认'}</b><p>{declaration.result.message}</p>{declaration.result.status === "insufficient" && <p>本次实验记录已保存，可以直接点击“输出实验记录”；补拍仅用于进一步检验残余。</p>}{current && declaration.result.status==='detected' && <button disabled={busy} type="button" onClick={() => run(async () => onChange(await saveSession({ ...session, restorations:[...session.restorations,restore(session)] })))}>评估残余补偿条件</button>}</div>}
      {session.restorations.map((r,i)=><p key={i}>{r.reason}</p>)}
    </>}
    <details ref={recordDetails} className="dock-details"><summary>{session ? `展开完整记录与参数 · ${session.rounds.length} 轮` : '查看历史实验'}</summary>
    <div className="flow-tools"><button disabled={busy} type="button" onClick={() => run(async () => setHistory((await listSessions()).filter(item=>item.profile.kind !== "simulation")))}>加载历史实验</button>{session && <><button disabled={busy} type="button" onClick={() => run(() => exportSession(session))}>导出本次实验</button></>}</div>
    <p className="archive-help">实验自动保存在当前浏览器；需要备份时可导出记录。</p>
    {history.map(s => <button key={s.id} type="button" disabled={busy} onClick={() => onResume(s)}>{s.profile.name} · {s.rounds.length} 轮 · 继续实验</button>)}
    {!session && <p>完成首次圆环分析后，记录会自动出现在这里。</p>}
    {session && <><h3>{session.profile.name} · {session.rounds.length} 轮</h3>
      <details className="experiment-panel"><summary>实验参数与标定（选填）</summary><form key={session.id} onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);const wavelengthNm=Number(data.get("wavelength")),resolutionMm=Number(data.get("resolution")),diameterFactor=Number(data.get("factor")),factorUncertainty=Number(data.get("uncertainty"));if([wavelengthNm,resolutionMm,diameterFactor].some(v=>!Number.isFinite(v)||v<=0)||!Number.isFinite(factorUncertainty)||factorUncertainty<0) {setError("请填写有效实验参数。");return;} void run(async()=>onChange(await saveSession({...session,measurementRevision:(session.measurementRevision??0)+1,profile:{...session.profile,conditions:String(data.get("conditions")),wavelengthNm,resolutionMm,diameterFactor,factorUncertainty}})));}}><div className="experiment-fields"><label>波长 / nm<input name="wavelength" type="number" step="any" defaultValue={session.profile.wavelengthNm}/></label><label>直径分辨率 / mm<input name="resolution" type="number" step="any" defaultValue={session.profile.resolutionMm}/></label><label>独立长度系数<input name="factor" type="number" step="any" defaultValue={session.profile.diameterFactor}/></label><label>系数标准不确定度<input name="uncertainty" type="number" step="any" defaultValue={session.profile.factorUncertainty}/></label><label>拍摄条件与标定来源<input name="conditions" defaultValue={session.profile.conditions}/></label></div><p>仅填写独立标定依据，不按预期曲率半径倒算系数。</p><button type="submit" disabled={busy}>保存参数</button></form></details>
      {session.rounds.map((r,i)=><section className="experiment-panel" key={r.id}><h3>第 {i+1} 轮 · {new Date(r.time).toLocaleString()}</h3><p>{r.action.replace("（未补充操作细节）", "")}</p><details className="round-operation-edit"><summary>补充或修改本轮操作</summary><form onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);const action=String(form.get("action")??"").trim();const operation=String(form.get("operation")??"unrecorded");const confounds=String(form.get("confounds")??"").trim();void run(async()=>onChange(await saveSession({...session,measurementRevision:(session.measurementRevision??0)+1,rounds:session.rounds.map(item=>item.id===r.id?{...item,action:action||"调整后复测",operation:action?operation:"unrecorded",confounds}:item)})));}}><label>实际调整<input name="action" defaultValue={r.operation==="unrecorded"?"":r.action} placeholder="例如：调整观察方向，重新对焦"/></label><label>操作类型<select name="operation" defaultValue={r.operation}><option value="unrecorded">未指定</option><option value="view">观察方向</option><option value="focus">对焦与照明</option><option value="center">取景与读数轴</option><option value="repeat">同设置重复测量</option><option value="other">其他操作</option></select></label><label>拍摄或光照变化<input name="confounds" defaultValue={r.confounds}/></label><button disabled={busy} type="submit">保存本轮操作</button></form></details><p>条件变化：{r.confounds || '未记录变化'} · {r.samples.length} 张照片 · 平均轴比 {summarize(r,'ratio').toFixed(4)}</p><p>{r.recommendation.title}：{r.recommendation.expected}</p><div className="round-photos">{r.samples.map(s=><figure key={s.id}><Photo image={s.image} name={s.name}/><figcaption>{s.name} · q={s.metrics.ratio.toFixed(4)}{s.reused ? " · 重复图片，已记录" : ""}</figcaption></figure>)}</div>{r.readings.length > 0 && <p>{(()=>{const result=calculate(r.readings,session.profile);return result ? `原始读数回归 R=${result.radius.toFixed(6)} m，U=${result.expanded.toFixed(6)} m（k=2，未包含全部系统不确定度）` : null;})()}</p>}{r.readings.length > 0 && <p>原始读数：{r.readings.map(v=>`${v.order}级 ${v.diameter}mm`).join('；')}</p>}</section>)}
    </>}
    </details>
  </div></section>;
}
