import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
import { screen } from "../fixtures/obscured-screen.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
const baseURL = process.env.RING_TEST_BASE_URL || "http://127.0.0.1:3024/";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname))
  throw new Error("Run this generated-image check against a local test server.");
const artifacts = process.env.RING_ARTIFACT_DIR || path.join(os.tmpdir(), "huanzhen-ring-browser");
fs.mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } }),
  errors = [],
  results = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  for (const spec of [
    { stains: false, offset: false },
    { stains: true, offset: false },
    { stains: true, offset: true },
  ]) {
    const f = screen(spec);
    await page.goto(baseURL);
    await page.getByRole("button", { name: /开始分析/ }).click();
    assert.equal(await page.getByRole("button", { name: /取点|点选目标环/ }).count(), 0);
    const png = await page.evaluate(
      ({ raw, w, h }) => {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d"),
          im = ctx.createImageData(w, h);
        for (let i = 0; i < raw.length; i++) {
          im.data[4 * i] = raw[i] * 1.4;
          im.data[4 * i + 1] = raw[i] * 0.8;
          im.data[4 * i + 2] = raw[i] * 0.15;
          im.data[4 * i + 3] = 255;
        }
        ctx.putImageData(im, 0, 0);
        return canvas.toDataURL("image/png").split(",")[1];
      },
      { raw: Array.from(f.raw), w: f.w, h: f.h },
    );
    await page.locator("input[type=file]").setInputFiles({
      name: "controlled-screen.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
    await page.getByRole("button", { name: /分析圆环/ }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "已自动保存第 1 轮" })
      .waitFor({ timeout: 20000 })
      .catch(async (e) => {
        console.log((await page.locator("body").innerText()).slice(-1800));
        throw e;
      });
    const metrics = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const q = indexedDB.open("huanzhen-experiments", 1);
          q.onsuccess = () => {
            const db = q.result,
              r = db.transaction("sessions").objectStore("sessions").getAll();
            r.onsuccess = () => {
              const s = r.result.sort((a, b) => b.created.localeCompare(a.created))[0];
              resolve(s.rounds[0].samples[0].metrics);
              db.close();
            };
          };
        }),
    );
    console.log(
      JSON.stringify({
        spec,
        fit: metrics.ellipse,
        status: metrics.fitStatus,
        ratio: metrics.ratio,
        evidence: metrics.fitEvidence,
        processingMs: metrics.processingMs,
      }),
    );
    assert.ok(metrics.ellipse, "a supported contour must be displayed");
    assert.ok(Math.hypot(metrics.ellipse.centerX - f.cx, metrics.ellipse.centerY - f.cy) < 5);
    assert.ok(Math.abs(metrics.ellipse.semiMajor - f.a) < 5);
    assert.ok(Math.abs(metrics.ratio - f.b / f.a) < 0.03);
    assert.ok(metrics.fitEvidence.fraction >= 0.72);
    assert.equal(metrics.ringSelection.absoluteOrder, null);
    await page.screenshot({
      path: path.join(artifacts, `controlled-${Number(spec.stains)}-${Number(spec.offset)}.png`),
      fullPage: true,
    });
    results.push({ spec, metrics });
    await page.getByRole("button", { name: "新实验", exact: true }).click();
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(artifacts, "results.json"), JSON.stringify(results, null, 2));
  console.log("PASS browser outer-ring geometry", results.length);
} finally {
  await browser.close();
}
