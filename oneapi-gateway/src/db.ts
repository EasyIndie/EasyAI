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

async function migrate(pool: pg.Pool): Promise<void> {
  await pool.query(`
    create table if not exists usage_events (
      id bigserial primary key,
      ts timestamptz not null default now(),
      principal text not null,
      api_key_id bigint,
      api_key_hash text,
      tenant_id text,
      auth_mode text not null,
      model text,
      endpoint text not null,
      method text not null,
      status int not null,
      latency_ms int not null,
      cached boolean not null default false,
      upstream text,
      request_bytes int,
      response_bytes int,
      prompt_tokens int,
      completion_tokens int,
      total_tokens int,
      error text,
      ttft_ms int,
      tps double precision
    );
  `);
  await pool.query(`
    do $$
    begin
      if not exists (select 1 from information_schema.columns where table_name='usage_events' and column_name='ttft_ms') then
        alter table usage_events add column ttft_ms int;
      end if;
      if not exists (select 1 from information_schema.columns where table_name='usage_events' and column_name='tps') then
        alter table usage_events add column tps double precision;
      end if;
      if not exists (select 1 from information_schema.columns where table_name='usage_events' and column_name='api_key_id') then
        alter table usage_events add column api_key_id bigint;
      end if;
      if not exists (select 1 from information_schema.columns where table_name='usage_events' and column_name='tenant_id') then
        alter table usage_events add column tenant_id text;
      end if;
    end $$;
  `);
  await pool.query(`create index if not exists usage_events_ts_idx on usage_events(ts desc);`);
  await pool.query(`create index if not exists usage_events_principal_ts_idx on usage_events(principal, ts desc);`);
  await pool.query(`create index if not exists usage_events_api_key_id_ts_idx on usage_events(api_key_id, ts desc);`);
  await pool.query(`create index if not exists usage_events_tenant_id_ts_idx on usage_events(tenant_id, ts desc);`);

  // api_keys must be created before the backfill UPDATE that references it
  await pool.query(`
    create table if not exists api_keys (
      id bigserial primary key,
      key_hash text not null unique,
      key_prefix text not null,
      created_at timestamptz not null default now(),
      revoked_at timestamptz,
      rpm_limit int,
      tenant_id text
    );
  `);
  await pool.query(`
    do $$
    begin
      if not exists (select 1 from information_schema.columns where table_name='api_keys' and column_name='tenant_id') then
        alter table api_keys add column tenant_id text;
      end if;
    end $$;
  `);
  await pool.query(`create index if not exists api_keys_revoked_idx on api_keys(revoked_at);`);
  await pool.query(`create index if not exists api_keys_tenant_idx on api_keys(tenant_id);`);

  await pool.query(`
    update usage_events ue
    set
      api_key_id = ak.id,
      tenant_id = coalesce(ue.tenant_id, ak.tenant_id)
    from api_keys ak
    where ue.api_key_id is null
      and ue.api_key_hash = ak.key_hash
  `);

  await pool.query(`
    create table if not exists tenants (
      tenant_id text primary key,
      created_at timestamptz not null default now(),
      rpm_limit int,
      tpm_limit int,
      disabled boolean not null default false
    );
  `);
  await pool.query(`create index if not exists tenants_disabled_idx on tenants(disabled);`);

  await pool.query(`
    create table if not exists batches (
      batch_id text primary key,
      principal text not null,
      tenant_id text,
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

  await pool.query(`
    create table if not exists conversations (
      id uuid primary key,
      title text not null default '',
      principal text not null,
      tenant_id text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);
  await pool.query(`create index if not exists conversations_principal_idx on conversations(principal, updated_at desc);`);

  await pool.query(`
    create table if not exists messages (
      id uuid primary key,
      conversation_id uuid not null references conversations(id) on delete cascade,
      role text not null,
      content text not null,
      model text,
      prompt_tokens int,
      completion_tokens int,
      created_at timestamptz not null default now()
    );
  `);
  await pool.query(`create index if not exists messages_conversation_idx on messages(conversation_id, created_at asc);`);
}

export type UsageEvent = {
  principal: string;
  apiKeyId?: number;
  apiKeyHash?: string;
  tenantId?: string | null;
  authMode: string;
  model?: string;
  endpoint: string;
  method: string;
  status: number;
  latencyMs: number;
  cached: boolean;
  upstream?: string;
  requestBytes?: number;
  responseBytes?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  error?: string;
  ttftMs?: number;
  tps?: number;
};

export async function insertUsageEvent(db: Db, e: UsageEvent): Promise<void> {
  await db.pool.query(
    `
    insert into usage_events (
      principal, api_key_id, api_key_hash, tenant_id, auth_mode, model, endpoint, method, status, latency_ms, cached, upstream,
      request_bytes, response_bytes, prompt_tokens, completion_tokens, total_tokens, error, ttft_ms, tps
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,$18,$19,$20
    )
  `,
    [
      e.principal,
      e.apiKeyId ?? null,
      e.apiKeyHash ?? null,
      e.tenantId ?? null,
      e.authMode,
      e.model ?? null,
      e.endpoint,
      e.method,
      e.status,
      e.latencyMs,
      e.cached,
      e.upstream ?? null,
      e.requestBytes ?? null,
      e.responseBytes ?? null,
      e.promptTokens ?? null,
      e.completionTokens ?? null,
      e.totalTokens ?? null,
      e.error ?? null,
      e.ttftMs ?? null,
      e.tps ?? null,
    ],
  );
}

export type UsageSummaryRow = {
  principal: string;
  auth_mode: string;
  tenant_id: string | null;
  api_key_id: number | null;
  api_key_prefix: string | null;
  requests: number;
  errors: number;
  cached: number;
  p95_latency_ms: number | null;
  total_tokens: number | null;
};

export async function getUsageSummary(db: Db, sinceMinutes: number): Promise<UsageSummaryRow[]> {
  const res = await db.pool.query(
    `
    select
      ue.principal,
      ue.auth_mode,
      ue.tenant_id,
      ue.api_key_id::bigint,
      ak.key_prefix as api_key_prefix,
      count(*)::int as requests,
      sum(case when ue.status >= 400 then 1 else 0 end)::int as errors,
      sum(case when ue.cached then 1 else 0 end)::int as cached,
      percentile_cont(0.95) within group (order by ue.latency_ms)::float as p95_latency_ms,
      sum(ue.total_tokens)::bigint as total_tokens
    from usage_events ue
    left join api_keys ak on ak.id = ue.api_key_id
    where ue.ts >= now() - ($1::text || ' minutes')::interval
    group by ue.principal, ue.auth_mode, ue.tenant_id, ue.api_key_id, ak.key_prefix
    order by requests desc
    limit 200
  `,
    [String(sinceMinutes)],
  );
  return res.rows;
}

export type ApiKeyRow = {
  id: number;
  key_hash: string;
  key_prefix: string;
  created_at: string;
  revoked_at: string | null;
  rpm_limit: number | null;
  tenant_id: string | null;
};

export async function listApiKeys(db: Db): Promise<ApiKeyRow[]> {
  const res = await db.pool.query(
    `
    select id, key_hash, key_prefix, created_at::text, revoked_at::text, rpm_limit, tenant_id
    from api_keys
    order by id desc
    limit 500
  `,
  );
  return res.rows;
}

export async function insertApiKey(db: Db, keyHash: string, keyPrefix: string): Promise<{ id: number }> {
  const res = await db.pool.query(
    `
    insert into api_keys (key_hash, key_prefix)
    values ($1, $2)
    returning id
  `,
    [keyHash, keyPrefix],
  );
  return { id: Number(res.rows[0]?.id) };
}

export async function revokeApiKey(db: Db, id: number): Promise<void> {
  await db.pool.query(`update api_keys set revoked_at = now() where id = $1 and revoked_at is null`, [id]);
}

export async function updateApiKeyRpm(db: Db, id: number, rpmLimit: number | null): Promise<void> {
  await db.pool.query(`update api_keys set rpm_limit = $2 where id = $1`, [id, rpmLimit]);
}

export async function updateApiKeyTenant(db: Db, id: number, tenantId: string | null): Promise<void> {
  await db.pool.query(`update api_keys set tenant_id = $2 where id = $1`, [id, tenantId]);
}

export async function findActiveApiKeyByHash(
  db: Db,
  keyHash: string,
): Promise<{ id: number; rpm_limit: number | null; tenant_id: string | null } | undefined> {
  const res = await db.pool.query(
    `select id, rpm_limit, tenant_id from api_keys where key_hash = $1 and revoked_at is null limit 1`,
    [keyHash],
  );
  if (!res.rows?.length) return;
  return {
    id: Number(res.rows[0].id),
    rpm_limit: res.rows[0].rpm_limit ?? null,
    tenant_id: res.rows[0].tenant_id ?? null,
  };
}

export type TenantRow = {
  tenant_id: string;
  created_at: string;
  rpm_limit: number | null;
  tpm_limit: number | null;
  disabled: boolean;
};

export async function deleteApiKey(db: Db, id: number, force: boolean): Promise<"deleted" | "not_found" | "must_revoke"> {
  const existsRes = await db.pool.query(`select id, key_hash, revoked_at, tenant_id from api_keys where id=$1 limit 1`, [id]);
  if (!existsRes.rows?.length) return "not_found";
  const row = existsRes.rows[0];

  if (!force && !row.revoked_at) return "must_revoke";

  await db.pool.query(`delete from usage_events where api_key_id=$1`, [row.id]);
  
  const res = await db.pool.query(`delete from api_keys where id=$1`, [id]);
  return res.rowCount === 1 ? "deleted" : "not_found";
}

export async function deleteTenant(
  db: Db,
  tenantId: string,
  force: boolean,
): Promise<"deleted" | "not_found" | "has_keys"> {
  if (!force) {
    const res = await db.pool.query(
      `
      delete from tenants
      where tenant_id = $1
        and not exists (select 1 from api_keys where tenant_id = $1)
    `,
      [tenantId],
    );
    if (res.rowCount === 1) return "deleted";

    const existsRes = await db.pool.query(`select tenant_id from tenants where tenant_id=$1 limit 1`, [tenantId]);
    if (!existsRes.rows?.length) return "not_found";

    const keysRes = await db.pool.query(`select 1 from api_keys where tenant_id=$1 limit 1`, [tenantId]);
    if (keysRes.rows?.length) return "has_keys";
    await db.pool.query(`delete from usage_events where tenant_id=$1`, [tenantId]);
    const res2 = await db.pool.query(`delete from tenants where tenant_id=$1`, [tenantId]);
    return res2.rowCount === 1 ? "deleted" : "not_found";
  }

  const existsRes = await db.pool.query(`select tenant_id from tenants where tenant_id=$1 limit 1`, [tenantId]);
  if (!existsRes.rows?.length) return "not_found";

  await db.pool.query(`delete from usage_events where tenant_id=$1`, [tenantId]);
  await db.pool.query(`update api_keys set tenant_id=null where tenant_id=$1`, [tenantId]);
  await db.pool.query(`delete from tenants where tenant_id=$1`, [tenantId]);
  return "deleted";
}

export async function unbindTenantKeys(db: Db, tenantId: string): Promise<number> {
  const res = await db.pool.query(`update api_keys set tenant_id=null where tenant_id=$1`, [tenantId]);
  return res.rowCount ?? 0;
}

export type BatchStatus = "queued" | "running" | "completed" | "failed";

export type BatchRow = {
  batch_id: string;
  principal: string;
  tenant_id: string | null;
  status: BatchStatus;
  created_at: string;
  updated_at: string;
  total: number;
  completed: number;
  failed: number;
};

export async function createBatch(
  db: Db,
  batchId: string,
  principal: string,
  tenantId: string | null,
  total: number,
): Promise<void> {
  await db.pool.query(
    `
    insert into batches (batch_id, principal, tenant_id, status, total)
    values ($1, $2, $3, 'queued', $4)
  `,
    [batchId, principal, tenantId, total],
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
    select batch_id, principal, tenant_id, status, created_at::text, updated_at::text, total, completed, failed
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

export async function claimBatch(db: Db, batchId: string): Promise<boolean> {
  const res = await db.pool.query(
    `update batches set status='running', updated_at=now() where batch_id=$1 and status='queued'`,
    [batchId],
  );
  return res.rowCount === 1;
}

export async function markBatchItemResult(
  db: Db,
  batchId: string,
  idx: number,
  status: "completed" | "failed",
  responseJson: string | null,
  error: string | null,
): Promise<void> {
  await db.pool.query(
    `
    update batch_items
    set status=$3, response_json=$4, error=$5
    where batch_id=$1 and idx=$2
  `,
    [batchId, idx, status, responseJson, error],
  );
}

export async function finishBatch(db: Db, batchId: string): Promise<void> {
  await db.pool.query(
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

export async function listTenants(db: Db): Promise<TenantRow[]> {
  const res = await db.pool.query(
    `
    select tenant_id, created_at::text, rpm_limit, tpm_limit, disabled
    from tenants
    order by tenant_id asc
    limit 500
  `,
  );
  return res.rows;
}

export async function upsertTenant(
  db: Db,
  tenantId: string,
  rpmLimit: number | null,
  tpmLimit: number | null,
  disabled: boolean,
): Promise<void> {
  await db.pool.query(
    `
    insert into tenants (tenant_id, rpm_limit, tpm_limit, disabled)
    values ($1, $2, $3, $4)
    on conflict (tenant_id) do update set
      rpm_limit = excluded.rpm_limit,
      tpm_limit = excluded.tpm_limit,
      disabled = excluded.disabled
  `,
    [tenantId, rpmLimit, tpmLimit, disabled],
  );
}

export async function findTenant(db: Db, tenantId: string): Promise<TenantRow | undefined> {
  const res = await db.pool.query(
    `select tenant_id, created_at::text, rpm_limit, tpm_limit, disabled from tenants where tenant_id = $1 limit 1`,
    [tenantId],
  );
  if (!res.rows?.length) return;
  return res.rows[0];
}

export type ConversationRow = {
  id: string;
  title: string;
  principal: string;
  tenant_id: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
};

export async function createConversation(
  db: Db,
  id: string,
  principal: string,
  tenantId: string | null,
): Promise<void> {
  await db.pool.query(
    `insert into conversations (id, title, principal, tenant_id) values ($1, $2, $3, $4)`,
    [id, "", principal, tenantId],
  );
}

export async function listConversations(db: Db, principal: string): Promise<ConversationRow[]> {
  const res = await db.pool.query(
    `
    select
      c.id, c.title, c.principal, c.tenant_id, c.created_at::text, c.updated_at::text,
      coalesce(msg_counts.cnt, 0)::int as message_count
    from conversations c
    left join (
      select conversation_id, count(*)::int as cnt from messages group by conversation_id
    ) msg_counts on msg_counts.conversation_id = c.id
    where c.principal = $1
    order by c.updated_at desc
    limit 100
  `,
    [principal],
  );
  return res.rows;
}

export async function getConversation(db: Db, id: string, principal: string): Promise<ConversationRow | undefined> {
  const res = await db.pool.query(
    `
    select
      c.id, c.title, c.principal, c.tenant_id, c.created_at::text, c.updated_at::text,
      coalesce(msg_counts.cnt, 0)::int as message_count
    from conversations c
    left join (
      select conversation_id, count(*)::int as cnt from messages group by conversation_id
    ) msg_counts on msg_counts.conversation_id = c.id
    where c.id = $1 and c.principal = $2
    limit 1
  `,
    [id, principal],
  );
  if (!res.rows?.length) return;
  return res.rows[0];
}

export async function updateConversationTitle(db: Db, id: string, title: string): Promise<void> {
  await db.pool.query(
    `update conversations set title = $2, updated_at = now() where id = $1`,
    [id, title],
  );
}

export async function touchConversation(db: Db, id: string): Promise<void> {
  await db.pool.query(`update conversations set updated_at = now() where id = $1`, [id]);
}

export async function deleteConversation(db: Db, id: string, principal: string): Promise<"deleted" | "not_found"> {
  const res = await db.pool.query(
    `delete from conversations where id = $1 and principal = $2`,
    [id, principal],
  );
  return res.rowCount === 1 ? "deleted" : "not_found";
}

export type MessageRow = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  created_at: string;
};

export async function insertMessage(
  db: Db,
  id: string,
  conversationId: string,
  role: string,
  content: string,
  model: string | null,
  promptTokens: number | null,
  completionTokens: number | null,
): Promise<void> {
  await db.pool.query(
    `insert into messages (id, conversation_id, role, content, model, prompt_tokens, completion_tokens) values ($1,$2,$3,$4,$5,$6,$7)`,
    [id, conversationId, role, content, model, promptTokens, completionTokens],
  );
}

export async function listMessages(db: Db, conversationId: string): Promise<MessageRow[]> {
  const res = await db.pool.query(
    `
    select id, conversation_id, role, content, model, prompt_tokens, completion_tokens, created_at::text
    from messages
    where conversation_id = $1
    order by created_at asc
  `,
    [conversationId],
  );
  return res.rows;
}
