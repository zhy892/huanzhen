// SI internally. Radii entered in mm, wavelength in nm; dark reflected rings.
export type ForceRow = { turns: number; innerMm: number; outerMm: number; validation: boolean };
export type ForceCalibration = {
  screw: string; position: string; direction: string; source: string;
  wavelengthNm: number; refractiveIndex: number; interval: number;
  referenceRadiusM: number; referenceUncertaintyM: number;
  curvatureUncertainty: number; validationTolerance: number;
  targetTurns: number; targetInnerMm: number; targetOuterMm: number;
  fixedConditions: boolean; rows: ForceRow[];
};
export function effectiveCurvature(innerMm: number, outerMm: number, p: number, wavelengthNm: number, n: number) {
  if (![innerMm,outerMm,p,wavelengthNm,n].every(Number.isFinite) || innerMm<0 || outerMm<=innerMm || !Number.isInteger(p) || p<=0 || wavelengthNm<=0 || n<=0) throw Error('请输入有效半径、正整数级差、波长和折射率。');
  const k=p*wavelengthNm*1e-9/n/((outerMm**2-innerMm**2)*1e-6);
  if(!Number.isFinite(k)||k<=0)throw Error('半径差或曲率超出数值计算范围。');
  return k;
}
export function calibrateForce(c: ForceCalibration) {
  if (!c.fixedConditions || [c.screw,c.position,c.direction,c.source].some(s=>!s.trim())) throw Error('请记录螺丝位置、读数方向和独立参考来源，并确认固定条件。');
  if (![c.referenceRadiusM,c.referenceUncertaintyM,c.curvatureUncertainty,c.validationTolerance].every(v=>Number.isFinite(v)&&v>0) || !Number.isFinite(c.targetTurns)) throw Error('参考半径、不确定度及验证容差须为正数。');
  const data=c.rows.map(r=>({...r,k:effectiveCurvature(r.innerMm,r.outerMm,c.interval,c.wavelengthNm,c.refractiveIndex)}));
  if(data.some(r=>!Number.isFinite(r.turns))) throw Error('调整量必须为有限数值。');
  const train=data.filter(r=>!r.validation), check=data.filter(r=>r.validation);
  if(train.length<3 || check.length<1) throw Error('至少需要三组标定状态和一组独立留出验证状态。');
  const lo=Math.min(...train.map(r=>r.turns)),hi=Math.max(...train.map(r=>r.turns));
  if(!train.some(r=>r.turns===0) || lo===hi) throw Error('标定须包含调整量为 0 的独立参考状态和不同调整量。');
  if([c.targetTurns,...check.map(r=>r.turns)].some(t=>t<lo||t>hi)) throw Error('目标或验证状态超出标定范围；不允许外推。');
  const avg=(xs:number[])=>xs.reduce((a,b)=>a+b,0)/xs.length;
  const x=avg(train.map(r=>r.turns)), y=avg(train.map(r=>r.k));
  const sxx=train.reduce((s,r)=>s+(r.turns-x)**2,0);
  const slope=train.reduce((s,r)=>s+(r.turns-x)*(r.k-y),0)/sxx, intercept=y-slope*x;
  const residual=Math.sqrt(train.reduce((s,r)=>s+(r.k-intercept-slope*r.turns)**2,0)/(train.length-2));
  const validationError=Math.max(...check.map(r=>Math.abs(r.k-intercept-slope*r.turns)));
  if(validationError>c.validationTolerance) throw Error('留出验证未通过：曲率残差超过设定容差。请重新采集或缩小线性模型范围。');
  const observed=effectiveCurvature(c.targetInnerMm,c.targetOuterMm,c.interval,c.wavelengthNm,c.refractiveIndex);
  if(Math.abs(observed-intercept-slope*c.targetTurns)>c.validationTolerance) throw Error('目标读数与标定模型不一致，暂不补偿。');
  const deformation=intercept+slope*c.targetTurns-1/c.referenceRadiusM;
  const corrected=observed-deformation;
  const modelU=Math.max(residual,validationError,c.curvatureUncertainty);
  // Conservative independent-input approximation; correlated reference errors need separate assessment.
  const uK=Math.hypot(c.curvatureUncertainty,modelU*Math.sqrt(1+1/train.length+(c.targetTurns-x)**2/sxx),c.referenceUncertaintyM/c.referenceRadiusM**2);
  if(corrected<=0 || corrected<=2*uK) throw Error('补偿分母非正或接近不确定度范围，无法稳定还原。');
  const radius=1/corrected;
  if(![radius,uK,slope,intercept,residual,validationError].every(Number.isFinite))throw Error('数据超出稳定数值范围。');
  return {radius,before:1/observed,amount:radius-1/observed,expanded:2*uK/corrected**2,slope,intercept,deformation,validationError,residual,range:[lo,hi]};
}
