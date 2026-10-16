import { bilinear, darkCandidates, traceDarkRing } from "./ring-tracking.ts";
import { fitRobustEllipse, initializeEllipse } from "./ellipse.ts";
import type { Ellipse } from "./ellipse.ts";
export type CauseId = "tilt" | "pressure" | "decenter" | "calibration" | "damage";
export type Mode = "empirical" | "deepseek";

export type ImageMetrics = {
  ratio: number;
  angle: number;
  centerOffset: number;
  clarity: number;
  asymmetry: number;
  fitQuality: number;
  confidence: number;
  damaged: boolean;
  annotatedImage: string;
  fitMethod: "auto" | "manual";
  detectedScreen: boolean;
  ellipse?: EllipseFit & { imageWidth:number; imageHeight:number };
  contourPoints?: Array<FitPoint & { inlier:boolean }>;
  processingMs?: number;
  fitResidualPx?: number;
  fitCoverage?: number;
  fitInlierFraction?: number;
  contourKind?: "dark-centerline" | "manual-points";
};

export type AiDiagnosis = {
  verdict: string;
  summary: string;
  causes: CauseId[];
  confidence: number;
  provider?: "deepseek" | "local-fallback" | "empirical";
};

export type FitPoint = { x: number; y: number };
type EllipseFit = Ellipse;

export const ORDERS = [5, 10, 15, 20, 25, 30, 35, 40];
export const STANDARD_RADIUS = 1.0;
export const CALIBRATION_STRENGTH = 0.96;
export const MAX_RECOMMENDED_CAUSES = 3;

export const CAUSES: Array<{
  id: CauseId;
  index: string;
  title: string;
  short: string;
  description: string;
  advice: string;
  formula: string;
}> = [
  {
    id: "tilt",
    index: "01",
    title: "光轴或观察面倾斜",
    short: "投影压缩",
    description: "环像沿倾斜方向被压缩，通常表现为轮廓完整、长短轴稳定的椭圆。",
    advice: "微调反射镜、显微镜或相机姿态，使观察光轴尽量垂直于牛顿环平面，并让十字线穿过环心。",
    formula: "D₀ = Dₓ · √(cos²φ + sin²φ / q²)",
  },
  {
    id: "pressure",
    index: "02",
    title: "透镜受力不均",
    short: "接触形变",
    description: "压紧螺钉或接触面倾斜造成非均匀空气膜，环宽与亮度常有方向差异。",
    advice: "均匀、少量地调节压紧螺钉；清洁透镜与平板接触面后重新放置，避免单侧过紧。",
    formula: "D₀ = √(ab)（等面积直径）",
  },
  {
    id: "decenter",
    index: "03",
    title: "环心偏离读数轴",
    short: "弦长误差",
    description: "测量线没有穿过真实环心，读到的是弦长而非直径，可用偏心量补偿。",
    advice: "移动镜组或读数显微镜，使环心与十字线交点重合；重新确认水平测量线穿过真实环心。",
    formula: "D₀ = √(D² + 4e²)",
  },
  {
    id: "calibration",
    index: "04",
    title: "横纵标尺比例不一致",
    short: "标定误差",
    description: "相机像素或读数显微镜在两个方向上的比例不同，需要乘以标定系数。",
    advice: "用标准刻尺复核横、纵方向比例，保持相机正对屏幕；若比例不一致，记录独立标定系数 k。",
    formula: "D₀ = k · D",
  },
  {
    id: "damage",
    index: "!",
    title: "仪器或光学元件明显损坏",
    short: "不可还原",
    description: "若条纹断裂、严重畸变或成像无法形成闭合轮廓，经验模型不能给出可信还原。",
    advice: "停止测量，检查光源、透镜划伤或崩边、接触面污染和显微镜成像；必要时更换仪器后重新拍照。",
    formula: "停止还原并检修仪器",
  },
];

