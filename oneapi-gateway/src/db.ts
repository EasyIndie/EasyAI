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
 * EasyAI only owns chat history + batch bookkeeping.
 * API keys, tenants, spend and request logs live in LiteLLM.
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

  await pool.query(`
    create table if not exists conversations (
      id uuid primary key,
      title text not null default '',
      principal text not null,
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

export type ConversationRow = {
  id: string;
  title: string;
  principal: string;
  created_at: string;
  updated_at: string;
  message_count: number;
};

export async function createConversation(db: Db, id: string, principal: string): Promise<void> {
  await db.pool.query(`insert into conversations (id, title, principal) values ($1, $2, $3)`, [id, "", principal]);
}

export async function listConversations(db: Db, principal: string): Promise<ConversationRow[]> {
  const res = await db.pool.query(
    `
    select
      c.id, c.title, c.principal, c.created_at::text, c.updated_at::text,
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
      c.id, c.title, c.principal, c.created_at::text, c.updated_at::text,
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
  await db.pool.query(`update conversations set title = $2, updated_at = now() where id = $1`, [id, title]);
}

export async function touchConversation(db: Db, id: string): Promise<void> {
  await db.pool.query(`update conversations set updated_at = now() where id = $1`, [id]);
}

export async function deleteConversation(db: Db, id: string, principal: string): Promise<"deleted" | "not_found"> {
  const res = await db.pool.query(`delete from conversations where id = $1 and principal = $2`, [id, principal]);
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
