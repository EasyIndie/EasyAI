import { createClient } from "redis";

export type RedisClient = ReturnType<typeof createClient>;

export async function createRedis(url: string): Promise<RedisClient> {
  const client = createClient({ url });
  client.on("error", () => {});
  await client.connect();
  return client;
}

