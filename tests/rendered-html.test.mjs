import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const developmentPreviewMeta = /<meta(?=[^>]*\bcontent=["']development["'])[^>]*>/i;
async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the huanzhen Newton rings homepage", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.doesNotMatch(html, developmentPreviewMeta);
  assert.match(html, /<title>环真｜牛顿环数据还原工具<\/title>/i);
  assert.match(html, /从环纹出发/);
  assert.match(html, /还原实验数据/);
  assert.match(html, /开始分析/);
});

test("ships diagnosis, retest, and report interpretation", async () => {
  const [css, page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /仪器调整建议/);
  assert.match(page, /全部常见原因/);
  const analysis = await readFile(new URL("../core/analysis.ts", import.meta.url), "utf8");
  assert.match(analysis, /MAX_RECOMMENDED_CAUSES = 3/);
  assert.match(analysis, /Scores order checks/);
  assert.match(page, /按建议调整，重新拍照/);
  assert.match(page, /辅助结果解读/);
  assert.doesNotMatch(
    page + analysis,
    /STANDARD_RADIUS|CALIBRATION_STRENGTH|autoCalibration|accuracyImprovement|beforeRelativeError|afterRelativeError/,
  );
  assert.match(page, /不从照片代替仪器读数/);
  assert.match(page, /器材真实半径未知/);
  assert.match(css, /\.ai-advice-heading h3/);
  assert.match(layout, /环真｜牛顿环数据还原工具/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page, /SkeletonPreview/);
});

test("ships robust real-photo ring fitting", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const analysis = await readFile(new URL("../core/analysis.ts", import.meta.url), "utf8");
  assert.match(analysis, /selectAutomaticRings/);
  assert.match(analysis, /robustEllipseFromRing/);
  assert.match(analysis, /detectGuideLine/);
  assert.match(page, /连续环边追踪与椭圆拟合/);
});

test("legacy iteration route returns to the unified workspace", async () => {
  const response = await render("/experiment");
  assert.ok([301, 302, 303, 307, 308].includes(response.status));
  assert.match(response.headers.get("location"), /\/\?tool=records$/);
});

test("removed simulation feature has no homepage entry or route", async () => {
  const home = await render();
  assert.doesNotMatch(await home.text(), /仿真试一试|牛顿环仿真/);
  const removed = await render("/simulation");
  assert.equal(removed.status, 404);
});
