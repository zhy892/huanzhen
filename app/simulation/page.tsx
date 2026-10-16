"use client";
import { useRef, useState } from 'react';
import { simulateRing } from '../../core/simulation';
import type { Simulation } from '../../core/simulation';
import '../experiment/experiment.css';
export default function SimulationPage() {
  const [options, setOptions] = useState<Simulation>({ size: 512, radiusM: 1.4, wavelengthNm: 589.3, pixelsPerMm: 55, ratio: .97, noise: .03, seed: 1, offsetX: 0, gradient: .1 });
  const [ready, setReady] = useState(false); const [message, setMessage] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const generated = useRef<Simulation | null>(null);
  function generate() {
    try {
      const data = simulateRing(options); const ctx = canvas.current?.getContext('2d');
      if (!ctx || !canvas.current) return;
      canvas.current.width = options.size; canvas.current.height = options.size;
      ctx.putImageData(new ImageData(data, options.size, options.size), 0, 0);
      generated.current = { ...options }; setReady(true); setMessage('已生成。固定种子可复现同一图像；改变种子可生成不同噪声。');
    } catch (e) { setMessage(e instanceof Error ? e.message : '生成失败'); }
  }
  function download() {
    canvas.current?.toBlob(blob => {
      if (!blob || !generated.current) return;
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url;
      a.download = `simulation-R${generated.current.radiusM}-q${generated.current.ratio}-seed${generated.current.seed}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  const fields: Array<[keyof Simulation, string, number, number, number]> = [
    ['radiusM', '真值曲率半径 / m', .01, 100, .1], ['wavelengthNm', '波长 / nm', 100, 2000, .1],
    ['pixelsPerMm', '像素 / mm', 1, 1000, 1], ['ratio', '成像短长轴比', .5, 1, .001],
    ['noise', '噪声幅度', 0, 1, .01], ['gradient', '光照梯度', -1, 1, .01],
    ['offsetX', '水平中心偏移 / 图宽', -.25, .25, .01], ['seed', '随机种子', 1, 1000000, 1],
  ];
  return <main className="experiment-page"><header><a href="/experiment">← 迭代实验</a></header><h1>牛顿环仿真</h1><p>用已知参数生成测试图。椭圆度在此表示成像缩放，不意味着实际透镜形变；仿真结果不能代替真实照片验证。</p><section className="experiment-panel"><div className="experiment-fields">{fields.map(([key, title, min, max, step]) => <label key={key}>{title}<input type="number" min={min} max={max} step={step} value={options[key]} onChange={e => { setOptions({ ...options, [key]: Number(e.target.value) }); setReady(false); }} /></label>)}</div><button type="button" onClick={generate}>生成测试图</button> <button type="button" onClick={download} disabled={!ready}>下载 PNG</button><p role="status">{message}</p><canvas ref={canvas} style={{ maxWidth: '100%', height: 'auto' }} /><p>模型：h=r²/(2R)，I=B+A[1−cos(4πh/λ)]。采用反射暗中心约定，叠加均匀噪声与线性照明梯度。测试图不包含真实仪器的全部误差。</p></section></main>;
}