export const DEMO_DATA: Record<number, string> = {
  5: "4.420",
  10: "6.250",
  15: "7.657",
  20: "8.572",
  25: "9.508",
  30: "10.335",
  35: "11.221",
  40: "11.944",
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function fmt(value: number, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

export function builtinDiagnosis(metrics: ImageMetrics): AiDiagnosis {
  if (metrics.damaged) {
    return {
      verdict: "无法可靠还原",
      summary: "轮廓完整度或清晰度未通过质量门槛，疑似存在明显成像/仪器异常。建议先检查光源、物镜、读数显微镜与接触面。",
      causes: ["damage"],
      confidence: metrics.confidence,
    };
  }

  const causes: CauseId[] = [];
  if (metrics.ratio < 0.975) causes.push(metrics.asymmetry > 0.34 ? "pressure" : "tilt");
  if (metrics.ratio < 0.93 && metrics.asymmetry > 0.2 && !causes.includes("pressure")) causes.push("pressure");
  if (metrics.centerOffset > 0.1) causes.push("decenter");
  if (metrics.ratio < 0.94 && Math.abs(metrics.angle) < 12) causes.push("calibration");
  if (!causes.length && metrics.ratio < 0.99) causes.push("tilt");

  const isCircle = metrics.ratio >= 0.975;
  const verdict = isCircle ? "可视为正圆" : metrics.ratio >= 0.92 ? "轻微椭圆" : "明显椭圆";
  const summary = isCircle
    ? "长短轴差异处于常见拍摄与边缘提取波动内，可直接进入数据计算；如需更严格处理，也可保留建议原因进行微量补偿。"
    : `检测到长短轴比为 ${metrics.ratio.toFixed(3)}，偏离正圆。系统已按轮廓方向、偏心与明暗对称性给出可复核的原因建议。`;
  return { verdict, summary, causes, confidence: metrics.confidence, provider: "empirical" };
}

export function buildAiSuggestions(metrics: ImageMetrics, diagnosis: AiDiagnosis) {
  const modelBoost = (id: CauseId) => diagnosis.causes.includes(id) ? 18 : 0;
  const rawScores: Record<CauseId, number> = {
    tilt: 12 + (1 - metrics.ratio) * 360 + (metrics.asymmetry < 0.34 ? 13 : 3) + modelBoost("tilt"),
    pressure: 7 + metrics.asymmetry * 130 + (1 - metrics.ratio) * 160 + modelBoost("pressure"),
    decenter: 6 + metrics.centerOffset * 260 + modelBoost("decenter"),
    calibration: 8 + (1 - metrics.ratio) * 110 + (Math.abs(metrics.angle) < 12 ? 10 : 3) + modelBoost("calibration"),
    damage: 3 + (1 - metrics.fitQuality) * 65 + (1 - metrics.clarity) * 28 + (metrics.damaged ? 45 : 0) + modelBoost("damage"),
  };
  const totalScore = CAUSES.reduce((sum, cause) => sum + Math.max(0.01, rawScores[cause.id]), 0);
  const shares = CAUSES.map((cause, index) => {
    const exact = (Math.max(0.01, rawScores[cause.id]) / totalScore) * 100;
    return { cause, index, exact, probability: Math.floor(exact) };
  });
  let remainder = 100 - shares.reduce((sum, item) => sum + item.probability, 0);
  [...shares]
    .sort((a, b) => (b.exact - b.probability) - (a.exact - a.probability) || a.index - b.index)
    .forEach((item) => {
      if (remainder <= 0) return;
      item.probability += 1;
      remainder -= 1;
    });
  const ranked = shares
    .map(({ cause, probability }) => ({ ...cause, probability }))
    .sort((a, b) => b.probability - a.probability);
  const recommendedIds = new Set<CauseId>(
    metrics.damaged
      ? ["damage"]
      : ranked
        .filter((item) => item.id !== "damage" && diagnosis.causes.includes(item.id))
        .slice(0, MAX_RECOMMENDED_CAUSES)
        .map((item) => item.id),
  );
  return ranked.map((item) => ({ ...item, recommended: recommendedIds.has(item.id) }));
}

export function fitEllipseFromPoints(points: FitPoint[], width: number, height: number): EllipseFit | null {
  return fitRobustEllipse(points.map(p=>({x:p.x*width,y:p.y*height})),width,height)?.fit ?? null;
}

function longestRun(input: boolean[]) {
  const flags=[...input];
  // A thin crosshair must not split one illuminated screen into two regions.
  const limit=Math.max(2,Math.round(flags.length*.025));
  for(let i=0;i<flags.length;) {
    if(flags[i]){i++;continue;}
    const start=i;while(i<flags.length&&!flags[i])i++;
    if(start>0 && i<flags.length && i-start<=limit)for(let j=start;j<i;j++)flags[j]=true;
  }
  let bestStart = 0;
  let bestEnd = -1;
  let currentStart = -1;
  for (let i = 0; i <= flags.length; i += 1) {
    if (i < flags.length && flags[i]) {
      if (currentStart < 0) currentStart = i;
    } else if (currentStart >= 0) {
      if (i - 1 - currentStart > bestEnd - bestStart) {
        bestStart = currentStart;
        bestEnd = i - 1;
      }
      currentStart = -1;
    }
  }
  return [bestStart, bestEnd] as const;
}

function boxBlur(source: Float32Array, width: number, height: number, radius: number) {
  if (radius <= 0) return source;
  const horizontal = new Float32Array(source.length);
  const result = new Float32Array(source.length);
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let x = 0; x < width; x += 1) {
      if (x + radius < width) sum += source[y * width + x + radius];
      if (x - radius - 1 >= 0) sum -= source[y * width + x - radius - 1];
      const count = Math.min(width - 1, x + radius) - Math.max(0, x - radius) + 1;
      if (x === 0) {
        sum = 0;
        for (let k = 0; k <= Math.min(width - 1, radius); k += 1) sum += source[y * width + k];
      }
      horizontal[y * width + x] = sum / count;
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = 0; y < height; y += 1) {
      if (y + radius < height) sum += horizontal[(y + radius) * width + x];
      if (y - radius - 1 >= 0) sum -= horizontal[(y - radius - 1) * width + x];
      const count = Math.min(height - 1, y + radius) - Math.max(0, y - radius) + 1;
      if (y === 0) {
        sum = 0;
        for (let k = 0; k <= Math.min(height - 1, radius); k += 1) sum += horizontal[k * width + x];
      }
      result[y * width + x] = sum / count;
    }
  }
  return result;
}

