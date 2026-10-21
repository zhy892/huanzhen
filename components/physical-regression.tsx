"use client";
import { physicalRegression, type PhysicalReading } from "../core/physical-regression";
export default function PhysicalRegressionPanel({
  readings,
  wavelengthNm,
  factor,
  refractiveIndex,
}: {
  readings: PhysicalReading[];
  wavelengthNm: number;
  factor: number;
  refractiveIndex: number;
}) {
  let result: ReturnType<typeof physicalRegression> | null = null,
    error = "";
  try {
    result = physicalRegression(readings, wavelengthNm, refractiveIndex, factor);
  } catch (e) {
    error = e instanceof Error ? e.message : "数据不足";
  }
  return (
    <details className="physical-regression report-analysis" aria-label="物理约束稳健回归">
      <summary>
        <span>稳健回归复核</span>
        <small>
          {result ? `R = ${result.radius.toFixed(6)} m · 展开查看残差与权重` : "展开查看计算条件"}
        </small>
      </summary>
      <div className="regression-details">
        <p>
          用 D² = 4Rλm/n + 截距拟合全部级次；自由截距消除共同级次偏移与中心常数间隙。Huber
          权重减少异常读数的影响，保留原始数据；不按标准半径倒算修正。
        </p>
        <p>
          间隙折射率 n = {refractiveIndex}（使用实验参数）。教学演示的标准值倒算系数不用于本回归。
        </p>
        {error && <p role="status">{error}</p>}
        {result && (
          <>
            <p>
              普通回归 R = {result.ordinaryRadius.toFixed(6)} m；稳健回归 R ={" "}
              {result.radius.toFixed(6)} m。固定权重逐点留出敏感性范围 [
              {result.leaveOneOutRange.map((v) => v.toFixed(6)).join(", ")}] m（非置信区间）。
            </p>
            <p>
              独立长度系数 {factor.toFixed(6)}；全点残差 RMS {result.rmsMmSquared.toFixed(5)} mm²。
              {result.flagged.length
                ? `请优先核对 ${result.flagged.join("、")} 级读数。`
                : "未发现被明显降权的级次；不代表无系统误差。"}
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>级次</th>
                    <th>D² 残差 / mm²</th>
                    <th>稳健权重</th>
                    <th>复核建议</th>
                  </tr>
                </thead>
                <tbody>
                  {result.orders.map((o, i) => (
                    <tr key={o}>
                      <td>{o}</td>
                      <td>{result!.residuals[i].toFixed(5)}</td>
                      <td>{result!.weights[i].toFixed(3)}</td>
                      <td>{result!.weights[i] < 0.5 ? "优先核对跳环、回程差与录入" : "保留"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              此结果反映当前受力和成像条件下的有效曲率，仍需独立尺度、相机与受力标定才能解释为未受力曲率；稳健回归不能消除共同系统偏差。
            </p>
          </>
        )}
      </div>
    </details>
  );
}
