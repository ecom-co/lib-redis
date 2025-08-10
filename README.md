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