type RingCandidate = { x: number; y: number; radius: number; magnitude: number; maxRadius: number };

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function robustGradientSample(
  gradient: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  cosine: number,
  sine: number,
) {
  const tangentialSamples: number[] = [];
  for (const tangentOffset of [-4, -2, 0, 2, 4]) {
    let localMaximum = 0;
    for (const radialOffset of [-1, 0, 1]) {
      const sampleX = x + cosine * radialOffset - sine * tangentOffset;
      const sampleY = y + sine * radialOffset + cosine * tangentOffset;
      if (sampleX <= 1 || sampleX >= width - 2 || sampleY <= 1 || sampleY >= height - 2) continue;
      localMaximum = Math.max(localMaximum, bilinear(gradient,width,height,sampleX,sampleY));
    }
    tangentialSamples.push(localMaximum);
  }
  return median(tangentialSamples);
}

function robustEllipseFromRing(points: RingCandidate[], width: number, height: number) {
  if(points.length<20)return null;
  const result=fitRobustEllipse(points,width,height);
  if(!result || result.coverage<.6)return null;
  return {fit:result.fit,residual:result.rms/result.fit.semiMinor,inlierCoverage:result.inliers.length/points.length,coverage:result.coverage,inliers:result.inliers,rms:result.rms};
}

function traceContinuousRing(gray: Float32Array, width: number, height: number, roi: {x0:number;x1:number;y0:number;y1:number}, center: {x:number;y:number}, gradientScale:number, target?:FitPoint, prediction?:EllipseFit, guide?:{x?:number;y?:number}) {
  return traceDarkRing(gray,width,height,roi,center,gradientScale,target,prediction,guide);
}

