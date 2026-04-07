import fs from "node:fs";
import path from "node:path";

function findRepoRoot(startDir: string): string {
  const rawExists = (p: string): boolean => {
    try {
      fs.accessSync(p);
      return true;
    } catch {
      return false;
    }
  };
  let dir = path.resolve(startDir);
  while (true) {
    const hasCompose = rawExists(path.join(dir, "docker-compose.yml"));
    const hasSpecs = rawExists(path.join(dir, "specs"));
    const hasDocs = rawExists(path.join(dir, "docs"));
    const hasGateway = rawExists(path.join(dir, "oneapi-gateway"));
    if (hasCompose && hasSpecs && hasDocs && hasGateway) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}

const repoRoot = findRepoRoot(process.cwd());

function readText(p: string): string {
  return fs.readFileSync(p, "utf8");
}

function exists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function walk(dir: string, exts: string[] | undefined, out: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "dist" || e.name === "build") continue;
      walk(p, exts, out);
    } else if (e.isFile()) {
      if (!exts || exts.includes(path.extname(e.name))) out.push(p);
    }
  }
  return out;
}

function rel(p: string): string {
  return path.relative(repoRoot, p);
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function extractEnvVarsFromText(s: string): string[] {
  const re = /\b[A-Z][A-Z0-9_]{2,}\b/g;
  const all = s.match(re) ?? [];
  const allowPrefixes = ["LITELLM_", "OLLAMA_", "REDIS_URL", "DATABASE_URL", "APP_ENV", "BASE_URL", "API_KEY", "API_KEYS"];
  return uniq(all.filter((v) => allowPrefixes.some((p) => (p.endsWith("_") ? v.startsWith(p) : v === p))));
}

function extractPathsFromText(s: string): string[] {
  const re = /\/(healthz|metrics|dashboard|admin\/api\/[a-z0-9/_:-]+|v1\/[a-z0-9/_:-]+)\b/gi;
  const out: string[] = [];
  for (const m of s.matchAll(re)) out.push(m[0]);
  return uniq(out.map((p) => (p.startsWith("/") ? p : `/${p}`)));
}

const docRoots = ["docs", "specs"];
const docFiles: string[] = [];
for (const r of docRoots) {
  const p = path.join(repoRoot, r);
  if (exists(p)) walk(p, [".md"], docFiles);
}
for (const f of [path.join(repoRoot, "README.md")].filter(exists)) docFiles.push(f);

const referencedEnvVars = new Map<string, Set<string>>();
const referencedPaths = new Map<string, Set<string>>();
const forbiddenTokens = ["ONEAPI_AUTH_MODES"];

for (const f of docFiles) {
  const text = readText(f);
  for (const tok of forbiddenTokens) {
    if (text.includes(tok)) {
      const s = referencedEnvVars.get(tok) ?? new Set<string>();
      s.add(rel(f));
      referencedEnvVars.set(tok, s);
    }
  }

  for (const v of extractEnvVarsFromText(text)) {
    const s = referencedEnvVars.get(v) ?? new Set<string>();
    s.add(rel(f));
    referencedEnvVars.set(v, s);
  }
  for (const p of extractPathsFromText(text)) {
    const s = referencedPaths.get(p) ?? new Set<string>();
    s.add(rel(f));
    referencedPaths.set(p, s);
  }
}

const knownExternalVars = new Set<string>(["BASE_URL", "API_KEY", "API_KEYS", "APP_ENV"]);

const sourceSearchFiles: string[] = [];
for (const r of ["oneapi-gateway/src", "batch-worker/src", "litellm-service/app", "config", "k8s", "docker-compose.yml", ".env.example"]) {
  const p = path.join(repoRoot, r);
  if (!exists(p)) continue;
  const stat = fs.statSync(p);
  if (stat.isFile()) sourceSearchFiles.push(p);
  else walk(p, [".ts", ".tsx", ".py", ".yaml", ".yml", ".env", ".example", ".md"], sourceSearchFiles);
}

const sourceBlob = sourceSearchFiles.map((p) => `\n### ${rel(p)}\n${readText(p)}`).join("\n");

const errors: string[] = [];

for (const [v, files] of referencedEnvVars.entries()) {
  if (forbiddenTokens.includes(v)) {
    errors.push(`Forbidden token "${v}" found in: ${[...files].join(", ")}`);
    continue;
  }
  if (knownExternalVars.has(v)) continue;
  if (!sourceBlob.includes(v)) {
    errors.push(`Env var "${v}" referenced in docs but not found in code/config/compose/k8s. Refs: ${[...files].join(", ")}`);
  }
}

const proxiedV1Allow = [/^\/v1\/chat\/completions$/i, /^\/v1\/embeddings$/i, /^\/v1\/models$/i];
const gatewayMustHandle = [/^\/v1\/batches\b/i, /^\/admin\/api\//i, /^\/dashboard\b/i, /^\/metrics$/i, /^\/healthz$/i];
const gatewayRouteFiles = [
  path.join(repoRoot, "oneapi-gateway/src/index.ts"),
  path.join(repoRoot, "oneapi-gateway/src/proxy.ts"),
  path.join(repoRoot, "oneapi-gateway/src/admin.ts"),
  path.join(repoRoot, "oneapi-gateway/src/dashboard.ts"),
  path.join(repoRoot, "oneapi-gateway/src/batch.ts"),
];
const gatewayBlob = gatewayRouteFiles.filter(exists).map((p) => readText(p)).join("\n");

function canonicalizeDocPath(p: string): string {
  let out = p;
  out = out.replace(/^\/admin\/api\/tenants\/[^/]+$/i, "/admin/api/tenants/:tenantId");
  out = out.replace(/^\/admin\/api\/keys\/[^/]+\/rpm$/i, "/admin/api/keys/:id/rpm");
  out = out.replace(/^\/admin\/api\/keys\/[^/]+\/tenant$/i, "/admin/api/keys/:id/tenant");
  out = out.replace(/^\/admin\/api\/keys\/[^/]+\/revoke$/i, "/admin/api/keys/:id/revoke");
  out = out.replace(/^\/v1\/batches\/[^/]+$/i, "/v1/batches/:batchId");
  out = out.replace(/^\/v1\/batches\/[^/]+\/output$/i, "/v1/batches/:batchId/output");
  return out;
}

for (const [p, files] of referencedPaths.entries()) {
  const must = gatewayMustHandle.some((re) => re.test(p));
  const isAllowedProxied = p.startsWith("/v1/") && proxiedV1Allow.some((re) => re.test(p));
  if (!must && isAllowedProxied) continue;
  if (!must && p.startsWith("/v1/")) continue;
  if (must) {
    const canon = canonicalizeDocPath(p);
    const candidates = canon === p ? [p] : [p, canon];
    const ok = candidates.some((c) => gatewayBlob.includes(`"${c}"`) || gatewayBlob.includes(`'${c}'`));
    if (!ok) {
      errors.push(`Path "${p}" referenced in docs but not found in gateway route strings. Refs: ${[...files].join(", ")}`);
    }
  }
}

if (errors.length) {
  process.stderr.write(`Doc audit failed with ${errors.length} issue(s):\n`);
  for (const e of errors) process.stderr.write(`- ${e}\n`);
  process.exit(1);
} else {
  process.stdout.write(`Doc audit OK: scanned ${docFiles.length} doc file(s), ${referencedEnvVars.size} env var(s), ${referencedPaths.size} path(s).\n`);
}
