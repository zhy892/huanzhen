"use client";

import { ChangeEvent, DragEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";

type CauseId = "tilt" | "pressure" | "decenter" | "calibration" | "damage";
type Mode = "empirical" | "deepseek";

type ImageMetrics = {
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

type AiDiagnosis = {
  verdict: string;
  summary: string;
  causes: CauseId[];
  confidence: number;
  provider?: "deepseek" | "local-fallback" | "empirical";
};

type FitPoint = { x: number; y: number };
type EllipseFit = { centerX: number; centerY: number; semiMajor: number; semiMinor: number; ratio: number; angle: number };

const ORDERS = [5, 10, 15, 20, 25, 30, 35, 40];
const STANDARD_RADIUS = 1.0;
const CALIBRATION_STRENGTH = 0.96;
const MAX_RECOMMENDED_CAUSES = 3;

const CAUSES: Array<{
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

const DEMO_DATA: Record<number, string> = {
  5: "4.420",
  10: "6.250",
  15: "7.657",
  20: "8.572",
  25: "9.508",
  30: "10.335",
  35: "11.221",
  40: "11.944",
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fmt(value: number, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function builtinDiagnosis(metrics: ImageMetrics): AiDiagnosis {
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

function buildAiSuggestions(metrics: ImageMetrics, diagnosis: AiDiagnosis) {
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

function fitEllipseFromPoints(points: FitPoint[], width: number, height: number): EllipseFit | null {
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

async function inspectImage(file: File, manualPoints: FitPoint[] = []): Promise<ImageMetrics> {
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
    const annotatedImage = canvas.toDataURL("image/jpeg", 0.9);

    return { ratio, angle, centerOffset, clarity, asymmetry, fitQuality, confidence, damaged, annotatedImage, fitMethod, detectedScreen };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function axisProjectionFactor(ratio: number, angleDegrees: number) {
  const phi = (angleDegrees * Math.PI) / 180;
  return Math.sqrt(Math.cos(phi) ** 2 + Math.sin(phi) ** 2 / ratio ** 2);
}

function calculationT(n: number) {
  return ({ 2: 12.706, 3: 4.303, 4: 3.182, 5: 2.776, 6: 2.571 } as Record<number, number>)[n] || 1.96;
}

export default function Home() {
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [mode, setMode] = useState<Mode>("empirical");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [metrics, setMetrics] = useState<ImageMetrics | null>(null);
  const [diagnosis, setDiagnosis] = useState<AiDiagnosis | null>(null);
  const [selectedCauses, setSelectedCauses] = useState<CauseId[]>([]);
  const [manualFit, setManualFit] = useState(false);
  const [fitPoints, setFitPoints] = useState<FitPoint[]>([]);
  const [thinking, setThinking] = useState<"analysis" | "restore" | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [wavelength, setWavelength] = useState("589.3");
  const [refractiveIndex, setRefractiveIndex] = useState("1.000");
  const [interval, setInterval] = useState("15");
  const [calibration, setCalibration] = useState("1.0000");
  const [autoCalibration, setAutoCalibration] = useState(true);
  const [values, setValues] = useState<Record<number, string>>(() => Object.fromEntries(ORDERS.map((order) => [order, ""])));
  const [copied, setCopied] = useState(false);
  const [reportReady, setReportReady] = useState(false);
  const [retestMode, setRetestMode] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewCanvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!preview || !previewCanvas.current) return;
    const canvas = previewCanvas.current;
    const context = canvas.getContext("2d");
    if (!context) return;
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(80, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(80, Math.round(image.naturalHeight * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      if (!fitPoints.length) return;
      const fit = fitEllipseFromPoints(fitPoints, canvas.width, canvas.height);
      if (fit) {
        context.save();
        context.strokeStyle = "rgba(201, 239, 99, .95)";
        context.lineWidth = Math.max(2, canvas.width / 450);
        context.setLineDash([10, 7]);
        context.beginPath();
        context.ellipse(fit.centerX, fit.centerY, fit.semiMajor, fit.semiMinor, (fit.angle * Math.PI) / 180, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
      fitPoints.forEach((point, index) => {
        const x = point.x * canvas.width;
        const y = point.y * canvas.height;
        context.beginPath();
        context.arc(x, y, Math.max(6, canvas.width / 150), 0, Math.PI * 2);
        context.fillStyle = "#c9ef63";
        context.fill();
        context.fillStyle = "#15211e";
        context.font = `800 ${Math.max(8, canvas.width / 130)}px system-ui`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(String(index + 1), x, y);
      });
    };
    image.src = preview;
  }, [preview, fitPoints]);

  const correction = useMemo(() => {
    if (!metrics) return { total: 1, parts: [] as Array<{ name: string; factor: number; formula: string }> };
    const parts: Array<{ name: string; factor: number; formula: string }> = [];
    const ellipseCount = Number(selectedCauses.includes("tilt")) + Number(selectedCauses.includes("pressure"));
    const sharedRatio = ellipseCount > 1 ? metrics.ratio ** (1 / ellipseCount) : metrics.ratio;
    if (selectedCauses.includes("tilt")) {
      parts.push({ name: "倾斜投影", factor: axisProjectionFactor(sharedRatio, metrics.angle), formula: "√(cos²φ + sin²φ/q²)" });
    }
    if (selectedCauses.includes("pressure")) {
      parts.push({
        name: "受力等面积",
        factor: Math.sqrt(sharedRatio) * axisProjectionFactor(sharedRatio, metrics.angle),
        formula: "√q · √(cos²φ + sin²φ/q²)",
      });
    }
    if (selectedCauses.includes("decenter")) {
      parts.push({ name: "偏心弦长", factor: Math.sqrt(1 + metrics.centerOffset ** 2), formula: "√(1 + (2e/D)²)" });
    }
    if (autoCalibration || selectedCauses.includes("calibration")) {
      parts.push({
        name: autoCalibration ? "标准半径辅助标定" : "标尺标定",
        factor: clamp(Number(calibration) || 1, 0.5, 1.5),
        formula: autoCalibration ? "k = (R₀/R标定前)^(α/2)，α=0.96" : "k",
      });
    }
    return { total: parts.reduce((total, part) => total * part.factor, 1), parts };
  }, [metrics, selectedCauses, calibration, autoCalibration]);

  const diagnosticDetail = useMemo(() => {
    if (!metrics || !diagnosis) return null;
    const circularDeviation = Math.max(0, (1 - metrics.ratio) * 100);
    const eccentricity = Math.sqrt(Math.max(0, 1 - metrics.ratio ** 2));
    const absoluteAngle = Math.abs(metrics.angle);
    const orientation = absoluteAngle < 10
      ? "长轴近水平方向"
      : Math.abs(absoluteAngle - 90) < 10
        ? "长轴近垂直方向"
        : metrics.angle > 0
          ? `长轴向右上倾斜 ${absoluteAngle.toFixed(1)}°`
          : `长轴向右下倾斜 ${absoluteAngle.toFixed(1)}°`;
    const causeEvidence: Record<CauseId, string> = {
      tilt: `q = ${metrics.ratio.toFixed(3)}，${orientation}；${metrics.asymmetry < 0.34 ? "四象限响应较均匀，更接近投影压缩" : "同时存在方向不对称，需与受力因素联合复核"}。`,
      pressure: `四象限边缘不对称度为 ${(metrics.asymmetry * 100).toFixed(1)}%，环宽或亮度方向差异支持接触面受力不均的可能。`,
      decenter: `拟合环心偏离有效成像区中心 ${(metrics.centerOffset * 100).toFixed(1)}%，测量线可能没有穿过真实环心。`,
      calibration: `${orientation}且长短轴比例存在差异，应使用标准长度复核横、纵标尺比例。`,
      damage: `连续环边拟合质量仅 ${Math.round(metrics.fitQuality * 100)}%，轮廓不足以满足经验还原的闭合与可辨认前提。`,
    };
    const evidence = diagnosis.causes.length
      ? diagnosis.causes.map((cause) => ({ label: CAUSES.find((item) => item.id === cause)?.short || cause, text: causeEvidence[cause] }))
      : [{ label: "未见系统偏差", text: "长短轴差异处于正圆阈值内，当前照片未给出需要强制修正的量化证据。" }];
    const restorationTitle = metrics.damaged
      ? "停止还原，优先重新成像"
      : metrics.ratio >= 0.975
        ? "可保留原始水平直径"
        : "可在现场复核后组合还原";
    const restorationText = metrics.damaged
      ? "请清洁光学表面、检查接触状态和读数显微镜，再拍摄一张完整闭合、对焦清晰的环纹照片。"
      : selectedCauses.length
        ? `当前选择 ${selectedCauses.length} 项原因，预估综合直径修正系数为 × ${correction.total.toFixed(5)}；进入数据页前仍应与实际装调现象核对。`
        : "当前无需启用额外几何修正；仍建议保留原始读数和照片，便于实验报告复核。";
    return {
      circularDeviation,
      eccentricity,
      orientation,
      symmetry: clamp(1 - metrics.asymmetry, 0, 1),
      evidence,
      restorationTitle,
      restorationText,
    };
  }, [metrics, diagnosis, selectedCauses, correction.total]);

  const aiSuggestions = useMemo(() => {
    if (!metrics || !diagnosis) return [];
    return buildAiSuggestions(metrics, diagnosis);
  }, [metrics, diagnosis]);

  const results = useMemo(() => {
    const rows = ORDERS.map((order) => {
      const original = Number(values[order]);
      const valid = Number.isFinite(original) && original > 0;
      const restored = valid ? original * correction.total : Number.NaN;
      return { order, original, restored, square: restored ** 2, valid };
    });
    const byOrder = new Map(rows.map((row) => [row.order, row]));
    const n = Math.max(1, Math.round(Number(interval) || 15));
    const reportLowOrders = [15, 20, 25];
    let pairs = reportLowOrders
      .map((low) => {
        const high = low + n;
        const lower = byOrder.get(low);
        const upper = byOrder.get(high);
        if (!lower?.valid || !upper?.valid) return null;
        return { low, high, difference: upper.square - lower.square };
      })
      .filter(Boolean) as Array<{ low: number; high: number; difference: number }>;
    if (!pairs.length) {
      pairs = rows
        .filter((row) => row.valid && byOrder.get(row.order + n)?.valid)
        .map((row) => ({ low: row.order, high: row.order + n, difference: byOrder.get(row.order + n)!.square - row.square }));
    }
    const meanDifference = pairs.length ? pairs.reduce((sum, pair) => sum + pair.difference, 0) / pairs.length : Number.NaN;
    const sampleDeviation =
      pairs.length > 1
        ? Math.sqrt(pairs.reduce((sum, pair) => sum + (pair.difference - meanDifference) ** 2, 0) / (pairs.length - 1))
        : Number.NaN;
    const expandedDifference = pairs.length > 1 ? (calculationT(pairs.length) * sampleDeviation) / Math.sqrt(pairs.length) : Number.NaN;
    const lambda = Number(wavelength);
    const mediumIndex = Number(refractiveIndex);
    const radius = (meanDifference * 1e-6 * mediumIndex) / (4 * n * lambda * 1e-9);
    const radiusUncertainty = Math.abs(radius * (expandedDifference / meanDifference));

    const validRows = rows.filter((row) => row.valid);
    const meanOrder = validRows.reduce((sum, row) => sum + row.order, 0) / Math.max(1, validRows.length);
    const meanSquare = validRows.reduce((sum, row) => sum + row.square, 0) / Math.max(1, validRows.length);
    const slopeNumerator = validRows.reduce((sum, row) => sum + (row.order - meanOrder) * (row.square - meanSquare), 0);
    const slopeDenominator = validRows.reduce((sum, row) => sum + (row.order - meanOrder) ** 2, 0);
    const slope = slopeNumerator / slopeDenominator;
    const regressionRadius = (slope * 1e-6 * mediumIndex) / (4 * lambda * 1e-9);
    const ssTotal = validRows.reduce((sum, row) => sum + (row.square - meanSquare) ** 2, 0);
    const intercept = meanSquare - slope * meanOrder;
    const ssResidual = validRows.reduce((sum, row) => sum + (row.square - (intercept + slope * row.order)) ** 2, 0);
    const rSquared = 1 - ssResidual / ssTotal;
    return { rows, pairs, meanDifference, sampleDeviation, expandedDifference, radius, radiusUncertainty, regressionRadius, rSquared };
  }, [values, correction.total, interval, wavelength, refractiveIndex]);

  useEffect(() => {
    if (!autoCalibration || !Number.isFinite(results.radius) || results.radius <= 0) return;
    const currentFactor = clamp(Number(calibration) || 1, 0.5, 1.5);
    const preCalibrationRadius = results.radius / (currentFactor ** 2);
    if (!Number.isFinite(preCalibrationRadius) || preCalibrationRadius <= 0) return;
    const nextFactor = clamp((STANDARD_RADIUS / preCalibrationRadius) ** (CALIBRATION_STRENGTH / 2), 0.5, 1.5);
    const nextValue = nextFactor.toFixed(6);
    if (nextValue !== calibration) {
      const updateTimer = window.setTimeout(() => {
        setCalibration(nextValue);
        setReportReady(false);
      }, 0);
      return () => window.clearTimeout(updateTimer);
    }
  }, [autoCalibration, calibration, results.radius]);

  const calibrationInsight = useMemo(() => {
    const factor = autoCalibration ? clamp(Number(calibration) || 1, 0.5, 1.5) : 1;
    const beforeRadius = autoCalibration && Number.isFinite(results.radius) ? results.radius / (factor ** 2) : results.radius;
    const beforeRelativeError = Number.isFinite(beforeRadius)
      ? Math.abs(beforeRadius - STANDARD_RADIUS) / STANDARD_RADIUS * 100
      : Number.NaN;
    const afterRelativeError = Number.isFinite(results.radius)
      ? Math.abs(results.radius - STANDARD_RADIUS) / STANDARD_RADIUS * 100
      : Number.NaN;
    const accuracyImprovement = Number.isFinite(beforeRelativeError) && beforeRelativeError > 1e-12
      ? clamp((beforeRelativeError - afterRelativeError) / beforeRelativeError * 100, 0, 100)
      : 0;
    return { factor, beforeRadius, beforeRelativeError, afterRelativeError, accuracyImprovement };
  }, [autoCalibration, calibration, results.radius]);

  const levelComparisons = useMemo(() => {
    const lambda = Number(wavelength) * 1e-9;
    const mediumIndex = Number(refractiveIndex);
    if (!Number.isFinite(lambda) || lambda <= 0 || !Number.isFinite(mediumIndex)) return [];
    return results.rows
      .filter((row) => row.valid && row.order >= 15)
      .slice(0, 6)
      .map((row) => {
        const originalRadius = (row.original ** 2 * 1e-6 * mediumIndex) / (4 * row.order * lambda);
        const restoredRadius = (row.restored ** 2 * 1e-6 * mediumIndex) / (4 * row.order * lambda);
        return {
          order: row.order,
          originalRadius,
          originalError: Math.abs(originalRadius - STANDARD_RADIUS) / STANDARD_RADIUS * 100,
          restoredRadius,
          restoredError: Math.abs(restoredRadius - STANDARD_RADIUS) / STANDARD_RADIUS * 100,
        };
      });
  }, [results.rows, wavelength, refractiveIndex]);

  const comparisonSummary = useMemo(() => {
    if (!levelComparisons.length) return { originalMeanError: Number.NaN, restoredMeanError: Number.NaN, improvement: Number.NaN };
    const originalMeanError = levelComparisons.reduce((sum, row) => sum + row.originalError, 0) / levelComparisons.length;
    const restoredMeanError = levelComparisons.reduce((sum, row) => sum + row.restoredError, 0) / levelComparisons.length;
    const improvement = originalMeanError > 0
      ? clamp((originalMeanError - restoredMeanError) / originalMeanError * 100, 0, 100)
      : 0;
    return { originalMeanError, restoredMeanError, improvement };
  }, [levelComparisons]);

  const resultInsight = useMemo(() => {
    const uncertaintyRatio = Number.isFinite(results.radiusUncertainty) && results.radius
      ? Math.abs(results.radiusUncertainty / results.radius) * 100
      : Number.NaN;
    const correctionShift = Math.abs(correction.total - 1) * 100;
    const fitLevel = results.rSquared >= 0.995 ? "高度一致" : results.rSquared >= 0.98 ? "基本一致" : "存在离散";
    const conclusion = results.rSquared >= 0.98 && uncertaintyRatio <= 5
      ? "本组数据的级次趋势较稳定，可结合原始记录写入实验报告。"
      : "建议回看异常级次的左右读数，并优先采用重新装调后的复测照片与数据。";
    return { uncertaintyRatio, correctionShift, fitLevel, conclusion };
  }, [results.radius, results.radiusUncertainty, results.rSquared, correction.total]);

  function updateFile(nextFile: File) {
    if (!nextFile.type.startsWith("image/")) {
      setError("请上传 JPG、PNG 或其他常见图片格式。");
      return;
    }
    if (nextFile.size > 12 * 1024 * 1024) {
      setError("图片请控制在 12 MB 以内。");
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setFile(nextFile);
    setPreview(URL.createObjectURL(nextFile));
    setMetrics(null);
    setDiagnosis(null);
    setManualFit(false);
    setFitPoints([]);
    setError("");
  }

  function addFitPoint(event: MouseEvent<HTMLCanvasElement>) {
    if (!manualFit || !previewCanvas.current) return;
    const rect = previewCanvas.current.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    setFitPoints((current) => [...current, { x, y }].slice(0, 16));
    setError("");
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) updateFile(dropped);
  }

  async function analyze() {
    if (!file) {
      setError("请先上传第一级牛顿环照片。");
      return;
    }
    if (manualFit && fitPoints.length < 5) {
      setError("精准拟合至少需要沿同一条清晰圆环点击 5 个点；建议均匀点击 6–10 个点。");
      return;
    }
    setError("");
    setThinking("analysis");
    try {
      const measured = await inspectImage(file, manualFit ? fitPoints : []);
      let nextDiagnosis = builtinDiagnosis(measured);
      if (mode === "deepseek") {
        const response = await fetch("/api/deepseek", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metrics: measured }),
        });
        const payload = await response.json() as AiDiagnosis & { error?: string };
        if (!response.ok) throw new Error(payload.error || "增强诊断暂时没有返回结果");
        nextDiagnosis = payload;
      } else {
        await wait(900);
      }
      setMetrics(measured);
      setDiagnosis(nextDiagnosis);
      setSelectedCauses(buildAiSuggestions(measured, nextDiagnosis).filter((item) => item.recommended).map((item) => item.id));
      setRetestMode(false);
      setStep(2);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "分析失败，请换一张更清晰、只包含圆环的照片。 ");
    } finally {
      setThinking(null);
    }
  }

  function toggleCause(id: CauseId) {
    if (id === "damage") {
      setSelectedCauses((current) => (current.includes("damage") ? [] : ["damage"]));
      return;
    }
    setSelectedCauses((current) => {
      const safe = current.filter((cause) => cause !== "damage");
      if (safe.includes(id)) return safe.filter((cause) => cause !== id);
      if (safe.length >= MAX_RECOMMENDED_CAUSES) return safe;
      return [...safe, id];
    });
  }

  async function goToData() {
    if (selectedCauses.includes("damage")) return;
    setThinking("restore");
    await wait(700);
    setThinking(null);
    setReportReady(false);
    setStep(3);
  }

  function startRetest() {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview("");
    setMetrics(null);
    setDiagnosis(null);
    setSelectedCauses([]);
    setManualFit(false);
    setFitPoints([]);
    setError("");
    setReportReady(false);
    setRetestMode(true);
    setStep(1);
  }

  async function calculate() {
    const validCount = ORDERS.filter((order) => Number(values[order]) > 0).length;
    if (validCount < 6) {
      setError("请至少填写 6 组有效直径；完整填写 8 组可获得更稳定的拟合检验。");
      return;
    }
    if (!results.pairs.length || !Number.isFinite(results.radius)) {
      setError("当前级次间隔没有形成可用的逐差数据，请检查输入或恢复间隔 15。");
      return;
    }
    setError("");
    setThinking("restore");
    await wait(900);
    setThinking(null);
    setReportReady(true);
    setStep(3);
  }

  function reset() {
    if (preview) URL.revokeObjectURL(preview);
    setStep(0);
    setMode("empirical");
    setFile(null);
    setPreview("");
    setMetrics(null);
    setDiagnosis(null);
    setSelectedCauses([]);
    setManualFit(false);
    setFitPoints([]);
    setError("");
    setValues(Object.fromEntries(ORDERS.map((order) => [order, ""])));
    setCalibration("1.0000");
    setAutoCalibration(true);
    setCopied(false);
    setReportReady(false);
    setRetestMode(false);
  }

  function reportText() {
    const causeText = selectedCauses.length
      ? selectedCauses.map((id) => CAUSES.find((cause) => cause.id === id)?.title).join("、")
      : "未启用经验修正";
    return [
      "牛顿环实验数据还原报告",
      `图像判断：${diagnosis?.verdict || "—"}（置信度 ${Math.round((diagnosis?.confidence || 0) * 100)}%）`,
      `AI 辅助建议（已由用户结合现场复核）：${causeText}`,
      `综合直径修正系数：${correction.total.toFixed(5)}`,
      `渐进式标准半径标定：R₀ = ${STANDARD_RADIUS.toFixed(3)} m，α = ${CALIBRATION_STRENGTH.toFixed(2)}，k = ${calibrationInsight.factor.toFixed(6)}`,
      `标定前曲率半径：${fmt(calibrationInsight.beforeRadius, 6)} m；标定前相对误差：${fmt(calibrationInsight.beforeRelativeError, 4)}%`,
      `逐差平均值：${fmt(results.meanDifference, 3)} mm²`,
      `曲率半径：R = ${fmt(results.radius, 3)} ± ${fmt(results.radiusUncertainty, 3)} m`,
      `标定后相对误差：${fmt(calibrationInsight.afterRelativeError, 4)}%；相对标准值精度提高：${fmt(calibrationInsight.accuracyImprovement, 2)}%`,
      `全数据线性拟合：R = ${fmt(results.regressionRadius, 3)} m，R² = ${fmt(results.rSquared, 4)}`,
      `六级数据平均相对误差：原始 ${fmt(comparisonSummary.originalMeanError, 4)}%，还原后 ${fmt(comparisonSummary.restoredMeanError, 4)}%，改善 ${fmt(comparisonSummary.improvement, 2)}%`,
      `数据一致性：${resultInsight.fitLevel}；相对不确定度 ${fmt(resultInsight.uncertaintyRatio, 2)}%`,
      "说明：精度提高指相对 1.000 m 标准值的绝对误差改善率，不代表测量不确定度同步下降；AI 仅辅助提出装调与复核建议，原因选择和实验结论仍应由学生依据现场现象确认。",
    ].join("\n");
  }

  async function copyReport() {
    await navigator.clipboard.writeText(reportText());
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function downloadCsv() {
    const lines = [
      "级次,原始水平直径(mm),还原直径(mm),还原直径平方(mm^2)",
      ...results.rows.filter((row) => row.valid).map((row) => `${row.order},${row.original.toFixed(3)},${row.restored.toFixed(3)},${row.square.toFixed(3)}`),
      "",
      `综合修正系数,${correction.total.toFixed(6)}`,
      `标准半径(m),${STANDARD_RADIUS.toFixed(6)}`,
      `标准半径辅助标定系数k,${calibrationInsight.factor.toFixed(6)}`,
      `渐进标定强度alpha,${CALIBRATION_STRENGTH.toFixed(6)}`,
      `标定前曲率半径(m),${calibrationInsight.beforeRadius.toFixed(6)}`,
      `标定前相对误差(%),${calibrationInsight.beforeRelativeError.toFixed(6)}`,
      `曲率半径(m),${results.radius.toFixed(6)}`,
      `标定后相对误差(%),${calibrationInsight.afterRelativeError.toFixed(6)}`,
      `相对标准值精度提高(%),${calibrationInsight.accuracyImprovement.toFixed(6)}`,
      `扩展不确定度(m),${results.radiusUncertainty.toFixed(6)}`,
      "",
      "级次,原始估计半径(m),原始相对误差(%),还原后估计半径(m),还原后相对误差(%)",
      ...levelComparisons.map((row) => `${row.order},${row.originalRadius.toFixed(6)},${row.originalError.toFixed(6)},${row.restoredRadius.toFixed(6)},${row.restoredError.toFixed(6)}`),
      `六级平均,,${comparisonSummary.originalMeanError.toFixed(6)},,${comparisonSummary.restoredMeanError.toFixed(6)}`,
    ];
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "牛顿环还原结果.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (step === 0) {
    return (
      <main className="landing">
        <header className="landing-nav">
          <button className="brand" type="button" onClick={reset} aria-label="环真首页">
            <span className="brand-mark"><i /><i /><i /></span>
            <span>环真</span>
          </button>
          <span className="open-badge"><span>●</span> 公开访问 · 无需登录</span>
        </header>

        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">大学物理 A14 · 等厚干涉 · 曲率半径测量</p>
            <div className="hero-lab-badge"><span>牛顿环实验</span><b>NEWTON&apos;S RINGS LAB</b></div>
            <h1>以环纹校准，<br /><em>让数据可信。</em></h1>
            <p className="hero-intro">专为牛顿环实验设计：上传干涉环照片，判断正圆或椭圆，定位仪器与操作误差，再按实验报告格式还原水平直径和透镜曲率半径。</p>
            <div className="experiment-strip" aria-label="牛顿环实验支持内容">
              <span><b>01</b> 环纹圆度</span><span><b>02</b> 复合误差</span><span><b>03</b> 曲率半径 R</span>
            </div>
            <button className="primary hero-cta" type="button" onClick={() => setStep(1)}>
              开始分析 <span>↗</span>
            </button>
            <p className="privacy-line"><span>✓</span> 经验模式全程在浏览器内处理图片</p>
          </div>

          <div className="hero-visual" aria-label="牛顿环分析示意图">
            <div className="visual-card">
              <div className="visual-top"><span>牛顿环实验 · 第一级环拟合</span><b>● READY</b></div>
              <div className="ring-stage">
                <div className="axis axis-x" />
                <div className="axis axis-y" />
                <div className="newton-rings">
                  <i /><i /><i /><i /><i /><i />
                </div>
                <span className="measure-tag tag-a">a · 1.000</span>
                <span className="measure-tag tag-b">b · 0.983</span>
                <span className="focus-dot" />
              </div>
              <div className="visual-result">
                <div><span>牛顿环圆度判断</span><strong>可视为正圆</strong></div>
                <div className="confidence-ring"><span>96<small>%</small></span></div>
              </div>
            </div>
            <div className="floating-note note-one"><span>◎</span><div><b>环边连续追踪</b><small>排除边框 · 刻线 · 摩尔纹</small></div></div>
            <div className="floating-note note-two"><span>R</span><div><b>牛顿环曲率半径</b><small>逐差法 · 实验报告格式</small></div></div>
          </div>
        </section>

        <footer className="landing-footer">
          <span>适用于高校牛顿环等厚干涉实验 · Public access</span>
          <span>影像判断 · 数据复核 · 报告输出</span>
        </footer>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <button className="brand" type="button" onClick={reset} aria-label="返回首页">
          <span className="brand-mark"><i /><i /><i /></span><span>环真</span>
        </button>
        {step < 3 && (
          <div className="stepper" aria-label="分析进度">
            <span className={step >= 1 ? "active" : ""}><b>1</b> 图像</span><i />
            <span className={step >= 2 ? "active" : ""}><b>2</b> 诊断</span><i />
            <span className={step >= 3 ? "active" : ""}><b>3</b> 数据</span>
          </div>
        )}
        <button className="quiet-button" type="button" onClick={reset}>回到首页</button>
      </header>

      {step === 1 && (
        <section className="workspace upload-workspace">
          <div className="section-heading">
            <span className="section-number">01</span>
            <div><p>图像输入</p><h2>上传第一级圆环</h2><span>尽量裁剪到只保留完整圆环，画面越正、边缘越清晰，判断越稳定。</span></div>
          </div>

          {retestMode && (
            <div className="retest-banner"><span>↻</span><div><b>仪器调整后的复测</b><p>请按上一页的 AI 辅助建议完成装调，再上传一张新的第一级环照片重新诊断。建议保持拍摄距离和方向一致，便于观察改进效果。</p></div></div>
          )}

          <div className="upload-layout">
            <div
              className={`drop-zone ${dragging ? "dragging" : ""} ${preview ? "has-image" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={preview ? "当前牛顿环照片" : "选择牛顿环照片"}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => !preview && fileInput.current?.click()}
              onKeyDown={(event) => { if (!preview && (event.key === "Enter" || event.key === " ")) fileInput.current?.click(); }}
            >
              <input ref={fileInput} type="file" accept="image/*" hidden onChange={(event: ChangeEvent<HTMLInputElement>) => event.target.files?.[0] && updateFile(event.target.files[0])} />
              {preview ? (
                <>
                  <canvas ref={previewCanvas} className={manualFit ? "pointing" : ""} onClick={addFitPoint} role="img" aria-label="待分析的牛顿环；精准拟合开启时可点击圆环取点" />
                  <div className="image-actions">
                    <button type="button" onClick={(event) => { event.stopPropagation(); fileInput.current?.click(); }}>更换照片</button>
                    <span>{file?.name}</span>
                  </div>
                </>
              ) : (
                <div className="drop-copy">
                  <span className="upload-icon">↑</span>
                  <h3>拖入照片，或点击选择</h3>
                  <p>支持 JPG / PNG · 最大 12 MB</p>
                  <button type="button">选择圆环照片</button>
                </div>
              )}
            </div>

            <aside className="analysis-options">
              <p className="field-label">选择分析方式</p>
              <button className={`mode-card ${mode === "empirical" ? "selected" : ""}`} type="button" onClick={() => { setMode("empirical"); setError(""); }}>
                <span className="mode-symbol">ƒ</span>
                <span><b>经验模型</b><small>本地特征提取 + 实验公式</small></span>
                <i>{mode === "empirical" ? "✓" : ""}</i>
              </button>
              <button className={`mode-card ${mode === "deepseek" ? "selected deepseek" : ""}`} type="button" onClick={() => { setMode("deepseek"); setError(""); }}>
                <span className="mode-symbol ds">DS</span>
                <span><b>DeepSeek 增强 · 免密钥</b><small>站点代理复核，用户无需配置</small></span>
                <i>{mode === "deepseek" ? "✓" : ""}</i>
              </button>
              {mode === "deepseek" && <div className="managed-ai-note"><span>✓</span><p><b>无需输入任何密钥</b><small>只提交长短轴比、偏心等量化特征，不上传原始照片。</small></p></div>}
              {preview && (
                <div className={`fit-control ${manualFit ? "active" : ""}`}>
                  <div><span>◎</span><p><b>精准轮廓拟合</b><small>适合显示器拍摄、带十字刻线的照片</small></p><button type="button" onClick={() => { setManualFit((current) => !current); setFitPoints([]); setError(""); }}>{manualFit ? "退出" : "开始取点"}</button></div>
                  {manualFit && <><p className="fit-instruction">沿<strong>同一条清晰圆环</strong>均匀点击至少 5 个点，系统会直接用这些点拟合椭圆。</p><div className="fit-counter"><span>{fitPoints.length} / 5+ 个点</span><button type="button" onClick={() => setFitPoints((current) => current.slice(0, -1))} disabled={!fitPoints.length}>撤销</button><button type="button" onClick={() => setFitPoints([])} disabled={!fitPoints.length}>清空</button></div></>}
                </div>
              )}
              <div className="tip-card"><b>连续环边追踪与椭圆拟合</b><p>邻域中值抑制十字刻线、屏幕边框、摩尔纹与孤立污点，再通过环心迭代和离群点剔除稳定拟合；轮廓不足时停止输出。</p></div>
              {error && <p className="error-message" role="alert">{error}</p>}
              <button className="primary full-button" type="button" onClick={analyze} disabled={!file}>分析圆环 <span>→</span></button>
            </aside>
          </div>
        </section>
      )}

      {step === 2 && metrics && diagnosis && (
        <section className="workspace diagnosis-workspace">
          <div className="diagnosis-hero">
            <div className="image-panel">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={metrics.annotatedImage} alt="已标注拟合椭圆的牛顿环" />
              <span className="image-caption">{metrics.damaged ? "质量门控：未输出拟合椭圆" : metrics.fitMethod === "manual" ? "精准取点拟合" : metrics.detectedScreen ? "屏幕内抗干扰迭代拟合" : "抗干扰迭代拟合"} · 质量 {Math.round(metrics.fitQuality * 100)}%</span>
              <button className="refit-button" type="button" onClick={() => { setStep(1); setManualFit(true); setFitPoints([]); }}>拟合不准？返回重新取点</button>
            </div>
            <div className="verdict-panel">
              <p className="eyebrow">ANALYSIS COMPLETE</p>
              <span className={`verdict-pill ${diagnosis.causes.includes("damage") ? "danger" : metrics.ratio >= 0.975 ? "good" : "warn"}`}>{diagnosis.verdict}</span>
              <h2>{diagnosis.causes.includes("damage") ? "当前图像不适合数据还原" : metrics.ratio >= 0.975 ? "圆度在可接受范围内" : "检测到可校正的椭圆偏差"}</h2>
              <p>{diagnosis.summary}</p>
              <div className="metric-strip">
                <div><span>长短轴比</span><b>{metrics.ratio.toFixed(3)}</b></div>
                <div><span>拟合质量</span><b>{Math.round(metrics.fitQuality * 100)}%</b></div>
                <div><span>判断置信度</span><b>{Math.round(diagnosis.confidence * 100)}%</b></div>
              </div>
              <small className="mode-note">{mode === "deepseek" ? diagnosis.provider === "deepseek" ? "DeepSeek V4 Flash 已基于量化特征完成复核" : "增强服务未配置或不可用，已采用本地诊断" : "经验模型已完成本地分析"}</small>
            </div>
          </div>

          <div className="cause-section ai-advice-section">
            <div className="cause-heading ai-advice-heading">
              <div>
                <p><span>调</span> INSTRUMENT ADJUSTMENT</p>
                <h3>仪器调整建议</h3>
                <strong>请选择与现场现象相符的建议；AI 提供辅助判断，最终原因由你结合装调情况确认。</strong>
              </div>
              <span>各项合计 100% · 最多推荐 3 项</span>
            </div>
            <div className="cause-grid ai-advice-grid">
              {aiSuggestions.map((cause, index) => (
                <button
                  type="button"
                  key={cause.id}
                  className={`cause-card advice-card ${selectedCauses.includes(cause.id) ? "selected" : ""} ${cause.id === "damage" ? "damage" : ""}`}
                  onClick={() => toggleCause(cause.id)}
                >
                  <span className="cause-index">建议 {String(index + 1).padStart(2, "0")}</span>
                  <span className={`advice-probability ${cause.probability >= 35 ? "high" : cause.probability >= 18 ? "medium" : "low"}`}><b>{cause.probability}%</b><small>相对可能性</small></span>
                  <span className="cause-check">{selectedCauses.includes(cause.id) ? "✓" : "+"}</span>
                  <b>{cause.title}</b>
                  <small>{cause.description}</small>
                  <p><span>调整建议</span>{cause.advice}</p>
                  <em>{selectedCauses.includes(cause.id) ? (cause.recommended ? "优先建议 · 已选入后续还原" : "已由你选入后续还原") : selectedCauses.length >= MAX_RECOMMENDED_CAUSES ? "已达 3 项上限，可先取消其他项" : "点击选择并结合现场复核"}</em>
                </button>
              ))}
            </div>
            <p className="probability-note">五项百分比已归一化且总和严格为 100%，表示本张照片中各原因的相对权重；AI 只优先推荐得分最高且有诊断证据的最多 3 项。该分布不等同于统计学故障概率，也不替代教师判断或仪器检修。</p>
          </div>

          {diagnosticDetail && (
            <div className="analysis-section compact-analysis-section">
              <div className="analysis-heading">
                <div><p>量化依据摘要</p><h3>这次判断依据了什么</h3></div>
                <span>关键证据已整合，减少重复信息</span>
              </div>
              <div className={`analysis-summary-card ${metrics.damaged ? "danger" : ""}`}>
                <div className="summary-metrics">
                  <div><span>长短轴比</span><b>{metrics.ratio.toFixed(3)}</b></div>
                  <div><span>偏离正圆</span><b>{diagnosticDetail.circularDeviation.toFixed(2)}%</b></div>
                  <div><span>拟合质量</span><b>{Math.round(metrics.fitQuality * 100)}%</b></div>
                  <div><span>环边清晰度</span><b>{Math.round(metrics.clarity * 100)}%</b></div>
                  <div><span>四象限对称度</span><b>{Math.round(diagnosticDetail.symmetry * 100)}%</b></div>
                </div>
                <div className="summary-explanation">
                  <p><b>几何结论</b><span>{diagnosticDetail.orientation}；正圆判据为 q ≥ 0.975，环心偏移 {(metrics.centerOffset * 100).toFixed(1)}%。</span></p>
                  <p><b>成像复核</b><span>{metrics.detectedScreen ? "已定位有效成像区并排除屏幕边框。" : "未识别到独立显示器边界，已按完整照片分析。"}</span></p>
                  <p><b>诊断依据</b><span>{diagnosticDetail.evidence.map((item) => `${item.label}：${item.text}`).join("；")}</span></p>
                </div>
                <div className="summary-decision">
                  <span>下一步建议</span>
                  <b>{diagnosticDetail.restorationTitle}</b>
                  <p>{diagnosticDetail.restorationText}</p>
                  <small>{metrics.fitMethod === "manual" ? "人工取点复核" : "环心迭代与离群点抑制"} · {mode === "deepseek" ? "DeepSeek 特征复核" : "经验公式判断"}</small>
                </div>
              </div>
            </div>
          )}

          {selectedCauses.includes("calibration") && (
            <div className="inline-parameter">
              <div><b>水平标尺标定系数 k</b><span>{autoCalibration ? "按 R₀ = 1.000 m 渐进修正 96% 偏差，保留真实残差与标定前结果" : "手动模式：实际长度 ÷ 读数长度"}</span></div>
              <input aria-label="水平标尺标定系数" type="number" min="0.5" max="1.5" step="0.000001" value={calibration} readOnly={autoCalibration} onChange={(event) => setCalibration(event.target.value)} />
            </div>
          )}

          {selectedCauses.includes("damage") ? (
            <div className="stop-card"><span>!</span><div><b>已停止经验还原</b><p>明显损坏会破坏模型前提，继续计算只会产生“看起来精确”的错误结果。请先更换/检修仪器并重新拍摄。</p></div><button type="button" onClick={startRetest}>按建议调整并重新上传</button></div>
          ) : (
            <div className="action-bar">
              <div className="correction-summary"><span>当前综合修正系数</span><b>× {correction.total.toFixed(5)}</b><small>{selectedCauses.length ? `${selectedCauses.length} 项建议经现场复核后启用` : "正圆 / 不启用额外修正"}</small></div>
              <div className="diagnosis-actions"><button className="secondary retest-action" type="button" onClick={startRetest}>按建议调整，重新拍照 ↻</button><button className="primary" type="button" onClick={goToData}>继续还原实验数据 <span>→</span></button></div>
            </div>
          )}
        </section>
      )}

      {step === 3 && !reportReady && (
        <section className="workspace data-workspace">
          <div className="section-heading compact-heading">
            <span className="section-number">03</span>
            <div><p>实验数据</p><h2>输入各级圆环的水平直径</h2><span>单位为 mm。系统默认按钠灯 λ = 589.3 nm、级次差 n = 15 复现实验报告的逐差法。</span></div>
          </div>

          <div className="data-card">
            <div className="data-card-top">
              <div><b>水平直径 D<sub>m</sub></b><span>请填测微显微镜左右读数之差</span></div>
              <button type="button" onClick={() => { setValues(DEMO_DATA); setReportReady(false); }}>载入实验报告示例</button>
            </div>
            <div className="diameter-grid">
              {ORDERS.map((order) => (
                <label key={order}><span>{order}<small>级</small></span><div><input type="number" min="0" step="0.001" inputMode="decimal" placeholder="0.000" value={values[order]} onChange={(event) => { setValues((current) => ({ ...current, [order]: event.target.value })); setReportReady(false); }} /><em>mm</em></div></label>
              ))}
            </div>
            <p className="demo-note">示例中的 15–40 级来自所附实验报告；5、10 级仅为演示补值，正式结果请替换为实测值。</p>
          </div>

          <div className="parameter-row">
            <label><span>光源波长 λ</span><div><input type="number" min="300" max="1000" step="0.1" value={wavelength} onChange={(event) => setWavelength(event.target.value)} /><em>nm</em></div></label>
            <label><span>逐差级次 n</span><div><input type="number" min="5" max="35" step="5" value={interval} onChange={(event) => setInterval(event.target.value)} /><em>级</em></div></label>
            <label><span>介质折射率</span><div><input type="number" min="1" max="2" step="0.001" value={refractiveIndex} onChange={(event) => setRefractiveIndex(event.target.value)} /><em>—</em></div></label>
            <div className={`factor-summary ${autoCalibration ? "auto" : ""}`}>
              <span>标准半径辅助标定</span>
              <b>k = {Number(calibration).toFixed(6)}</b>
              <small>R₀ = {STANDARD_RADIUS.toFixed(3)} m · {autoCalibration ? "96% 渐进标定" : "手动系数"}</small>
              <button type="button" onClick={() => { setAutoCalibration((current) => !current); setReportReady(false); }}>{autoCalibration ? "改为手动" : "启用自动"}</button>
            </div>
          </div>

          {correction.parts.length > 0 && (
            <div className="formula-trace"><span>修正链</span>{correction.parts.map((part) => <b key={part.name}>{part.name} × {part.factor.toFixed(5)}</b>)}<em>→ D₀ = {correction.total.toFixed(5)}D</em></div>
          )}
          {error && <p className="error-message centered" role="alert">{error}</p>}
          <div className="bottom-actions"><button className="secondary" type="button" onClick={() => setStep(2)}>← 返回诊断</button><button className="primary" type="button" onClick={calculate}>生成还原报告 <span>→</span></button></div>
        </section>
      )}

      {step === 3 && reportReady && !thinking && (
        <section className="workspace report-workspace">
          <div className="report-titlebar">
            <div><p className="eyebrow">RESTORATION COMPLETE</p><h2>数据已还原，可以写入实验报告</h2><span>{diagnosis?.verdict} · {selectedCauses.length ? `${selectedCauses.length} 项复合修正` : "未启用额外修正"}</span></div>
            <div className="report-buttons"><button type="button" onClick={copyReport}>{copied ? "已复制 ✓" : "复制摘要"}</button><button type="button" onClick={downloadCsv}>下载 CSV</button><button className="primary" type="button" onClick={() => window.print()}>打印报告</button></div>
          </div>

          <div className="result-cards">
            <article className="main-result"><span>最终曲率半径</span><div><b>{fmt(results.radius, 3)}</b><em>m</em></div><p>R = {fmt(results.radius, 3)} ± {fmt(results.radiusUncertainty, 3)} m</p></article>
            <article><span>标定前曲率半径</span><b>{fmt(calibrationInsight.beforeRadius, 3)}</b><em>m</em></article>
            <article><span>相对标准值精度提高</span><b>{fmt(calibrationInsight.accuracyImprovement, 2)}%</b><em>误差改善率</em></article>
            <article><span>全数据拟合优度</span><b>{fmt(results.rSquared, 4)}</b><em>R²</em></article>
          </div>

          <section className="report-analysis" aria-label="实验结果解读">
            <div className="report-analysis-title"><span>析</span><div><p>辅助结果解读</p><h3>把计算结果转化为可复核的实验结论</h3></div><em>结果由实验数据与预设公式计算，请结合现场情况复核</em></div>
            <div className="report-analysis-grid">
              <article><span>01</span><div><b>渐进式标准值标定</b><p>以 R₀ = <strong>{STANDARD_RADIUS.toFixed(3)} m</strong> 为标准，仅修正 96% 的对数偏差。标定前 R = <strong>{fmt(calibrationInsight.beforeRadius, 6)} m</strong>，k = <strong>{calibrationInsight.factor.toFixed(6)}</strong>；相对误差由 <strong>{fmt(calibrationInsight.beforeRelativeError, 4)}%</strong> 降至 <strong>{fmt(calibrationInsight.afterRelativeError, 4)}%</strong>，该结果依赖预设标准值，不代表独立测量精度。</p></div></article>
              <article><span>02</span><div><b>精度提高 {fmt(calibrationInsight.accuracyImprovement, 2)}%</b><p>按“标定前后相对标准值绝对误差的下降比例”计算。它表示对 1.000 m 标准值的误差改善，不等同于测量不确定度下降。</p></div></article>
              <article><span>03</span><div><b>数据一致性 · {resultInsight.fitLevel}</b><p>线性拟合 R² = <strong>{fmt(results.rSquared, 4)}</strong>，相对不确定度约 <strong>{fmt(resultInsight.uncertaintyRatio, 2)}%</strong>。{resultInsight.conclusion}</p></div></article>
            </div>
          </section>

          <div className="report-table-card comparison-card">
            <div className="table-title"><div><b>六组实验数据相对误差对比</b><span>实验报告中的 15、20、25、30、35、40 级 · 标准值 R₀ = 1.000 m</span></div><span>原始 vs 还原后</span></div>
            <div className="table-scroll"><table><thead><tr><th>实验组（级次）</th><th>原始估计 R / m</th><th>原始相对误差</th><th>还原后 R / m</th><th>还原后相对误差</th></tr></thead><tbody>
              {levelComparisons.map((row) => <tr key={row.order}><th>{row.order} 级</th><td>{fmt(row.originalRadius, 6)}</td><td>{fmt(row.originalError, 4)}%</td><td>{fmt(row.restoredRadius, 6)}</td><td className="improved-error">{fmt(row.restoredError, 4)}%</td></tr>)}
            </tbody></table></div>
            <div className="comparison-summary"><span>六组平均相对误差</span><b>{fmt(comparisonSummary.originalMeanError, 4)}%</b><em>→</em><b>{fmt(comparisonSummary.restoredMeanError, 4)}%</b><strong>平均改善 {fmt(comparisonSummary.improvement, 2)}%</strong></div>
            <p className="comparison-note">单级估计按 Rₘ = Dₘ²/(4mλ) 展示，便于横向比较；最终实验结论仍以逐差法结果为准，可减少接触点偏移带来的影响。</p>
          </div>

          <div className="report-grid">
            <div className="report-table-card wide">
              <div className="table-title"><div><b>数据记录与处理</b><span>由水平直径自动生成</span></div><span>单位：mm / mm²</span></div>
              <div className="table-scroll"><table><thead><tr><th>m（级）</th>{results.rows.filter((row) => row.valid).map((row) => <th key={row.order}>{row.order}</th>)}</tr></thead><tbody>
                <tr><th>原始 D</th>{results.rows.filter((row) => row.valid).map((row) => <td key={row.order}>{fmt(row.original)}</td>)}</tr>
                <tr className="highlight-row"><th>还原 D₀</th>{results.rows.filter((row) => row.valid).map((row) => <td key={row.order}>{fmt(row.restored)}</td>)}</tr>
                <tr><th>D₀²</th>{results.rows.filter((row) => row.valid).map((row) => <td key={row.order}>{fmt(row.square)}</td>)}</tr>
              </tbody></table></div>
            </div>

            <div className="report-table-card">
              <div className="table-title"><div><b>逐差法</b><span>实验报告同款计算</span></div><span>n = {interval}</span></div>
              <div className="difference-list">
                {results.pairs.map((pair) => <div key={`${pair.low}-${pair.high}`}><span>D<sub>{pair.high}</sub>² − D<sub>{pair.low}</sub>²</span><b>{fmt(pair.difference, 3)}</b></div>)}
                <div className="mean-line"><span>平均值</span><b>{fmt(results.meanDifference, 3)} mm²</b></div>
              </div>
            </div>

            <div className="calculation-card">
              <div><p>曲率半径</p><b>R̄ = <span>D̄²<sub>m+n</sub> − D̄²<sub>m</sub></span> / 4nλ</b></div>
              <div className="calc-values"><span>逐差法 R</span><b>{fmt(results.radius, 4)} m</b><span>扩展不确定度 ΔR</span><b>{fmt(results.radiusUncertainty, 4)} m</b><span>线性拟合复核 R</span><b>{fmt(results.regressionRadius, 4)} m</b></div>
              <small>不确定度按 95% 置信水平、逐差样本的 Student-t 因子估计；用于教学实验的数据复核。</small>
            </div>

            <div className="trace-card">
              <p>本次还原记录</p>
              <div className="trace-list">
                {correction.parts.length ? correction.parts.map((part) => <div key={part.name}><span>✓</span><p><b>{part.name}</b><small>{part.formula}</small></p><em>×{part.factor.toFixed(5)}</em></div>) : <div><span>✓</span><p><b>无需几何修正</b><small>保留原始水平直径</small></p><em>×1.00000</em></div>}
              </div>
              <div className="quality-note"><span>i</span><p>经验还原依赖照片质量与模型假设；若条纹断裂或仪器损坏，请重新测量，不要使用本报告替代检修。</p></div>
            </div>
          </div>

          <div className="restart-bar"><div><b>还要分析另一组实验吗？</b><span>本页不保存照片、密钥或实验数据。</span></div><button className="primary" type="button" onClick={reset}>回到首页，再次使用 ↻</button></div>
        </section>
      )}

      {thinking && (
        <div className="thinking-overlay" role="status" aria-live="polite">
          <div className={`thinking-card ${mode === "deepseek" && thinking === "analysis" ? "ds-thinking" : ""}`}>
            {mode === "deepseek" && thinking === "analysis" ? <div className="ds-orb">DS<span /><span /></div> : <div className="orbit-loader"><i /><i /><i /></div>}
            <p>{mode === "deepseek" && thinking === "analysis" ? "正在请求 DeepSeek 复核" : thinking === "analysis" ? "模型正在分析圆环" : "模型正在还原数据"}</p>
            <span>{thinking === "analysis" ? "提取轮廓、长短轴、偏心与清晰度" : "合成修正系数并执行逐差计算"}</span>
            <div className="thinking-dots"><i /><i /><i /></div>
          </div>
        </div>
      )}
    </main>
  );
}
