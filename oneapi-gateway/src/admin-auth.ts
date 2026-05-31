import { createHmac, timingSafeEqual } from "node:crypto";
import type { Config } from "./config.js";
import { ipAllowed } from "./net.js";

export const ADMIN_SESSION_COOKIE = "easyai_admin_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

export function basicAuthOk(authHeader: string | undefined, user: string, pass: string): boolean {
  if (!authHeader) return false;
  const m = authHeader.match(/^Basic\s+(.+)$/i);
  if (!m) return false;
  const decoded = Buffer.from(m[1]!, "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  if (idx < 0) return false;
  const u = decoded.slice(0, idx);
  const p = decoded.slice(idx + 1);
  return u === user && p === pass;
}

function sessionSecret(cfg: Config): string {
  return `${cfg.adminUser}:${cfg.adminPass}:${cfg.internalToken ?? ""}:${cfg.databaseUrl}`;
}

function sign(value: string, cfg: Config): string {
  return createHmac("sha256", sessionSecret(cfg)).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function createAdminSessionCookie(cfg: Config): string {
  const payload = Buffer.from(JSON.stringify({
    u: cfg.adminUser,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  }), "utf8").toString("base64url");
  const token = `${payload}.${sign(payload, cfg)}`;
  const attrs = [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (cfg.tls) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearAdminSessionCookie(): string {
  return `${ADMIN_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function adminSessionOk(cookieHeader: string | undefined, cfg: Config): boolean {
  const token = parseCookies(cookieHeader)[ADMIN_SESSION_COOKIE];
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !safeEqual(sig, sign(payload, cfg))) return false;
  try {
    const raw = Buffer.from(payload, "base64url").toString("utf8");
    const data = JSON.parse(raw);
    return data?.u === cfg.adminUser && typeof data?.exp === "number" && data.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function isAdminRequest(req: any, cfg: Config): boolean {
  return ipAllowed(req.ip, cfg.adminAllowedCidrs)
    && (adminSessionOk(req.headers.cookie, cfg) || basicAuthOk(req.headers.authorization, cfg.adminUser, cfg.adminPass));
}