function detectGuideLine(
  gray: Float32Array,
  width: number,
  height: number,
  roi: { x0: number; x1: number; y0: number; y1: number },
  axis: "vertical" | "horizontal",
) {
  const start = Math.round((axis === "vertical" ? roi.x0 : roi.y0) + (axis === "vertical" ? roi.x1 - roi.x0 : roi.y1 - roi.y0) * 0.32);
  const end = Math.round((axis === "vertical" ? roi.x0 : roi.y0) + (axis === "vertical" ? roi.x1 - roi.x0 : roi.y1 - roi.y0) * 0.68);
  let bestCoordinate = (start + end) / 2;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestSupport=0;
  for (let coordinate = start; coordinate <= end; coordinate += 1) {
    const contrasts: number[] = [];
    const alongStart = axis === "vertical" ? roi.y0 : roi.x0;
    const alongEnd = axis === "vertical" ? roi.y1 : roi.x1;
    for (let along = alongStart + 4; along <= alongEnd - 4; along += 3) {
      const lineValues: number[] = [];
      const neighborValues: number[] = [];
      for (const offset of [-1, 0, 1]) {
        const x = axis === "vertical" ? coordinate + offset : along;
        const y = axis === "vertical" ? along : coordinate + offset;
        lineValues.push(gray[y * width + x]);
      }
      for (const offset of [-12, -8, 8, 12]) {
        const x = axis === "vertical" ? coordinate + offset : along;
        const y = axis === "vertical" ? along : coordinate + offset;
        if (x >= roi.x0 && x <= roi.x1 && y >= roi.y0 && y <= roi.y1) neighborValues.push(gray[y * width + x]);
      }
      if (neighborValues.length) contrasts.push(median(neighborValues) - median(lineValues));
    }
    const score = median(contrasts) + median(contrasts.filter((value) => value > 0)) * 0.45;
    if (score > bestScore) {
      bestScore = score;
      bestCoordinate = coordinate;
      bestSupport=contrasts.filter(v=>v>12).length/Math.max(1,contrasts.length);
    }
  }
  return { coordinate: bestCoordinate, strength: bestScore, support:bestSupport };
}

function refineSourceRing(image: HTMLImageElement, fit: EllipseFit, width: number, height: number,guide:{x?:number;y?:number}): RingCandidate[] | null {
  const angle=fit.angle*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  const ex=Math.hypot(fit.semiMajor*c,fit.semiMinor*s)+10,ey=Math.hypot(fit.semiMajor*s,fit.semiMinor*c)+10;
  const sx=image.naturalWidth/width,sy=image.naturalHeight/height;
  const x=Math.max(0,Math.floor((fit.centerX-ex)*sx)),y=Math.max(0,Math.floor((fit.centerY-ey)*sy));
  const sourceWidth=Math.min(image.naturalWidth-x,Math.ceil(2*ex*sx)),sourceHeight=Math.min(image.naturalHeight-y,Math.ceil(2*ey*sy));
  const scale=Math.min(1,1800/Math.max(sourceWidth,sourceHeight));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(sourceWidth*scale));canvas.height=Math.max(1,Math.round(sourceHeight*scale));
  const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)return null;
  context.drawImage(image,x,y,sourceWidth,sourceHeight,0,0,canvas.width,canvas.height);
  const gx=canvas.width/sourceWidth,gy=canvas.height/sourceHeight;
  const toLocal=(px:number,py:number)=>({x:(px*sx-x)*gx,y:(py*sy-y)*gy});
  const outline=Array.from({length:40},(_,i)=>{const t=i/40*2*Math.PI;return toLocal(fit.centerX+fit.semiMajor*Math.cos(t)*c-fit.semiMinor*Math.sin(t)*s,fit.centerY+fit.semiMajor*Math.cos(t)*s+fit.semiMinor*Math.sin(t)*c);});
  const predicted=initializeEllipse(outline);if(!predicted)return null;
  const pixels=context.getImageData(0,0,canvas.width,canvas.height).data,gray=new Float32Array(canvas.width*canvas.height);
  for(let i=0;i<gray.length;i++)gray[i]=pixels[4*i]*.299+pixels[4*i+1]*.587+pixels[4*i+2]*.114;
  const points:RingCandidate[]=[];
  for(let i=0;i<240;i++) {
    const theta=i/240*2*Math.PI,phi=theta-predicted.angle*Math.PI/180;
    const radius=1/Math.hypot(Math.cos(phi)/predicted.semiMajor,Math.sin(phi)/predicted.semiMinor);
    const band=Math.max(3,Math.min(10*sx*gx,predicted.semiMinor*.035));
    const candidates=darkCandidates(gray,canvas.width,canvas.height,{x:predicted.centerX,y:predicted.centerY},theta,Math.max(2,radius-band),radius+band,1.5);
    if(!candidates.length)continue;
    const best=candidates.reduce((a,b)=>Math.abs(a.radius-radius)<Math.abs(b.radius-radius)?a:b);
    const px=(best.x/gx+x)/sx,py=(best.y/gy+y)/sy;
    if((guide.x!==undefined&&Math.abs(px-guide.x)<6)||(guide.y!==undefined&&Math.abs(py-guide.y)<6))continue;
    points.push({x:px,y:py,radius:Math.hypot(px-fit.centerX,py-fit.centerY),magnitude:best.magnitude,maxRadius:Math.max(width,height)});
  }
  // Release the potentially large fine-pass canvas before constructing overlays.
  canvas.width=1;canvas.height=1;
  return points.length>=144?points:null;
}

