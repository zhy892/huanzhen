import type { Session } from '../core/experiment';
const DB_NAME = 'huanzhen-experiments';
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sessions', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('请关闭其他环真实验标签页后重试。'));
  });
}
export async function listSessions(): Promise<Session[]> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('sessions').objectStore('sessions').getAll();
      request.onsuccess = () => resolve((request.result as Session[]).sort((a, b) => b.created.localeCompare(a.created)));
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export async function saveSession(session: Session): Promise<Session> {
  const db = await open();
  const saved = { ...session, revision: (session.revision ?? 0) + 1 };
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite');
      const store = tx.objectStore('sessions');
      const request = store.get(session.id);
      let conflict = false;
      request.onsuccess = () => {
        const current = request.result as Session | undefined;
        if (current && (current.revision ?? 0) !== (session.revision ?? 0)) {
          conflict = true; tx.abort(); return;
        }
        store.put(saved);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error(conflict ? '其他标签页已更新该实验，请刷新并重新打开档案，避免覆盖记录。' : '存储失败，请导出已有记录后检查浏览器空间。'));
    });
    return saved;
  } finally { db.close(); }
}
export async function exportSession(session: Session) {
  const rounds = await Promise.all(session.rounds.map(async round => ({ ...round, samples: await Promise.all(round.samples.map(async sample => ({ ...sample, image: await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(sample.image);
  }) }))) })));
  const blob = new Blob([JSON.stringify({ ...session, rounds }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = `环真-${session.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importSession(file: File): Promise<Session> {
  if (file.size > 200 * 1024 * 1024) throw new Error('档案超过 200 MB，请使用较小档案。');
  const data = JSON.parse(await file.text()) as Session;
  const numeric = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
  if (data?.version !== 1 || !data.profile || typeof data.profile.name !== 'string' || typeof data.profile.instrument !== 'string' || typeof data.profile.conditions !== 'string' || !numeric(data.profile.wavelengthNm) || data.profile.wavelengthNm <= 0 || !numeric(data.profile.resolutionMm) || data.profile.resolutionMm <= 0 || !numeric(data.profile.diameterFactor) || data.profile.diameterFactor <= 0 || !numeric(data.profile.factorUncertainty) || data.profile.factorUncertainty < 0 || !Array.isArray(data.rounds) || data.rounds.length > 200 || !Array.isArray(data.declarations) || !Array.isArray(data.restorations)) throw new Error('不是受支持的实验档案。');
  const ids = new Set<string>();
  for (const round of data.rounds) {
    if (typeof round.id !== 'string' || ids.has(round.id) || typeof round.time !== 'string' || typeof round.action !== 'string' || typeof round.operation !== 'string' || typeof round.confounds !== 'string' || !Array.isArray(round.samples) || round.samples.length < 1 || round.samples.length > 8 || !Array.isArray(round.readings) || round.readings.length > 1000 || !round.recommendation) throw new Error('轮次记录格式错误。');
    ids.add(round.id);
    for (const sample of round.samples) {
      const encoded = sample.image as unknown;
      const metrics = sample.metrics;
      if (typeof sample.id !== 'string' || typeof sample.name !== 'string' || !metrics || ['ratio','angle','centerOffset','clarity','asymmetry','fitQuality','confidence'].some(k => !numeric(metrics[k as keyof typeof metrics])) || metrics.ratio <= 0 || metrics.ratio > 1 || typeof metrics.damaged !== 'boolean' || typeof encoded !== 'string' || !/^data:image\/(png|jpeg|webp|gif|bmp|avif);base64,[A-Za-z0-9+/=]+$/.test(encoded)) throw new Error('照片或分析指标格式错误。');
      const [header, content] = encoded.split(','); const binary = atob(content);
      if (binary.length > 15 * 1024 * 1024) throw new Error('档案中的单张照片超过 15 MB。');
      sample.image = new Blob([Uint8Array.from(binary, char => char.charCodeAt(0))], { type: header.slice(5, -7) });
    }
    for (const reading of round.readings) if (!Number.isInteger(reading.order) || reading.order < 0 || !numeric(reading.diameter) || reading.diameter <= 0) throw new Error('原始读数格式错误。');
    const { recommend } = await import('../core/experiment');
    round.recommendation = recommend(round.samples);
  }
  for (const declaration of data.declarations) {
    if (typeof declaration.id !== 'string' || typeof declaration.time !== 'string' || !Array.isArray(declaration.roundIds) || !declaration.roundIds.every(id => typeof id === 'string' && ids.has(id))) throw new Error('完成声明格式错误。');
    const { inspectResidual } = await import('../core/experiment');
    declaration.result = inspectResidual(data.rounds.filter(round => declaration.roundIds.includes(round.id)));
  }
  for (const restoration of data.restorations) if (typeof restoration.time !== 'string' || typeof restoration.reason !== 'string' || typeof restoration.declarationId !== 'string' || !['restored','bounded','unavailable'].includes(restoration.tier) || ['before','after','amount','uncertainty'].some(key => restoration[key as 'before'] !== undefined && !numeric(restoration[key as 'before']))) throw new Error('补偿记录格式错误。');
  return { ...data, revision: 0, id: crypto.randomUUID(), created: new Date().toISOString(), profile: { ...data.profile, name: `${data.profile.name}（导入）` } };
}
