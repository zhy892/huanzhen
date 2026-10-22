# 环真

牛顿环实验图像分析与数据还原工具。支持暗纹拟合、原因排查、多轮实验记录及曲率估计。仪器读数由用户完成，系统处理用户提供的数据。

## 功能

- 自动寻找清晰暗环，拟合椭圆并显示实测轮廓点、轴比、残差和弧段覆盖。
- 屏蔽检测到的十字丝邻域，用鲁棒拟合减少污斑和孤立点的影响。
- 列出八项常见误差因素，分别提供证据和验证建议。
- 使用逐差法及带自由截距的 D²–级次回归计算曲率半径，保留原始读数。
- 提供 Huber 稳健回归、异常读数权重与留出敏感性检查。
- 记录单螺丝受控调整，通过独立参考和留出验证评估受力形变补偿。
- 在浏览器中保存多轮照片、操作及实验参数，支持 JSON、CSV 和打印报告。

## 本地运行

需要 Node.js 22.13 或以上版本，使用 npm 管理依赖。

```sh
npm ci
npm run dev
```

生产构建与测试：

```sh
npm test
npm run build
npm start
```

类型检查需要先生成 Worker 运行时声明：

```sh
npx wrangler types .wrangler/runtime.d.ts --config dist/server/wrangler.json --include-env false
npx tsc --noEmit
```

应用入口为 `/`。`/experiment` 兼容旧地址并打开实验记录。

## 项目结构

```text
app/                    页面、样式及特征复核接口
components/             实验记录、标定及结果组件
core/                   暗纹检测、几何拟合与物理计算
lib/                    浏览器记录存储
worker/                 Cloudflare Worker 入口
db/                     可选数据库访问
docs/                   模型、适用条件和验证说明
tests/                  单元测试与浏览器回归
deployment.config.json  可选存储绑定
```

## 配置与部署

技术栈为 React、vinext、Vite 和 Cloudflare Workers。`npm run build` 生成 `dist/client` 和 `dist/server`。部署到自己的 Cloudflare 账号前，检查 Worker 名称及资源绑定：

```sh
npx wrangler deploy --config dist/server/wrangler.json
```

`deployment.config.json` 中的 `d1`、`r2` 默认为 `null`；基础图像分析和浏览器实验记录不依赖这些服务。启用可选存储时，需要先创建生产资源并配置真实绑定。示例数据库配置只用于本地开发。

图像特征提取、环纹拟合与原因排查均在浏览器本地完成，无需外部分析接口。文件监听不正常的环境可设置 `WATCH_POLLING=true`。

## 数据与计算边界

照片和实验记录保存在当前浏览器的 IndexedDB 中，不自动跨设备同步。建议定期导出 JSON 备份；清理浏览器数据会删除本地记录。

照片提供可见环纹的形状证据，不自动确定绝对级次、真实长度或唯一误差成因。曲率半径依赖实测直径、已知级差、波长和介质折射率。十字丝正常存在，少量灰尘不代表失焦或器件损坏。

长度系数仅在勾选对应标尺原因且参数有效时应用；取消勾选后不再改变直径。图像阶段处理与数值补偿分别记录。透视、畸变、偏心或受力补偿缺少独立标定时，导出记录会明确标为未执行。

系统不预设器材真实曲率半径，不按参考值倒算系数，不输出相对真值误差或精度提升比例。还原结果是输入数据、独立标定与模型条件下的估计。拟合残差描述数据与模型的一致性，留出敏感性范围和组间离散不能替代完整的不确定度预算。

## 技术文档

- [图像分析与物理回归](docs/diagnosis-and-validation.md)
- [原因与算法执行](docs/restoration-selection.md)
- [受力形变标定](docs/force-calibration.md)
- [环纹检测验证](docs/ring-detection-validation.md)

## 许可证

[MIT](LICENSE)。第三方依赖遵循各自的许可证。
