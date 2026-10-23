import type { Session } from "../core/experiment";
import { SOFTWARE_NAME, SOFTWARE_VERSION } from "../core/software";
const DB_NAME = "huanzhen-experiments";
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("sessions", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("请关闭其他环真实验标签页后重试。"));
  });
}
export async function listSessions(): Promise<Session[]> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("sessions").objectStore("sessions").getAll();
      request.onsuccess = () =>
        resolve((request.result as Session[]).sort((a, b) => b.created.localeCompare(a.created)));
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
export async function saveSession(session: Session): Promise<Session> {
  const db = await open();
  const saved = { ...session, revision: (session.revision ?? 0) + 1 };
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("sessions", "readwrite");
      const store = tx.objectStore("sessions");
      const request = store.get(session.id);
      let conflict = false;
      request.onsuccess = () => {
        const current = request.result as Session | undefined;
        if (current && (current.revision ?? 0) !== (session.revision ?? 0)) {
          conflict = true;
          tx.abort();
          return;
        }
        store.put(saved);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(
          new Error(
            conflict
              ? "其他标签页已更新该实验，请刷新并重新打开档案，避免覆盖记录。"
              : "存储失败，请导出已有记录后检查浏览器空间。",
          ),
        );
    });
    return saved;
  } finally {
    db.close();
  }
}
export async function exportSession(session: Session) {
  const rounds = await Promise.all(
    session.rounds.map(async (round) => ({
      ...round,
      samples: await Promise.all(
        round.samples.map(async (sample) => ({
          ...sample,
          image: await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(sample.image);
          }),
        })),
      ),
    })),
  );
  const blob = new Blob(
    [
      JSON.stringify(
        { ...session, software: { name: SOFTWARE_NAME, version: SOFTWARE_VERSION }, rounds },
        null,
        2,
      ),
    ],
    {
      type: "application/json",
    },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `环真-${session.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function getSession(id: string): Promise<Session | null> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("sessions").objectStore("sessions").get(id);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
