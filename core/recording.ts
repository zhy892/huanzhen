// These identifiers label local records; they are not authentication tokens.
export function newRecordId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `record-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
  );
}
export async function imageFingerprint(image: Blob): Promise<string> {
  const bytes = new Uint8Array(await image.arrayBuffer());
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  }
  // HTTP LAN previews may not expose SubtleCrypto. The fallback is only a
  // duplicate-photo hint: it never authenticates a file or blocks recording.
  let a = 2166136261,
    b = 5381;
  for (const byte of bytes) {
    a = Math.imul(a ^ byte, 16777619);
    b = Math.imul(b, 33) ^ byte;
  }
  return `local-${bytes.length}-${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`;
}
