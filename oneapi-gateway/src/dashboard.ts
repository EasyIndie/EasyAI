import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { getUsageSummary } from "./db.ts";

function basicAuthOk(authHeader: string | undefined, user: string, pass: string): boolean {
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

export async function registerDashboard(app: FastifyInstance, cfg: Config, db: Db): Promise<void> {
  app.addHook("onRequest", async (req, reply) => {
    const p = (req.url.split("?")[0] ?? req.url) as string;
    const needsAuth = p === "/dashboard" || p.startsWith("/dashboard/") || p.startsWith("/admin/api/");
    if (!needsAuth) return;
    const ok = basicAuthOk(req.headers.authorization, cfg.adminUser, cfg.adminPass);
    if (ok) return;
    reply.header("WWW-Authenticate", 'Basic realm="oneapi-dashboard"');
    if (p.startsWith("/admin/api/")) return reply.status(401).send({ error: "unauthorized" });
    return reply.status(401).send("Unauthorized");
  });

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const dashboardRoot = path.resolve(__dirname, "../admin-ui/dist");

  if (fs.existsSync(dashboardRoot)) {
    const assetsRoot = path.join(dashboardRoot, "assets");
    if (fs.existsSync(assetsRoot)) {
      await app.register(fastifyStatic, { root: assetsRoot, prefix: "/dashboard/assets/" });
    }

    app.get("/dashboard", async (_req, reply) => {
      const html = fs.readFileSync(path.join(dashboardRoot, "index.html"), "utf8");
      reply.type("text/html; charset=utf-8");
      return reply.send(html);
    });

    app.get("/dashboard/*", async (_req, reply) => {
      const html = fs.readFileSync(path.join(dashboardRoot, "index.html"), "utf8");
      reply.type("text/html; charset=utf-8");
      return reply.send(html);
    });
  } else {
    app.get("/dashboard", async (_req, reply) => {
      return reply.status(503).send("Dashboard not built");
    });
  }

  app.get("/admin/api/usage", async (req, reply) => {
    const ok = basicAuthOk(req.headers.authorization, cfg.adminUser, cfg.adminPass);
    if (!ok) {
      reply.header("WWW-Authenticate", 'Basic realm="oneapi-dashboard"');
      return reply.status(401).send({ error: "unauthorized" });
    }

    const sinceMinutes = Math.max(1, Math.min(24 * 60, Number((req.query as any)?.sinceMinutes ?? "60")));
    const rows = await getUsageSummary(db, sinceMinutes);
    return { rows };
  });
}
