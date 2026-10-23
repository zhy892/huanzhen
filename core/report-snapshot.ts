import { SOFTWARE_NAME, SOFTWARE_VERSION } from "./software.ts";
import type { Reading } from "./experiment.ts";

export type ReportParameters = {
  wavelengthNm: number;
  refractiveIndex: number;
  orderInterval: number;
  lengthFactor: number;
};
export type ReportResults = {
  radius: number;
  radiusUncertainty: number;
  regressionRadius: number;
  rSquared: number;
};
export type ReportSnapshot = {
  software: { name: string; version: string };
  parameters: ReportParameters;
  results: ReportResults;
};

export function validateReportInput(readings: Reading[], p: ReportParameters): string | null {
  if (!Number.isFinite(p.wavelengthNm) || p.wavelengthNm < 300 || p.wavelengthNm > 1000)
    return "光源波长须在 300–1000 nm 之间，请按实验光源填写。";
  if (!Number.isFinite(p.refractiveIndex) || p.refractiveIndex < 1 || p.refractiveIndex > 2)
    return "介质折射率须在 1–2 之间。";
  if (
    !Number.isInteger(p.orderInterval) ||
    p.orderInterval < 5 ||
    p.orderInterval > 35 ||
    p.orderInterval % 5 !== 0
  )
    return "级次差须为 5–35 之间的 5 的整数倍。";
  if (!Number.isFinite(p.lengthFactor) || p.lengthFactor < 0.5 || p.lengthFactor > 1.5)
    return "独立长度系数须在 0.5–1.5 之间。";
  if (readings.some((r) => !Number.isFinite(r.diameter) || r.diameter <= 0))
    return "已填写的直径须为有限正数，请清除或更正无效数据。";
  if (readings.length < 6) return "请至少填写 6 组有效直径。";
  const sorted = [...readings].sort((a, b) => a.order - b.order);
  if (sorted.some((r, i) => i > 0 && r.diameter <= sorted[i - 1].diameter))
    return "直径应随级次增加，请复核级次与直径的对应关系。";
  return null;
}

export function captureReport(
  parameters: ReportParameters,
  results: ReportResults,
): ReportSnapshot {
  return {
    software: { name: SOFTWARE_NAME, version: SOFTWARE_VERSION },
    parameters: { ...parameters },
    results: {
      radius: results.radius,
      radiusUncertainty: results.radiusUncertainty,
      regressionRadius: results.regressionRadius,
      rSquared: results.rSquared,
    },
  };
}
