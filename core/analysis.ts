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
};

export type AiDiagnosis = {
  verdict: string;
  summary: string;
  causes: CauseId[];
  confidence: number;
  provider?: "deepseek" | "local-fallback" | "empirical";
};

export type FitPoint = { x: number; y: number };
type EllipseFit = { centerX: number; centerY: number; semiMajor: number; semiMinor: number; ratio: number; angle: number };

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

function solveLinearSystem(matrix: number[][], vector: number[]) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    if (Math.abs(divisor) < 1e-10) return null;
    for (let j = column; j <= size; j += 1) augmented[column][j] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let j = column; j <= size; j += 1) augmented[row][j] -= factor * augmented[column][j];
    }
  }
  return augmented.map((row) => row[size]);
}

export function fitEllipseFromPoints(points: FitPoint[], width: number, height: number): EllipseFit | null {
  if (points.length < 5) return null;
  const scale = Math.max(width, height);
  const rows = points.map((point) => {
    const x = (point.x * width - width / 2) / scale;
    const y = (point.y * height - height / 2) / scale;
    return [x * x, x * y, y * y, x, y];
  });
  const normal = Array.from({ length: 5 }, () => Array(5).fill(0));
  const target = Array(5).fill(0);
  for (const row of rows) {
    for (let i = 0; i < 5; i += 1) {
      target[i] += row[i];
      for (let j = 0; j < 5; j += 1) normal[i][j] += row[i] * row[j];
    }
  }
  for (let i = 0; i < 5; i += 1) normal[i][i] += 1e-8;
  const solved = solveLinearSystem(normal, target);
  if (!solved) return null;
  const [a, b, c, d, e] = solved;
  const determinant = a * c - (b * b) / 4;
  if (determinant <= 1e-9) return null;
  const centerXNorm = (b * e - 2 * c * d) / (4 * determinant);
  const centerYNorm = (b * d - 2 * a * e) / (4 * determinant);
  const constant = 1 + a * centerXNorm ** 2 + b * centerXNorm * centerYNorm + c * centerYNorm ** 2;
  const root = Math.sqrt(Math.max(0, (a - c) ** 2 + b ** 2));
  const lambdaLarge = (a + c + root) / 2;
  const lambdaSmall = (a + c - root) / 2;
  if (constant <= 0 || lambdaSmall <= 0 || lambdaLarge <= 0) return null;
  const semiMajor = Math.sqrt(constant / lambdaSmall) * scale;
  const semiMinor = Math.sqrt(constant / lambdaLarge) * scale;
  let angle = ((0.5 * Math.atan2(b, a - c) + Math.PI / 2) * 180) / Math.PI;
  while (angle > 90) angle -= 180;
  while (angle < -90) angle += 180;
  const centerX = centerXNorm * scale + width / 2;
  const centerY = centerYNorm * scale + height / 2;
  if (semiMajor > scale * 1.2 || semiMinor < 3 || centerX < -width * 0.25 || centerX > width * 1.25 || centerY < -height * 0.25 || centerY > height * 1.25) return null;
  return { centerX, centerY, semiMajor, semiMinor, ratio: clamp(semiMinor / semiMajor, 0.35, 1), angle };
}

function longestRun(flags: boolean[]) {
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
      const sampleX = Math.round(x + cosine * radialOffset - sine * tangentOffset);
      const sampleY = Math.round(y + sine * radialOffset + cosine * tangentOffset);
      if (sampleX <= 1 || sampleX >= width - 2 || sampleY <= 1 || sampleY >= height - 2) continue;
      localMaximum = Math.max(localMaximum, gradient[sampleY * width + sampleX]);
    }
    tangentialSamples.push(localMaximum);
  }
  return median(tangentialSamples);
}

