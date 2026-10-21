export type PhysicalReading={order:number;diameter:number};
const median=(a:number[])=>{const s=[...a].sort((a,b)=>a-b);return s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2;};
function fit(x:number[],y:number[],weights:number[]){const sum=weights.reduce((a,b)=>a+b,0),mx=x.reduce((s,v,i)=>s+v*weights[i],0)/sum,my=y.reduce((s,v,i)=>s+v*weights[i],0)/sum;const den=x.reduce((s,v,i)=>s+weights[i]*(v-mx)**2,0);if(den<=0)throw Error('至少需要不同级次。');const slope=x.reduce((s,v,i)=>s+weights[i]*(v-mx)*(y[i]-my),0)/den;return {slope,intercept:my-slope*mx};}
// Free intercept removes unknown common order offset and constant central gap.
// Robust weights flag influential data; original readings are never overwritten.
export function physicalRegression(readings:PhysicalReading[],wavelengthNm:number,n=1,factor=1){
  if(readings.length<4||![wavelengthNm,n,factor].every(v=>Number.isFinite(v)&&v>0))throw Error('至少四个级次及有效波长、折射率、独立长度系数。');
  if(readings.some(r=>!Number.isFinite(r.order)||!Number.isInteger(r.order)||!Number.isFinite(r.diameter)||r.diameter<=0)||new Set(readings.map(r=>r.order)).size!==readings.length)throw Error('级次须为不重复整数，直径须为正数。');
  const x=readings.map(r=>r.order),y=readings.map(r=>(r.diameter*factor)**2);let weights=x.map(()=>1),model=fit(x,y,weights);const ordinary={...model};
  for(let pass=0;pass<30;pass++){const residual=y.map((v,i)=>v-model.intercept-model.slope*x[i]),center=median(residual),scale=Math.max(1e-9,1.4826*median(residual.map(v=>Math.abs(v-center))));weights=residual.map(v=>Math.min(1,1.345*scale/Math.max(1e-12,Math.abs(v-center))));const next=fit(x,y,weights);if(Math.abs(next.slope-model.slope)<1e-9){model=next;break;}model=next;}
  if(model.slope<=0||ordinary.slope<=0)throw Error('D² 随级次的斜率非正，不满足当前牛顿环模型。');
  const convert=(s:number)=>s*1e-6*n/(4*wavelengthNm*1e-9),radius=convert(model.slope),ordinaryRadius=convert(ordinary.slope);
  const jackknife=x.map((_,j)=>{const m=fit(x.filter((_,i)=>i!==j),y.filter((_,i)=>i!==j),weights.filter((_,i)=>i!==j));return convert(m.slope);});
  const residuals=y.map((v,i)=>v-model.intercept-model.slope*x[i]);
  return {radius,ordinaryRadius,intercept:model.intercept,weights,residuals,orders:x,leaveOneOutRange:[Math.min(...jackknife),Math.max(...jackknife)],flagged:x.filter((_,i)=>weights[i]<.5),rmsMmSquared:Math.sqrt(residuals.reduce((s,v)=>s+v*v,0)/x.length),negativePredictions:x.some(v=>model.intercept+model.slope*v<=0)};
}
