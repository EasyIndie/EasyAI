import pg from "pg";
import { createClient } from "redis";
import fs from "node:fs";
import yaml from "js-yaml";
import process from "node:process";

type BatchRow = {
  batch_id: string;
  principal: string;
  tenant_id: string | null;
};

type BatchItemRow = {
  idx: number;
  endpoint: string;
  request_json: string;
};

function loadConfig() {
  const configPath = resolveConfigPath("/app/config/easyai.yaml");
  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file not found: ${configPath}`);
  }
  const fileContents = fs.readFileSync(configPath, "utf8");
  const parsed = yaml.load(fileContents) as any;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid YAML configuration");
  }
  
  const secrets = parsed.secrets || {};
  const redisUrl = "redis://redis:6379";
  const databaseUrl = `postgres://oneapi:${encodeURIComponent(String(secrets.postgres_password ?? "oneapi"))}@postgres:5432/oneapi`;
  const internalToken = secrets.internal_token;
  if (!internalToken) throw new Error("Missing secrets.internal_token in config");
  
  const pollSleepMs = 200;
  const oneapiBaseUrl = "http://oneapi:3003";
  
  return { redisUrl, databaseUrl, internalToken, pollSleepMs, oneapiBaseUrl };
}

function resolveConfigPath(configPath: string): string {
  if (fs.existsSync(configPath)) return configPath;
  if (fs.existsSync("../config/easyai.development.yaml")) return "../config/easyai.development.yaml";
  if (fs.existsSync("config/easyai.development.yaml")) return "config/easyai.development.yaml";
  return configPath;
}

async function sleep(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonOrText(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; bodyText: string }> {
  const res = await fetch(url, init);
  const text = await res.text();
  return { ok: res.ok, status: res.status, bodyText: text };
}

async function main(): Promise<void> {
  const { redisUrl, databaseUrl, internalToken, pollSleepMs, oneapiBaseUrl } = loadConfig();

  const db = new pg.Pool({ connectionString: databaseUrl });
  const redis = createClient({ url: redisUrl });
  await redis.connect();

  while (true) {
    const popped = await redis.brPop("batch:q:v1", 1);
    if (!popped) {
      await sleep(pollSleepMs);
      continue;
    }
    const batchId = popped.element;

    const claimed = await db.query(`update batches set status='running', updated_at=now() where batch_id=$1 and status='queued'`, [
      batchId,
    ]);
    if (claimed.rowCount !== 1) continue;

    const batchRes = await db.query<BatchRow>(
      `select batch_id, principal, tenant_id from batches where batch_id=$1 limit 1`,
      [batchId],
    );
    if (!batchRes.rows.length) continue;
    const batch = batchRes.rows[0]!;

    const itemsRes = await db.query<BatchItemRow>(
      `select idx, endpoint, request_json from batch_items where batch_id=$1 order by idx asc`,
      [batchId],
    );

    for (const it of itemsRes.rows) {
      try {
        const url = `${oneapiBaseUrl}${it.endpoint}`;
        const { ok, status, bodyText } = await fetchJsonOrText(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-oneapi-internal-token": internalToken,
            "x-oneapi-principal": batch.principal,
            ...(batch.tenant_id ? { "x-oneapi-tenant-id": batch.tenant_id } : {}),
          },
          body: it.request_json,
        });

        if (ok) {
          await db.query(
            `update batch_items set status='completed', response_json=$3, error=null where batch_id=$1 and idx=$2`,
            [batchId, it.idx, bodyText],
          );
        } else {
          await db.query(
            `update batch_items set status='failed', response_json=$3, error=$4 where batch_id=$1 and idx=$2`,
            [batchId, it.idx, bodyText, `http_${status}`],
          );
        }
      } catch (e: any) {
        await db.query(
          `update batch_items set status='failed', response_json=null, error=$3 where batch_id=$1 and idx=$2`,
          [batchId, it.idx, String(e?.message ?? "error").slice(0, 2000)],
        );
      }
    }

    await db.query(
      `
      with s as (
        select
          sum(case when status='completed' then 1 else 0 end)::int as completed,
          sum(case when status='failed' then 1 else 0 end)::int as failed
        from batch_items
        where batch_id = $1
      )
      update batches
      set
        status = case when (select failed from s) > 0 then 'failed' else 'completed' end,
        completed = (select completed from s),
        failed = (select failed from s),
        updated_at = now()
      where batch_id = $1
    `,
      [batchId],
    );
  }
}

main().catch((e) => {
  process.stderr.write(String(e?.stack ?? e?.message ?? e) + "\n");
  process.exit(1);
});
