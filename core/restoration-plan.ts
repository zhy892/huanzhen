import type { CauseId } from './analysis.ts';
export type RestorationStep={cause:CauseId;algorithm:string;status:'applied'|'image'|'pending';detail:string};
export function buildRestorationPlan(selected:CauseId[],lengthFactor:number,teaching=false){
  const valid=Number.isFinite(lengthFactor)&&lengthFactor>=.5&&lengthFactor<=1.5;
  const factor=selected.includes('calibration')&&valid?lengthFactor:1;
  const mapping:Record<CauseId,Omit<RestorationStep,'cause'>>={
    calibration:{algorithm:'独立长度标定 D₀=kD',status:valid?'applied':'pending',detail:valid?`${teaching?'教学演示系数':'独立长度系数'} k=${lengthFactor.toFixed(6)}，仅在勾选本项时应用。`:'系数无效，未应用；请填写 0.5–1.5 范围的独立标定系数。'},
    focus:{algorithm:'十字丝邻域屏蔽、切向中位数、鲁棒拟合与留出验证',status:'image',detail:'已在照片分析阶段运行。十字丝与少量灰尘属于常见成像结构，只有剩余条纹证据不足或残差明显时才建议复拍；不生成直径乘数。'},
    illumination:{algorithm:'局部亮度趋势处理与暗纹双侧明暗核验',status:'image',detail:'已在照片分析阶段按证据运行，精修仅在留出验证通过时采用；不将明暗差换算为直径补偿。'},
    tilt:{algorithm:'观察投影/透视逆变换',status:'pending',detail:'未执行数值补偿：尚无独立姿态或平面标定矩阵，不能仅按轴比拉圆。'},
    distortion:{algorithm:'相机逐点去畸变与重拟合',status:'pending',detail:'未执行数值补偿：尚无相机内参、畸变系数及独立标定。'},
    decenter:{algorithm:'已知偏心量的弦长修正',status:'pending',detail:'未执行数值补偿：尚无独立的真实读数轴偏心量，取景中心偏移不能代替它。'},
    pressure:{algorithm:'受力形变响应标定与间隙贡献扣除',status:'pending',detail:'本次直径计算未执行受力补偿；请在“受力形变标定”面板对匹配状态独立标定和计算，其结果单独报告，不混入当前读数。'},
    damage:{algorithm:'实物检查与模型适用性复核',status:'pending',detail:'仅记录待验证因素，照片不确认实物损坏；无可自动调用的损伤补偿公式。'},
  };
  const steps=[...new Set(selected)].map(cause=>({cause,...mapping[cause]}));
  return {factor,steps};
}