export async function inspectImage(file: File, manualPoints: FitPoint[] = [], annotate = true, targetPoint?: FitPoint): Promise<ImageMetrics> {
  const started=performance.now();
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });

    const maxSide = 900;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    if(Math.min(image.naturalWidth,image.naturalHeight)<80) throw new Error("图像尺寸过小，请提供原始照片。");
    const width = Math.round(image.naturalWidth * scale);
    const height = Math.round(image.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("浏览器无法读取图像画布");
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const gray = new Float32Array(width * height);
    for (let i = 0; i < width * height; i += 1) {
      const p = i * 4;
      gray[i] = pixels[p] * 0.299 + pixels[p + 1] * 0.587 + pixels[p + 2] * 0.114;
    }

    const warmRows = Array(height).fill(0);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 2) {
        const p = (y * width + x) * 4;
        const r = pixels[p];
        const g = pixels[p + 1];
        const b = pixels[p + 2];
        if (r > 55 && r > g * 1.12 && r > b * 1.35) warmRows[y] += 2;
      }
    }
    const [screenY0, screenY1] = longestRun(warmRows.map((count) => count > width * 0.43));
    let x0 = Math.floor(width * 0.05);
    let x1 = Math.floor(width * 0.95);
    let y0 = Math.floor(height * 0.05);
    let y1 = Math.floor(height * 0.95);
    let detectedScreen = screenY1 - screenY0 > height * 0.28;
    if (detectedScreen) {
      const warmColumns = Array(width).fill(0);
      for (let x = 0; x < width; x += 1) {
        for (let y = screenY0; y <= screenY1; y += 2) {
          const p = (y * width + x) * 4;
          const r = pixels[p];
          const g = pixels[p + 1];
          const b = pixels[p + 2];
          if (r > 55 && r > g * 1.12 && r > b * 1.35) warmColumns[x] += 2;
        }
      }
      const [screenX0, screenX1] = longestRun(warmColumns.map((count) => count > (screenY1 - screenY0) * 0.54));
      detectedScreen = screenX1 - screenX0 > width * 0.32;
      if (detectedScreen) {
        const insetX = Math.max(3, Math.round((screenX1 - screenX0) * 0.025));
        const insetY = Math.max(3, Math.round((screenY1 - screenY0) * 0.025));
        x0 = screenX0 + insetX;
        x1 = screenX1 - insetX;
        y0 = screenY0 + insetY;
        y1 = screenY1 - insetY;
      }
    }

    let guideCenterX = (x0 + x1) / 2;
    let guideCenterY = (y0 + y1) / 2;
    const guideMask:{x?:number;y?:number}={};
    if (manualPoints.length < 5) {
      const verticalGuide = detectGuideLine(gray, width, height, { x0, x1, y0, y1 }, "vertical");
      const horizontalGuide = detectGuideLine(gray, width, height, { x0, x1, y0, y1 }, "horizontal");
      if (verticalGuide.strength > 10 && verticalGuide.support>.55) {guideCenterX=verticalGuide.coordinate;guideMask.x=verticalGuide.coordinate;}
      if (horizontalGuide.strength > 10 && horizontalGuide.support>.55) {guideCenterY=horizontalGuide.coordinate;guideMask.y=horizontalGuide.coordinate;}
    }

    const blurRadius = clamp(Math.round(Math.max(width, height) / 450), 1, 3);
    const blurred = boxBlur(boxBlur(gray, width, height, blurRadius), width, height, Math.max(2, Math.round(blurRadius / 2)));
    const gradient = new Float32Array(width * height);
    const gradientSamples: number[] = [];
    for (let y = y0 + 1; y < y1 - 1; y += 1) {
      for (let x = x0 + 1; x < x1 - 1; x += 1) {
        const i = y * width + x;
        const gx =
          -blurred[i - width - 1] + blurred[i - width + 1] - 2 * blurred[i - 1] + 2 * blurred[i + 1] - blurred[i + width - 1] + blurred[i + width + 1];
        const gy =
          -blurred[i - width - 1] - 2 * blurred[i - width] - blurred[i - width + 1] + blurred[i + width - 1] + 2 * blurred[i + width] + blurred[i + width + 1];
        gradient[i] = Math.hypot(gx, gy);
        if (x % 3 === 0 && y % 3 === 0) gradientSamples.push(gradient[i]);
      }
    }
    if (gradientSamples.length < 100) throw new Error("图像尺寸过小，请上传更清晰的照片");
    gradientSamples.sort((a, b) => a - b);
    const q65 = gradientSamples[Math.floor(gradientSamples.length * 0.65)] || 0;
    const q76 = gradientSamples[Math.floor(gradientSamples.length * 0.76)] || q65;
    const q92 = Math.max(1, gradientSamples[Math.floor(gradientSamples.length * 0.92)] || 1);
    const manualResult=manualPoints.length>=5?fitRobustEllipse(manualPoints.map(p=>({x:p.x*width,y:p.y*height})),width,height):null;
    if(manualPoints.length>=5 && (!manualResult || manualResult.coverage<.55)) throw new Error("取点覆盖不足或不构成可靠椭圆，请沿同一暗环均匀取点，覆盖至少三个象限。");
    const target=targetPoint?{x:targetPoint.x*width,y:targetPoint.y*height}:undefined;
    let tracked:RingCandidate[] | null = manualResult ? manualPoints.map(p=>({x:p.x*width,y:p.y*height,radius:Math.hypot(p.x*width-manualResult.fit.centerX,p.y*height-manualResult.fit.centerY),magnitude:robustGradientSample(gradient,width,height,p.x*width,p.y*height,1,0),maxRadius:Math.max(width,height)})) : traceContinuousRing(
      blurred,
      width,
      height,
      { x0, x1, y0, y1 },
      { x: guideCenterX, y: guideCenterY },
      q92, target, undefined, guideMask,
    );
    if(!tracked && manualResult) tracked=manualPoints.map(p=>({x:p.x*width,y:p.y*height,radius:Math.hypot(p.x*width-manualResult.fit.centerX,p.y*height-manualResult.fit.centerY),magnitude:robustGradientSample(gradient,width,height,p.x*width,p.y*height,1,0),maxRadius:Math.max(width,height)}));
    if (!tracked) throw new Error("没有找到可靠的同一条暗环，请点选目标暗环、重新裁剪或使用手动取点。");

    let robustAutoFit = manualResult ? null : robustEllipseFromRing(tracked, width, height);
    if (robustAutoFit && manualPoints.length < 5) {
      for (let iteration = 0; iteration < 2; iteration += 1) {
        const retraced = traceContinuousRing(
          blurred,
          width,
          height,
          { x0, x1, y0, y1 },
          { x: robustAutoFit.fit.centerX, y: robustAutoFit.fit.centerY },
          q92, target, robustAutoFit.fit, guideMask,
        );
        if (!retraced) break;
        const refined = robustEllipseFromRing(retraced, width, height);
        if (!refined || refined.residual > robustAutoFit.residual * 1.08) break;
        tracked = retraced;
        robustAutoFit = refined;
      }
    }

    if(robustAutoFit && !manualResult) {
      const finePoints=refineSourceRing(image,robustAutoFit.fit,width,height,guideMask);
      const fine=finePoints?robustEllipseFromRing(finePoints,width,height):null;
      if(fine && Math.abs(fine.fit.ratio-robustAutoFit.fit.ratio)<.06 && Math.hypot(fine.fit.centerX-robustAutoFit.fit.centerX,fine.fit.centerY-robustAutoFit.fit.centerY)<5 && Math.abs(fine.fit.semiMajor/robustAutoFit.fit.semiMajor-1)<.05 && fine.rms<=Math.max(1,robustAutoFit.rms*1.2)) {tracked=finePoints!;robustAutoFit=fine;}
    }
    if(!robustAutoFit && !manualResult) throw new Error("轮廓无法通过椭圆一致性检查，请点选目标暗环或重新取点。");
    const result=manualResult ?? {fit:robustAutoFit!.fit,rms:robustAutoFit!.rms,coverage:robustAutoFit!.coverage,inliers:robustAutoFit!.inliers};
    const {centerX,centerY,semiMajor,semiMinor,ratio,angle}=result.fit;
    const fitResidual=result.rms/semiMinor;
    const fitMethod: "auto" | "manual" = manualResult?"manual":"auto";
    const quadrants=[0,0,0,0];
    for(const point of tracked)quadrants[(point.x>=centerX?1:0)+(point.y>=centerY?2:0)]+=point.magnitude;
    const meanMagnitude=tracked.reduce((sum,p)=>sum+p.magnitude,0)/tracked.length;
    const contrastScore=clamp((meanMagnitude-q65)/Math.max(1,q92-q65),0,1);
    const edgeCoverage=tracked.filter(p=>p.magnitude>=q76).length/tracked.length;
    const fitInlierFraction=result.inliers.length/tracked.length;
    const residualScore=Math.exp(-((result.rms/Math.max(.8,Math.min(width,height)*.0015))**2));
    const fitQuality=clamp((residualScore*.5+result.coverage*.2+fitInlierFraction*.15+contrastScore*.15)*Math.min(1,contrastScore/.2),0,1);
    const fitResidualPx=result.rms,fitCoverage=result.coverage;
    const quadrantTotal = quadrants.reduce((sum, value) => sum + value, 0) || 1;
    const normalizedQuadrants = quadrants.map((value) => value / quadrantTotal);
    const asymmetry = clamp((Math.max(...normalizedQuadrants) - Math.min(...normalizedQuadrants)) * 2.2, 0, 1);
    const centerOffset = clamp(
      Math.hypot(centerX - (x0 + x1) / 2, centerY - (y0 + y1) / 2) / (Math.min(x1 - x0, y1 - y0) * 0.5),
      0,
      1,
    );
    const clarity = clamp(contrastScore * 0.7 + edgeCoverage * 0.3, 0, 1);
    const damaged = fitQuality < 0.48 || fitResidual > 0.08 || fitCoverage < 0.6 || contrastScore<.08 || (fitMethod === "auto" && edgeCoverage < 0.28);
    const confidence = clamp(fitQuality, 0, 0.98);

    context.save();
    const accepted=new Set(result.inliers);
    tracked.forEach((point,i)=>{context.fillStyle=accepted.has(i)?"rgba(72,202,142,.85)":"rgba(255,105,92,.9)";context.beginPath();context.arc(point.x,point.y,Math.max(1.1,width/700),0,Math.PI*2);context.fill();});
    context.lineWidth = Math.max(2, width / 420);
    if (!damaged) {
      context.strokeStyle = "rgba(201, 239, 99, 0.98)";
      context.fillStyle = "rgba(201, 239, 99, 0.98)";
      context.setLineDash([Math.max(5, width / 90), Math.max(4, width / 130)]);
      context.beginPath();
      context.ellipse(centerX, centerY, semiMajor, semiMinor, (angle * Math.PI) / 180, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
      context.beginPath();
      context.arc(centerX, centerY, Math.max(4, width / 180), 0, Math.PI * 2);
      context.fill();
    } else {
      context.strokeStyle = "rgba(255, 119, 98, 0.95)";
      context.fillStyle = "rgba(255, 119, 98, 0.95)";
      context.setLineDash([8, 6]);
      context.strokeRect(x0, y0, x1 - x0, y1 - y0);
      context.setLineDash([]);
      context.font = `700 ${Math.max(11, width / 58)}px ui-monospace, monospace`;
      context.fillText("LOW FIT QUALITY", x0 + 14, y0 + 25);
    }
    context.strokeStyle = damaged ? "rgba(255,119,98,.82)" : "rgba(255,255,255,.82)";
    context.lineWidth = Math.max(1, width / 800);
    context.strokeRect(x0, y0, x1 - x0, y1 - y0);
    context.restore();
    const annotatedImage = annotate ? canvas.toDataURL("image/jpeg", 0.9) : "";

    return { ratio, angle, centerOffset, clarity, asymmetry, fitQuality, confidence, damaged, annotatedImage, fitMethod, detectedScreen, fitResidualPx, fitCoverage, fitInlierFraction, ellipse:damaged?undefined:{...result.fit,imageWidth:width,imageHeight:height},contourPoints:tracked.map((point,i)=>({x:point.x/width,y:point.y/height,inlier:accepted.has(i)})),processingMs:performance.now()-started, contourKind:manualResult?"manual-points":"dark-centerline" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function axisProjectionFactor(ratio: number, angleDegrees: number) {
  const phi = (angleDegrees * Math.PI) / 180;
  return Math.sqrt(Math.cos(phi) ** 2 + Math.sin(phi) ** 2 / ratio ** 2);
}

export function calculationT(n: number) {
  return ({ 2: 12.706, 3: 4.303, 4: 3.182, 5: 2.776, 6: 2.571 } as Record<number, number>)[n] || 1.96;
}
