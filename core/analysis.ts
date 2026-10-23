import { MIN_DARK_BAND_SUPPORT, measureRingEvidence } from "./ring-evidence.ts";
import { angularSupport, fitRingEllipse, darkCandidates, traceDarkRing } from "./ring-tracking.ts";
import { initializeEllipse } from "./ellipse.ts";
import { selectAutomaticRings } from "./auto-rings.ts";
import type { RingSelection } from "./auto-rings.ts";
import { assessFit } from "./fit-quality.ts";
import { refineSubpixelRing } from "./subpixel-ring.ts";
import type { FitValidation } from "./subpixel-ring.ts";
import type { FitStatus } from "./fit-quality.ts";
import type { Ellipse } from "./ellipse.ts";
export type CauseId =
  | "tilt"
  | "pressure"
  | "decenter"
  | "calibration"
  | "damage"
  | "focus"
  | "illumination"
  | "distortion";

export type ImageMetrics = {
  fitValidation?: FitValidation;
  ratio: number;
  angle: number;
  centerOffset: number;
  clarity: number;
  asymmetry: number;
  fitQuality: number;
  confidence: number;
  damaged: boolean;
  annotatedImage: string;
  fitMethod: "auto";
  detectedScreen: boolean;
  ellipse?: EllipseFit & { imageWidth: number; imageHeight: number };
  contourPoints?: Array<FitPoint & { inlier: boolean }>;
  processingMs?: number;
  fitResidualPx?: number;
  fitCoverage?: number;
  fitInlierFraction?: number;
  fitEvidence?: ReturnType<typeof measureRingEvidence>;
  fitObservedFraction?: number;
  fitStatus?: FitStatus;
  fitWarnings?: string[];
  contourKind?: "dark-centerline";
  ringSelection?: RingSelection;
};

export type Diagnosis = {
  verdict: string;
  summary: string;
  causes: CauseId[];
  confidence: number;
  provider?: "empirical";
};

export type FitPoint = { x: number; y: number };
type EllipseFit = Ellipse;

