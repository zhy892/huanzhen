const ALLOWED_CAUSES = new Set(["tilt", "pressure", "decenter", "calibration", "damage"]);

type Metrics = {
  ratio: number;
  angle: number;
  centerOffset: number;
  clarity: number;
  asymmetry: number;
  fitQuality: number;
  confidence: number;
  damaged?: boolean;
};

function fallbackDiagnosis(metrics: Metrics, serviceUnavailable = false) {
  if (metrics.damaged) {
    return {
      verdict: "无法可靠还原",
      summary: "轮廓清晰度或完整性没有通过质量门槛，建议检查光源、读数显微镜、透镜接触面后重新拍摄。",
      causes: ["damage"],
      confidence: Math.max(0.55, metrics.confidence),
      provider: "local-fallback",
    };
  }
  const causes: string[] = [];
  if (metrics.ratio < 0.975) causes.push(metrics.asymmetry > 0.34 ? "pressure" : "tilt");
  if (metrics.ratio < 0.93 && metrics.asymmetry > 0.2 && !causes.includes("pressure")) causes.push("pressure");
  if (metrics.centerOffset > 0.1) causes.push("decenter");
  if (metrics.ratio < 0.94 && Math.abs(metrics.angle) < 12) causes.push("calibration");
  const verdict = metrics.ratio >= 0.975 ? "可视为正圆" : metrics.ratio >= 0.92 ? "轻微椭圆" : "明显椭圆";
  return {
    verdict,
    summary: serviceUnavailable
      ? `增强服务暂时不可用，已自动按同一组量化特征完成诊断。长短轴比 ${metrics.ratio.toFixed(3)}，建议结合现场装调情况复核原因。`
      : `公开版已按量化特征完成免密诊断。长短轴比 ${metrics.ratio.toFixed(3)}，建议结合现场装调情况复核原因。`,
    causes,
    confidence: Math.max(0.55, metrics.confidence * 0.94),
    provider: "local-fallback",
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { metrics?: Metrics };
    const metrics = body?.metrics as Metrics;
    const numericKeys: Array<keyof Metrics> = ["ratio", "angle", "centerOffset", "clarity", "asymmetry", "fitQuality", "confidence"];
    if (!metrics || numericKeys.some((key) => !Number.isFinite(metrics[key]))) {
      return Response.json({ error: "图像特征不完整，请重新分析。" }, { status: 400 });
    }

    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) return Response.json(fallbackDiagnosis(metrics));

    const prompt = `你是大学物理实验助教。浏览器已从牛顿环照片提取量化特征：
- 长短轴比 q=${metrics.ratio.toFixed(4)}（1 为正圆）
- 长轴相对水平方向角 φ=${metrics.angle.toFixed(2)}°
- 环心相对有效成像区中心偏移=${(metrics.centerOffset * 100).toFixed(2)}%
- 边缘清晰度=${metrics.clarity.toFixed(3)}
- 四象限边缘不对称度=${metrics.asymmetry.toFixed(3)}
- 连续环边拟合质量=${metrics.fitQuality.toFixed(3)}
- 算法基础置信度=${metrics.confidence.toFixed(3)}
- 质量门控是否提示损坏=${Boolean(metrics.damaged)}

请按牛顿环实验常见误差诊断。原因 id 只能是 tilt（光轴/观察面倾斜）、pressure（透镜受力不均/空气膜倾斜）、decenter（环心偏离读数轴）、calibration（横纵标尺比例不一致）、damage（仪器或光学元件明显损坏且不可还原）。不要声称看过原图；你只看到了量化特征。正圆阈值取 q≥0.975。只有质量极差或明显损坏才选 damage。输出 JSON：{"verdict":"可视为正圆/轻微椭圆/明显椭圆/无法可靠还原","summary":"140字以内，依次说明主要量化证据、最可能原因、现场复核方法和是否适合还原","causes":["id"],"confidence":0到1}。`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "deepseek-v4-flash",
          messages: [
            { role: "system", content: "你只输出合法 JSON，不输出 Markdown。" },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: 500,
        }),
        signal: controller.signal,
      });
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      if (!response.ok) return Response.json(fallbackDiagnosis(metrics, true));
      const parsed = JSON.parse(payload?.choices?.[0]?.message?.content || "{}");
      const causes = Array.isArray(parsed.causes) ? parsed.causes.filter((cause: string) => ALLOWED_CAUSES.has(cause)) : [];
      return Response.json({
        verdict: String(parsed.verdict || "已完成分析").slice(0, 24),
        summary: String(parsed.summary || "DeepSeek 已完成特征复核。").slice(0, 260),
        causes,
        confidence: Math.min(0.99, Math.max(0.5, Number(parsed.confidence) || metrics.confidence)),
        provider: "deepseek",
      });
    } catch {
      return Response.json(fallbackDiagnosis(metrics, true));
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return Response.json({ error: "请求内容无法解析，请重新分析。" }, { status: 400 });
  }
}
