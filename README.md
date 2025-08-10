# @ecom-co/redis

NestJS Redis module built on ioredis with multi-client support and optional health indicator.

## Install

```bash
npm i @ecom-co/redis ioredis
```

Peer deps: `@nestjs/common`, `@nestjs/core`.

## Usage

### Register

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
  useFactory: (config: ConfigService) => ({
    clients: [
      { type: 'single', name: 'default', host: config.get('REDIS_HOST'), port: config.get('REDIS_PORT') },
    ],
  }),
  inject: [ConfigService],
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

### Health (optional)

```ts
import { checkRedisHealthy } from '@ecom-co/redis';
const res = await checkRedisHealthy(redisClient);
```

## Notes
- Dependencies are peers; install them in the app.
- Exposes root-only API. Avoid deep imports.

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


