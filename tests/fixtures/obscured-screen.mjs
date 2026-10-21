import { boxBlur } from "../../core/analysis.ts";

// Controlled fixtures reproduce visible failure conditions, not the user's
// photographs. Geometry is known independently of the detector.
export function screen({ stains = false, offset = false, textureOnly = false } = {}) {
  const w = 720,
    h = 540,
    roi = { x0: 85, x1: 645, y0: 108, y1: 438 };
  const cx = offset ? 411 : 380,
    cy = 272,
    a = 244,
    b = 201,
    angle = 0.12;
  const c = Math.cos(angle),
    s = Math.sin(angle),
    raw = new Float32Array(w * h);
  const marks = Array.from({ length: 72 }, (_, i) => ({
    x: 120 + ((i * 107) % 500),
    y: 130 + ((i * 73) % 285),
    r: 3 + (i % 5),
  }));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (x < roi.x0 || x > roi.x1 || y < roi.y0 || y > roi.y1) {
        raw[y * w + x] = 4;
        continue;
      }
      const dx = x - cx,
        dy = y - cy,
        r = Math.hypot((dx * c + dy * s) / a, (-dx * s + dy * c) / b),
        theta = Math.atan2(dy, dx);
      const contrast = stains && theta > 0.1 && theta < 0.65 ? 3 : 34;
      let value =
        145 +
        (16 * x) / w +
        (7 * y) / h +
        6 * Math.sin(x * 0.014) -
        (textureOnly ? 0 : contrast * Math.exp(-(((r - 1) / 0.11) ** 2)));
      // Broad central shading is not a closed first dark fringe.
      if (!textureOnly) value -= 9 * Math.exp(-((dx / 80) ** 2 + (dy / 65) ** 2));
      value +=
        5 * Math.sin(2.2 * x) +
        3 * Math.sin(0.74 * y) +
        (stains ? 12 * Math.sin(x * 0.42 + 3 * Math.sin(y * 0.015)) : 0);
      if (stains)
        for (const m of marks)
          value -= 65 * Math.exp(-((x - m.x) ** 2 + (y - m.y) ** 2) / (m.r * m.r));
      if (Math.abs(x - 360) < 1 || Math.abs(y - 270) < 1) value -= 40;
      raw[y * w + x] = value;
    }
  return {
    w,
    h,
    roi,
    raw,
    gray: boxBlur(boxBlur(raw, w, h, 2), w, h, 2),
    cx,
    cy,
    a,
    b,
    guide: { x: 360, y: 270 },
  };
}
