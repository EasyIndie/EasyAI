import pg from "pg";

export type Db = {
  pool: pg.Pool;
  close: () => Promise<void>;
};

export async function createDb(databaseUrl: string): Promise<Db> {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  await migrate(pool);
  return {
    pool,
    close: async () => {
      await pool.end();
    },
  };
}

/**
 * EasyAI only owns batch bookkeeping.
 * API keys, budgets, spend and request logs live in LiteLLM.
 */
async function migrate(pool: pg.Pool): Promise<void> {
  await pool.query(`
    create table if not exists batches (
      batch_id text primary key,
      principal text not null,
      status text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      total int not null,
      completed int not null default 0,
      failed int not null default 0
    );
  `);
  await pool.query(`create index if not exists batches_status_idx on batches(status, created_at desc);`);

  await pool.query(`
    create table if not exists batch_items (
      batch_id text not null references batches(batch_id) on delete cascade,
      idx int not null,
      endpoint text not null,
      request_json text not null,
      status text not null,
      response_json text,
      error text,
      primary key (batch_id, idx)
    );
  `);
  await pool.query(`create index if not exists batch_items_batch_idx on batch_items(batch_id, idx);`);

}

export type BatchStatus = "queued" | "running" | "completed" | "failed";

export type BatchRow = {
  batch_id: string;
  principal: string;
  status: BatchStatus;
  created_at: string;
  updated_at: string;
  total: number;
  completed: number;
  failed: number;
};

export async function createBatch(db: Db, batchId: string, principal: string, total: number): Promise<void> {
  await db.pool.query(
    `
    insert into batches (batch_id, principal, status, total)
    values ($1, $2, 'queued', $3)
  `,
    [batchId, principal, total],
  );
}

export async function insertBatchItem(
  db: Db,
  batchId: string,
  idx: number,
  endpoint: string,
  requestJson: string,
): Promise<void> {
  await db.pool.query(
    `
    insert into batch_items (batch_id, idx, endpoint, request_json, status)
    values ($1, $2, $3, $4, 'queued')
  `,
    [batchId, idx, endpoint, requestJson],
  );
}

export async function getBatch(db: Db, batchId: string): Promise<BatchRow | undefined> {
  const res = await db.pool.query(
    `
    select batch_id, principal, status, created_at::text, updated_at::text, total, completed, failed
    from batches
    where batch_id = $1
    limit 1
  `,
    [batchId],
  );
  if (!res.rows?.length) return;
  return res.rows[0];
}

export async function listBatchItems(
  db: Db,
  batchId: string,
): Promise<{ idx: number; endpoint: string; status: string; response_json: string | null; error: string | null }[]> {
  const res = await db.pool.query(
    `
    select idx, endpoint, status, response_json, error
    from batch_items
    where batch_id = $1
    order by idx asc
  `,
    [batchId],
  );
  return res.rows;
}