function robustEllipseFromRing(points: RingCandidate[], width: number, height: number) {
  if (points.length < 20) return null;
  let inliers = points;
  let fit: EllipseFit | null = null;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    fit = fitEllipseFromPoints(inliers.map((point) => ({ x: point.x / width, y: point.y / height })), width, height);
    if (!fit) return null;
    const angle = (fit.angle * Math.PI) / 180;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const residuals = points.map((point) => {
      const dx = point.x - fit!.centerX;
      const dy = point.y - fit!.centerY;
      const alongMajor = dx * cosine + dy * sine;
      const alongMinor = -dx * sine + dy * cosine;
      return Math.abs(Math.hypot(alongMajor / fit!.semiMajor, alongMinor / fit!.semiMinor) - 1);
    });
    const residualMedian = median(residuals);
    const mad = median(residuals.map((value) => Math.abs(value - residualMedian)));
    const threshold = clamp(residualMedian + Math.max(0.018, mad * 3.2), 0.035, 0.14);
    const nextInliers = points.filter((_, index) => residuals[index] <= threshold);
    if (nextInliers.length < points.length * 0.62 || nextInliers.length < 18) break;
    if (nextInliers.length === inliers.length) {
      inliers = nextInliers;
      break;
    }
    inliers = nextInliers;
  }
  if (!fit) return null;
  const angle = (fit.angle * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const residuals = points.map((point) => {
    const dx = point.x - fit!.centerX;
    const dy = point.y - fit!.centerY;
    const alongMajor = dx * cosine + dy * sine;
    const alongMinor = -dx * sine + dy * cosine;
    return Math.abs(Math.hypot(alongMajor / fit!.semiMajor, alongMinor / fit!.semiMinor) - 1);
  }).sort((a, b) => a - b);
  const trimmed = residuals.slice(0, Math.max(1, Math.floor(residuals.length * 0.86)));
  const residual = trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
  return { fit, residual, inlierCoverage: inliers.length / points.length };
}

function ringCandidateScore(candidate: RingCandidate, gradientScale: number) {
  const edgeProximity = candidate.radius / Math.max(1, candidate.maxRadius);
  return 2.5 * candidate.magnitude / gradientScale - 0.42 * edgeProximity ** 4;
}

function traceContinuousRing(
  gradient: Float32Array,
  width: number,
  height: number,
  roi: { x0: number; x1: number; y0: number; y1: number },
  center: { x: number; y: number },
  gradientScale: number,
) {
  const angleCount = 120;
  const minDimension = Math.min(roi.x1 - roi.x0, roi.y1 - roi.y0);
  const minimumRadius = Math.max(10, minDimension * 0.12);
  const candidates: RingCandidate[][] = [];

  for (let index = 0; index < angleCount; index += 1) {
    const theta = (index / angleCount) * Math.PI * 2;
    const cosine = Math.cos(theta);
    const sine = Math.sin(theta);
    const hitX = Math.abs(cosine) < 1e-5 ? Number.POSITIVE_INFINITY : (cosine > 0 ? roi.x1 - center.x : roi.x0 - center.x) / cosine;
    const hitY = Math.abs(sine) < 1e-5 ? Number.POSITIVE_INFINITY : (sine > 0 ? roi.y1 - center.y : roi.y0 - center.y) / sine;
    const maximumRadius = Math.max(minimumRadius + 4, Math.min(hitX, hitY) * 0.94);
    const samples: RingCandidate[] = [];
    for (let radius = minimumRadius; radius <= maximumRadius; radius += 2) {
      const x = Math.round(center.x + cosine * radius);
      const y = Math.round(center.y + sine * radius);
      if (x <= 1 || x >= width - 2 || y <= 1 || y >= height - 2) continue;
      samples.push({
        x,
        y,
        radius,
        magnitude: robustGradientSample(gradient, width, height, x, y, cosine, sine),
        maxRadius: maximumRadius,
      });
    }
    const localPeaks = samples.filter((sample, sampleIndex) => {
      const before = samples[Math.max(0, sampleIndex - 1)]?.magnitude ?? sample.magnitude;
      const after = samples[Math.min(samples.length - 1, sampleIndex + 1)]?.magnitude ?? sample.magnitude;
      return sample.magnitude >= before && sample.magnitude >= after;
    }).sort((a, b) => b.magnitude - a.magnitude);
    const selected: RingCandidate[] = [];
    for (const candidate of localPeaks) {
      if (selected.every((existing) => Math.abs(existing.radius - candidate.radius) >= Math.max(7, minDimension * 0.018))) selected.push(candidate);
      if (selected.length === 8) break;
    }
    if (!selected.length && samples.length) selected.push(samples.reduce((best, sample) => sample.magnitude > best.magnitude ? sample : best));
    candidates.push(selected.sort((a, b) => a.radius - b.radius));
  }

  if (candidates.some((items) => !items.length)) return null;
  const jumpScale = Math.max(11, minDimension * 0.055);
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestPath: RingCandidate[] = [];

  for (let start = 0; start < candidates[0].length; start += 1) {
    let scores = candidates[0].map((candidate, candidateIndex) => candidateIndex === start
      ? ringCandidateScore(candidate, gradientScale)
      : Number.NEGATIVE_INFINITY);
    const backPointers: number[][] = [candidates[0].map(() => -1)];
    for (let angleIndex = 1; angleIndex < angleCount; angleIndex += 1) {
      const previous = candidates[angleIndex - 1];
      const current = candidates[angleIndex];
      const nextScores = current.map(() => Number.NEGATIVE_INFINITY);
      const pointers = current.map(() => -1);
      current.forEach((candidate, currentIndex) => {
        previous.forEach((prior, priorIndex) => {
          const jump = (candidate.radius - prior.radius) / jumpScale;
          const score = scores[priorIndex] - 1.9 * jump * jump + ringCandidateScore(candidate, gradientScale);
          if (score > nextScores[currentIndex]) {
            nextScores[currentIndex] = score;
            pointers[currentIndex] = priorIndex;
          }
        });
      });
      scores = nextScores;
      backPointers.push(pointers);
    }
    scores.forEach((score, end) => {
      const closure = (candidates[angleCount - 1][end].radius - candidates[0][start].radius) / jumpScale;
      const closedScore = score - 2.4 * closure * closure;
      if (closedScore <= bestScore) return;
      const path = Array<RingCandidate>(angleCount);
      let cursor = end;
      for (let angleIndex = angleCount - 1; angleIndex >= 0; angleIndex -= 1) {
        path[angleIndex] = candidates[angleIndex][cursor];
        cursor = backPointers[angleIndex][cursor];
      }
      bestScore = closedScore;
      bestPath = path;
    });
  }
  return bestPath.length === angleCount ? bestPath : null;
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
    }
  }
  return { coordinate: bestCoordinate, strength: bestScore };
}

