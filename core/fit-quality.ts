export type FitStatus = "accepted" | "review" | "unreliable";
export function assessFit(input: {
  rms: number;
  semiMinor: number;
  minDimension: number;
  coverage: number;
  observedFraction: number;
  inlierFraction: number;
  contrast: number;
}) {
  const {
    rms,
    semiMinor,
    minDimension,
    coverage,
    observedFraction,
    inlierFraction,
    contrast,
  } = input;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const residualScore = Math.exp(
    -((rms / Math.max(1.2, minDimension * 0.004)) ** 2),
  );
  const quality = clamp(
    (residualScore * 0.4 +
      observedFraction * 0.25 +
      inlierFraction * 0.2 +
      contrast * 0.15) *
      Math.min(1, contrast / 0.2),
  );
  const geometrySupported =
    Number.isFinite(rms) &&
    rms / semiMinor <= 0.06 &&
    coverage >= 0.6 &&
    observedFraction >= 0.4 &&
    inlierFraction >= 0.55 &&
    contrast >= 0.08;
  const accepted =
    geometrySupported &&
    quality >= 0.6 &&
    observedFraction >= 0.72 &&
    rms / semiMinor <= 0.03 &&
    contrast >= 0.2;
  const status: FitStatus = !geometrySupported
    ? "unreliable"
    : accepted
      ? "accepted"
      : "review";
  const warnings: string[] = [];
  if (observedFraction < 0.85)
    warnings.push(
      "部分方向缺少有效暗纹，虚线包含模型推测的弧段；请核对是否为同一条环。",
    );
  if (contrast < 0.2)
    warnings.push("暗纹对比度不足，建议保持仪器设置并改善对焦或拍摄条件。");
  if (rms / semiMinor > 0.03 || residualScore < 0.5)
    warnings.push("轮廓与椭圆存在较大偏差，当前形状参数仅供复核。");
  if (!geometrySupported)
    warnings.push("有效轮廓证据不足，本轮不用于误差归因或残余补偿。");
  return { quality, status, warnings };
}
