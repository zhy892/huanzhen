"use client";

import type { Session, Round, Sample } from "../core/experiment";
import { recommend } from "../core/experiment";
import { saveSession, getSession } from "../lib/experiment-store";
import { newRecordId, imageFingerprint } from "../core/recording";
import ExperimentFlow from "../components/experiment-flow";
import { ChangeEvent, DragEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";

import { CauseId, Mode, ImageMetrics, AiDiagnosis, FitPoint, ORDERS, STANDARD_RADIUS, CALIBRATION_STRENGTH, MAX_RECOMMENDED_CAUSES, CAUSES, DEMO_DATA, clamp, wait, fmt, builtinDiagnosis, buildAiSuggestions, fitEllipseFromPoints, inspectImage, axisProjectionFactor, calculationT } from "../core/analysis";

export default function Home() {
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const [showRecords, setShowRecords] = useState(false);
  const [roundAction, setRoundAction] = useState("");
  const [roundOperation, setRoundOperation] = useState("repeat");
  const [roundConfounds, setRoundConfounds] = useState("");
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [recordNotice, setRecordNotice] = useState("");
  function receiveSession(s: Session) { sessionRef.current = s; setActiveSession(s); try {sessionStorage.setItem("huanzhen-active-session",s.id);} catch { /* The saved IndexedDB record remains available from history. */ } }
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [mode, setMode] = useState<Mode>("empirical");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [metrics, setMetrics] = useState<ImageMetrics | null>(null);
  const [diagnosis, setDiagnosis] = useState<AiDiagnosis | null>(null);
  const [selectedCauses, setSelectedCauses] = useState<CauseId[]>([]);
  const [selectingRing, setSelectingRing] = useState(false);
  const [targetPoint, setTargetPoint] = useState<FitPoint | null>(null);
  const [manualFit, setManualFit] = useState(false);
  const [fitPoints, setFitPoints] = useState<FitPoint[]>([]);
  const [thinking, setThinking] = useState<"analysis" | "restore" | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [wavelength, setWavelength] = useState("589.3");
  const [refractiveIndex, setRefractiveIndex] = useState("1.000");
  const [interval, setInterval] = useState("15");
  const [calibration, setCalibration] = useState("1.0000");
  const [autoCalibration, setAutoCalibration] = useState(false);
  const [values, setValues] = useState<Record<number, string>>(() => Object.fromEntries(ORDERS.map((order) => [order, ""])));
  const [copied, setCopied] = useState(false);
  const [reportReady, setReportReady] = useState(false);
  const [retestMode, setRetestMode] = useState(false);
  useEffect(() => {
    let cancelled=false;
    const tool = new URLSearchParams(window.location.search).get("tool");
    let id:string|null=null;
    try { id=sessionStorage.getItem("huanzhen-active-session"); } catch { /* Resume is optional when session storage is unavailable. */ }
    const load=id ? getSession(id) : Promise.resolve(null);
    void load.then(saved=>{
      if(cancelled) return;
      if(saved && saved.profile.kind !== "simulation") receiveSession(saved);
      if(tool==="records") setShowRecords(true);
    }).catch(()=>{ if(!cancelled) setRecordNotice("当前浏览器无法恢复实验记录，请检查存储权限。"); });
    return ()=>{cancelled=true;};
  }, []);
  useEffect(() => {
    if (!showRecords) return;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const overlay = document.querySelector<HTMLElement>(".flow-overlay");
    const controls = () => Array.from(overlay?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]') ?? []).filter(e => e.getClientRects().length > 0);
    controls()[0]?.focus();
    const keyboard = (e: KeyboardEvent) => {
      if(e.key === "Escape") { setShowRecords(false); }
      if(e.key === "Tab") { const all=controls(); const first=all[0],last=all.at(-1); if(e.shiftKey && document.activeElement===first) {e.preventDefault();last?.focus();} else if(!e.shiftKey && document.activeElement===last) {e.preventDefault();first?.focus();} }
    };
    document.addEventListener("keydown",keyboard);
    return () => {document.body.style.overflow=oldOverflow; document.removeEventListener("keydown",keyboard);previous?.focus();};
  }, [showRecords]);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewCanvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!preview || !previewCanvas.current) return;
    const canvas = previewCanvas.current;
    const context = canvas.getContext("2d");
    if (!context) return;
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      if(targetPoint) {
        context.strokeStyle="#f2a43a";context.lineWidth=2;context.beginPath();context.arc(targetPoint.x*canvas.width,targetPoint.y*canvas.height,8,0,2*Math.PI);context.stroke();
      }
      if (!fitPoints.length) return;
      const fit = fitEllipseFromPoints(fitPoints, canvas.width, canvas.height);
      if (fit) {
        context.save();
        context.strokeStyle = "rgba(201, 239, 99, .95)";
        context.lineWidth = Math.max(2, canvas.width / 450);
        context.setLineDash([10, 7]);
        context.beginPath();
        context.ellipse(fit.centerX, fit.centerY, fit.semiMajor, fit.semiMinor, (fit.angle * Math.PI) / 180, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
      fitPoints.forEach((point, index) => {
        const x = point.x * canvas.width;
        const y = point.y * canvas.height;
        context.beginPath();
        context.arc(x, y, Math.max(6, canvas.width / 150), 0, Math.PI * 2);
        context.fillStyle = "#c9ef63";
        context.fill();
        context.fillStyle = "#15211e";
        context.font = `800 ${Math.max(8, canvas.width / 130)}px system-ui`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(String(index + 1), x, y);
      });
    };
    image.src = preview;
  }, [preview, fitPoints, targetPoint]);

  const correction = useMemo(() => {
    if (!metrics || metrics.damaged) return { total: 1, parts: [] as Array<{ name: string; factor: number; formula: string }> };
    const parts: Array<{ name: string; factor: number; formula: string }> = [];
    const ellipseCount = Number(selectedCauses.includes("tilt")) + Number(selectedCauses.includes("pressure"));
    const sharedRatio = ellipseCount > 1 ? metrics.ratio ** (1 / ellipseCount) : metrics.ratio;
    if (selectedCauses.includes("tilt")) {
      parts.push({ name: "倾斜投影", factor: axisProjectionFactor(sharedRatio, metrics.angle), formula: "√(cos²φ + sin²φ/q²)" });
    }
    if (selectedCauses.includes("pressure")) {
      parts.push({
        name: "受力等面积",
        factor: Math.sqrt(sharedRatio) * axisProjectionFactor(sharedRatio, metrics.angle),
        formula: "√q · √(cos²φ + sin²φ/q²)",
      });
    }
    if (selectedCauses.includes("decenter")) {
      parts.push({ name: "偏心弦长", factor: Math.sqrt(1 + metrics.centerOffset ** 2), formula: "√(1 + (2e/D)²)" });
    }
    if (autoCalibration || selectedCauses.includes("calibration")) {
      parts.push({
        name: autoCalibration ? "标准半径辅助标定" : "标尺标定",
        factor: clamp(Number(calibration) || 1, 0.5, 1.5),
        formula: autoCalibration ? "k = (R₀/R标定前)^(α/2)，α=0.96" : "k",
      });
    }
    return { total: parts.reduce((total, part) => total * part.factor, 1), parts };
  }, [metrics, selectedCauses, calibration, autoCalibration]);

  const diagnosticDetail = useMemo(() => {
    if (!metrics || !diagnosis) return null;
    const circularDeviation = Math.max(0, (1 - metrics.ratio) * 100);
    const eccentricity = Math.sqrt(Math.max(0, 1 - metrics.ratio ** 2));
    const absoluteAngle = Math.abs(metrics.angle);
    const orientation = metrics.ratio>.995 ? "接近正圆，主轴方向不稳定，不作方向归因" : absoluteAngle < 10
      ? "长轴近水平方向"
      : Math.abs(absoluteAngle - 90) < 10
        ? "长轴近垂直方向"
        : metrics.angle > 0
          ? `长轴向右下倾斜 ${absoluteAngle.toFixed(1)}°`
          : `长轴向右上倾斜 ${absoluteAngle.toFixed(1)}°`;
    const causeEvidence: Record<CauseId, string> = {
      tilt: `q = ${metrics.ratio.toFixed(3)}，${orientation}；${metrics.asymmetry < 0.34 ? "四象限响应较均匀，更接近投影压缩" : "同时存在方向不对称，需与受力因素联合复核"}。`,
      pressure: `四象限边缘不对称度为 ${(metrics.asymmetry * 100).toFixed(1)}%，环宽或亮度方向差异支持接触面受力不均的可能。`,
      decenter: `拟合环心偏离有效成像区中心 ${(metrics.centerOffset * 100).toFixed(1)}%，测量线可能没有穿过真实环心。`,
      calibration: `${orientation}且长短轴比例存在差异，应使用标准长度复核横、纵标尺比例。`,
      damage: `连续环边拟合质量仅 ${Math.round(metrics.fitQuality * 100)}%，轮廓不足以满足经验还原的闭合与可辨认前提。`,
    };
    const evidence = metrics.damaged ? [{label:"轮廓复核",text:"当前形状参数仅供核对目标环，暂不据此推断仪器误差。"}] : diagnosis.causes.length
      ? diagnosis.causes.map((cause) => ({ label: CAUSES.find((item) => item.id === cause)?.short || cause, text: causeEvidence[cause] }))
      : [{ label: "未见系统偏差", text: "长短轴差异处于正圆阈值内，当前照片未给出需要强制修正的量化证据。" }];
    const restorationTitle = metrics.damaged
      ? "先确认候选轮廓"
      : metrics.ratio >= 0.975
        ? "可保留原始水平直径"
        : "可在现场复核后组合还原";
    const restorationText = metrics.damaged
      ? "先确认虚线是否沿同一条暗环；可点选目标环或手动取点复核。若环纹被裁切或遮挡，建议补拍，本轮仍保留在实验记录中。"
      : selectedCauses.length
        ? `当前选择 ${selectedCauses.length} 项原因，预估综合直径修正系数为 × ${correction.total.toFixed(5)}；进入数据页前仍应与实际装调现象核对。`
        : "当前无需启用额外几何修正；仍建议保留原始读数和照片，便于实验报告复核。";
    return {
      circularDeviation,
      eccentricity,
      orientation,
      symmetry: clamp(1 - metrics.asymmetry, 0, 1),
      evidence,
      restorationTitle,
      restorationText,
    };
  }, [metrics, diagnosis, selectedCauses, correction.total]);

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
        .map((row) => ({ low: row.order, high: row.order + n, difference: byOrder.get(row.order + n)!.square - row.square }));
    }
    const meanDifference = pairs.length ? pairs.reduce((sum, pair) => sum + pair.difference, 0) / pairs.length : Number.NaN;
    const sampleDeviation =
      pairs.length > 1
        ? Math.sqrt(pairs.reduce((sum, pair) => sum + (pair.difference - meanDifference) ** 2, 0) / (pairs.length - 1))
        : Number.NaN;
    const expandedDifference = pairs.length > 1 ? (calculationT(pairs.length) * sampleDeviation) / Math.sqrt(pairs.length) : Number.NaN;
    const lambda = Number(wavelength);
    const mediumIndex = Number(refractiveIndex);
    const radius = (meanDifference * 1e-6 * mediumIndex) / (4 * n * lambda * 1e-9);
    const radiusUncertainty = Math.abs(radius * (expandedDifference / meanDifference));

    const validRows = rows.filter((row) => row.valid);
    const meanOrder = validRows.reduce((sum, row) => sum + row.order, 0) / Math.max(1, validRows.length);
    const meanSquare = validRows.reduce((sum, row) => sum + row.square, 0) / Math.max(1, validRows.length);
    const slopeNumerator = validRows.reduce((sum, row) => sum + (row.order - meanOrder) * (row.square - meanSquare), 0);
    const slopeDenominator = validRows.reduce((sum, row) => sum + (row.order - meanOrder) ** 2, 0);
    const slope = slopeNumerator / slopeDenominator;
    const regressionRadius = (slope * 1e-6 * mediumIndex) / (4 * lambda * 1e-9);
    const ssTotal = validRows.reduce((sum, row) => sum + (row.square - meanSquare) ** 2, 0);
    const intercept = meanSquare - slope * meanOrder;
    const ssResidual = validRows.reduce((sum, row) => sum + (row.square - (intercept + slope * row.order)) ** 2, 0);
    const rSquared = 1 - ssResidual / ssTotal;
    return { rows, pairs, meanDifference, sampleDeviation, expandedDifference, radius, radiusUncertainty, regressionRadius, rSquared };
  }, [values, correction.total, interval, wavelength, refractiveIndex]);

  useEffect(() => {
    if (!autoCalibration || !Number.isFinite(results.radius) || results.radius <= 0) return;
    const currentFactor = clamp(Number(calibration) || 1, 0.5, 1.5);
    const preCalibrationRadius = results.radius / (currentFactor ** 2);
    if (!Number.isFinite(preCalibrationRadius) || preCalibrationRadius <= 0) return;
    const nextFactor = clamp((STANDARD_RADIUS / preCalibrationRadius) ** (CALIBRATION_STRENGTH / 2), 0.5, 1.5);
    const nextValue = nextFactor.toFixed(6);
    if (nextValue !== calibration) {
      const updateTimer = window.setTimeout(() => {
        setCalibration(nextValue);
        setReportReady(false);
      }, 0);
      return () => window.clearTimeout(updateTimer);
    }
  }, [autoCalibration, calibration, results.radius]);

  const calibrationInsight = useMemo(() => {
    const factor = autoCalibration ? clamp(Number(calibration) || 1, 0.5, 1.5) : 1;
    const beforeRadius = autoCalibration && Number.isFinite(results.radius) ? results.radius / (factor ** 2) : results.radius;
    const beforeRelativeError = Number.isFinite(beforeRadius)
      ? Math.abs(beforeRadius - STANDARD_RADIUS) / STANDARD_RADIUS * 100
      : Number.NaN;
    const afterRelativeError = Number.isFinite(results.radius)
      ? Math.abs(results.radius - STANDARD_RADIUS) / STANDARD_RADIUS * 100
      : Number.NaN;
    const accuracyImprovement = Number.isFinite(beforeRelativeError) && beforeRelativeError > 1e-12
      ? clamp((beforeRelativeError - afterRelativeError) / beforeRelativeError * 100, 0, 100)
      : 0;
    return { factor, beforeRadius, beforeRelativeError, afterRelativeError, accuracyImprovement };
  }, [autoCalibration, calibration, results.radius]);

  const levelComparisons = useMemo(() => {
    const lambda = Number(wavelength) * 1e-9;
    const mediumIndex = Number(refractiveIndex);
    if (!Number.isFinite(lambda) || lambda <= 0 || !Number.isFinite(mediumIndex)) return [];
    return results.rows
      .filter((row) => row.valid && row.order >= 15)
      .slice(0, 6)
      .map((row) => {
        const originalRadius = (row.original ** 2 * 1e-6 * mediumIndex) / (4 * row.order * lambda);
        const restoredRadius = (row.restored ** 2 * 1e-6 * mediumIndex) / (4 * row.order * lambda);
        return {
          order: row.order,
          originalRadius,
          originalError: Math.abs(originalRadius - STANDARD_RADIUS) / STANDARD_RADIUS * 100,
          restoredRadius,
          restoredError: Math.abs(restoredRadius - STANDARD_RADIUS) / STANDARD_RADIUS * 100,
        };
      });
  }, [results.rows, wavelength, refractiveIndex]);

  const comparisonSummary = useMemo(() => {
    if (!levelComparisons.length) return { originalMeanError: Number.NaN, restoredMeanError: Number.NaN, improvement: Number.NaN };
    const originalMeanError = levelComparisons.reduce((sum, row) => sum + row.originalError, 0) / levelComparisons.length;
    const restoredMeanError = levelComparisons.reduce((sum, row) => sum + row.restoredError, 0) / levelComparisons.length;
    const improvement = originalMeanError > 0
      ? clamp((originalMeanError - restoredMeanError) / originalMeanError * 100, 0, 100)
      : 0;
    return { originalMeanError, restoredMeanError, improvement };
  }, [levelComparisons]);

  const resultInsight = useMemo(() => {
    const uncertaintyRatio = Number.isFinite(results.radiusUncertainty) && results.radius
      ? Math.abs(results.radiusUncertainty / results.radius) * 100
      : Number.NaN;
    const correctionShift = Math.abs(correction.total - 1) * 100;
    const fitLevel = results.rSquared >= 0.995 ? "高度一致" : results.rSquared >= 0.98 ? "基本一致" : "存在离散";
    const conclusion = results.rSquared >= 0.98 && uncertaintyRatio <= 5
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
    setSelectingRing(false);setTargetPoint(null);
    setManualFit(false);
    setFitPoints([]);
    setError("");
  }

  function addFitPoint(event: MouseEvent<HTMLCanvasElement>) {
    if ((!manualFit && !selectingRing) || !previewCanvas.current) return;
    const rect = previewCanvas.current.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    if(selectingRing) {setTargetPoint({x,y});setSelectingRing(false);setError("");return;}
    setFitPoints((current) => [...current, { x, y }].slice(0, 32));
    setError("");
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const files=Array.from(event.dataTransfer.files);
    if(files.length>8) {setError("每轮最多选择8张照片。");return;}
    if (files[0]) {updateFile(files[0]);setBatchFiles(files);if(retestMode) void analyze(files[0],files,true);}
  }

  async function analyze(chosenFile: File | null = file, chosenBatch: File[] = batchFiles, automatic = false) {
    if (!chosenFile) {
      setError("请先上传牛顿环照片。");
      return;
    }
    if (!automatic && manualFit && fitPoints.length < 5) {
      setError("精准拟合至少需要沿同一条清晰圆环点击 5 个点；建议均匀点击 6–10 个点。");
      return;
    }
    if (chosenBatch.some(f=>!f.type.startsWith("image/") || f.size>12*1024*1024)) {setError("请上传每张不超过12 MB的图片。");return;}
    setError("");
    setThinking("analysis");
    try {
      const measured = await inspectImage(chosenFile, !automatic && manualFit ? fitPoints : [], true, !automatic ? targetPoint ?? undefined : undefined);
      let nextDiagnosis = builtinDiagnosis(measured);
      if (mode === "deepseek" && !measured.damaged) {
        const response = await fetch("/api/deepseek", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metrics: {ratio:measured.ratio,angle:measured.angle,centerOffset:measured.centerOffset,clarity:measured.clarity,asymmetry:measured.asymmetry,fitQuality:measured.fitQuality,confidence:measured.confidence,damaged:measured.damaged} }),
        });
        const payload = await response.json() as AiDiagnosis & { error?: string };
        if (!response.ok) throw new Error(payload.error || "增强诊断暂时没有返回结果");
        nextDiagnosis = payload;
      } else {
        await wait(900);
      }
      try {
        const samples: Sample[] = [];
        const sources = chosenBatch.length ? chosenBatch : [chosenFile];
        for (let i=0; i<sources.length; i++) {
          const source=sources[i];
          const hash=await imageFingerprint(source);
          const result=i===0 ? measured : await inspectImage(source, [], false);
          const { annotatedImage, ...observation }=result; void annotatedImage;
          samples.push({ id:newRecordId(), contentHash:hash, image:source, name:source.name, metrics:observation });
        }
        const current=sessionRef.current;
        const existing=current && current.profile.kind !== "simulation" ? current : null;
        const known=new Set(existing?.rounds.flatMap(r=>r.samples.map(s=>s.contentHash ?? s.id)) ?? []);
        for(const sample of samples) {const hash=sample.contentHash!;sample.reused=known.has(hash);known.add(hash);}
          const base:Session=existing ?? { version:1, id:newRecordId(), created:new Date().toISOString(), profile:{ kind:"experiment", name:`牛顿环实验 ${new Date().toLocaleString()}`,instrument:"未填写", wavelengthNm:Number(wavelength)||589.3,resolutionMm:.001,pixelPerMm:null,conditions:"未记录",diameterFactor:1,factorUncertainty:0 }, rounds:[],declarations:[],restorations:[] };
          const round:Round={ id:newRecordId(),time:new Date().toISOString(),algorithmVersion:"ring-v3",operation:existing ? (roundAction.trim() ? roundOperation : "unrecorded") : "repeat", action:existing ? roundAction.trim() || "调整后复测" : "首次分析，建立基线",confounds:roundConfounds.trim(),samples, readings:ORDERS.filter(o=>Number(values[o])>0).map(o=>({order:o,diameter:Number(values[o])})),recommendation:recommend(samples) };
          receiveSession(await saveSession({...base,rounds:[...base.rounds,round]}));
          const duplicates=samples.filter(s=>s.reused).length;
          setRecordNotice(`已自动保存第 ${base.rounds.length+1} 轮，后续复测将继续记录在同一次实验。${duplicates ? `其中 ${duplicates} 张与已有照片重复，已保留曲线记录，但不计为新的独立测量。` : ""}`);
      } catch(e) { setRecordNotice(`分析已完成，记录未保存：${e instanceof Error ? e.message : "请检查浏览器存储"}`); }
      setMetrics(measured);
      setDiagnosis(nextDiagnosis);
      setSelectedCauses(buildAiSuggestions(measured, nextDiagnosis).filter((item) => item.recommended).map((item) => item.id));
      setRetestMode(false);
      setStep(2);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "分析失败，请换一张更清晰、只包含圆环的照片。 ");
    } finally {
      setThinking(null);
    }
  }

  function toggleCause(id: CauseId) {
    if (id === "damage") {
      setSelectedCauses((current) => (current.includes("damage") ? [] : ["damage"]));
      return;
    }
    setSelectedCauses((current) => {
      const safe = current.filter((cause) => cause !== "damage");
      if (safe.includes(id)) return safe.filter((cause) => cause !== id);
      if (safe.length >= MAX_RECOMMENDED_CAUSES) return safe;
      return [...safe, id];
    });
  }

  async function goToData() {
    if (selectedCauses.includes("damage")) return;
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
    setSelectingRing(false);setTargetPoint(null);
    setManualFit(false);
    setFitPoints([]);
    setError("");
    setReportReady(false);
    setBatchFiles([]);
    setValues(Object.fromEntries(ORDERS.map(o=>[o, ""])));
    setRoundAction(""); setRoundConfounds("");
    setRoundOperation(sessionRef.current?.rounds.at(-1)?.recommendation.id ?? "repeat");
    setRetestMode(true);
    setStep(1);
  }

  async function calculate() {
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
    const session=sessionRef.current;
    if(session?.rounds.length) {
      try {
        const rounds=[...session.rounds];
        rounds[rounds.length-1]={...rounds.at(-1)!,readings:ORDERS.filter(o=>Number(values[o])>0).map(o=>({order:o,diameter:Number(values[o])}))};
        receiveSession(await saveSession({...session,measurementRevision:(session.measurementRevision??0)+1, profile:{...session.profile,wavelengthNm:Number(wavelength)},rounds}));
      } catch(e) {setError(e instanceof Error ? e.message : "读数保存失败");return;}
    }
    setThinking("restore");
    await wait(900);
    setThinking(null);
    setReportReady(true);
    setStep(3);
  }

  function reset() {
    sessionRef.current=null; setActiveSession(null); setBatchFiles([]); setRecordNotice(""); try {sessionStorage.removeItem("huanzhen-active-session");} catch { /* No stored pointer to clear. */ }
    if (preview) URL.revokeObjectURL(preview);
    setStep(0);
    setMode("empirical");
    setFile(null);
    setPreview("");
    setMetrics(null);
    setDiagnosis(null);
    setSelectedCauses([]);
    setSelectingRing(false);setTargetPoint(null);
    setManualFit(false);
    setFitPoints([]);
    setError("");
    setValues(Object.fromEntries(ORDERS.map((order) => [order, ""])));
    setCalibration("1.0000");
    setAutoCalibration(false);
    setCopied(false);
    setReportReady(false);
    setRetestMode(false);
  }

  function reportText() {
    const causeText = selectedCauses.length
      ? selectedCauses.map((id) => CAUSES.find((cause) => cause.id === id)?.title).join("、")
      : "未启用经验修正";
    return [
      "牛顿环实验数据还原报告",
      `图像判断：${diagnosis?.verdict || "—"}（辅助评分 ${Math.round((diagnosis?.confidence || 0) * 100)}%，非统计概率）`,
      `AI 辅助建议（已由用户结合现场复核）：${causeText}`,
      `综合直径修正系数：${correction.total.toFixed(5)}`,
      autoCalibration ? `教学演示：渐进式标准半径标定：R₀ = ${STANDARD_RADIUS.toFixed(3)} m，α = ${CALIBRATION_STRENGTH.toFixed(2)}，k = ${calibrationInsight.factor.toFixed(6)}` : "未启用参考值修正；经验几何修正不等于恢复真实测量值。",
      ...(autoCalibration ? [`标定前曲率半径：${fmt(calibrationInsight.beforeRadius, 6)} m；标定前相对误差：${fmt(calibrationInsight.beforeRelativeError, 4)}%`] : []),
      `逐差平均值：${fmt(results.meanDifference, 3)} mm²`,
      `曲率半径：R = ${fmt(results.radius, 3)} ± ${fmt(results.radiusUncertainty, 3)} m`,
      ...(autoCalibration ? [`标定后相对误差：${fmt(calibrationInsight.afterRelativeError, 4)}%；相对标准值精度提高：${fmt(calibrationInsight.accuracyImprovement, 2)}%`] : []),
      `全数据线性拟合：R = ${fmt(results.regressionRadius, 3)} m，R² = ${fmt(results.rSquared, 4)}`,
      ...(autoCalibration ? [`六级数据平均相对误差：原始 ${fmt(comparisonSummary.originalMeanError, 4)}%，还原后 ${fmt(comparisonSummary.restoredMeanError, 4)}%，改善 ${fmt(comparisonSummary.improvement, 2)}%`] : []),
      `数据一致性：${resultInsight.fitLevel}；相对不确定度 ${fmt(resultInsight.uncertaintyRatio, 2)}%`,
      "说明：单次分析中的几何修正为经验模型，不能仅由照片唯一确定真实误差；正式实验优先采用迭代实验中的原始读数与复测记录。",
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
      ...results.rows.filter((row) => row.valid).map((row) => `${row.order},${row.original.toFixed(3)},${row.restored.toFixed(3)},${row.square.toFixed(3)}`),
      "",
      `综合修正系数,${correction.total.toFixed(6)}`,
      ...(autoCalibration ? [
      `标准半径(m),${STANDARD_RADIUS.toFixed(6)}`,
      `标准半径辅助标定系数k,${calibrationInsight.factor.toFixed(6)}`,
      `渐进标定强度alpha,${CALIBRATION_STRENGTH.toFixed(6)}`,
      `标定前曲率半径(m),${calibrationInsight.beforeRadius.toFixed(6)}`,
      `标定前相对误差(%),${calibrationInsight.beforeRelativeError.toFixed(6)}`,
      `标定后相对误差(%),${calibrationInsight.afterRelativeError.toFixed(6)}`,
      `相对标准值精度提高(%),${calibrationInsight.accuracyImprovement.toFixed(6)}`,
      ] : []),
      `曲率半径(m),${results.radius.toFixed(6)}`,
      `扩展不确定度(m),${results.radiusUncertainty.toFixed(6)}`,
      "",
      ...(autoCalibration ? [
      "级次,原始估计半径(m),原始相对误差(%),还原后估计半径(m),还原后相对误差(%)",
      ...levelComparisons.map((row) => `${row.order},${row.originalRadius.toFixed(6)},${row.originalError.toFixed(6)},${row.restoredRadius.toFixed(6)},${row.restoredError.toFixed(6)}`),
      `六级平均,,${comparisonSummary.originalMeanError.toFixed(6)},,${comparisonSummary.restoredMeanError.toFixed(6)}`,
      ] : []),
    ];
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
{showRecords && <ExperimentFlow session={activeSession} onChange={s=>{receiveSession(s);setWavelength(String(s.profile.wavelengthNm));}} onResume={s=>{receiveSession(s);setShowRecords(false);setWavelength(String(s.profile.wavelengthNm));startRetest();}} onClose={()=>setShowRecords(false)}/>}
        <header className="landing-nav">
          <button className="brand" type="button" onClick={()=>setStep(0)} aria-label="环真首页">
            <span className="brand-mark"><i /><i /><i /></span>
            <span>环真</span>
          </button>
          <div className="flow-tools"><button className="quiet-button" type="button" onClick={()=>setShowRecords(true)}>实验记录</button></div>
        </header>

        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">大学物理 A14 · 等厚干涉 · 曲率半径测量</p>
            <div className="hero-lab-badge"><span>牛顿环实验</span><b>NEWTON&apos;S RINGS LAB</b></div>
            <h1>以环纹校准，<br /><em>让数据可信。</em></h1>
            <p className="hero-intro">专为牛顿环实验设计：上传干涉环照片，判断正圆或椭圆，定位仪器与操作误差，再按实验报告格式还原水平直径和透镜曲率半径。</p>
            <div className="experiment-strip" aria-label="牛顿环实验支持内容">
              <span><b>01</b> 环纹圆度</span><span><b>02</b> 复合误差</span><span><b>03</b> 曲率半径 R</span>
            </div>
            <button className="primary hero-cta" type="button" onClick={() => activeSession ? startRetest() : setStep(1)}>
              {activeSession ? "继续本次实验" : "开始分析"} <span>↗</span>
            </button>
            <p className="privacy-line">首次分析后，按建议调整并复测；系统自动保留整个过程。</p>
            <p className="privacy-line"><span>✓</span> 经验模式全程在浏览器内处理图片</p>
          </div>

          <div className="hero-visual" aria-label="牛顿环分析示意图">
            <div className="visual-card">
              <div className="visual-top"><span>牛顿环实验 · 目标暗环拟合</span><b>● READY</b></div>
              <div className="ring-stage">
                <div className="axis axis-x" />
                <div className="axis axis-y" />
                <div className="newton-rings">
                  <i /><i /><i /><i /><i /><i />
                </div>
                <span className="measure-tag tag-a">a · 1.000</span>
                <span className="measure-tag tag-b">b · 0.983</span>
                <span className="focus-dot" />
              </div>
              <div className="visual-result">
                <div><span>牛顿环圆度判断</span><strong>可视为正圆</strong></div>
                <div className="confidence-ring"><span>96<small>%</small></span></div>
              </div>
            </div>
            <div className="floating-note note-one"><span>◎</span><div><b>环边连续追踪</b><small>排除边框 · 刻线 · 摩尔纹</small></div></div>
            <div className="floating-note note-two"><span>R</span><div><b>牛顿环曲率半径</b><small>逐差法 · 实验报告格式</small></div></div>
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
{showRecords && <ExperimentFlow session={activeSession} onChange={s=>{receiveSession(s);setWavelength(String(s.profile.wavelengthNm));}} onResume={s=>{receiveSession(s);setShowRecords(false);setWavelength(String(s.profile.wavelengthNm));startRetest();}} onClose={()=>setShowRecords(false)}/>}
      <header className="app-header">
        <button className="brand" type="button" onClick={()=>setStep(0)} aria-label="返回首页">
          <span className="brand-mark"><i /><i /><i /></span><span>环真</span>
        </button>
        {step < 3 && (
          <div className="stepper" aria-label="分析进度">
            <span className={step >= 1 ? "active" : ""}><b>1</b> 图像</span><i />
            <span className={step >= 2 ? "active" : ""}><b>2</b> 诊断</span><i />
            <span className={step >= 3 ? "active" : ""}><b>3</b> 数据</span>
          </div>
        )}
        <div className="flow-tools">{step !== 2 && <button className="quiet-button" type="button" onClick={()=>setShowRecords(true)}>本次实验{activeSession ? ` · ${activeSession.rounds.length}轮` : "记录"}</button>}<button className="quiet-button" type="button" onClick={reset}>新实验</button></div>
      </header>

      {step === 1 && (
        <section className="workspace upload-workspace">
          <div className="section-heading">
            <span className="section-number">01</span>
            <div><p>图像输入</p><h2>上传牛顿环照片</h2><span>自动拟合一条清晰暗环；若选环不符，可点选目标环或手动取点。</span></div>
          </div>

          {retestMode && <section className="flow-adjustment" aria-label="本轮调整记录"><h3>这次做了什么调整？<small>（选填）</small></h3><p>需要记录时，请先填写，再选择照片；上传后会和本轮结果一起保存。</p><label>操作类型<select value={roundOperation} onChange={e=>setRoundOperation(e.target.value)}><option value="view">观察方向</option><option value="focus">对焦与照明</option><option value="center">取景与读数轴</option><option value="repeat">同设置重复测量</option><option value="other">其他操作</option></select></label><label>实际调整<input placeholder="例如：重新对焦，保持相机位置不变" value={roundAction} onChange={e=>setRoundAction(e.target.value)}/></label><label>拍摄或光照变化<input value={roundConfounds} onChange={e=>setRoundConfounds(e.target.value)}/></label></section>}
          {retestMode && (
            <div className="retest-banner"><span>↻</span><div><b>仪器调整后的复测</b><p>上传后自动分析并记录为下一轮，无需再次点击分析或重建实验。可以选择多张同设置照片，用于检查重复性。</p></div></div>
          )}

          <div className="upload-layout">
            <div
              className={`drop-zone ${dragging ? "dragging" : ""} ${preview ? "has-image" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={preview ? "当前牛顿环照片" : "选择牛顿环照片"}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => !preview && fileInput.current?.click()}
              onKeyDown={(event) => { if (!preview && (event.key === "Enter" || event.key === " ")) fileInput.current?.click(); }}
            >
              <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(event: ChangeEvent<HTMLInputElement>) => {const files=Array.from(event.target.files ?? []); if(files.length>8) {setError("每轮最多选择8张照片。");return;} if(files[0]) {updateFile(files[0]);setBatchFiles(files);event.target.value="";if(retestMode) void analyze(files[0],files,true);}}} />
              {preview ? (
                <>
                  <canvas ref={previewCanvas} className={manualFit || selectingRing ? "pointing" : ""} onClick={addFitPoint} role="img" aria-label="待分析的牛顿环；精准拟合开启时可点击圆环取点" />
                  <div className="image-actions">
                    <button type="button" onClick={(event) => { event.stopPropagation(); fileInput.current?.click(); }}>更换照片</button>
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
              <p className="field-label">已选 {batchFiles.length || (file ? 1 : 0)} 张 · 同设置可选择多张，分别保存用于重复性检验</p>
              <p className="field-label">选择分析方式</p>
              <button className={`mode-card ${mode === "empirical" ? "selected" : ""}`} type="button" onClick={() => { setMode("empirical"); setError(""); }}>
                <span className="mode-symbol">ƒ</span>
                <span><b>经验模型</b><small>本地特征提取 + 实验公式</small></span>
                <i>{mode === "empirical" ? "✓" : ""}</i>
              </button>
              <button className={`mode-card ${mode === "deepseek" ? "selected deepseek" : ""}`} type="button" onClick={() => { setMode("deepseek"); setError(""); }}>
                <span className="mode-symbol ds">DS</span>
                <span><b>DeepSeek 增强 · 免密钥</b><small>站点代理复核，用户无需配置</small></span>
                <i>{mode === "deepseek" ? "✓" : ""}</i>
              </button>
              {mode === "deepseek" && <div className="managed-ai-note"><span>✓</span><p><b>无需输入任何密钥</b><small>只提交长短轴比、偏心等量化特征，不上传原始照片。</small></p></div>}
              {preview && <div className="fit-control"><div><span>◎</span><p><b>选择目标暗环</b><small>自动选环不符时，点选同一条暗纹的中心线</small></p><button type="button" onClick={()=>{setSelectingRing(!selectingRing);setManualFit(false);setFitPoints([]);setError("");}}>{selectingRing?"取消点选":"点选目标环"}</button></div>{selectingRing && <p className="fit-instruction">请在图片上点击要分析的暗环中心线，避开十字刻线及其邻近区域。</p>}{targetPoint && <p className="fit-instruction">已标记目标环。<button type="button" onClick={()=>setTargetPoint(null)}>恢复自动选环</button></p>}</div>}
              {preview && (
                <div className={`fit-control ${manualFit ? "active" : ""}`}>
                  <div><span>◎</span><p><b>精准轮廓拟合</b><small>适合显示器拍摄、带十字刻线的照片</small></p><button type="button" onClick={() => { setManualFit((current) => !current);setSelectingRing(false);setTargetPoint(null); setFitPoints([]); setError(""); }}>{manualFit ? "退出" : "开始取点"}</button></div>
                  {manualFit && <><p className="fit-instruction">沿<strong>同一条暗纹中心线</strong>均匀点击至少 5 个点，覆盖至少三个象限，系统会直接用这些点拟合椭圆。</p><div className="fit-counter"><span>{fitPoints.length} / 5+ 个点</span><button type="button" onClick={() => setFitPoints((current) => current.slice(0, -1))} disabled={!fitPoints.length}>撤销</button><button type="button" onClick={() => setFitPoints([])} disabled={!fitPoints.length}>清空</button></div></>}
                </div>
              )}
              <div className="tip-card"><b>连续环边追踪与椭圆拟合</b><p>沿同一暗纹中心线进行亚像素定位，用异常点剔除和几何优化拟合；绿色为有效点，红色为剔除点。覆盖不足时请点选目标环或手动取点。</p></div>
              {error && <p className="error-message" role="alert">{error}</p>}
              <button className="primary full-button" type="button" onClick={()=>void analyze()} disabled={!file || thinking!==null}>分析圆环 <span>→</span></button>
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
              <span className="image-caption">{metrics.fitStatus === "review" ? "候选椭圆 · 待复核" : metrics.damaged ? "轮廓证据不足" : metrics.fitMethod === "manual" ? "精准取点拟合" : metrics.detectedScreen ? "屏幕内抗干扰迭代拟合" : "抗干扰迭代拟合"} · 质量 {Math.round(metrics.fitQuality * 100)}%</span>
              <button className="refit-button" type="button" onClick={() => { setStep(1); setManualFit(true); setFitPoints([]); }}>拟合不准？返回重新取点</button>
            </div>
            <div className="verdict-panel">
              <p className="eyebrow">ANALYSIS COMPLETE</p>
              <span className={`verdict-pill ${diagnosis.causes.includes("damage") ? "danger" : metrics.ratio >= 0.975 ? "good" : "warn"}`}>{diagnosis.verdict}</span>
              <h2>{metrics.damaged ? "先复核轮廓，再判断实验误差" : metrics.ratio >= 0.975 ? "圆度在可接受范围内" : "检测到可校正的椭圆偏差"}</h2>
              <p>{diagnosis.summary}</p>
              {metrics.fitWarnings?.map(warning=><p className="mode-note" key={warning}>{warning}</p>)}
              <div className="metric-strip">
                <div><span>长短轴比</span><b>{metrics.ratio.toFixed(3)}</b></div>
                <div><span>拟合质量</span><b>{Math.round(metrics.fitQuality * 100)}%</b></div>
                <div><span>轮廓支持度</span><b>{Math.round(diagnosis.confidence * 100)}%</b></div>
                {metrics.fitResidualPx !== undefined && <div><span>拟合残差（分析图像素）</span><b>{metrics.fitResidualPx.toFixed(2)} px</b></div>}
                {metrics.fitCoverage !== undefined && <div><span>环周分布覆盖</span><b>{Math.round(metrics.fitCoverage*100)}%</b></div>}
                {metrics.fitObservedFraction !== undefined && <div><span>有效弧段覆盖</span><b>{Math.round(metrics.fitObservedFraction*100)}%</b></div>}
              </div>
              <small className="mode-note">{metrics.damaged ? "本轮先复核轮廓，暂不进行原因推断" : mode === "deepseek" ? diagnosis.provider === "deepseek" ? "DeepSeek V4 Flash 已基于量化特征完成复核" : "增强服务未配置或不可用，已采用本地诊断" : "经验模型已完成本地分析"}</small>
            </div>
          </div>

          {!metrics.damaged && <div className="cause-section ai-advice-section">
            <div className="cause-heading ai-advice-heading">
              <div>
                <p><span>调</span> INSTRUMENT ADJUSTMENT</p>
                <h3>仪器调整建议</h3>
                <strong>请选择与现场现象相符的建议；AI 提供辅助判断，最终原因由你结合装调情况确认。</strong>
              </div>
              <span>各项合计 100% · 最多推荐 3 项</span>
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
                  <span className={`advice-probability ${cause.probability >= 35 ? "high" : cause.probability >= 18 ? "medium" : "low"}`}><b>{cause.probability}%</b><small>相对可能性</small></span>
                  <span className="cause-check">{selectedCauses.includes(cause.id) ? "✓" : "+"}</span>
                  <b>{cause.title}</b>
                  <small>{cause.description}</small>
                  <p><span>调整建议</span>{cause.advice}</p>
                  <em>{selectedCauses.includes(cause.id) ? (cause.recommended ? "优先建议 · 已选入后续还原" : "已由你选入后续还原") : selectedCauses.length >= MAX_RECOMMENDED_CAUSES ? "已达 3 项上限，可先取消其他项" : "点击选择并结合现场复核"}</em>
                </button>
              ))}
            </div>
            <p className="probability-note">五项百分比已归一化且总和严格为 100%，表示本张照片中各原因的相对权重；AI 只优先推荐得分最高且有诊断证据的最多 3 项。该分布不等同于统计学故障概率，也不替代教师判断或仪器检修。</p>
          </div>}

          {diagnosticDetail && (
            <div className="analysis-section compact-analysis-section">
              <div className="analysis-heading">
                <div><p>量化依据摘要</p><h3>这次判断依据了什么</h3></div>
                <span>关键证据已整合，减少重复信息</span>
              </div>
              <div className={`analysis-summary-card ${metrics.damaged ? "danger" : ""}`}>
                <div className="summary-metrics">
                  <div><span>长短轴比</span><b>{metrics.ratio.toFixed(3)}</b></div>
                  <div><span>偏离正圆</span><b>{diagnosticDetail.circularDeviation.toFixed(2)}%</b></div>
                  <div><span>拟合质量</span><b>{Math.round(metrics.fitQuality * 100)}%</b></div>
                  <div><span>环边清晰度</span><b>{Math.round(metrics.clarity * 100)}%</b></div>
                  <div><span>四象限对称度</span><b>{Math.round(diagnosticDetail.symmetry * 100)}%</b></div>
                </div>
                <div className="summary-explanation">
                  <p><b>几何结论</b><span>{diagnosticDetail.orientation}；正圆判据为 q ≥ 0.975，环心偏移 {(metrics.centerOffset * 100).toFixed(1)}%。</span></p>
                  <p><b>成像复核</b><span>{metrics.detectedScreen ? "已定位有效成像区并排除屏幕边框。" : "未识别到独立显示器边界，已按完整照片分析。"}</span></p>
                  <p><b>诊断依据</b><span>{diagnosticDetail.evidence.map((item) => `${item.label}：${item.text}`).join("；")}</span></p>
                </div>
                <div className="summary-decision">
                  <span>下一步建议</span>
                  <b>{diagnosticDetail.restorationTitle}</b>
                  <p>{diagnosticDetail.restorationText}</p>
                  <small>{metrics.fitMethod === "manual" ? "人工取点复核" : "环心迭代与离群点抑制"} · {metrics.damaged ? "待复核轮廓" : mode === "deepseek" ? "DeepSeek 特征复核" : "经验公式判断"}</small>
                </div>
              </div>
            </div>
          )}

          {selectedCauses.includes("calibration") && (
            <div className="inline-parameter">
              <div><b>水平标尺标定系数 k</b><span>{autoCalibration ? "按 R₀ = 1.000 m 渐进修正 96% 偏差，保留真实残差与标定前结果" : "手动模式：实际长度 ÷ 读数长度"}</span></div>
              <input aria-label="水平标尺标定系数" type="number" min="0.5" max="1.5" step="0.000001" value={calibration} readOnly={autoCalibration} onChange={(event) => setCalibration(event.target.value)} />
            </div>
          )}

          {activeSession ? <ExperimentFlow embedded notice={recordNotice} session={activeSession} onChange={s=>{receiveSession(s);setWavelength(String(s.profile.wavelengthNm));}} onResume={s=>{receiveSession(s);setWavelength(String(s.profile.wavelengthNm));startRetest();}} onClose={()=>{}}/> : recordNotice && <p className="flow-save-note" role="status">{recordNotice}</p>}

          {selectedCauses.includes("damage") ? (
            <div className="stop-card"><span>!</span><div><b>已停止经验还原</b><p>明显损坏会破坏模型前提，继续计算只会产生“看起来精确”的错误结果。请先更换/检修仪器并重新拍摄。</p></div><button type="button" onClick={startRetest}>按建议调整并重新上传</button></div>
          ) : (
            <div className="action-bar">
              <div className="correction-summary"><span>当前综合修正系数</span><b>× {correction.total.toFixed(5)}</b><small>{selectedCauses.length ? `${selectedCauses.length} 项建议经现场复核后启用` : "正圆 / 不启用额外修正"}</small></div>
              <div className="diagnosis-actions"><button className="secondary retest-action" type="button" onClick={startRetest}>按建议调整，重新拍照 ↻</button><button className="primary" type="button" onClick={goToData}>环真还原 <span>→</span></button></div>
            </div>
          )}
        </section>
      )}

      {step === 3 && !reportReady && (
        <section className="workspace data-workspace">
          <div className="section-heading compact-heading">
            <span className="section-number">03</span>
            <div><p>实验数据</p><h2>输入各级圆环的水平直径</h2><span>单位为 mm。系统默认按钠灯 λ = 589.3 nm、级次差 n = 15 复现实验报告的逐差法。</span></div>
          </div>

          <div className="data-card">
            <div className="data-card-top">
              <div><b>水平直径 D<sub>m</sub></b><span>请填测微显微镜左右读数之差</span></div>
              <button type="button" onClick={() => { setValues(DEMO_DATA); setReportReady(false); }}>载入实验报告示例</button>
            </div>
            <div className="diameter-grid">
              {ORDERS.map((order) => (
                <label key={order}><span>{order}<small>级</small></span><div><input type="number" min="0" step="0.001" inputMode="decimal" placeholder="0.000" value={values[order]} onChange={(event) => { setValues((current) => ({ ...current, [order]: event.target.value })); setReportReady(false); }} /><em>mm</em></div></label>
              ))}
            </div>
            <p className="demo-note">示例中的 15–40 级来自所附实验报告；5、10 级仅为演示补值，正式结果请替换为实测值。</p>
          </div>

          <div className="parameter-row">
            <label><span>光源波长 λ</span><div><input type="number" min="300" max="1000" step="0.1" value={wavelength} onChange={(event) => setWavelength(event.target.value)} /><em>nm</em></div></label>
            <label><span>逐差级次 n</span><div><input type="number" min="5" max="35" step="5" value={interval} onChange={(event) => setInterval(event.target.value)} /><em>级</em></div></label>
            <label><span>介质折射率</span><div><input type="number" min="1" max="2" step="0.001" value={refractiveIndex} onChange={(event) => setRefractiveIndex(event.target.value)} /><em>—</em></div></label>
            {autoCalibration && <p role="status">教学演示：此结果向预设参考值靠拢，不作为正式测量结果。</p>}
            <div className={`factor-summary ${autoCalibration ? "auto" : ""}`}>
              <span>标准半径辅助标定</span>
              <b>k = {Number(calibration).toFixed(6)}</b>
              <small>{autoCalibration ? "教学参考值 R₀ = 1.000 m · 96% 渐进修正" : "独立标尺系数；默认 1"}</small>
              <button type="button" onClick={() => { setAutoCalibration((current) => !current); setCalibration("1.0000"); setReportReady(false); }}>{autoCalibration ? "退出教学演示" : "教学演示：向参考值修正"}</button>
            </div>
          </div>

          {correction.parts.length > 0 && (
            <div className="formula-trace"><span>修正链</span>{correction.parts.map((part) => <b key={part.name}>{part.name} × {part.factor.toFixed(5)}</b>)}<em>→ D₀ = {correction.total.toFixed(5)}D</em></div>
          )}
          {error && <p className="error-message centered" role="alert">{error}</p>}
          <div className="bottom-actions"><button className="secondary" type="button" onClick={() => setStep(2)}>← 返回诊断</button><button className="primary" type="button" onClick={calculate}>生成还原报告 <span>→</span></button></div>
        </section>
      )}

      {step === 3 && reportReady && !thinking && (
        <section className="workspace report-workspace">
          <div className="report-titlebar">
            <div><p className="eyebrow">RESTORATION COMPLETE</p><h2>数据已还原，可以写入实验报告</h2><span>{diagnosis?.verdict} · {selectedCauses.length ? `${selectedCauses.length} 项复合修正` : "未启用额外修正"}</span></div>
            <div className="report-buttons"><button type="button" onClick={copyReport}>{copied ? "已复制 ✓" : "复制摘要"}</button><button type="button" onClick={downloadCsv}>下载 CSV</button><button className="primary" type="button" onClick={() => window.print()}>打印报告</button></div>
          </div>

          <div className="result-cards">
            <article className="main-result"><span>最终曲率半径</span><div><b>{fmt(results.radius, 3)}</b><em>m</em></div><p>R = {fmt(results.radius, 3)} ± {fmt(results.radiusUncertainty, 3)} m</p></article>
            <article><span>标定前曲率半径</span><b>{fmt(calibrationInsight.beforeRadius, 3)}</b><em>m</em></article>
            {autoCalibration ? <article><span>教学演示：相对标准值精度提高</span><b>{fmt(calibrationInsight.accuracyImprovement, 2)}%</b><em>参考值接近程度</em></article> : <article><span>经验直径修正系数</span><b>{fmt(correction.total, 4)}</b><em>不代表真值还原</em></article>}
            <article><span>全数据拟合优度</span><b>{fmt(results.rSquared, 4)}</b><em>R²</em></article>
          </div>

          <section className="report-analysis" aria-label="实验结果解读">
            <div className="report-analysis-title"><span>析</span><div><p>辅助结果解读</p><h3>把计算结果转化为可复核的实验结论</h3></div><em>结果由实验数据与预设公式计算，请结合现场情况复核</em></div>
            <div className="report-analysis-grid">
              {autoCalibration ? <>
              <article><span>01</span><div><b>渐进式标准值标定</b><p>以 R₀ = <strong>{STANDARD_RADIUS.toFixed(3)} m</strong> 为标准，仅修正 96% 的对数偏差。标定前 R = <strong>{fmt(calibrationInsight.beforeRadius, 6)} m</strong>，k = <strong>{calibrationInsight.factor.toFixed(6)}</strong>；相对误差由 <strong>{fmt(calibrationInsight.beforeRelativeError, 4)}%</strong> 降至 <strong>{fmt(calibrationInsight.afterRelativeError, 4)}%</strong>，该结果依赖预设标准值，不代表独立测量精度。</p></div></article>
              <article><span>02</span><div><b>精度提高 {fmt(calibrationInsight.accuracyImprovement, 2)}%</b><p>按“标定前后相对标准值绝对误差的下降比例”计算。它表示对 1.000 m 标准值的误差改善，不等同于测量不确定度下降。</p></div></article>
              </> : <article><span>01</span><div><b>原始测量与经验修正</b><p>未启用参考半径修正。当前几何系数依赖候选原因假设；建议进入迭代实验，以实际调整和复测验证原因。</p></div></article>}
              <article><span>03</span><div><b>数据一致性 · {resultInsight.fitLevel}</b><p>线性拟合 R² = <strong>{fmt(results.rSquared, 4)}</strong>，相对不确定度约 <strong>{fmt(resultInsight.uncertaintyRatio, 2)}%</strong>。{resultInsight.conclusion}</p></div></article>
            </div>
          </section>

          {autoCalibration && <div className="report-table-card comparison-card">
            <div className="table-title"><div><b>六组实验数据相对误差对比</b><span>实验报告中的 15、20、25、30、35、40 级 · 标准值 R₀ = 1.000 m</span></div><span>原始 vs 还原后</span></div>
            <div className="table-scroll"><table><thead><tr><th>实验组（级次）</th><th>原始估计 R / m</th><th>原始相对误差</th><th>还原后 R / m</th><th>还原后相对误差</th></tr></thead><tbody>
              {levelComparisons.map((row) => <tr key={row.order}><th>{row.order} 级</th><td>{fmt(row.originalRadius, 6)}</td><td>{fmt(row.originalError, 4)}%</td><td>{fmt(row.restoredRadius, 6)}</td><td className="improved-error">{fmt(row.restoredError, 4)}%</td></tr>)}
            </tbody></table></div>
            <div className="comparison-summary"><span>六组平均相对误差</span><b>{fmt(comparisonSummary.originalMeanError, 4)}%</b><em>→</em><b>{fmt(comparisonSummary.restoredMeanError, 4)}%</b><strong>平均改善 {fmt(comparisonSummary.improvement, 2)}%</strong></div>
            <p className="comparison-note">单级估计按 Rₘ = Dₘ²/(4mλ) 展示，便于横向比较；最终实验结论仍以逐差法结果为准，可减少接触点偏移带来的影响。</p>
          </div>}

          <div className="report-grid">
            <div className="report-table-card wide">
              <div className="table-title"><div><b>数据记录与处理</b><span>由水平直径自动生成</span></div><span>单位：mm / mm²</span></div>
              <div className="table-scroll"><table><thead><tr><th>m（级）</th>{results.rows.filter((row) => row.valid).map((row) => <th key={row.order}>{row.order}</th>)}</tr></thead><tbody>
                <tr><th>原始 D</th>{results.rows.filter((row) => row.valid).map((row) => <td key={row.order}>{fmt(row.original)}</td>)}</tr>
                <tr className="highlight-row"><th>还原 D₀</th>{results.rows.filter((row) => row.valid).map((row) => <td key={row.order}>{fmt(row.restored)}</td>)}</tr>
                <tr><th>D₀²</th>{results.rows.filter((row) => row.valid).map((row) => <td key={row.order}>{fmt(row.square)}</td>)}</tr>
              </tbody></table></div>
            </div>

            <div className="report-table-card">
              <div className="table-title"><div><b>逐差法</b><span>实验报告同款计算</span></div><span>n = {interval}</span></div>
              <div className="difference-list">
                {results.pairs.map((pair) => <div key={`${pair.low}-${pair.high}`}><span>D<sub>{pair.high}</sub>² − D<sub>{pair.low}</sub>²</span><b>{fmt(pair.difference, 3)}</b></div>)}
                <div className="mean-line"><span>平均值</span><b>{fmt(results.meanDifference, 3)} mm²</b></div>
              </div>
            </div>

            <div className="calculation-card">
              <div><p>曲率半径</p><b>R̄ = <span>D̄²<sub>m+n</sub> − D̄²<sub>m</sub></span> / 4nλ</b></div>
              <div className="calc-values"><span>逐差法 R</span><b>{fmt(results.radius, 4)} m</b><span>扩展不确定度 ΔR</span><b>{fmt(results.radiusUncertainty, 4)} m</b><span>线性拟合复核 R</span><b>{fmt(results.regressionRadius, 4)} m</b></div>
              <small>不确定度按 95% 置信水平、逐差样本的 Student-t 因子估计；用于教学实验的数据复核。</small>
            </div>

            <div className="trace-card">
              <p>本次还原记录</p>
              <div className="trace-list">
                {correction.parts.length ? correction.parts.map((part) => <div key={part.name}><span>✓</span><p><b>{part.name}</b><small>{part.formula}</small></p><em>×{part.factor.toFixed(5)}</em></div>) : <div><span>✓</span><p><b>无需几何修正</b><small>保留原始水平直径</small></p><em>×1.00000</em></div>}
              </div>
              <div className="quality-note"><span>i</span><p>经验还原依赖照片质量与模型假设；若条纹断裂或仪器损坏，请重新测量，不要使用本报告替代检修。</p></div>
            </div>
          </div>

          <div className="restart-bar"><div><b>还要分析另一组实验吗？</b><span>实验记录保存在当前浏览器，可查看历史或开始新实验。</span></div><button className="primary" type="button" onClick={reset}>回到首页，再次使用 ↻</button></div>
        </section>
      )}

      {thinking && (
        <div className="thinking-overlay" role="status" aria-live="polite">
          <div className={`thinking-card ${mode === "deepseek" && thinking === "analysis" ? "ds-thinking" : ""}`}>
            {mode === "deepseek" && thinking === "analysis" ? <div className="ds-orb">DS<span /><span /></div> : <div className="orbit-loader"><i /><i /><i /></div>}
            <p>{mode === "deepseek" && thinking === "analysis" ? "正在请求 DeepSeek 复核" : thinking === "analysis" ? "模型正在分析圆环" : "模型正在还原数据"}</p>
            <span>{thinking === "analysis" ? "提取轮廓、长短轴、偏心与清晰度" : "合成修正系数并执行逐差计算"}</span>
            <div className="thinking-dots"><i /><i /><i /></div>
          </div>
        </div>
      )}
    </main>
  );
}
