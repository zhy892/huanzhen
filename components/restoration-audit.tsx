import type {RestorationStep} from '../core/restoration-plan';
import {CAUSES} from '../core/analysis';
export default function RestorationAudit({steps}:{steps:RestorationStep[]}){
return <section className="restoration-audit report-analysis" aria-label="勾选原因与算法执行清单"><h3>勾选原因与算法执行清单</h3><p>共同流程：先定位暗纹、屏蔽检测到的十字丝邻域、剔除异常点并验证拟合；有原始读数时执行逐差法与 D²–m 回归。以下列出本次勾选对应的处理，不按原因个数叠加经验系数。</p>{steps.length?<div className="table-scroll"><table><thead><tr><th>勾选原因</th><th>对应算法</th><th>执行状态与依据</th></tr></thead><tbody>{steps.map(s=><tr key={s.cause}><td>{CAUSES.find(c=>c.id===s.cause)?.title}</td><td>{s.algorithm}</td><td><b>{s.status==='applied'?'已应用数值换算':s.status==='image'?'图像阶段已处理':'未执行数值补偿'}</b><p>{s.detail}</p></td></tr>)}</tbody></table></div>:<p>未勾选原因：不执行原因专属的数值修正，保留原始直径。</p>}</section>;
}
