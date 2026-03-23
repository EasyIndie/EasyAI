import pg from "pg";
import { createClient } from "redis";

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

function req(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing env: ${name}`);
  return v.trim();
}

function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length ? v.trim() : undefined;
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
  const redisUrl = req("REDIS_URL");
  const databaseUrl = req("DATABASE_URL");
  const oneapiBaseUrl = req("ONEAPI_BASE_URL");
  const internalToken = opt("ONEAPI_INTERNAL_TOKEN");
  const pollSleepMs = Number(opt("BATCH_POLL_SLEEP_MS") ?? "200");

  const db = new pg.Pool({ connectionString: databaseUrl });
  const redis = createClient({ url: redisUrl });
  await redis.connect();

  if (!internalToken) {
    while (true) {
      await sleep(10_000);
    }
  }

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
