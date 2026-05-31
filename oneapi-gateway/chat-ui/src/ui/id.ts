export function createClientId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") {
    try {
      return randomUUID.call(globalThis.crypto);
    } catch {}
  }

  const bytes = new Uint8Array(16);
  const getRandomValues = globalThis.crypto?.getRandomValues;
  if (typeof getRandomValues === "function") {
    try {
      getRandomValues.call(globalThis.crypto, bytes);
    } catch {
      fillPseudoRandom(bytes);
    }
  } else {
    fillPseudoRandom(bytes);
  }

  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

function fillPseudoRandom(bytes: Uint8Array) {
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
}
