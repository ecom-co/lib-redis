import 'reflect-metadata';
import { createRedisClient } from '../src/redis.utils';
import type { RedisClientOptions } from '../src/redis.interfaces';

async function main() {
  const opts: RedisClientOptions = {
    type: 'single',
    host: '127.0.0.1',
    port: 6379,
    // connectionString: 'redis://:pass@127.0.0.1:6379/0',
  };
  const client = createRedisClient(opts);
  await client.set('example:key', 'hello', 'EX', 5);
  const v = await client.get('example:key');
  console.log('GET example:key =', v);
  await (client as any).quit();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


