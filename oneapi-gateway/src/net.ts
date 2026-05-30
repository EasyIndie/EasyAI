export function normalizeIp(raw?: string): string | undefined {
  if (!raw) return;
  const ip = raw.trim();
  if (!ip) return;
  if (ip === "::1") return "127.0.0.1";
  if (ip.startsWith("::ffff:")) return ip.slice("::ffff:".length);
  return ip;
}

function ipv4ToInt(ip: string): number | undefined {
  const parts = ip.split(".");
  if (parts.length !== 4) return;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [base, maskRaw] = cidr.split("/");
  const mask = Number(maskRaw);
  if (!base || !Number.isInteger(mask) || mask < 0 || mask > 32) return false;
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === undefined || baseInt === undefined) return false;
  const m = mask === 0 ? 0 : (0xffffffff << (32 - mask)) >>> 0;
  return (ipInt & m) === (baseInt & m);
}

export function ipAllowed(ipRaw: string | undefined, allowCidrs: string[] | null | undefined): boolean {
  if (allowCidrs === undefined || allowCidrs === null) return true;
  const ip = normalizeIp(ipRaw);
  if (!ip) return false;
  return allowCidrs.some((c) => ipInCidr(ip, c));
}

export function parseCidrAllowList(value: unknown, defaultCidrs: string[] | null | undefined): string[] | null | undefined {
  if (value === undefined) return defaultCidrs;
  if (value === "any" || value === null) return null;
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return defaultCidrs;
}
