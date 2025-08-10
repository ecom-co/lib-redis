# @ecom-co/redis

NestJS Redis module built on ioredis with multi-client support and optional health indicator.

## Install

```bash
npm i @ecom-co/redis ioredis
```

Peer deps: `@nestjs/common`, `@nestjs/core`.

## Usage

### Register (sync)

```ts
import { Module } from '@nestjs/common';
import { RedisModule } from '@ecom-co/redis';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: [
        { type: 'single', name: 'default', host: 'localhost', port: 6379 },
        { type: 'single', name: 'cache', host: 'localhost', port: 6380 },
        // Cluster example
        // { type: 'cluster', name: 'clustered', nodes: [{ host: 'r1', port: 6379 }, { host: 'r2', port: 6379 }] },
      ],
    }),
  ],
})
export class AppModule {}
```

or async:

```ts
RedisModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    clients: [
      { type: 'single', name: 'default', connectionString: config.get('REDIS_URL') },
      { type: 'single', name: 'forward', connectionString: 'redis://user:pass@host:6379' },
    ],
  }),
  // Optional in async mode: predeclare names to enable direct DI by name
  predeclare: ['forward'],
});
```

### Inject client

```ts
import { Injectable } from '@nestjs/common';
import { InjectRedis, RedisClient } from '@ecom-co/redis';

@Injectable()
export class CacheService {
  constructor(@InjectRedis() private readonly redis: RedisClient) {}

  async set(key: string, value: string) {
    await this.redis.set(key, value, 'EX', 60);
  }
}
```

Inject a named client (sync or async with predeclared name):

```ts
@Injectable()
export class ForwardService {
  constructor(@InjectRedis('forward') private readonly redis: RedisClient) {}
}
```

Async without predeclare: use `RedisService` and resolve by name at runtime:

```ts
@Injectable()
export class ForwardService {
  constructor(private readonly redisService: RedisService) {}
  get client() {
    return this.redisService.get('forward');
  }
}
```

### Type-safe client names (compile-time)

For stricter typing of client names:

```ts
import {
  InjectRedis,
  RedisClient,
  RedisClientNamesFromOptions,
  RedisClientNamesFromPredeclare,
  defineRedisNames,
} from '@ecom-co/redis';

// Sync (forRoot): derive names from options
const options = {
  clients: [
    { type: 'single', name: 'default', connectionString: 'redis://...' },
    { type: 'single', name: 'forward', connectionString: 'redis://...' },
  ],
} as const;
type ClientName = RedisClientNamesFromOptions<typeof options>; // 'default' | 'forward'

// Async (forRootAsync): derive names from predeclare
const names = ['FORWARD', 'CACHE'] as const;
const RedisNames = defineRedisNames(names);
type AsyncClientName = RedisClientNamesFromPredeclare<typeof names>; // 'default' | 'forward' | 'cache'

@Injectable()
export class ExampleService {
  constructor(
    @InjectRedis('forward' as ClientName) private readonly forward: RedisClient,
    // No 'as' needed using defineRedisNames helper
    @InjectRedis(RedisNames.CACHE) private readonly cache: RedisClient,
  ) {}
}
```

### Health (optional)

```ts
import { checkRedisHealthy } from '@ecom-co/redis';
const res = await checkRedisHealthy(redisClient);
```

## Notes
- Dependencies are peers; install them in the app.
- Exposes root-only API. Avoid deep imports.
- Tokens are uppercase: `REDIS_CLIENT` (default) and `REDIS_CLIENT_<NAME>` for named clients.
- Names in DI are case-insensitive; internally normalized.

## Connection strings

### Single
```ts
RedisModule.forRoot({
  clients: [
    { type: 'single', name: 'fromUrl', connectionString: 'redis://:pass@localhost:6379/0' },
    // rediss (TLS)
    { type: 'single', name: 'secure', connectionString: 'rediss://:pass@your-host:6380/0', tls: {} },
  ],
});
```

### Cluster
```ts
RedisModule.forRoot({
  clients: [
    {
      type: 'cluster',
      name: 'clustered',
      nodes: [
        'redis://:pass@r1:6379/0',
        { host: 'r2', port: 6379 },
      ],
      redisOptions: { password: 'pass' },
    },
  ],
});
```


### RedisFacade (high-level utilities)

The `RedisFacade` wraps a `RedisClient` and provides batteries-included helpers: JSON handling, batching, locks, rate limiting, health/stats, key prefixing, and more.

```ts
import { Injectable } from '@nestjs/common';
import { InjectRedis, InjectRedisFacade, RedisClient, RedisFacade } from '@ecom-co/redis';

@Injectable()
export class ExampleCache {
  constructor(@InjectRedisFacade() private readonly cache: RedisFacade) {}

  async basic() {
    // String or object values; TTL options supported
    await this.cache.set('greeting', 'hello', { ttlSeconds: 60 });
    const v = await this.cache.get<string>('greeting');

    // JSON helpers
    await this.cache.setJson('user:1', { id: 1, name: 'Ada' }, { ttlSeconds: 300 });
    const user = await this.cache.getJson<{ id: number; name: string }>('user:1');

    // Idempotent create (NX) or update-only (XX); return old value (GET)
    await this.cache.set('only-once', 'v', { mode: 'NX' });
    const old = await this.cache.set('swap', 'new', { get: true });

    return { v, user, old };
  }

  async withPrefixExample() {
    const session = this.cache.withPrefix('session');
    await session.set('token:abc', '...', { ttlSeconds: 900 });
  }

  async batching() {
    await this.cache.mset([
      { key: 'a', value: 1 },
      { key: 'b', value: { x: 2 } },
    ]);
    const values = await this.cache.mget(['a', 'b', 'c']); // [1, {x:2}, null]
    return values;
  }

  async locking() {
    // Acquire lock, run work, auto-release
    return this.cache.withLock('order:123', 15_000, async () => {
      // critical section
      return 'done';
    }, { maxRetries: 2, retryDelayMs: 100 });
  }

  async rateLimiting(ip: string) {
    const fixed = await this.cache.rateLimit(`ip:${ip}`, 100, 60_000);
    const sliding = await this.cache.slidingWindowRateLimit(`ip:${ip}`, 100, 60_000);
    return { fixed, sliding };
  }

  async observability() {
    const health = await this.cache.healthCheck();
    const deep = await this.cache.deepHealthCheck();
    const stats = await this.cache.getCacheStats();
    return { health, deep, stats };
  }
}
```

Common options for `set` (all optional):
- `ttlSeconds`, `pxMs`, `exAtSec`, `pxAtMs`, `keepTtl`
- `mode`: `'NX' | 'XX'`
- `get`: `true` to return previous value

