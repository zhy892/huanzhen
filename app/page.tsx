"use client";

import type { Session, Round, Sample } from "../core/experiment";
import { recommend } from "../core/experiment";
import { saveSession, getSession } from "../lib/experiment-store";
import { newRecordId, imageFingerprint } from "../core/recording";
import ExperimentFlow from "../components/experiment-flow";
import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";

import { buildRestorationPlan } from "../core/restoration-plan";
import { physicalRegression } from "../core/physical-regression";
import PhysicalRegressionPanel from "../components/physical-regression";
import {
  CauseId,
  Mode,
  ImageMetrics,
  AiDiagnosis,
  ORDERS,
  CAUSES,
  DEMO_DATA,
  clamp,
  wait,
  fmt,
  builtinDiagnosis,
  buildAiSuggestions,
  constrainDiagnosis,
  inspectImage,
  calculationT,
} from "../core/analysis";

export default function Home() {
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const [showRecords, setShowRecords] = useState(false);
  const [roundAction, setRoundAction] = useState("");
  const [roundOperation, setRoundOperation] = useState("repeat");
  const [roundConfounds, setRoundConfounds] = useState("");
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [recordNotice, setRecordNotice] = useState("");
  function receiveSession(s: Session) {
    sessionRef.current = s;
    setActiveSession(s);
    try {
      sessionStorage.setItem("huanzhen-active-session", s.id);
    } catch {
      /* The saved IndexedDB record remains available from history. */
    }
  }
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [mode, setMode] = useState<Mode>("empirical");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [metrics, setMetrics] = useState<ImageMetrics | null>(null);
  const [diagnosis, setDiagnosis] = useState<AiDiagnosis | null>(null);
  const [selectedCauses, setSelectedCauses] = useState<CauseId[]>([]);
  const [thinking, setThinking] = useState<"analysis" | "restore" | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [wavelength, setWavelength] = useState("589.3");
  const [refractiveIndex, setRefractiveIndex] = useState("1.000");
  const [interval, setInterval] = useState("15");
  const [calibration, setCalibration] = useState("1.0000");
  const [values, setValues] = useState<Record<number, string>>(() =>
    Object.fromEntries(ORDERS.map((order) => [order, ""])),
  );
  const [copied, setCopied] = useState(false);
  const [reportReady, setReportReady] = useState(false);
  const [retestMode, setRetestMode] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const tool = new URLSearchParams(window.location.search).get("tool");
    let id: string | null = null;
    try {
      id = sessionStorage.getItem("huanzhen-active-session");
    } catch {
      /* Resume is optional when session storage is unavailable. */
    }
    const load = id ? getSession(id) : Promise.resolve(null);
    void load
      .then((saved) => {
        if (cancelled) return;
        if (saved && saved.profile.kind !== "simulation") receiveSession(saved);
        if (tool === "records") setShowRecords(true);
      })
      .catch(() => {
        if (!cancelled) setRecordNotice("当前浏览器无法恢复实验记录，请检查存储权限。");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!showRecords) return;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const overlay = document.querySelector<HTMLElement>(".flow-overlay");
    const controls = () =>
      Array.from(
        overlay?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]",
        ) ?? [],
      ).filter((e) => e.getClientRects().length > 0);
    controls()[0]?.focus();
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowRecords(false);
      }
      if (e.key === "Tab") {
        const all = controls();
        const first = all[0],
          last = all.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", keyboard);
      previous?.focus();
    };
  }, [showRecords]);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewCanvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (step !== 1 || !preview || !previewCanvas.current) return;
    const canvas = previewCanvas.current;
    const context = canvas.getContext("2d");
    if (!context) return;
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = preview;
  }, [preview, step]);

  const restorationPlan = useMemo(
    () => buildRestorationPlan(selectedCauses, Number(calibration)),
    [selectedCauses, calibration],
  );
  const correction = useMemo(
    () => ({
      total: restorationPlan.factor,
      parts: restorationPlan.steps
        .filter((s) => s.cause === "calibration" && s.status === "applied")
        .map((s) => ({
          name: "独立标尺标定",
          factor: restorationPlan.factor,
          formula: s.algorithm,
        })),
    }),
    [restorationPlan],
  );

  const diagnosticDetail = useMemo(() => {
    if (!metrics || !diagnosis) return null;
    const circularDeviation = Math.max(0, (1 - metrics.ratio) * 100);
    const eccentricity = Math.sqrt(Math.max(0, 1 - metrics.ratio ** 2));
    const absoluteAngle = Math.abs(metrics.angle);
    const orientation =
      metrics.ratio > 0.995
        ? "接近正圆，主轴方向不稳定，不作方向归因"
        : absoluteAngle < 10
          ? "长轴近水平方向"
          : Math.abs(absoluteAngle - 90) < 10
            ? "长轴近垂直方向"
            : metrics.angle > 0
              ? `长轴向右下倾斜 ${absoluteAngle.toFixed(1)}°`
              : `长轴向右上倾斜 ${absoluteAngle.toFixed(1)}°`;
    const causeEvidence: Partial<Record<CauseId, string>> = {
      tilt: `q = ${metrics.ratio.toFixed(3)}，${orientation}；${metrics.asymmetry < 0.34 ? "可见暗环响应较均匀，但不能排除比例失真" : "可见弧段存在明暗不均，需先排除遮挡与照明影响"}。`,
      pressure: `多环轴比差异为 ${(100 * (metrics.ringSelection?.ratioSpread ?? 0)).toFixed(2)} 个百分点；局部形变与成像畸变仍需区分。`,
      decenter: `拟合环心偏离有效成像区中心 ${(metrics.centerOffset * 100).toFixed(1)}%，这只描述取景偏移，不代表真实读数偏心。`,
      calibration: `${orientation}且长短轴比例存在差异，应使用标准长度复核横、纵标尺比例。`,
      damage: `连续环边拟合质量仅 ${Math.round(metrics.fitQuality * 100)}%，轮廓不足以满足经验还原的闭合与可辨认前提。`,
    };
    const evidence = metrics.damaged
      ? [{ label: "轮廓复核", text: "当前形状参数仅供核对目标环，暂不据此推断仪器误差。" }]
      : diagnosis.causes.length
        ? diagnosis.causes.map((cause) => ({
            label: CAUSES.find((item) => item.id === cause)?.short || cause,
            text:
              causeEvidence[cause] ??
              CAUSES.find((item) => item.id === cause)?.description ??
              "需现场验证",
          }))
        : [
            {
              label: "未见系统偏差",
              text: "长短轴差异处于正圆阈值内，当前照片未给出需要强制修正的量化证据。",
            },
          ];
    const restorationTitle = metrics.damaged
      ? "先确认可见条纹"
      : metrics.ratio >= 0.975
        ? "可保留原始水平直径"
        : "保留原始直径，验证候选原因";
    const restorationText = metrics.damaged
      ? "先确认虚线是否沿同一条暗环；系统已自动比较可辨认的条纹。若环纹被裁切或遮挡，建议补拍，本轮仍保留在实验记录中。"
      : selectedCauses.length
        ? `已记录 ${selectedCauses.length} 项待验证原因。选中原因不会自动改变直径；仅在提供独立长度标定系数时进行相应换算。`
        : "保留原始直径；图像形状不自动转换为补偿量；仍建议保留原始读数和照片，便于实验报告复核。";
    return {
      circularDeviation,
      eccentricity,
      orientation,
      symmetry: clamp(1 - metrics.asymmetry, 0, 1),
      evidence,
      restorationTitle,
      restorationText,
    };
  }, [metrics, diagnosis, selectedCauses]);

  const aiSuggestions = useMemo(() => {
    if (!metrics || !diagnosis) return [];
    return buildAiSuggestions(metrics, diagnosis);
  }, [metrics, diagnosis]);

  const results = useMemo(() => {
    const rows = ORDERS.map((order) => {
      const original = Number(values[order]);
      const valid = Number.isFinite(original) && original > 0;
      const restored = valid ? original * correction.total : Number.NaN;
      return { order, original, restored, square: restored ** 2, valid };
    });
    const byOrder = new Map(rows.map((row) => [row.order, row]));
    const n = Math.max(1, Math.round(Number(interval) || 15));
    const reportLowOrders = [15, 20, 25];
    let pairs = reportLowOrders
      .map((low) => {
        const high = low + n;
        const lower = byOrder.get(low);
        const upper = byOrder.get(high);
        if (!lower?.valid || !upper?.valid) return null;
        return { low, high, difference: upper.square - lower.square };
      })
      .filter(Boolean) as Array<{ low: number; high: number; difference: number }>;
    if (!pairs.length) {
      pairs = rows
        .filter((row) => row.valid && byOrder.get(row.order + n)?.valid)
        .map((row) => ({
          low: row.order,
          high: row.order + n,
          difference: byOrder.get(row.order + n)!.square - row.square,
        }));
    }
    const meanDifference = pairs.length
      ? pairs.reduce((sum, pair) => sum + pair.difference, 0) / pairs.length
      : Number.NaN;
    const sampleDeviation =
      pairs.length > 1
        ? Math.sqrt(
            pairs.reduce((sum, pair) => sum + (pair.difference - meanDifference) ** 2, 0) /
              (pairs.length - 1),
          )
        : Number.NaN;
    const expandedDifference =
      pairs.length > 1
        ? (calculationT(pairs.length) * sampleDeviation) / Math.sqrt(pairs.length)
        : Number.NaN;
    const lambda = Number(wavelength);
    const mediumIndex = Number(refractiveIndex);
    const radius = (meanDifference * 1e-6 * mediumIndex) / (4 * n * lambda * 1e-9);
    const radiusUncertainty = Math.abs(radius * (expandedDifference / meanDifference));

    const validRows = rows.filter((row) => row.valid);
    const meanOrder =
      validRows.reduce((sum, row) => sum + row.order, 0) / Math.max(1, validRows.length);
    const meanSquare =
      validRows.reduce((sum, row) => sum + row.square, 0) / Math.max(1, validRows.length);
    const slopeNumerator = validRows.reduce(
      (sum, row) => sum + (row.order - meanOrder) * (row.square - meanSquare),
      0,
    );
    const slopeDenominator = validRows.reduce((sum, row) => sum + (row.order - meanOrder) ** 2, 0);
    const slope = slopeNumerator / slopeDenominator;
    const regressionRadius = (slope * 1e-6 * mediumIndex) / (4 * lambda * 1e-9);
    const ssTotal = validRows.reduce((sum, row) => sum + (row.square - meanSquare) ** 2, 0);
    const intercept = meanSquare - slope * meanOrder;
    const ssResidual = validRows.reduce(
      (sum, row) => sum + (row.square - (intercept + slope * row.order)) ** 2,
      0,
    );
    const rSquared = 1 - ssResidual / ssTotal;
    return {
      rows,
      pairs,
      meanDifference,
      sampleDeviation,
      expandedDifference,
      radius,
      radiusUncertainty,
      regressionRadius,
      rSquared,
    };
  }, [values, correction.total, interval, wavelength, refractiveIndex]);

  const resultInsight = useMemo(() => {
    const uncertaintyRatio =
      Number.isFinite(results.radiusUncertainty) && results.radius
        ? Math.abs(results.radiusUncertainty / results.radius) * 100
        : Number.NaN;
    const correctionShift = Math.abs(correction.total - 1) * 100;
    const fitLevel =
      results.rSquared >= 0.995 ? "高度一致" : results.rSquared >= 0.98 ? "基本一致" : "存在离散";
    const conclusion =
      results.rSquared >= 0.98 && uncertaintyRatio <= 5
        ? "本组数据的级次趋势较稳定，可结合原始记录写入实验报告。"
        : "建议回看异常级次的左右读数，并优先采用重新装调后的复测照片与数据。";
    return { uncertaintyRatio, correctionShift, fitLevel, conclusion };
  }, [results.radius, results.radiusUncertainty, results.rSquared, correction.total]);

  function updateFile(nextFile: File) {
    setBatchFiles([]);
    if (!nextFile.type.startsWith("image/")) {
      setError("请上传 JPG、PNG 或其他常见图片格式。");
      return;
    }
    if (nextFile.size > 12 * 1024 * 1024) {
      setError("图片请控制在 12 MB 以内。");
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setFile(nextFile);
    setPreview(URL.createObjectURL(nextFile));
    setMetrics(null);
    setDiagnosis(null);
    setError("");
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 8) {
      setError("每轮最多选择8张照片。");
      return;
    }
    if (files[0]) {
      updateFile(files[0]);
      setBatchFiles(files);
      if (retestMode) void analyze(files[0], files);
    }
  }

  async function analyze(chosenFile: File | null = file, chosenBatch: File[] = batchFiles) {
    if (!chosenFile) {
      setError("请先上传牛顿环照片。");
      return;
    }
    if (chosenBatch.some((f) => !f.type.startsWith("image/") || f.size > 12 * 1024 * 1024)) {
      setError("请上传每张不超过12 MB的图片。");
      return;
    }
    setError("");
    setThinking("analysis");
    try {
      const measured = await inspectImage(chosenFile);
      let nextDiagnosis = builtinDiagnosis(measured);
      if (mode === "deepseek" && !measured.damaged) {
        const response = await fetch("/api/deepseek", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            metrics: {
              ratio: measured.ratio,
              angle: measured.angle,
              centerOffset: measured.centerOffset,
              clarity: measured.clarity,
              asymmetry: measured.asymmetry,
              fitQuality: measured.fitQuality,
              confidence: measured.confidence,
              damaged: measured.damaged,
              ringSelection: measured.ringSelection,
            },
          }),
        });
        const payload = (await response.json()) as AiDiagnosis & { error?: string };
        if (!response.ok) throw new Error(payload.error || "增强诊断暂时没有返回结果");
        nextDiagnosis = constrainDiagnosis(measured, payload);
      } else {
        await wait(900);
      }
      try {
        const samples: Sample[] = [];
        const sources = chosenBatch.length ? chosenBatch : [chosenFile];
        for (let i = 0; i < sources.length; i++) {
          const source = sources[i];
          const hash = await imageFingerprint(source);
          const result = i === 0 ? measured : await inspectImage(source, false);
          const { annotatedImage, ...observation } = result;
          void annotatedImage;
          samples.push({
            id: newRecordId(),
            contentHash: hash,
            image: source,
            name: source.name,
            metrics: observation,
          });
        }
        const current = sessionRef.current;
        const existing = current && current.profile.kind !== "simulation" ? current : null;
        const known = new Set(
          existing?.rounds.flatMap((r) => r.samples.map((s) => s.contentHash ?? s.id)) ?? [],
        );
        for (const sample of samples) {
          const hash = sample.contentHash!;
          sample.reused = known.has(hash);
          known.add(hash);
        }
        const base: Session = existing ?? {
          version: 1,
          id: newRecordId(),
          created: new Date().toISOString(),
          profile: {
            kind: "experiment",
            name: `牛顿环实验 ${new Date().toLocaleString()}`,
            instrument: "未填写",
            wavelengthNm: Number(wavelength) || 589.3,
            resolutionMm: 0.001,
            pixelPerMm: null,
            conditions: "未记录",
            diameterFactor: 1,
            factorUncertainty: 0,
          },
          rounds: [],
          declarations: [],
          restorations: [],
        };
        const round: Round = {
          id: newRecordId(),
          time: new Date().toISOString(),
          algorithmVersion: "ring-v6-normal-profile",
          operation: existing ? (roundAction.trim() ? roundOperation : "unrecorded") : "repeat",
          action: existing ? roundAction.trim() || "调整后复测" : "首次分析，建立基线",
          confounds: roundConfounds.trim(),
          samples,
          readings: ORDERS.filter((o) => Number(values[o]) > 0).map((o) => ({
            order: o,
            diameter: Number(values[o]),
          })),
          recommendation: recommend(samples),
        };
        receiveSession(await saveSession({ ...base, rounds: [...base.rounds, round] }));
        const duplicates = samples.filter((s) => s.reused).length;
        setRecordNotice(
          `已自动保存第 ${base.rounds.length + 1} 轮，后续复测将继续记录在同一次实验。${duplicates ? `其中 ${duplicates} 张与已有照片重复，已保留曲线记录，但不计为新的独立测量。` : ""}`,
        );
      } catch (e) {
        setRecordNotice(
          `分析已完成，记录未保存：${e instanceof Error ? e.message : "请检查浏览器存储"}`,
        );
      }
      setMetrics(measured);
      setDiagnosis(nextDiagnosis);
      setSelectedCauses(
        buildAiSuggestions(measured, nextDiagnosis)
          .filter((item) => item.recommended)
          .map((item) => item.id),
      );
      setRetestMode(false);
      setStep(2);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "分析失败，请换一张更清晰、只包含圆环的照片。 ",
      );
    } finally {
      setThinking(null);
    }
  }

  function toggleCause(id: CauseId) {
    setSelectedCauses((current) =>
      current.includes(id) ? current.filter((c) => c !== id) : [...current, id],
    );
  }

  async function goToData() {
    setThinking("restore");
    await wait(700);
    setThinking(null);
    setReportReady(false);
    setStep(3);
  }

  function startRetest() {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview("");
    setMetrics(null);
    setDiagnosis(null);
    setSelectedCauses([]);
    setError("");
    setReportReady(false);
    setBatchFiles([]);
    setValues(Object.fromEntries(ORDERS.map((o) => [o, ""])));
    setRoundAction("");
    setRoundConfounds("");
    setRoundOperation(sessionRef.current?.rounds.at(-1)?.recommendation.id ?? "repeat");
    setRetestMode(true);
    setStep(1);
  }

  async function calculate() {
    const lengthFactor = Number(calibration);
    if (
      selectedCauses.includes("calibration") &&
      (!Number.isFinite(lengthFactor) || lengthFactor < 0.5 || lengthFactor > 1.5)
    ) {
      setError("独立长度系数须在 0.5–1.5 之间；未标定时请保持 1。");
      return;
    }
    const validCount = ORDERS.filter((order) => Number(values[order]) > 0).length;
    if (validCount < 6) {
      setError("请至少填写 6 组有效直径；完整填写 8 组可获得更稳定的拟合检验。");
      return;
    }
    if (!results.pairs.length || !Number.isFinite(results.radius)) {
      setError("当前级次间隔没有形成可用的逐差数据，请检查输入或恢复间隔 15。");
      return;
    }
    setError("");
    const session = sessionRef.current;
    if (session?.rounds.length) {
      try {
        const rounds = [...session.rounds];
        rounds[rounds.length - 1] = {
          ...rounds.at(-1)!,
          restorationExecution: {
            selectedCauses: [...selectedCauses],
            lengthFactor: correction.total,
            steps: restorationPlan.steps,
          },
          readings: ORDERS.filter((o) => Number(values[o]) > 0).map((o) => ({
            order: o,
            diameter: Number(values[o]),
          })),
        };
        receiveSession(
          await saveSession({
            ...session,
            measurementRevision: (session.measurementRevision ?? 0) + 1,
            profile: { ...session.profile, wavelengthNm: Number(wavelength) },
            rounds,
          }),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "读数保存失败");
        return;
      }
    }
    setThinking("restore");
    await wait(900);
    setThinking(null);
    setReportReady(true);
    setStep(3);
  }

  function reset() {
    sessionRef.current = null;
    setActiveSession(null);
    setBatchFiles([]);
    setRecordNotice("");
    try {
      sessionStorage.removeItem("huanzhen-active-session");
    } catch {
      /* No stored pointer to clear. */
    }
    if (preview) URL.revokeObjectURL(preview);
    setStep(0);
    setMode("empirical");
    setFile(null);
    setPreview("");
    setMetrics(null);
    setDiagnosis(null);
    setSelectedCauses([]);
    setError("");
    setValues(Object.fromEntries(ORDERS.map((order) => [order, ""])));
    setCalibration("1.0000");
    setCopied(false);
    setReportReady(false);
    setRetestMode(false);
  }

  function physicalReport() {
    try {
      const r = physicalRegression(
        ORDERS.filter((o) => Number(values[o]) > 0).map((o) => ({
          order: o,
          diameter: Number(values[o]),
        })),
        Number(wavelength),
        Number(refractiveIndex),
        restorationPlan.factor,
      );
      return [
        `物理约束稳健回归 R=${r.radius.toFixed(6)} m，普通回归 R=${r.ordinaryRadius.toFixed(6)} m；固定权重逐点留出敏感性范围 ${r.leaveOneOutRange.map((v) => v.toFixed(6)).join("–")} m（非置信区间）。`,
        `优先核对级次：${r.flagged.join("、") || "无显著降权级次"}；未修改原始读数，未按标准半径倒算修正。`,
      ];
    } catch {
      return ["物理约束稳健回归：有效级次不足或输入不满足模型，请复核原始读数。"];
    }
  }

  function reportText() {
    const causeText = selectedCauses.length
      ? selectedCauses.map((id) => CAUSES.find((cause) => cause.id === id)?.title).join("、")
      : "未选择待验证原因";
    return [
      "牛顿环实验数据还原报告",
      `图像判断：${diagnosis?.verdict || "—"}（辅助评分 ${Math.round((diagnosis?.confidence || 0) * 100)}%，非统计概率）`,
      `待验证原因（选中不代表确认）：${causeText}`,
      ...(metrics?.ellipse
        ? [
            `拟合椭圆（分析图像素）：中心 (${metrics.ellipse.centerX.toFixed(3)}, ${metrics.ellipse.centerY.toFixed(3)})，半轴 a=${metrics.ellipse.semiMajor.toFixed(3)}、b=${metrics.ellipse.semiMinor.toFixed(3)}，φ=${metrics.angle.toFixed(3)}°；u²/a²+v²/b²=1。`,
          ]
        : []),
      `选环依据：自动比较可见暗环，绝对级次未确定；多环复核 ${metrics?.ringSelection?.checkedRingCount ?? 0} 条；中心区域未评估。`,
      `综合直径修正系数：${correction.total.toFixed(5)}`,
      "结果基于用户输入的实测直径、实验参数及独立长度系数；系统不代替仪器读数，也不预设器材真实半径。",
      `逐差平均值：${fmt(results.meanDifference, 3)} mm²`,
      `还原曲率估计：R = ${fmt(results.radius, 3)} ± ${fmt(results.radiusUncertainty, 3)} m`,
      `全数据线性拟合：R = ${fmt(results.regressionRadius, 3)} m，R² = ${fmt(results.rSquared, 4)}`,
      ...restorationPlan.steps.map(
        (s) =>
          `算法执行：${s.algorithm} · ${s.status === "applied" ? "已应用" : s.status === "image" ? "图像阶段已处理" : "未执行数值补偿"}；${s.detail}`,
      ),
      ...physicalReport(),
      ...aiSuggestions.map(
        (c) => `原因排查：${c.title} · ${c.status}；${c.evidence} 验证方法：${c.advice}`,
      ),
      `数据一致性：${resultInsight.fitLevel}；组间离散对应的相对不确定度 ${fmt(resultInsight.uncertaintyRatio, 2)}%，不表示相对真值误差。`,
      "不确定度说明：按逐差样本离散及 Student-t 因子估算，尚未包含尺度、波长及模型偏差；逐差组相关时不代表严格的 95% 覆盖区间。",
      "说明：图像自动选用清晰暗环，绝对级次未知；R 使用输入直径和级次差，D²–m 回归含截距。图像方程不提供曲率半径、中心接触状态或唯一误差成因。",
    ].join("\n");
  }

  async function copyReport() {
    await navigator.clipboard.writeText(reportText());
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function downloadCsv() {
    const lines = [
      "级次,原始水平直径(mm),还原直径(mm),还原直径平方(mm^2)",
      ...results.rows
        .filter((row) => row.valid)
        .map(
          (row) =>
            `${row.order},${row.original.toFixed(3)},${row.restored.toFixed(3)},${row.square.toFixed(3)}`,
        ),
      "",
      "图像选环,自动选择清晰暗环；绝对级次未知；不将图像环序套入读数级次",
      `综合修正系数,${correction.total.toFixed(6)}`,
      `还原曲率估计(m),${results.radius.toFixed(6)}`,
      `组间离散估算的不确定度(m),${results.radiusUncertainty.toFixed(6)}`,
      "结果说明,基于用户输入数据与物理模型的条件估计；系统不代替仪器读数；器材真实半径未知",
      "不确定度范围,仅由逐差样本离散估算；未包含尺度、波长和模型偏差；不表示相对真值误差",
      "",
    ];
    lines.push(
      "",
      ...restorationPlan.steps.map(
        (s) => `"算法执行：${s.algorithm}；${s.status}；${s.detail.replaceAll('"', '""')}"`,
      ),
      ...physicalReport().map((line) => `"${line.replaceAll('"', '""')}"`),
    );
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "牛顿环还原结果.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (step === 0) {
    return (
      <main className="landing">
        {showRecords && (
          <ExperimentFlow
            session={activeSession}
            onChange={(s) => {
              receiveSession(s);
              setWavelength(String(s.profile.wavelengthNm));
            }}
            onResume={(s) => {
              receiveSession(s);
              setShowRecords(false);
              setWavelength(String(s.profile.wavelengthNm));
              startRetest();
            }}
            onClose={() => setShowRecords(false)}
          />
        )}
        <header className="landing-nav">
          <button className="brand" type="button" onClick={() => setStep(0)} aria-label="环真首页">
            <span className="brand-mark">
              <i />
              <i />
              <i />
            </span>
            <span>环真</span>
          </button>
          <div className="flow-tools">
            <button className="quiet-button" type="button" onClick={() => setShowRecords(true)}>
              实验记录
            </button>
          </div>
        </header>

        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">大学物理 A14 · 等厚干涉 · 曲率半径测量</p>
            <div className="hero-lab-badge">
              <span>牛顿环实验</span>
              <b>NEWTON&apos;S RINGS LAB</b>
            </div>
            <h1>
              从环纹出发，
              <br />
              <em>还原实验数据。</em>
            </h1>
            <p className="hero-intro">
              上传照片排查环纹形状，输入你已完成的仪器读数，结合实验参数与独立标定进行数据还原。系统提供有依据的曲率估计，不预设器材真实半径。
            </p>
            <div className="experiment-strip" aria-label="牛顿环实验支持内容">
              <span>
                <b>01</b> 环纹圆度
              </span>
              <span>
                <b>02</b> 复合误差
              </span>
              <span>
                <b>03</b> 曲率半径 R
              </span>
            </div>
            <button
              className="primary hero-cta"
              type="button"
              onClick={() => (activeSession ? startRetest() : setStep(1))}
            >
              {activeSession ? "继续本次实验" : "开始分析"} <span>↗</span>
            </button>
            <p className="privacy-line">首次分析后，按建议调整并复测；系统自动保留整个过程。</p>
            <p className="privacy-line">
              <span>✓</span> 经验模式全程在浏览器内处理图片
            </p>
          </div>

          <div className="hero-visual" aria-label="牛顿环分析示意图">
            <div className="visual-card">
              <div className="visual-top">
                <span>牛顿环实验 · 目标暗环拟合</span>
                <b>● READY</b>
              </div>
              <div className="ring-stage">
                <div className="axis axis-x" />
                <div className="axis axis-y" />
                <div className="newton-rings">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
                <span className="measure-tag tag-a">a · 1.000</span>
                <span className="measure-tag tag-b">b · 0.983</span>
                <span className="focus-dot" />
              </div>
              <div className="visual-result">
                <div>
                  <span>牛顿环圆度判断</span>
                  <strong>可视为正圆</strong>
                </div>
                <div className="confidence-ring">
                  <span>示意</span>
                </div>
              </div>
            </div>
            <div className="floating-note note-one">
              <span>◎</span>
              <div>
                <b>环边连续追踪</b>
                <small>排除边框 · 刻线 · 摩尔纹</small>
              </div>
            </div>
            <div className="floating-note note-two">
              <span>R</span>
              <div>
                <b>牛顿环曲率半径</b>
                <small>逐差法 · 实验报告格式</small>
              </div>
            </div>
          </div>
        </section>

        <footer className="landing-footer">
          <span>适用于高校牛顿环等厚干涉实验 · Public access</span>
          <span>影像判断 · 数据复核 · 报告输出</span>
        </footer>
      </main>
    );
  }

  return (
    <main className="app-shell">
      {showRecords && (
        <ExperimentFlow
          session={activeSession}
          onChange={(s) => {
            receiveSession(s);
            setWavelength(String(s.profile.wavelengthNm));
          }}
          onResume={(s) => {
            receiveSession(s);
            setShowRecords(false);
            setWavelength(String(s.profile.wavelengthNm));
            startRetest();
          }}
          onClose={() => setShowRecords(false)}
        />
      )}
      <header className="app-header">
        <button className="brand" type="button" onClick={() => setStep(0)} aria-label="返回首页">
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          <span>环真</span>
        </button>
        {step < 3 && (
          <div className="stepper" aria-label="分析进度">
            <span className={step >= 1 ? "active" : ""}>
              <b>1</b> 图像
            </span>
            <i />
            <span className={step >= 2 ? "active" : ""}>
              <b>2</b> 诊断
            </span>
            <i />
            <span className={step >= 3 ? "active" : ""}>
              <b>3</b> 数据
            </span>
          </div>
        )}
        <div className="flow-tools">
          {step !== 2 && (
            <button className="quiet-button" type="button" onClick={() => setShowRecords(true)}>
              本次实验{activeSession ? ` · ${activeSession.rounds.length}轮` : "记录"}
            </button>
          )}
          <button className="quiet-button" type="button" onClick={reset}>
            新实验
          </button>
        </div>
      </header>

      {step === 1 && (
        <section className="workspace upload-workspace">
          <div className="section-heading">
            <span className="section-number">01</span>
            <div>
              <p>图像输入</p>
              <h2>上传牛顿环照片</h2>
              <span>自动比较可见暗环，优先分析清晰条纹；中心暗斑缺失时也会寻找外侧暗环。</span>
            </div>
          </div>

          {retestMode && (
            <section className="flow-adjustment" aria-label="本轮调整记录">
              <h3>
                这次做了什么调整？<small>（选填）</small>
              </h3>
              <p>需要记录时，请先填写，再选择照片；上传后会和本轮结果一起保存。</p>
              <label>
                操作类型
                <select value={roundOperation} onChange={(e) => setRoundOperation(e.target.value)}>
                  <option value="view">观察方向</option>
                  <option value="focus">对焦与照明</option>
                  <option value="center">取景与读数轴</option>
                  <option value="repeat">同设置重复测量</option>
                  <option value="other">其他操作</option>
                </select>
              </label>
              <label>
                实际调整
                <input
                  placeholder="例如：重新对焦，保持相机位置不变"
                  value={roundAction}
                  onChange={(e) => setRoundAction(e.target.value)}
                />
              </label>
              <label>
                拍摄或光照变化
                <input value={roundConfounds} onChange={(e) => setRoundConfounds(e.target.value)} />
              </label>
            </section>
          )}
          {retestMode && (
            <div className="retest-banner">
              <span>↻</span>
              <div>
                <b>仪器调整后的复测</b>
                <p>
                  上传后自动分析并记录为下一轮，无需再次点击分析或重建实验。可以选择多张同设置照片，用于检查重复性。
                </p>
              </div>
            </div>
          )}

          <div className="upload-layout">
            <div
              className={`drop-zone ${dragging ? "dragging" : ""} ${preview ? "has-image" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={preview ? "当前牛顿环照片" : "选择牛顿环照片"}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => !preview && fileInput.current?.click()}
              onKeyDown={(event) => {
                if (!preview && (event.key === "Enter" || event.key === " "))
                  fileInput.current?.click();
              }}
            >
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  const files = Array.from(event.target.files ?? []);
                  if (files.length > 8) {
                    setError("每轮最多选择8张照片。");
                    return;
                  }
                  if (files[0]) {
                    updateFile(files[0]);
                    setBatchFiles(files);
                    event.target.value = "";
                    if (retestMode) void analyze(files[0], files);
                  }
                }}
              />
              {preview ? (
                <>
                  <canvas ref={previewCanvas} role="img" aria-label="待分析的牛顿环照片" />
                  <div className="image-actions">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        fileInput.current?.click();
                      }}
                    >
                      更换照片
                    </button>
                    <span>{file?.name}</span>
                  </div>
                </>
              ) : (
                <div className="drop-copy">
                  <span className="upload-icon">↑</span>
                  <h3>拖入照片，或点击选择</h3>
                  <p>支持 JPG / PNG · 最大 12 MB</p>
                  <button type="button">选择圆环照片</button>
                </div>
              )}
            </div>

            <aside className="analysis-options">
              <p className="field-label">
                已选 {batchFiles.length || (file ? 1 : 0)} 张 ·
                同设置可选择多张，分别保存用于重复性检验
              </p>
              <p className="field-label">选择分析方式</p>
              <button
                className={`mode-card ${mode === "empirical" ? "selected" : ""}`}
                type="button"
                onClick={() => {
                  setMode("empirical");
                  setError("");
                }}
              >
                <span className="mode-symbol">ƒ</span>
                <span>
                  <b>经验模型</b>
                  <small>本地特征提取 + 实验公式</small>
                </span>
                <i>{mode === "empirical" ? "✓" : ""}</i>
              </button>
              <button
                className={`mode-card ${mode === "deepseek" ? "selected deepseek" : ""}`}
                type="button"
                onClick={() => {
                  setMode("deepseek");
                  setError("");
                }}
              >
                <span className="mode-symbol ds">DS</span>
                <span>
                  <b>DeepSeek 增强 · 免密钥</b>
                  <small>站点代理复核，用户无需配置</small>
                </span>
                <i>{mode === "deepseek" ? "✓" : ""}</i>
              </button>
              {mode === "deepseek" && (
                <div className="managed-ai-note">
                  <span>✓</span>
                  <p>
                    <b>无需输入任何密钥</b>
                    <small>只提交长短轴比、偏心等量化特征，不上传原始照片。</small>
                  </p>
                </div>
              )}
              <div className="tip-card">
                <b>连续环边追踪与椭圆拟合</b>
                <p>
                  沿同一暗纹中心线进行亚像素定位，用异常点剔除和几何优化拟合；绿色为有效点，红色为剔除点。系统按清晰度、弧段覆盖和拟合残差自动选环，不要求第一级暗环完整。
                </p>
              </div>
              {error && (
                <p className="error-message" role="alert">
                  {error}
                </p>
              )}
              {error && file && (
                <details className="failed-diagnosis" open>
                  <summary>原因排查清单 · 当前照片尚未建立可靠轮廓</summary>
                  <p>
                    可能首先与取景、对焦、遮挡或照明有关；以下原因全部保留供验证，不能从分析失败确认器件损坏。
                  </p>
                  {CAUSES.map((c) => (
                    <article key={c.id}>
                      <h4>{c.title} · 待验证</h4>
                      <p>{c.description}</p>
                      <p>验证方法：{c.advice}</p>
                    </article>
                  ))}
                </details>
              )}
              <button
                className="primary full-button"
                type="button"
                onClick={() => void analyze()}
                disabled={!file || thinking !== null}
              >
                分析圆环 <span>→</span>
              </button>
            </aside>
          </div>
        </section>
      )}

      {step === 2 && metrics && diagnosis && (
        <section className="workspace diagnosis-workspace">
          <div className="diagnosis-hero">
            <div className="image-panel">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={metrics.annotatedImage} alt="已标注拟合椭圆的牛顿环" />
              <span className="image-caption">
                {metrics.fitStatus === "review"
                  ? "候选椭圆 · 待复核"
                  : metrics.damaged
                    ? "轮廓证据不足"
                    : metrics.detectedScreen
                      ? "屏幕内抗干扰迭代拟合"
                      : "抗干扰迭代拟合"}{" "}
                · 质量 {Math.round(metrics.fitQuality * 100)}%
              </span>
              <button
                className="refit-button"
                type="button"
                onClick={() => {
                  setStep(1);
                  setError("");
                }}
              >
                查看原图或更换照片
              </button>
            </div>
            <div className="verdict-panel">
              <p className="eyebrow">ANALYSIS COMPLETE</p>
              <span
                className={`verdict-pill ${diagnosis.causes.includes("damage") ? "danger" : metrics.ratio >= 0.975 ? "good" : "warn"}`}
              >
                {diagnosis.verdict}
              </span>
              <h2>
                {metrics.damaged
                  ? "先复核轮廓，再判断实验误差"
                  : metrics.ratio >= 0.975
                    ? "圆度在可接受范围内"
                    : "检测到可见环形状偏差"}
              </h2>
              <p>{diagnosis.summary}</p>
              <p className="mode-note">
                自动选择清晰暗环，不推断绝对级次。{metrics.ringSelection?.checkedRingCount ?? 0}{" "}
                条清晰环参与复核；中心区域未评估。
              </p>
              {metrics.ellipse && (
                <p className="mode-note">
                  曲线方程（分析图像素）：u²/{metrics.ellipse.semiMajor.toFixed(2)}² + v²/
                  {metrics.ellipse.semiMinor.toFixed(2)}² = 1；u=(x−
                  {metrics.ellipse.centerX.toFixed(2)})cosφ+(y−{metrics.ellipse.centerY.toFixed(2)}
                  )sinφ，v=−(x−{metrics.ellipse.centerX.toFixed(2)})sinφ+(y−
                  {metrics.ellipse.centerY.toFixed(2)})cosφ，φ={metrics.angle.toFixed(2)}°。
                </p>
              )}
              {metrics.fitWarnings?.map((warning) => (
                <p className="mode-note" key={warning}>
                  {warning}
                </p>
              ))}
              {metrics.fitValidation && (
                <p className="mode-note">
                  分区留出检验 ·{" "}
                  {metrics.fitValidation.adopted
                    ? "采用亚像素精修"
                    : "保留原拟合，候选未通过全部检查"}
                  ：{metrics.fitValidation.testedPoints} 个实测点，留出残差{" "}
                  {metrics.fitValidation.beforeHeldOutRms.toFixed(2)} →{" "}
                  {metrics.fitValidation.heldOutRms.toFixed(2)} px；分区轴比范围{" "}
                  {metrics.fitValidation.ratioRange.map((v) => v.toFixed(4)).join("–")}
                  。这是稳定性检验，不代表真值精度或统计置信区间。
                </p>
              )}
              <div className="metric-strip">
                <div>
                  <span>长短轴比</span>
                  <b>{metrics.ratio.toFixed(3)}</b>
                </div>
                <div>
                  <span>拟合质量</span>
                  <b>{Math.round(metrics.fitQuality * 100)}%</b>
                </div>
                <div>
                  <span>轮廓支持度</span>
                  <b>{Math.round(diagnosis.confidence * 100)}%</b>
                </div>
                {metrics.fitResidualPx !== undefined && (
                  <div>
                    <span>拟合残差（分析图像素）</span>
                    <b>{metrics.fitResidualPx.toFixed(2)} px</b>
                  </div>
                )}
                {metrics.fitCoverage !== undefined && (
                  <div>
                    <span>环周分布覆盖</span>
                    <b>{Math.round(metrics.fitCoverage * 100)}%</b>
                  </div>
                )}
                {metrics.fitObservedFraction !== undefined && (
                  <div>
                    <span>有效弧段覆盖</span>
                    <b>{Math.round(metrics.fitObservedFraction * 100)}%</b>
                  </div>
                )}
              </div>
              <small className="mode-note">
                {metrics.damaged
                  ? "轮廓待复核，仍列出完整原因排查与可能项"
                  : mode === "deepseek"
                    ? diagnosis.provider === "deepseek"
                      ? "DeepSeek V4 Flash 已基于量化特征完成复核"
                      : "增强服务未配置或不可用，已采用本地诊断"
                    : "经验模型已完成本地分析"}
              </small>
            </div>
          </div>

          {aiSuggestions.length > 0 && (
            <div className="cause-section ai-advice-section">
              <div className="cause-heading ai-advice-heading">
                <div>
                  <p>
                    <span>调</span> INSTRUMENT ADJUSTMENT
                  </p>
                  <h3>仪器调整建议</h3>
                  <strong>
                    请选择与现场现象相符的建议；系统提供辅助判断，最终原因由你结合装调情况确认。
                  </strong>
                </div>
                <span>全部常见原因 · 优先验证 3 项</span>
              </div>
              <div className="cause-grid ai-advice-grid">
                {aiSuggestions.map((cause, index) => (
                  <button
                    type="button"
                    key={cause.id}
                    className={`cause-card advice-card ${selectedCauses.includes(cause.id) ? "selected" : ""} ${cause.id === "damage" ? "damage" : ""}`}
                    onClick={() => toggleCause(cause.id)}
                  >
                    <span className="cause-index">建议 {String(index + 1).padStart(2, "0")}</span>
                    <span
                      className={`advice-probability ${cause.probability >= 35 ? "high" : cause.probability >= 18 ? "medium" : "low"}`}
                    >
                      <b>{cause.status}</b>
                      <small>排查优先级 {cause.score}/100</small>
                    </span>
                    <span className="cause-check">
                      {selectedCauses.includes(cause.id) ? "✓" : "+"}
                    </span>
                    <b>{cause.title}</b>
                    <small>{cause.description}</small>
                    <p className="cause-evidence">
                      <span>本图证据</span>
                      {cause.evidence}
                    </p>
                    <p>
                      <span>调整建议</span>
                      {cause.advice}
                    </p>
                    <em>
                      {selectedCauses.includes(cause.id)
                        ? cause.recommended
                          ? "优先验证 · 已记录"
                          : "已记录为待验证原因"
                        : "点击选择并结合现场复核"}
                    </em>
                  </button>
                ))}
              </div>
              <p className="probability-note">
                完整列出形状、成像、受力与读数原因。优先级只决定排查顺序，不是故障概率；“可能相关”不等于已确认。形状待复核时仍给出排查方法，选中原因不改变原始读数。
              </p>
            </div>
          )}

          {diagnosticDetail && (
            <div className="analysis-section compact-analysis-section">
              <div className="analysis-heading">
                <div>
                  <p>量化依据摘要</p>
                  <h3>这次判断依据了什么</h3>
                </div>
                <span>关键证据已整合，减少重复信息</span>
              </div>
              <div className={`analysis-summary-card ${metrics.damaged ? "danger" : ""}`}>
                <div className="summary-metrics">
                  <div>
                    <span>长短轴比</span>
                    <b>{metrics.ratio.toFixed(3)}</b>
                  </div>
                  <div>
                    <span>偏离正圆</span>
                    <b>{diagnosticDetail.circularDeviation.toFixed(2)}%</b>
                  </div>
                  <div>
                    <span>拟合质量</span>
                    <b>{Math.round(metrics.fitQuality * 100)}%</b>
                  </div>
                  <div>
                    <span>环边清晰度</span>
                    <b>{Math.round(metrics.clarity * 100)}%</b>
                  </div>
                  <div>
                    <span>四象限对称度</span>
                    <b>{Math.round(diagnosticDetail.symmetry * 100)}%</b>
                  </div>
                </div>
                <div className="summary-explanation">
                  <p>
                    <b>几何结论</b>
                    <span>
                      {diagnosticDetail.orientation}；正圆判据为 q ≥ 0.975，环心偏移{" "}
                      {(metrics.centerOffset * 100).toFixed(1)}%。
                    </span>
                  </p>
                  <p>
                    <b>成像复核</b>
                    <span>
                      {metrics.detectedScreen
                        ? "已定位有效成像区并排除屏幕边框。"
                        : "未识别到独立显示器边界，已按完整照片分析。"}
                    </span>
                  </p>
                  <p>
                    <b>诊断依据</b>
                    <span>
                      {diagnosticDetail.evidence
                        .map((item) => `${item.label}：${item.text}`)
                        .join("；")}
                    </span>
                  </p>
                </div>
                <div className="summary-decision">
                  <span>下一步建议</span>
                  <b>{diagnosticDetail.restorationTitle}</b>
                  <p>{diagnosticDetail.restorationText}</p>
                  <small>
                    {"自动多环筛选与轮廓复核"} ·{" "}
                    {metrics.damaged
                      ? "待复核轮廓"
                      : mode === "deepseek"
                        ? "DeepSeek 特征复核"
                        : "经验公式判断"}
                  </small>
                </div>
              </div>
            </div>
          )}

          {selectedCauses.includes("calibration") && (
            <div className="inline-parameter">
              <div>
                <b>水平标尺标定系数 k</b>
                <span>实际长度 ÷ 仪器记录长度，须来自独立标尺</span>
              </div>
              <input
                aria-label="水平标尺标定系数"
                type="number"
                min="0.5"
                max="1.5"
                step="0.000001"
                value={calibration}
                onChange={(event) => setCalibration(event.target.value)}
              />
            </div>
          )}

          {activeSession ? (
            <ExperimentFlow
              embedded
              notice={recordNotice}
              session={activeSession}
              onChange={(s) => {
                receiveSession(s);
                setWavelength(String(s.profile.wavelengthNm));
              }}
              onResume={(s) => {
                receiveSession(s);
                setWavelength(String(s.profile.wavelengthNm));
                startRetest();
              }}
              onClose={() => {}}
            />
          ) : (
            recordNotice && (
              <p className="flow-save-note" role="status">
                {recordNotice}
              </p>
            )
          )}

          <div className="action-bar">
            <div className="correction-summary">
              <span>当前综合修正系数</span>
              <b>× {correction.total.toFixed(5)}</b>
              <small>
                {correction.parts.length
                  ? "仅应用独立长度标定；不使用图像几何补偿"
                  : "保留原始直径"}
              </small>
            </div>
            <div className="diagnosis-actions">
              <button className="secondary retest-action" type="button" onClick={startRetest}>
                按建议调整，重新拍照 ↻
              </button>
              <button className="primary" type="button" onClick={goToData}>
                环真还原 <span>→</span>
              </button>
            </div>
          </div>
        </section>
      )}

      {step === 3 && !reportReady && (
        <section className="workspace data-workspace">
          <div className="section-heading compact-heading">
            <span className="section-number">03</span>
            <div>
              <p>实验数据</p>
              <h2>输入各级圆环的水平直径</h2>
              <span>
                填写你已完成的仪器读数，单位为 mm。波长与级次差为可修改的初始参数，请按本次实验确认。
              </span>
            </div>
          </div>

          <div className="data-card">
            <div className="data-card-top">
              <div>
                <b>
                  水平直径 D<sub>m</sub>
                </b>
                <span>请填测微显微镜左右读数之差</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setValues(DEMO_DATA);
                  setReportReady(false);
                }}
              >
                载入实验报告示例
              </button>
            </div>
            <div className="diameter-grid">
              {ORDERS.map((order) => (
                <label key={order}>
                  <span>
                    {order}
                    <small>级</small>
                  </span>
                  <div>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      inputMode="decimal"
                      placeholder="0.000"
                      value={values[order]}
                      onChange={(event) => {
                        setValues((current) => ({ ...current, [order]: event.target.value }));
                        setReportReady(false);
                      }}
                    />
                    <em>mm</em>
                  </div>
                </label>
              ))}
            </div>
            <p className="demo-note">
              示例中的 15–40 级来自所附实验报告；5、10 级仅为演示补值，正式结果请替换为实测值。
            </p>
          </div>

          <div className="parameter-row">
            <label>
              <span>独立长度系数 k（需勾选标尺比例）</span>
              <div>
                <input
                  disabled={!selectedCauses.includes("calibration")}
                  aria-label="独立长度标定系数"
                  type="number"
                  min="0.5"
                  max="1.5"
                  step="0.000001"
                  value={calibration}
                  onChange={(event) => setCalibration(event.target.value)}
                />
                <em>—</em>
              </div>
            </label>
            <label>
              <span>光源波长 λ</span>
              <div>
                <input
                  type="number"
                  min="300"
                  max="1000"
                  step="0.1"
                  value={wavelength}
                  onChange={(event) => setWavelength(event.target.value)}
                />
                <em>nm</em>
              </div>
            </label>
            <label>
              <span>级次差 Δm</span>
              <div>
                <input
                  type="number"
                  min="5"
                  max="35"
                  step="5"
                  value={interval}
                  onChange={(event) => setInterval(event.target.value)}
                />
                <em>级</em>
              </div>
            </label>
            <label>
              <span>介质折射率</span>
              <div>
                <input
                  type="number"
                  min="1"
                  max="2"
                  step="0.001"
                  value={refractiveIndex}
                  onChange={(event) => setRefractiveIndex(event.target.value)}
                />
                <em>—</em>
              </div>
            </label>
            <div className="factor-summary">
              <span>本次采用的长度系数</span>
              <b>k = {correction.total.toFixed(6)}</b>
              <small>由独立标尺提供；未启用时为 1</small>
            </div>
          </div>

          <p className="mode-note">
            长度系数 k 须来自标准刻尺等独立标定，未标定时保持
            1。照片用于形状诊断，不给选中暗环指定第一级。以下直径须对应你记录的级次或已知相对级次差：Dₘ²
            = 4Rλ(m+ε)/n，R =
            n·ΔD²/(4λ·Δm)。共同级次偏移由回归截距吸收；漏数造成的级次差错误不能自动修复。
          </p>
          {correction.parts.length > 0 && (
            <div className="formula-trace">
              <span>修正链</span>
              {correction.parts.map((part) => (
                <b key={part.name}>
                  {part.name} × {part.factor.toFixed(5)}
                </b>
              ))}
              <em>→ D₀ = {correction.total.toFixed(5)}D</em>
            </div>
          )}
          {error && (
            <p className="error-message centered" role="alert">
              {error}
            </p>
          )}
          <div className="bottom-actions">
            <button className="secondary" type="button" onClick={() => setStep(2)}>
              ← 返回诊断
            </button>
            <button className="primary" type="button" onClick={calculate}>
              生成还原报告 <span>→</span>
            </button>
          </div>
        </section>
      )}

      {step === 3 && reportReady && !thinking && (
        <section className="workspace report-workspace">
          <div className="report-titlebar">
            <div>
              <p className="eyebrow">RESTORATION COMPLETE</p>
              <h2>数据还原结果</h2>
              <span>
                {diagnosis?.verdict} ·{" "}
                {selectedCauses.length ? `${selectedCauses.length} 项原因待验证` : "未启用额外修正"}
              </span>
            </div>
            <div className="report-buttons">
              <button type="button" onClick={copyReport}>
                {copied ? "已复制 ✓" : "复制摘要"}
              </button>
              <button type="button" onClick={downloadCsv}>
                下载 CSV
              </button>
              <button className="primary" type="button" onClick={() => window.print()}>
                打印报告
              </button>
            </div>
          </div>

          <div className="result-cards">
            <article className="main-result">
              <span>还原曲率估计 · 逐差法</span>
              <div>
                <b>{fmt(results.radius, 3)}</b>
                <em>m</em>
              </div>
              <p>
                R = {fmt(results.radius, 3)} ± {fmt(results.radiusUncertainty, 3)} m
              </p>
            </article>
            <article>
              <span>全数据回归半径</span>
              <b>{fmt(results.regressionRadius, 3)}</b>
              <em>m · 用于方法间复核</em>
            </article>
            <article>
              <span>长度标定系数</span>
              <b>{fmt(correction.total, 4)}</b>
              <em>来自独立长度标定</em>
            </article>
            <article>
              <span>数据拟合一致性</span>
              <b>{fmt(results.rSquared, 4)}</b>
              <em>R²</em>
            </article>
          </div>

          <PhysicalRegressionPanel
            readings={ORDERS.filter((o) => Number(values[o]) > 0).map((o) => ({
              order: o,
              diameter: Number(values[o]),
            }))}
            wavelengthNm={Number(wavelength)}
            refractiveIndex={Number(refractiveIndex)}
            factor={restorationPlan.factor}
          />
          <section className="report-analysis" aria-label="实验结果解读">
            <div className="report-analysis-title">
              <div>
                <p>辅助结果解读</p>
                <h3>结果解读</h3>
              </div>
              <em>结果基于用户实测数据与物理模型，请结合现场条件复核</em>
            </div>
            <div className="report-analysis-grid">
              <article>
                <div>
                  <b>基于实测数据的条件还原</b>
                  <p>
                    系统处理你提供的直径与级次，不从照片代替仪器读数。结果由实验参数、独立长度系数和所用模型共同确定，是当前条件下的曲率估计。器材真实半径未知，因此不计算相对真值误差或精度提升比例。
                  </p>
                </div>
              </article>
              <article>
                <div>
                  <b>数据一致性 · {resultInsight.fitLevel}</b>
                  <p>
                    线性拟合 R² = <strong>{fmt(results.rSquared, 4)}</strong>
                    ，组间离散对应的相对不确定度约{" "}
                    <strong>{fmt(resultInsight.uncertaintyRatio, 2)}%</strong>
                    。它描述数据离散，不表示接近真实值的程度。
                    {resultInsight.conclusion}
                  </p>
                </div>
              </article>
            </div>
          </section>

          <div className="report-grid">
            <div className="report-table-card wide">
              <div className="table-title">
                <div>
                  <b>数据记录与处理</b>
                  <span>由水平直径自动生成</span>
                </div>
                <span>单位：mm / mm²</span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>m（级）</th>
                      {results.rows
                        .filter((row) => row.valid)
                        .map((row) => (
                          <th key={row.order}>{row.order}</th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th>原始 D</th>
                      {results.rows
                        .filter((row) => row.valid)
                        .map((row) => (
                          <td key={row.order}>{fmt(row.original)}</td>
                        ))}
                    </tr>
                    <tr className="highlight-row">
                      <th>还原 D₀</th>
                      {results.rows
                        .filter((row) => row.valid)
                        .map((row) => (
                          <td key={row.order}>{fmt(row.restored)}</td>
                        ))}
                    </tr>
                    <tr>
                      <th>D₀²</th>
                      {results.rows
                        .filter((row) => row.valid)
                        .map((row) => (
                          <td key={row.order}>{fmt(row.square)}</td>
                        ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="report-table-card">
              <div className="table-title">
                <div>
                  <b>逐差法</b>
                  <span>已知级差的平方差计算</span>
                </div>
                <span>Δm = {interval}</span>
              </div>
              <div className="difference-list">
                {results.pairs.map((pair) => (
                  <div key={`${pair.low}-${pair.high}`}>
                    <span>
                      D<sub>{pair.high}</sub>² − D<sub>{pair.low}</sub>²
                    </span>
                    <b>{fmt(pair.difference, 3)}</b>
                  </div>
                ))}
                <div className="mean-line">
                  <span>平均值</span>
                  <b>{fmt(results.meanDifference, 3)} mm²</b>
                </div>
              </div>
            </div>

            <div className="calculation-card">
              <div>
                <p>曲率半径</p>
                <b>
                  R̄ = n介质 ·{" "}
                  <span>
                    D̄²<sub>m+Δm</sub> − D̄²<sub>m</sub>
                  </span>{" "}
                  / (4Δmλ)
                </b>
              </div>
              <div className="calc-values">
                <span>逐差法 R</span>
                <b>{fmt(results.radius, 4)} m</b>
                <span>组间离散估算 ΔR</span>
                <b>{fmt(results.radiusUncertainty, 4)} m</b>
                <span>线性拟合复核 R</span>
                <b>{fmt(results.regressionRadius, 4)} m</b>
              </div>
              <small>
                ΔR 按逐差样本离散及 Student-t
                因子估算，尚未包含尺度、波长及模型偏差；逐差组相关时不代表严格的 95%
                覆盖区间，也不表示相对真值误差。
              </small>
            </div>
          </div>

          <p className="report-footnote">
            曲率半径来自输入直径与已知级差。图像只提供形状证据；尺度、波长和模型偏差仍需独立评估。请结合原始记录使用结果。
          </p>
          <div className="restart-bar">
            <div>
              <b>还要分析另一组实验吗？</b>
              <span>实验记录保存在当前浏览器，可查看历史或开始新实验。</span>
            </div>
            <button className="primary" type="button" onClick={reset}>
              回到首页，再次使用 ↻
            </button>
          </div>
        </section>
      )}

      {thinking && (
        <div className="thinking-overlay" role="status" aria-live="polite">
          <div
            className={`thinking-card ${mode === "deepseek" && thinking === "analysis" ? "ds-thinking" : ""}`}
          >
            {mode === "deepseek" && thinking === "analysis" ? (
              <div className="ds-orb">
                DS
                <span />
                <span />
              </div>
            ) : (
              <div className="orbit-loader">
                <i />
                <i />
                <i />
              </div>
            )}
            <p>
              {mode === "deepseek" && thinking === "analysis"
                ? "正在请求 DeepSeek 复核"
                : thinking === "analysis"
                  ? "模型正在分析圆环"
                  : "模型正在还原数据"}
            </p>
            <span>
              {thinking === "analysis"
                ? "提取轮廓、长短轴、偏心与清晰度"
                : "合成修正系数并执行逐差计算"}
            </span>
            <div className="thinking-dots">
              <i />
              <i />
              <i />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
