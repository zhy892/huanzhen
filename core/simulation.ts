export type Simulation = { size: number; radiusM: number; wavelengthNm: number; pixelsPerMm: number; ratio: number; noise: number; seed: number; offsetX: number; gradient: number };
export function simulateRing(options: Simulation) {
  const { size, radiusM, wavelengthNm, pixelsPerMm, ratio, noise, offsetX, gradient } = options;
  if (!Number.isInteger(size) || size < 64 || size > 1024 || [radiusM, wavelengthNm, pixelsPerMm, ratio].some(v => !Number.isFinite(v) || v <= 0) || ratio > 1 || !Number.isFinite(noise) || noise < 0 || noise > 1 || !Number.isFinite(gradient) || Math.abs(gradient) > 1 || !Number.isFinite(offsetX) || Math.abs(offsetX) > .25) throw new Error('仿真参数超出范围。');
  let state = options.seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x - size * (.5 + offsetX)) / pixelsPerMm * 1e-3;
    const dy = (y - size * .5) / (pixelsPerMm * ratio) * 1e-3;
    const gap = (dx * dx + dy * dy) / (2 * radiusM);
    const intensity = .12 + .35 * (1 - Math.cos(4 * Math.PI * gap / (wavelengthNm * 1e-9)));
    const value = Math.round(255 * Math.max(0, Math.min(1, intensity + gradient * (x / size - .5) + noise * (random() - .5))));
    const i = (y * size + x) * 4;
    pixels[i] = value; pixels[i + 1] = Math.round(value * .83); pixels[i + 2] = Math.round(value * .24); pixels[i + 3] = 255;
  }
  return pixels;
}
