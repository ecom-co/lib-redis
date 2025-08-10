import 'reflect-metadata';
import { createRedisClient } from '../src/redis.utils';
import type { RedisClientOptions } from '../src/redis.interfaces';

async function main() {
  const {
    REDIS_URL,
    REDIS_HOST = '127.0.0.1',
    REDIS_PORT = '6379',
    REDIS_PASSWORD,
    REDIS_DB,
  } = process.env as Record<string, string | undefined>;

  let opts: RedisClientOptions;
  if (REDIS_URL) {
    opts = {
      type: 'single',
      name: 'fromUrl',
      connectionString: REDIS_URL,
      password: REDIS_PASSWORD,
    } as const;
  } else {
    opts = {
      type: 'single',
      name: 'fromFields',
      host: REDIS_HOST,
      port: Number(REDIS_PORT),
      password: REDIS_PASSWORD,
      db: REDIS_DB ? Number(REDIS_DB) : undefined,
    } as const;
  }

  const client = createRedisClient(opts);
  const key = `example:env:${Date.now()}`;
  await client.set(key, 'ok', 'EX', 10);
  const v = await client.get(key);
  console.log('GET', key, '=', v);
  await (client as any).quit();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


