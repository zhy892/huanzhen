"use client";
import { useState } from 'react';
import { calibrateForce, type ForceCalibration } from '../core/force-calibration';
const initial: ForceCalibration = {screw:'',position:'',direction:'',source:'',wavelengthNm:589.3,refractiveIndex:1,interval:5,referenceRadiusM:0,referenceUncertaintyM:0,curvatureUncertainty:0,validationTolerance:0,targetTurns:0,targetInnerMm:0,targetOuterMm:0,fixedConditions:false,rows:[]};
export default function ForceCalibrationPanel({ value, onSave }: {value?:ForceCalibration;onSave?:(c:ForceCalibration)=>Promise<void>}) {
  const [c,setC]=useState<ForceCalibration>(value??initial),[rows,setRows]=useState(value?.rows.map(r=>`${r.turns},${r.innerMm},${r.outerMm},${r.validation?'验证':'标定'}`).join('\n')??''),[error,setError]=useState(''),[result,setResult]=useState<ReturnType<typeof calibrateForce>|null>(null),[busy,setBusy]=useState(false);
  function update(p:Partial<ForceCalibration>){setC({...c,...p});setResult(null);setError('');}
  const numberField=(key:keyof ForceCalibration,label:string)=><label key={key}>{label}<input required type="number" step="any" value={String(c[key])} onChange={e=>update({[key]:e.target.value===''?NaN:Number(e.target.value)})}/></label>;
  async function submit(e:React.FormEvent){e.preventDefault();setError('');setResult(null);setBusy(true);try{
    const parsed=rows.trim().split('\n').map((line,i)=>{const parts=line.split(/[,，]/).map(s=>s.trim());if(parts.length!==4||parts.slice(0,3).some(s=>s==='')||!['标定','验证'].includes(parts[3]))throw Error(`第 ${i+1} 行格式无效。`);return {turns:Number(parts[0]),innerMm:Number(parts[1]),outerMm:Number(parts[2]),validation:parts[3]==='验证'};});
    const data={...c,rows:parsed};const output=calibrateForce(data);if(onSave)await onSave(data);setC(data);setResult(output);
  }catch(e){setError(e instanceof Error?e.message:'计算失败');}finally{setBusy(false);}}
  return <details className="experiment-panel force-calibration"><summary>受力形变标定 · 条件还原</summary>
    <p>环纹是间隙等厚线。仅凭一张椭圆照片不能唯一反推未受力曲率；纯相对倾斜在球面近轴模型中主要使环心移动。</p>
    <p>t(x,y) = t₀ + (x²+y²)/(2R₀) + αx + βy + ΔtＦ(x,y)，反射暗环满足 2nt = mλ。</p>
    <ol><li>固定相机、尺度、光源和取景；标出螺丝位置。排除透视，并消除或建模倾斜。</li><li>每次只调整一个螺丝，沿同一方向跟踪同一对暗环。填写从环心量取的物理半径；不能将未校准像素直接作为毫米。</li><li>至少三组标定状态（包含零调整参考）及一组不参与拟合的验证状态。零状态须有独立的未受力参考半径。</li><li>本工具拟合小范围内曲率随螺丝转数的线性响应；转数不能当成力，多螺丝耦合需分别标定。</li></ol>
    <form onSubmit={submit}><div className="experiment-fields">
      {(['screw','position','direction','source'] as const).map((key,i)=><label key={key}>{['螺丝编号','位置（如右上方、坐标）','读数方向 / 角度','独立未受力参考与尺度标定来源'][i]}<input required value={c[key]} onChange={e=>update({[key]:e.target.value})}/></label>)}
      {numberField('wavelengthNm','波长 λ / nm')}{numberField('refractiveIndex','间隙折射率 n')}{numberField('interval','同一对暗环级差 p')}{numberField('referenceRadiusM','独立未受力参考 R₀ / m')}{numberField('referenceUncertaintyM','参考半径标准不确定度 / m')}{numberField('curvatureUncertainty','单状态有效曲率标准不确定度 / m⁻¹')}{numberField('validationTolerance','预先确定的曲率验证容差 / m⁻¹')}
    </div><label>状态记录：调整转数,内环半径mm,外环半径mm,标定或验证<textarea required rows={6} value={rows} placeholder={'0,1,2,标定\n0.1,1,1.98,标定\n0.2,1,1.96,标定\n0.15,1,1.97,验证'} onChange={e=>{setRows(e.target.value);setResult(null);}}/></label>
    <div className="experiment-fields">{numberField('targetTurns','待补偿状态的调整转数')}{numberField('targetInnerMm','待补偿内环半径 / mm')}{numberField('targetOuterMm','待补偿外环半径 / mm')}</div>
    <label><input type="checkbox" checked={c.fixedConditions} onChange={e=>update({fixedConditions:e.target.checked})}/>已固定拍摄与尺度，确认同级暗环、单螺丝操作及倾斜处理，参考来源独立于待测照片</label>
    <button disabled={busy} type="submit">{busy?'正在计算…':'验证模型并计算补偿'}</button>{!onSave&&<p>当前无实验记录；结果仅在此页展示。建立实验后可保存并导出。</p>}</form>
    {error&&<p role="alert">{error}</p>}{result&&<div role="status"><h3>条件还原结果</h3><p>有效半径 {result.before.toPrecision(7)} m → 条件还原 R₀ = {result.radius.toPrecision(7)} m；补偿量 {result.amount.toPrecision(4)} m。</p><p>扩展不确定度 U = {result.expanded.toPrecision(3)} m（k=2，独立输入近似）；留出验证最大残差 {result.validationError.toPrecision(3)} m⁻¹。</p><p>响应斜率 {result.slope.toPrecision(5)} m⁻¹/转；相对间隙曲率贡献 {result.deformation.toPrecision(5)} m⁻¹；适用转数范围 [{result.range.join(', ')}]。</p><p>R₀ = (r外²−r内²) / [pλ/n − 2(ΔtＦ外−ΔtＦ内)]。此处采用二次间隙近似，ΔtＦ外−ΔtＦ内 = κＦ(r外²−r内²)/2。</p><p>不确定度包含输入有效曲率、参考半径及拟合/验证残差；未完整覆盖波长、尺度相关性、接触非线性及模型偏差。缺少独立未受力参考时只能报告相对形变。</p><button type="button" onClick={()=>window.print()}>打印标定与结果</button></div>}
    <p>薄板小挠度仅在适用条件下满足 D∇⁴w=P，D=Eh³/[12(1−ν²)]；需边缘支撑和接触条件。透镜与平板的相对变形可能需要三维弹性接触模型。</p>
    <p><a href="https://www.animations.physics.unsw.edu.au/jw/light/Newton%27s-rings.html" target="_blank" rel="noreferrer">牛顿环物理说明</a> · <a href="https://users.cecs.anu.edu.au/~Qinghua.Qin/publications/pap96E-AMR.pdf" target="_blank" rel="noreferrer">薄板弯曲资料</a></p>
  </details>;
}