export const ORDERS = [5, 10, 15, 20, 25, 30, 35, 40];
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
    title: "观察方向倾斜或斜拍",
    short: "投影压缩",
    description: "观察投影与透视可能使圆环成为椭圆；器件间隙的纯线性倾斜主要使环心移动。",
    advice: "微调反射镜、显微镜或相机姿态，使观察光轴尽量垂直于牛顿环平面，并让十字线穿过环心。",
    formula: "q = b/a；原因未独立验证时不作投影补偿",
  },
  {
    id: "pressure",
    index: "02",
    title: "透镜受力不均",
    short: "接触形变",
    description: "多环形状差异可能与局部形变有关，也可能来自污斑、遮挡或成像畸变，需现场复核。",
    advice: "先保持设置复拍，排除污斑与反光；涉及接触面或受力调整时按仪器说明或教师指导操作。",
    formula: "多环形状对比；不以等面积圆代替真实环径",
  },
  {
    id: "decenter",
    index: "03",
    title: "环心偏离读数轴",
    short: "弦长误差",
    description: "测量线没有穿过真实环心，读到的是弦长而非直径，可用偏心量补偿。",
    advice: "移动镜组或读数显微镜，使环心与十字线交点重合；重新确认水平测量线穿过真实环心。",
    formula: "实际偏心量 e 未独立测量时不作弦长补偿",
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
    description: "实物划伤、崩边等可能改变成像；条纹裁切、遮挡或低质量本身不能证明元件损坏。",
    advice:
      "停止测量，检查光源、透镜划伤或崩边、接触面污染和显微镜成像；必要时更换仪器后重新拍照。",
    formula: "停止还原并检修仪器",
  },
  {
    id: "focus",
    index: "06",
    title: "成像清晰度与局部干扰",
    short: "成像复核",
    description:
      "十字丝正常存在，少量灰尘也很常见；算法会屏蔽十字丝邻域并剔除孤立异常点。只有剩余条纹证据不足时，才进一步排查失焦、抖动或严重遮挡。",
    advice:
      "先核对拟合是否沿同一条暗纹。若有效弧段不足或残差明显，再固定相机、检查对焦与照明并复拍；无需为了正常十字丝反复调整器件。",
    formula: "十字丝屏蔽 + 切向中位数 + 鲁棒拟合 + 分区留出检验",
  },
  {
    id: "illumination",
    index: "07",
    title: "照明不均与反光",
    short: "照明影响",
    description: "亮度梯度、局部反光和过曝会偏移暗纹极小值。",
    advice: "改变照明或遮挡杂散光，避免过曝，保持器件设置不变复拍。",
    formula: "比较分区对比度与暗纹位置",
  },
  {
    id: "distortion",
    index: "09",
    title: "镜头畸变与屏幕斜拍",
    short: "成像畸变",
    description: "镜头径向畸变、屏幕翻拍和透视可改变不同位置的环形。",
    advice: "用标定板或已知矩形平面获取独立相机标定，换角度复拍对比。",
    formula: "需独立相机内参与平面映射后逐点重拟合",
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

export function builtinDiagnosis(metrics: ImageMetrics): Diagnosis {
  if (metrics.damaged) {
    return {
      verdict: metrics.fitStatus === "review" ? "拟合待复核" : "轮廓证据不足",
      summary:
        metrics.fitStatus === "review"
          ? "已显示可辨认弧段支持的候选椭圆。缺失、遮挡或较大的轮廓偏差会影响形状判断，请先核对目标环；本轮暂不作仪器误差归因或自动补偿。"
          : "当前图像不足以支持可靠的轮廓判断。请检查取景、对焦与目标环选择；这不等同于仪器损坏。",
      causes: [],
      confidence: metrics.confidence,
    };
  }

  const causes: CauseId[] = [];
  if (metrics.ringSelection?.consistency === "inconsistent") {
    return {
      verdict: "各环形状不一致",
      summary:
        "不同可见暗环的轴比或圆心差异较大。局部形变、遮挡及成像畸变均有可能，暂不采用统一形状解释，更不能统一补偿所有直径。",
      causes: ["pressure"],
      confidence: metrics.confidence,
      provider: "empirical",
    };
  }
  if (metrics.ratio < 0.99) causes.push("tilt", "calibration");
  const verdict =
    metrics.ratio >= 0.975 ? "可见环接近正圆" : metrics.ratio >= 0.92 ? "轻微椭圆" : "明显椭圆";
  return {
    verdict,
    summary: `当前可见暗环短长轴比 ${metrics.ratio.toFixed(3)}。倾斜、透视与横纵比例失真可能产生相似形状；仅凭照片不能唯一归因。中心接触状态、绝对级次与真实读数偏心未评估。`,
    causes,
    confidence: metrics.confidence,
    provider: "empirical",
  };
}

export function constrainDiagnosis(metrics: ImageMetrics, diagnosis: Diagnosis): Diagnosis {
  const local = builtinDiagnosis(metrics);
  if (metrics.damaged || metrics.ringSelection?.consistency === "inconsistent") return local;
  const scope = "仅评估可见暗环形状；中心接触状态和真实读数偏心未评估，不据此补偿直径。";
  return {
    ...diagnosis,
    verdict: local.verdict,
    causes: diagnosis.causes.filter((id) => local.causes.includes(id)),
    confidence: Math.min(diagnosis.confidence, metrics.confidence),
    summary: local.summary + " " + scope,
  };
}

export function buildCauseSuggestions(metrics: ImageMetrics, _diagnosis: Diagnosis) {
  // Scores order checks, not calibrated causal probabilities. Every cause stays visible.
  const weak = metrics.damaged || metrics.fitStatus === "review",
    ellipse = metrics.ratio < 0.99;
  const inconsistent = metrics.ringSelection?.consistency === "inconsistent";
  const details: Record<CauseId, { score: number; status: string; evidence: string }> = {
    tilt: {
      score: ellipse ? 75 : 25,
      status: ellipse ? "可能相关" : "当前支持较弱",
      evidence: `q=${metrics.ratio.toFixed(4)}；观察投影可产生椭圆，器件的纯间隙倾斜主要移动环心。需改变相机方向验证。`,
    },
    pressure: {
      score: inconsistent ? 80 : ellipse ? 55 : 25,
      status: inconsistent ? "优先验证" : ellipse ? "可能相关" : "尚不能排除",
      evidence: `${metrics.ringSelection?.checkedRingCount ?? 0} 条环复核；多环轴比差 ${(100 * (metrics.ringSelection?.ratioSpread ?? 0)).toFixed(2)} 个百分点。各向同性受力也可能保持圆形，需受控调整与独立参考。`,
    },
    decenter: {
      score: 35,
      status: "需现场验证",
      evidence: `取景中心偏移 ${(100 * metrics.centerOffset).toFixed(1)}%；未确定真实读数轴，不能从取景偏移直接推断弦长误差。`,
    },
    calibration: {
      score: ellipse ? 65 : 30,
      status: ellipse ? "可能相关" : "需独立标定",
      evidence: "横纵像素比例与真实尺度无法仅凭一张环图分离；用标准刻尺复核。",
    },
    damage: {
      score: 10,
      status: "无法凭本图确认",
      evidence: "低拟合质量不是物理损坏证据；需要实物检查划痕、崩边或独立复测。",
    },
    focus: {
      score: weak ? 82 : 20,
      status: weak ? "建议复核" : "常规干扰已处理",
      evidence: `暗纹定位 RMS=${metrics.fitResidualPx?.toFixed(2) ?? "未知"} px；有效角向支持 ${Math.round((metrics.fitObservedFraction ?? 0) * 100)}%。十字丝正常存在，灰尘常见；裁切、宽纹与失焦不能仅凭此区分。先检查剔除干扰后的剩余条纹证据。`,
    },
    illumination: {
      score: metrics.asymmetry > 0.25 ? 78 : 40,
      status: metrics.asymmetry > 0.25 ? "优先验证" : "可能相关",
      evidence: `四象限明暗不对称指标 ${metrics.asymmetry.toFixed(3)}，裁切也会改变该指标。`,
    },
    distortion: {
      score: ellipse || inconsistent ? 62 : 30,
      status: ellipse || inconsistent ? "可能相关" : "需独立标定",
      evidence: `${metrics.detectedScreen ? "检测到暖色成像区域，存在屏幕翻拍可能。" : "尚未确定相机与器件几何关系。"}需标定板区分透视、比例和镜头畸变。`,
    },
  };
  return CAUSES.map((c) => ({
    ...c,
    probability: details[c.id].score,
    ...details[c.id],
    recommended: false,
  }))
    .sort((a, b) => b.score - a.score)
    .map((c, i) => ({ ...c, recommended: i < MAX_RECOMMENDED_CAUSES && c.id !== "damage" }));
}

function longestRun(input: boolean[]) {
  const flags = [...input];
  // A thin crosshair must not split one illuminated screen into two regions.
  const limit = Math.max(2, Math.round(flags.length * 0.025));
  for (let i = 0; i < flags.length; ) {
    if (flags[i]) {
      i++;
      continue;
    }
    const start = i;
    while (i < flags.length && !flags[i]) i++;
    if (start > 0 && i < flags.length && i - start <= limit)
      for (let j = start; j < i; j++) flags[j] = true;
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

export function boxBlur(source: Float32Array, width: number, height: number, radius: number) {
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

function robustEllipseFromRing(points: RingCandidate[], width: number, height: number) {
  if (points.length < 20) return null;
  const result = fitRingEllipse(points, width, height);
  if (!result || result.coverage < 0.6) return null;
  return {
    fit: result.fit,
    residual: result.rms / result.fit.semiMinor,
    inlierCoverage: result.inliers.length / points.length,
    coverage: result.coverage,
    inliers: result.inliers,
    rms: result.rms,
  };
}

function traceContinuousRing(
  gray: Float32Array,
  width: number,
  height: number,
  roi: { x0: number; x1: number; y0: number; y1: number },
  center: { x: number; y: number },
  gradientScale: number,
  target?: FitPoint,
  prediction?: EllipseFit,
  guide?: { x?: number; y?: number },
) {
  return traceDarkRing(gray, width, height, roi, center, gradientScale, target, prediction, guide);
}

export function detectGuideLine(
  gray: Float32Array,
  width: number,
  height: number,
  roi: { x0: number; x1: number; y0: number; y1: number },
  axis: "vertical" | "horizontal",
) {
  const start = Math.round(
    (axis === "vertical" ? roi.x0 : roi.y0) +
      (axis === "vertical" ? roi.x1 - roi.x0 : roi.y1 - roi.y0) * 0.32,
  );
  const end = Math.round(
    (axis === "vertical" ? roi.x0 : roi.y0) +
      (axis === "vertical" ? roi.x1 - roi.x0 : roi.y1 - roi.y0) * 0.68,
  );
  let bestCoordinate = (start + end) / 2;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestSupport = 0;
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
        if (x >= roi.x0 && x <= roi.x1 && y >= roi.y0 && y <= roi.y1)
          neighborValues.push(gray[y * width + x]);
      }
      if (neighborValues.length) contrasts.push(median(neighborValues) - Math.min(...lineValues));
    }
    const score = median(contrasts) + median(contrasts.filter((value) => value > 0)) * 0.45;
    if (score > bestScore) {
      bestScore = score;
      bestCoordinate = coordinate;
      bestSupport = contrasts.filter((v) => v > 12).length / Math.max(1, contrasts.length);
    }
  }
  return { coordinate: bestCoordinate, strength: bestScore, support: bestSupport };
}

function refineSourceRing(
  image: HTMLImageElement,
  fit: EllipseFit,
  width: number,
  height: number,
  guide: { x?: number; y?: number },
): RingCandidate[] | null {
  const angle = (fit.angle * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const ex = Math.hypot(fit.semiMajor * c, fit.semiMinor * s) + 10,
    ey = Math.hypot(fit.semiMajor * s, fit.semiMinor * c) + 10;
  const sx = image.naturalWidth / width,
    sy = image.naturalHeight / height;
  const x = Math.max(0, Math.floor((fit.centerX - ex) * sx)),
    y = Math.max(0, Math.floor((fit.centerY - ey) * sy));
  const sourceWidth = Math.min(image.naturalWidth - x, Math.ceil(2 * ex * sx)),
    sourceHeight = Math.min(image.naturalHeight - y, Math.ceil(2 * ey * sy));
  const scale = Math.min(1, 1800 / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, x, y, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  const gx = canvas.width / sourceWidth,
    gy = canvas.height / sourceHeight;
  const toLocal = (px: number, py: number) => ({ x: (px * sx - x) * gx, y: (py * sy - y) * gy });
  const outline = Array.from({ length: 40 }, (_, i) => {
    const t = (i / 40) * 2 * Math.PI;
    return toLocal(
      fit.centerX + fit.semiMajor * Math.cos(t) * c - fit.semiMinor * Math.sin(t) * s,
      fit.centerY + fit.semiMajor * Math.cos(t) * s + fit.semiMinor * Math.sin(t) * c,
    );
  });
  const predicted = initializeEllipse(outline);
  if (!predicted) return null;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data,
    gray = new Float32Array(canvas.width * canvas.height);
  for (let i = 0; i < gray.length; i++)
    gray[i] = pixels[4 * i] * 0.299 + pixels[4 * i + 1] * 0.587 + pixels[4 * i + 2] * 0.114;
  const fineGray = boxBlur(gray, canvas.width, canvas.height, Math.max(1, Math.round(sx * gx)));
  const points: RingCandidate[] = [];
  for (let i = 0; i < 240; i++) {
    const theta = (i / 240) * 2 * Math.PI,
      phi = theta - (predicted.angle * Math.PI) / 180;
    const radius =
      1 / Math.hypot(Math.cos(phi) / predicted.semiMajor, Math.sin(phi) / predicted.semiMinor);
    const band = Math.max(3, Math.min(10 * sx * gx, predicted.semiMinor * 0.035));
    const candidates = darkCandidates(
      fineGray,
      canvas.width,
      canvas.height,
      { x: predicted.centerX, y: predicted.centerY },
      theta,
      Math.max(2, radius - band),
      radius + band,
      1.5,
    );
    if (!candidates.length) continue;
    const best = candidates.reduce((a, b) =>
      Math.abs(a.radius - radius) < Math.abs(b.radius - radius) ? a : b,
    );
    const px = (best.x / gx + x) / sx,
      py = (best.y / gy + y) / sy;
    if (
      (guide.x !== undefined && Math.abs(px - guide.x) < 6) ||
      (guide.y !== undefined && Math.abs(py - guide.y) < 6)
    )
      continue;
    points.push({
      x: px,
      y: py,
      radius: Math.hypot(px - fit.centerX, py - fit.centerY),
      magnitude: best.magnitude,
      maxRadius: Math.max(width, height),
    });
  }
  // Release the potentially large fine-pass canvas before constructing overlays.
  canvas.width = 1;
  canvas.height = 1;
  return points.length >= 144 ? points : null;
}

export async function inspectImage(file: File, annotate = true): Promise<ImageMetrics> {
  const started = performance.now();
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
    if (Math.min(image.naturalWidth, image.naturalHeight) < 80)
      throw new Error("图像尺寸过小，请提供原始照片。");
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
      const [screenX0, screenX1] = longestRun(
        warmColumns.map((count) => count > (screenY1 - screenY0) * 0.54),
      );
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
    const guideMask: { x?: number; y?: number } = {};
    {
      const verticalGuide = detectGuideLine(gray, width, height, { x0, x1, y0, y1 }, "vertical");
      const horizontalGuide = detectGuideLine(
        gray,
        width,
        height,
        { x0, x1, y0, y1 },
        "horizontal",
      );
      if (verticalGuide.strength > 10 && verticalGuide.support > 0.55) {
        guideCenterX = verticalGuide.coordinate;
        guideMask.x = verticalGuide.coordinate;
      }
      if (horizontalGuide.strength > 10 && horizontalGuide.support > 0.55) {
        guideCenterY = horizontalGuide.coordinate;
        guideMask.y = horizontalGuide.coordinate;
      }
    }

    const blurRadius = clamp(Math.round(Math.max(width, height) / 450), 1, 3);
    const blurred = boxBlur(
      boxBlur(gray, width, height, blurRadius),
      width,
      height,
      Math.max(2, Math.round(blurRadius / 2)),
    );
    const gradient = new Float32Array(width * height);
    const gradientSamples: number[] = [];
    for (let y = y0 + 1; y < y1 - 1; y += 1) {
      for (let x = x0 + 1; x < x1 - 1; x += 1) {
        const i = y * width + x;
        const gx =
          -blurred[i - width - 1] +
          blurred[i - width + 1] -
          2 * blurred[i - 1] +
          2 * blurred[i + 1] -
          blurred[i + width - 1] +
          blurred[i + width + 1];
        const gy =
          -blurred[i - width - 1] -
          2 * blurred[i - width] -
          blurred[i - width + 1] +
          blurred[i + width - 1] +
          2 * blurred[i + width] +
          blurred[i + width + 1];
        gradient[i] = Math.hypot(gx, gy);
        if (x % 3 === 0 && y % 3 === 0) gradientSamples.push(gradient[i]);
      }
    }
    if (gradientSamples.length < 100) throw new Error("图像尺寸过小，请上传更清晰的照片");
    gradientSamples.sort((a, b) => a - b);
    const q65 = gradientSamples[Math.floor(gradientSamples.length * 0.65)] || 0;
    const q76 = gradientSamples[Math.floor(gradientSamples.length * 0.76)] || q65;
    const q92 = Math.max(1, gradientSamples[Math.floor(gradientSamples.length * 0.92)] || 1);
    const automatic = selectAutomaticRings(
      blurred,
      width,
      height,
      { x0, x1, y0, y1 },
      { x: guideCenterX, y: guideCenterY },
      q92,
      guideMask,
    );
    if (!automatic)
      throw new Error(
        "未找到足够清晰的暗环。请保持拍摄方向，改善对焦或取景后重拍；无需让中心暗斑完整出现。",
      );
    let tracked: RingCandidate[] = automatic.selected.points;
    let robustAutoFit = robustEllipseFromRing(tracked, width, height);
    let fitEvidence = measureRingEvidence(
      blurred,
      width,
      height,
      { x0, x1, y0, y1 },
      automatic.selected.fit,
      guideMask,
      Math.max(3, q92 * 0.1),
    );
    if (robustAutoFit) {
      for (let iteration = 0; iteration < 2; iteration += 1) {
        const retraced = traceContinuousRing(
          blurred,
          width,
          height,
          { x0, x1, y0, y1 },
          { x: robustAutoFit.fit.centerX, y: robustAutoFit.fit.centerY },
          q92,
          undefined,
          robustAutoFit.fit,
          guideMask,
        );
        if (!retraced) break;
        const refined = robustEllipseFromRing(retraced, width, height);
        if (!refined || refined.residual > robustAutoFit.residual * 1.08) break;
        const evidence = measureRingEvidence(
          blurred,
          width,
          height,
          { x0, x1, y0, y1 },
          refined.fit,
          guideMask,
          Math.max(3, q92 * 0.1),
        );
        if (
          evidence.fraction < MIN_DARK_BAND_SUPPORT ||
          evidence.fraction < fitEvidence.fraction - 0.05
        )
          break;
        tracked = retraced;
        robustAutoFit = refined;
        fitEvidence = evidence;
      }
    }

    if (robustAutoFit) {
      const finePoints = refineSourceRing(image, robustAutoFit.fit, width, height, guideMask);
      const fine = finePoints ? robustEllipseFromRing(finePoints, width, height) : null;
      if (
        fine &&
        Math.abs(fine.fit.ratio - robustAutoFit.fit.ratio) < 0.06 &&
        Math.hypot(
          fine.fit.centerX - robustAutoFit.fit.centerX,
          fine.fit.centerY - robustAutoFit.fit.centerY,
        ) < 5 &&
        Math.abs(fine.fit.semiMajor / robustAutoFit.fit.semiMajor - 1) < 0.05 &&
        fine.rms <= Math.max(1, robustAutoFit.rms * 1.2)
      ) {
        const evidence = measureRingEvidence(
          blurred,
          width,
          height,
          { x0, x1, y0, y1 },
          fine.fit,
          guideMask,
          Math.max(3, q92 * 0.1),
        );
        if (
          evidence.fraction >= MIN_DARK_BAND_SUPPORT &&
          evidence.fraction >= fitEvidence.fraction - 0.05
        ) {
          tracked = finePoints!;
          robustAutoFit = fine;
          fitEvidence = evidence;
        }
      }
    }
    let fitValidation: FitValidation | undefined;
    if (robustAutoFit) {
      const proposal = refineSubpixelRing(
        blurred,
        width,
        height,
        { x0, x1, y0, y1 },
        robustAutoFit.fit,
        guideMask,
      );
      if (proposal) {
        fitValidation = proposal.validation;
        const evidence = measureRingEvidence(
          blurred,
          width,
          height,
          { x0, x1, y0, y1 },
          proposal.fit,
          guideMask,
          Math.max(3, q92 * 0.1),
        );
        const verified = robustEllipseFromRing(proposal.points, width, height);
        if (
          proposal.validation.adopted &&
          verified &&
          evidence.fraction >= MIN_DARK_BAND_SUPPORT &&
          evidence.fraction >= fitEvidence.fraction - 0.025
        ) {
          tracked = proposal.points;
          robustAutoFit = verified;
          fitEvidence = evidence;
        } else fitValidation = { ...fitValidation, adopted: false };
      }
    }
    if (!robustAutoFit) throw new Error("可见暗纹不足以支持可靠曲线，请改善对焦或取景后重拍。");
    const result = {
      fit: robustAutoFit!.fit,
      rms: robustAutoFit!.rms,
      coverage: robustAutoFit!.coverage,
      inliers: robustAutoFit!.inliers,
    };
    const { centerX, centerY, semiMajor, semiMinor, ratio, angle } = result.fit;
    const fitMethod = "auto" as const;
    const quadrants = [0, 0, 0, 0];
    for (const point of tracked)
      quadrants[(point.x >= centerX ? 1 : 0) + (point.y >= centerY ? 2 : 0)] += point.magnitude;
    const meanMagnitude = tracked.reduce((sum, p) => sum + p.magnitude, 0) / tracked.length;
    const contrastScore = clamp(meanMagnitude / Math.max(16, q92 * 1.5), 0, 1);
    const edgeCoverage = tracked.filter((p) => p.magnitude >= q76).length / tracked.length;
    const fitInlierFraction = result.inliers.length / tracked.length;
    const fitObservedFraction = angularSupport(
      result.inliers.map((i) => tracked![i]),
      result.fit,
    );
    const assessment = assessFit({
      rms: result.rms,
      semiMinor,
      minDimension: Math.min(width, height),
      coverage: result.coverage,
      observedFraction: fitObservedFraction,
      inlierFraction: fitInlierFraction,
      contrast: contrastScore,
      imageEvidence: fitEvidence,
    });
    const fitQuality = assessment.quality;
    const fitResidualPx = result.rms,
      fitCoverage = result.coverage;
    const quadrantTotal = quadrants.reduce((sum, value) => sum + value, 0) || 1;
    const normalizedQuadrants = quadrants.map((value) => value / quadrantTotal);
    const asymmetry = clamp(
      (Math.max(...normalizedQuadrants) - Math.min(...normalizedQuadrants)) * 2.2,
      0,
      1,
    );
    const centerOffset = clamp(
      Math.hypot(centerX - (x0 + x1) / 2, centerY - (y0 + y1) / 2) /
        (Math.min(x1 - x0, y1 - y0) * 0.5),
      0,
      1,
    );
    const clarity = clamp(contrastScore * 0.7 + edgeCoverage * 0.3, 0, 1);
    // Legacy `damaged` means unsuitable for quantitative use, not physical damage.
    const damaged = assessment.status !== "accepted";
    const showEllipse = assessment.status !== "unreliable";
    const confidence = clamp(fitQuality, 0, 0.98);

    context.save();
    const accepted = new Set(result.inliers);
    tracked.forEach((point, i) => {
      context.fillStyle = accepted.has(i) ? "rgba(72,202,142,.85)" : "rgba(255,105,92,.9)";
      context.beginPath();
      context.arc(point.x, point.y, Math.max(1.1, width / 700), 0, Math.PI * 2);
      context.fill();
    });
    context.lineWidth = Math.max(2, width / 420);
    if (showEllipse) {
      context.strokeStyle = damaged ? "rgba(255, 190, 77, 0.98)" : "rgba(201, 239, 99, 0.98)";
      context.fillStyle = "rgba(201, 239, 99, 0.98)";
      context.setLineDash([Math.max(5, width / 90), Math.max(4, width / 130)]);
      context.beginPath();
      context.ellipse(
        centerX,
        centerY,
        semiMajor,
        semiMinor,
        (angle * Math.PI) / 180,
        0,
        Math.PI * 2,
      );
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

    return {
      ratio,
      angle,
      centerOffset,
      clarity,
      asymmetry,
      fitQuality,
      confidence,
      damaged,
      annotatedImage,
      fitMethod,
      detectedScreen,
      fitResidualPx,
      fitCoverage,
      fitInlierFraction,
      fitEvidence,
      fitValidation,
      fitStatus: assessment.status,
      fitWarnings: assessment.warnings,
      fitObservedFraction,
      ellipse: !showEllipse ? undefined : { ...result.fit, imageWidth: width, imageHeight: height },
      contourPoints: tracked.map((point, i) => ({
        x: point.x / width,
        y: point.y / height,
        inlier: accepted.has(i),
      })),
      processingMs: performance.now() - started,
      contourKind: "dark-centerline",
      ringSelection: {
        ...automatic.selection,
        scaleFraction: Math.sqrt(semiMajor * semiMinor) / Math.min(x1 - x0, y1 - y0),
      },
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function calculationT(n: number) {
  return (
    ({ 2: 12.706, 3: 4.303, 4: 3.182, 5: 2.776, 6: 2.571 } as Record<number, number>)[n] || 1.96
  );
}