export async function inspectImage(file: File, manualPoints: FitPoint[] = [], annotate = true): Promise<ImageMetrics> {
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
    const width = Math.max(80, Math.round(image.naturalWidth * scale));
    const height = Math.max(80, Math.round(image.naturalHeight * scale));
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
    if (detectedScreen && manualPoints.length < 5) {
      const verticalGuide = detectGuideLine(gray, width, height, { x0, x1, y0, y1 }, "vertical");
      const horizontalGuide = detectGuideLine(gray, width, height, { x0, x1, y0, y1 }, "horizontal");
      if (verticalGuide.strength > 1.4) guideCenterX = verticalGuide.coordinate;
      if (horizontalGuide.strength > 1.4) guideCenterY = horizontalGuide.coordinate;
    }

    const blurRadius = clamp(Math.round(Math.max(width, height) / 145), 4, 8);
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
    let tracked = traceContinuousRing(
      gradient,
      width,
      height,
      { x0, x1, y0, y1 },
      { x: guideCenterX, y: guideCenterY },
      q92,
    );
    if (!tracked) throw new Error("没有识别到连续的牛顿环边缘，请重新裁剪或使用精准取点");

    let robustAutoFit = robustEllipseFromRing(tracked, width, height);
    if (robustAutoFit && manualPoints.length < 5) {
      for (let iteration = 0; iteration < 2; iteration += 1) {
        const retraced = traceContinuousRing(
          gradient,
          width,
          height,
          { x0, x1, y0, y1 },
          { x: robustAutoFit.fit.centerX, y: robustAutoFit.fit.centerY },
          q92,
        );
        if (!retraced) break;
        const refined = robustEllipseFromRing(retraced, width, height);
        if (!refined || refined.residual > robustAutoFit.residual * 1.08) break;
        tracked = retraced;
        robustAutoFit = refined;
      }
    }

    let centerX = tracked.reduce((sum, point) => sum + point.x, 0) / tracked.length;
    let centerY = tracked.reduce((sum, point) => sum + point.y, 0) / tracked.length;
    let xx = 0;
    let yy = 0;
    let xy = 0;
    const quadrants = [0, 0, 0, 0];
    for (const point of tracked) {
      const dx = point.x - centerX;
      const dy = point.y - centerY;
      xx += dx * dx;
      yy += dy * dy;
      xy += dx * dy;
      quadrants[(point.x >= centerX ? 1 : 0) + (point.y >= centerY ? 2 : 0)] += point.magnitude;
    }
    xx /= tracked.length;
    yy /= tracked.length;
    xy /= tracked.length;
    const trace = xx + yy;
    const root = Math.sqrt(Math.max(0, (xx - yy) ** 2 + 4 * xy ** 2));
    const major = Math.max(1, (trace + root) / 2);
    const minor = Math.max(1, (trace - root) / 2);
    let ratio = clamp(Math.sqrt(minor / major), 0.35, 1);
    let angle = (0.5 * Math.atan2(2 * xy, xx - yy) * 180) / Math.PI;
    while (angle > 90) angle -= 180;
    while (angle < -90) angle += 180;
    let semiMajor = clamp(Math.sqrt(2 * major), Math.min(width, height) * 0.08, Math.max(x1 - x0, y1 - y0) * 0.54);
    let semiMinor = semiMajor * ratio;

    if (robustAutoFit) {
      centerX = robustAutoFit.fit.centerX;
      centerY = robustAutoFit.fit.centerY;
      semiMajor = robustAutoFit.fit.semiMajor;
      semiMinor = robustAutoFit.fit.semiMinor;
      ratio = robustAutoFit.fit.ratio;
      angle = robustAutoFit.fit.angle;
    }

    const angleRadians = (angle * Math.PI) / 180;
    const cosine = Math.cos(angleRadians);
    const sine = Math.sin(angleRadians);
    const radialResiduals = tracked.map((point) => {
      const dx = point.x - centerX;
      const dy = point.y - centerY;
      const alongMajor = dx * cosine + dy * sine;
      const alongMinor = -dx * sine + dy * cosine;
      return Math.abs(Math.hypot(alongMajor / semiMajor, alongMinor / semiMinor) - 1);
    });
    const sortedResiduals = [...radialResiduals].sort((a, b) => a - b);
    const trimmedResiduals = sortedResiduals.slice(0, Math.max(1, Math.floor(sortedResiduals.length * 0.86)));
    let fitResidual = trimmedResiduals.reduce((sum, value) => sum + value, 0) / trimmedResiduals.length;
    let radialRoughness = 0;
    for (let index = 0; index < tracked.length; index += 1) {
      const previous = tracked[(index + tracked.length - 1) % tracked.length].radius;
      radialRoughness += Math.abs(tracked[index].radius - previous);
    }
    radialRoughness /= tracked.length * Math.max(1, Math.min(x1 - x0, y1 - y0));
    const meanMagnitude = tracked.reduce((sum, point) => sum + point.magnitude, 0) / tracked.length;
    const contrastScore = clamp((meanMagnitude - q65) / Math.max(1, q92 - q65), 0, 1);
    const edgeCoverage = tracked.filter((point) => point.magnitude >= q76).length / tracked.length;
    const inlierCoverage = robustAutoFit?.inlierCoverage ?? 0.72;
    const residualScore = clamp(1 - fitResidual / 0.13, 0, 1);
    const smoothnessScore = clamp(1 - radialRoughness / 0.042, 0, 1);
    let fitQuality = clamp(contrastScore * 0.24 + edgeCoverage * 0.14 + residualScore * 0.34 + smoothnessScore * 0.16 + inlierCoverage * 0.09 + (detectedScreen ? 0.03 : 0), 0, 1);

    let fitMethod: "auto" | "manual" = "auto";
    const manualFit = fitEllipseFromPoints(manualPoints, width, height);
    if (manualFit) {
      centerX = manualFit.centerX;
      centerY = manualFit.centerY;
      semiMajor = manualFit.semiMajor;
      semiMinor = manualFit.semiMinor;
      ratio = manualFit.ratio;
      angle = manualFit.angle;
      fitResidual = 0.02;
      fitQuality = 0.96;
      fitMethod = "manual";
    }

    const quadrantTotal = quadrants.reduce((sum, value) => sum + value, 0) || 1;
    const normalizedQuadrants = quadrants.map((value) => value / quadrantTotal);
    const asymmetry = clamp((Math.max(...normalizedQuadrants) - Math.min(...normalizedQuadrants)) * 2.2, 0, 1);
    const centerOffset = clamp(
      Math.hypot(centerX - (x0 + x1) / 2, centerY - (y0 + y1) / 2) / (Math.min(x1 - x0, y1 - y0) * 0.5),
      0,
      1,
    );
    const clarity = clamp(contrastScore * 0.7 + edgeCoverage * 0.3, 0, 1);
    const damaged = fitMethod === "auto" && (fitQuality < 0.48 || fitResidual > 0.2 || edgeCoverage < 0.28);
    const confidence = clamp(0.46 + fitQuality * 0.46 + (fitMethod === "manual" ? 0.06 : 0), 0.5, 0.98);

    context.save();
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

    return { ratio, angle, centerOffset, clarity, asymmetry, fitQuality, confidence, damaged, annotatedImage, fitMethod, detectedScreen };
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
