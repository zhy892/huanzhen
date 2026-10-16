"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Use document navigation to avoid vinext beta RSC link failures. */

import { useEffect, useRef, useState } from 'react';
import { calculate, compareRounds, inspectResidual, recommend, restore, summarize } from '../../core/experiment';
import type { Profile, Round, Sample, Session } from '../../core/experiment';
import RoundTrend from '../../components/round-trend';
import { exportSession, importSession, listSessions, saveSession } from '../../lib/experiment-store';
import './experiment.css';

const defaults: Profile = { name: '', instrument: '', wavelengthNm: 589.3, resolutionMm: 0.001, pixelPerMm: null, conditions: '', diameterFactor: 1, factorUncertainty: 0 };
const operations = [['view', '观察方向'], ['focus', '对焦与照明'], ['center', '取景与读数轴'], ['repeat', '保持设置，重复测量'], ['other', '其他或同时改变多项']];
const labels = { insufficient: '数据不足，无法判断', adjustable: '建议继续调整', detected: '检出形状残余', 'not-detected': '未检出显著形状残余' };
function display(n: number | undefined, digits = 4) { return n !== undefined && Number.isFinite(n) ? n.toFixed(digits) : '—'; }
function Photo({ image, name }: { image: Blob; name: string }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => { const url = URL.createObjectURL(image); if (ref.current) ref.current.src = url; return () => URL.revokeObjectURL(url); }, [image]);
  // Local Blob URLs contain experiment images, not remote resources.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} alt={name} loading="lazy" />;
}
export default function Experiment() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile>(defaults);
  const [files, setFiles] = useState<File[]>([]);
  const [readingText, setReadingText] = useState('');
  const [action, setAction] = useState(''); const [operation, setOperation] = useState('repeat'); const [confounds, setConfounds] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [progress, setProgress] = useState('');
  const [comparisonIds, setComparisonIds] = useState<[string, string]>(['', '']);
  const [storageReady, setStorageReady] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    listSessions().then(items => { setSessions(items); setStorageReady(true); }).catch(() => setError('无法打开本机实验存储。请检查浏览器是否允许 IndexedDB，已有云端仓库不受影响。'));
  }, []);
  async function persist(next: Session) {
    const saved = await saveSession(next); setSession(saved);
    setSessions(items => [saved, ...items.filter(item => item.id !== saved.id)]);
  }
  async function create() {
    setError('');
    if ((profile.pixelPerMm !== null && (!Number.isFinite(profile.pixelPerMm) || profile.pixelPerMm <= 0)) || !profile.name.trim() || !profile.instrument.trim() || !profile.conditions.trim() || !(profile.wavelengthNm > 0) || !Number.isFinite(profile.wavelengthNm) || !(profile.resolutionMm > 0) || !Number.isFinite(profile.resolutionMm)) { setError('请填写实验名称、仪器、拍摄条件及有效波长和读数分辨率。'); return; }
    if (!Number.isFinite(profile.diameterFactor) || profile.diameterFactor <= 0 || !Number.isFinite(profile.factorUncertainty) || profile.factorUncertainty < 0) { setError('独立长度标定参数无效。'); return; }
    setBusy(true);
    try { await persist({ version: 1, id: crypto.randomUUID(), created: new Date().toISOString(), profile: { ...profile }, rounds: [], declarations: [], restorations: [] }); }
    catch { setError('实验未保存，请检查浏览器存储空间。'); }
    finally { setBusy(false); }
  }
  async function addRound() {
    if (!session) return;
    setError('');
    if (!files.length || !action.trim()) { setError('请选择照片，并记录本轮实际操作；基线轮可填写“未调整”。'); return; }
    if (files.length > 8 || files.some(file => file.size > 15 * 1024 * 1024 || !file.type.startsWith('image/'))) { setError('每轮最多 8 张图片，每张不超过 15 MB。'); return; }
    const readings = [];
    try {
      for (const line of readingText.split('\n').filter(s => s.trim())) {
        const cells = line.trim().split(/[,，\s]+/);
        if (cells.length !== 2) throw new Error();
        const [order, diameter] = cells.map(Number);
        if (!Number.isInteger(order) || order < 0 || !Number.isFinite(diameter) || diameter <= 0) throw new Error();
        readings.push({ order, diameter });
      }
      if (readings.length && !calculate(readings, session.profile)) throw new Error();
    } catch { setError('读数格式为每行“级次,直径(mm)”，至少 3 个不同级次，且 D² 应总体随级次增大。也可以暂不填写读数。'); return; }
    setBusy(true);
    try {
      const hashes = await Promise.all(files.map(async f => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await f.arrayBuffer()))).map(v => v.toString(16).padStart(2, '0')).join('')));
      const existing = new Set(session.rounds.flatMap(r => r.samples.map(s => s.id)));
      if (new Set(hashes).size !== hashes.length || hashes.some(h => existing.has(h))) throw new Error('包含重复照片。重复测量需要重新独立拍摄，不能重复提交同一文件。');
      const { inspectImage } = await import('../../core/analysis');
      const samples: Sample[] = [];
      for (let i = 0; i < files.length; i++) {
        setProgress(`正在分析 ${i + 1}/${files.length}`);
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const { annotatedImage: _annotated, ...metrics } = await inspectImage(files[i], [], false);
        void _annotated;
        samples.push({ id: hashes[i], image: files[i], name: files[i].name, metrics });
      }
      const round: Round = { algorithmVersion: 'ring-v1', id: crypto.randomUUID(), time: new Date().toISOString(), samples, readings, operation, action: action.trim(), confounds: confounds.trim(), recommendation: recommend(samples) };
      await persist({ ...session, rounds: [...session.rounds, round] });
      const previous = session.rounds.at(-1); if (previous) setComparisonIds([previous.id, round.id]);
      setFiles([]); setAction(''); setConfounds(''); setReadingText(''); if (fileInput.current) fileInput.current.value = '';
    } catch (e) { setError(e instanceof Error ? e.message : '本轮未保存，请重试。'); }
    finally { setBusy(false); setProgress(''); }
  }
  async function declare() {
    if (!session) return; setBusy(true); setError('');
    try { await persist({ ...session, declarations: [...session.declarations, { ruleVersion: 'residual-screen-v1-unvalidated', id: crypto.randomUUID(), time: new Date().toISOString(), roundIds: session.rounds.map(r => r.id), result: inspectResidual(session.rounds) }] }); }
    catch (e) { setError(e instanceof Error ? e.message : '完成声明未保存，请重试。'); } finally { setBusy(false); }
  }
  async function assess() {
    if (!session) return; setBusy(true); setError('');
    try { await persist({ ...session, restorations: [...session.restorations, restore(session)] }); }
    catch (e) { setError(e instanceof Error ? e.message : '补偿评估未保存，请重试。'); } finally { setBusy(false); }
  }
  const last = session?.rounds.at(-1);
  const declaration = session?.declarations.at(-1);
  const currentDeclaration = declaration && declaration.roundIds.join(',') === session?.rounds.map(r => r.id).join(',');
  const restoration = session?.restorations.at(-1);
  const a = session?.rounds.find(r => r.id === comparisonIds[0]); const b = session?.rounds.find(r => r.id === comparisonIds[1]);
  const comparison = a && b && a.id !== b.id ? (session!.rounds.indexOf(a) < session!.rounds.indexOf(b) ? compareRounds(a, b) : { label: '轮次顺序无效', detail: '请选择较早轮次作为调整前、较晚轮次作为调整后。' }) : null;
  return <main className="experiment-page">
    <header className="experiment-header"><a href="/">环真 / 单次分析</a><span>迭代实验 · <a href="/simulation">仿真测试</a></span></header>
    <h1>先调整，再复核。</h1><p>记录原因假设、实际调整与复测结果。由你确认调整完毕，再检查残余。</p>
    <p className="storage-note">档案仅保存在当前浏览器，不上传照片。浏览器清理可能导致记录丢失，请定期导出完整档案；不提供跨设备或永久保存保证。</p>
    {error && <p className="experiment-error" role="alert">{error}</p>}
    <section className="experiment-panel no-print"><h2>实验档案</h2>
      <label>打开已有实验<select disabled={busy} value={session?.id ?? ''} onChange={e => { setSession(sessions.find(s => s.id === e.target.value) ?? null); setError(''); setFiles([]); setReadingText(''); setAction(''); setConfounds(''); setComparisonIds(['', '']); if (fileInput.current) fileInput.current.value = ''; }}><option value="">新建实验</option>{sessions.map(s => <option key={s.id} value={s.id}>{s.profile.name} · {s.rounds.length} 轮</option>)}</select></label>
      {!session && <><label>导入完整档案<input type="file" accept=".json,application/json" disabled={busy || !storageReady} onChange={async e => { const f = e.target.files?.[0]; if (!f) return; setBusy(true); setError(''); try { await persist(await importSession(f)); } catch (error) { setError(error instanceof Error ? error.message : '导入失败'); } finally { setBusy(false); } }} /></label><div className="experiment-fields">
        <label>实验名称<input value={profile.name} onChange={e => setProfile({ ...profile, name: e.target.value })} /></label>
        <label>仪器信息<input value={profile.instrument} onChange={e => setProfile({ ...profile, instrument: e.target.value })} /></label>
        <label>波长 / nm<input type="number" min="1" value={profile.wavelengthNm} onChange={e => setProfile({ ...profile, wavelengthNm: Number(e.target.value) })} /></label>
        <label>直径读数分辨率 / mm<input type="number" min="0.000001" step="any" value={profile.resolutionMm} onChange={e => setProfile({ ...profile, resolutionMm: Number(e.target.value) })} /></label>
        <label>比例尺 / 像素每毫米（可空）<input type="number" min="0.000001" step="any" value={profile.pixelPerMm ?? ''} onChange={e => setProfile({ ...profile, pixelPerMm: e.target.value ? Number(e.target.value) : null })} /></label>
      </div><label htmlFor="profile-conditions">拍摄条件与比例尺来源</label><textarea id="profile-conditions" value={profile.conditions} onChange={e => setProfile({ ...profile, conditions: e.target.value })} placeholder="记录距离、焦距、光源、参考刻尺等；没有尺度标定时只能分析形状。" />
      <details><summary>独立长度标定（可选）</summary><p>仅填写独立标准件测得的实际长度/读数长度及标准不确定度，不得按预期曲率半径倒算。比例尺暂不自动用于图像直径测量。</p><div className="experiment-fields"><label>长度系数 k<input type="number" step="any" min="0" value={profile.diameterFactor} onChange={e => setProfile({ ...profile, diameterFactor: Number(e.target.value) })} /></label><label>系数标准不确定度 u(k)<input type="number" step="any" min="0" value={profile.factorUncertainty} onChange={e => setProfile({ ...profile, factorUncertainty: Number(e.target.value) })} /></label></div></details>
      <button type="button" disabled={busy || !storageReady} onClick={create}>建立档案</button></>}
      {session && <><p>{session.profile.name} · {session.profile.instrument} · λ={session.profile.wavelengthNm} nm · 分辨率 {session.profile.resolutionMm} mm</p><p>{session.profile.conditions}</p><button type="button" disabled={busy} onClick={() => exportSession(session).catch(() => setError('导出失败，请重试。'))}>导出完整档案（含照片）</button> <button type="button" onClick={() => window.print()}>打印全过程报告</button></>}
    </section>
    {session && <>
      {last && <section className="experiment-panel"><h2>下一轮只验证一项</h2><h3>{last.recommendation.title}</h3><p><b>观测依据：</b>{last.recommendation.evidence}</p><p><b>建议操作：</b>{last.recommendation.action}</p><p><b>预期变化：</b>{last.recommendation.expected}</p><small>候选原因尚待验证，不提供未经标定的故障概率。压力及接触面操作请遵循仪器说明和教师指导。</small></section>}
      <section className="experiment-panel no-print"><h2>{last ? `第 ${session.rounds.length + 1} 轮复测` : '基线测量'}</h2><p>建议同设置独立拍摄 3–5 张。未满 3 张仍可存档，但不进行残余检验。当前只分析单环形状，不推断多环漂移。</p>
        <label>实验照片<input ref={fileInput} type="file" accept="image/*" multiple disabled={busy} onChange={e => setFiles(Array.from(e.target.files ?? []))} /></label>
        <label>本轮操作类型<select value={operation} onChange={e => setOperation(e.target.value)}>{operations.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
        <label htmlFor="round-action">实际调整记录</label><textarea id="round-action" value={action} onChange={e => setAction(e.target.value)} placeholder="写实际操作；基线可填写未调整。" />
        <label htmlFor="round-confounds">混杂因素（无则留空）</label><textarea id="round-confounds" value={confounds} onChange={e => setConfounds(e.target.value)} placeholder="如相机位置、光照改变，或同时调整了多处。" />
        <label htmlFor="round-readings">原始直径读数（可选，每行：级次,直径mm）</label><textarea id="round-readings" value={readingText} onChange={e => setReadingText(e.target.value)} placeholder={'5,3.43\n10,4.85\n15,5.95'} />
        <button type="button" disabled={busy} onClick={addRound}>{busy ? progress || '正在保存…' : '分析并保存本轮'}</button>
      </section>
      {session.rounds.length > 1 && <section className="experiment-panel"><h2>两轮对比</h2><div className="experiment-fields">{[0, 1].map(index => <label key={index}>{index === 0 ? '调整前' : '调整后'}<select value={comparisonIds[index]} onChange={e => setComparisonIds(ids => index === 0 ? [e.target.value, ids[1]] : [ids[0], e.target.value])}><option value="">选择轮次</option>{session.rounds.map((r, i) => <option key={r.id} value={r.id}>第 {i + 1} 轮</option>)}</select></label>)}</div>{comparison && <><h3>{comparison.label}</h3><p>{comparison.detail}</p><p>平均轴比 {display(summarize(a!, 'ratio'))} → {display(summarize(b!, 'ratio'))}；清晰度 {display(summarize(a!, 'clarity'))} → {display(summarize(b!, 'clarity'))}</p></>}</section>}
      <section className="experiment-panel"><h2>用户确认调整完毕</h2><p>你可以随时结束调整。检验仅筛查当前形状残余，不判断个人能力极限，不以预设曲率半径作为答案。</p><button className="no-print" type="button" disabled={busy} onClick={declare}>我已调整完毕</button>
        {declaration && <><p>{new Date(declaration.time).toLocaleString()} · {currentDeclaration ? '对应当前轮次' : '之后已新增轮次，请重新确认'}</p><h3>{labels[declaration.result.status]}</h3><p>{declaration.result.message}</p><p>轴比偏离 {display(declaration.result.deviation)} · 重复性标准差 {display(declaration.result.repeatability)} · 95% 筛查界限 {display(declaration.result.uncertainty)}</p><p>历史可分辨调整幅度：{display(declaration.result.adjustmentResolution)}。估计至少需要 3 次可比且超过噪声的同类调整；不代表个人能力边界。</p><small>筛查假设：独立重复照片、近似正态波动及算法偏差可忽略。尚未经真实实验标定，不作为计量认证结论。</small>{currentDeclaration && declaration.result.status === 'detected' && <p><button className="no-print" type="button" disabled={busy} onClick={assess}>评估残余补偿条件</button></p>}</>}
        {restoration && <><p>评估关联声明：{restoration.declarationId === declaration?.id && currentDeclaration ? "当前声明" : "历史声明，结果不适用于新增数据"}</p><h3>{restoration.tier === 'bounded' ? '条件性标定补偿' : '不可还原'}</h3><p>{restoration.reason}</p>{restoration.before !== undefined && <p>补偿前 {display(restoration.before, 6)} m → 补偿后 {display(restoration.after, 6)} m；补偿量 {display(restoration.amount, 6)} m；扩展不确定度 {display(restoration.uncertainty, 6)} m（k=2，条件性估计）。</p>}</>}
      </section>
      <RoundTrend rounds={session.rounds} />
      <section className="experiment-panel"><h2>全过程记录</h2><p>每轮原始数据单独保留，包括没有改善或退步的轮次。读数结果采用 D²–级次带截距回归，不自动校正到参考值。</p>
        {!session.rounds.length && <p>尚无测量轮次。</p>}
        {session.rounds.map((r, i) => { const result = calculate(r.readings, session.profile); return <article className="round-record" key={r.id}><h3>第 {i + 1} 轮 · {new Date(r.time).toLocaleString()}</h3><p>实际操作：{r.action}</p><p>条件变化：{r.confounds || '未记录变化'}</p><p>轴比 {display(summarize(r, 'ratio'))} · 清晰度 {display(summarize(r, 'clarity'))} · {r.samples.length} 张照片</p><div className="round-photos">{r.samples.map(s => <figure key={s.id}><Photo image={s.image} name={s.name} /><figcaption>{s.name} · q={display(s.metrics.ratio)}{s.metrics.damaged ? ' · 质量不足' : ''}</figcaption></figure>)}</div>{r.readings.length > 0 && <table><thead><tr><th>级次</th><th>原始直径 / mm</th><th>D² / mm²</th></tr></thead><tbody>{r.readings.map(v => <tr key={v.order}><td>{v.order}</td><td>{v.diameter}</td><td>{display(v.diameter ** 2)}</td></tr>)}</tbody></table>}{result && <><p>原始 R={display(result.radius, 6)} m；U={display(result.expanded, 6)} m（k=2）；截距={display(result.intercept)} mm²。</p><small>uA={display(result.uA, 6)} m，分辨率传播 uB={display(result.uB, 6)} m。直接直径读数按矩形舍入分布计算；该估计未包含波长、相关读数和模型失配。</small></>}<p>当轮建议：{r.recommendation.title}；{r.recommendation.expected}</p></article>; })}
        <h3>完成声明记录</h3>{session.declarations.map(d => <p key={d.id}>{new Date(d.time).toLocaleString()} · {d.roundIds.length} 轮 · {labels[d.result.status]}：{d.result.message}</p>)}
        <h3>补偿评估记录</h3>{session.restorations.map((r, i) => <p key={`${r.time}-${i}`}>{new Date(r.time).toLocaleString()} · {r.reason} 补偿前 {display(r.before, 6)} m，补偿后 {display(r.after, 6)} m，补偿量 {display(r.amount, 6)} m，U={display(r.uncertainty, 6)} m。</p>)}
      </section>
    </>}
  </main>;
}
