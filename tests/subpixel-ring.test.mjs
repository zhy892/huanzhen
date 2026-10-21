import test from 'node:test';
import assert from 'node:assert/strict';
import {refineSubpixelRing} from '../core/subpixel-ring.ts';
import {ellipseResidual} from '../core/ellipse.ts';
const w=460,h=380,roi={x0:5,y0:5,x1:w-5,y1:h-5},truth={centerX:230.2,centerY:189.6,semiMajor:143.4,semiMinor:122.5,ratio:122.5/143.4,angle:24};
test('normal subpixel profiling improves a biased ellipse on known ground truth',()=>{const gray=new Float32Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const d=ellipseResidual({x,y},truth);gray[y*w+x]=160+.018*x+.01*y-85*Math.exp(-d*d/35)+.3*Math.sin(x*1.7+y);}
 const initial={...truth,centerX:231.3,centerY:188.6,semiMajor:144.9,semiMinor:123.9,ratio:123.9/144.9};const r=refineSubpixelRing(gray,w,h,roi,initial);assert.ok(r?.validation.adopted);assert.ok(Math.hypot(r.fit.centerX-truth.centerX,r.fit.centerY-truth.centerY)<.3);assert.ok(Math.abs(r.fit.semiMajor-truth.semiMajor)<.3);assert.ok(r.validation.heldOutRms<r.validation.beforeHeldOutRms);});
test('a featureless image cannot produce measured subpixel ring points',()=>assert.equal(refineSubpixelRing(new Float32Array(w*h).fill(120),w,h,roi,truth),null));
