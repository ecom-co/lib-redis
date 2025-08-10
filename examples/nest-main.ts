import 'reflect-metadata';
import { Module, Injectable, OnModuleInit } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { InjectRedis, RedisClient, RedisModule } from '@ecom-co/redis';

@Injectable()
class DemoService implements OnModuleInit {
  constructor(@InjectRedis() private readonly redis: RedisClient) {}

  async onModuleInit() {
    await this.redis.set('example:nest', 'works', 'EX', 5);
    const v = await this.redis.get('example:nest');
    console.log('Nest example ->', v);
  }
}

const { REDIS_URL, REDIS_HOST = '127.0.0.1', REDIS_PORT = '6379', REDIS_PASSWORD, REDIS_DB } =
  process.env as Record<string, string | undefined>;

@Module({
  imports: [
    RedisModule.forRoot({
      clients: [
        REDIS_URL
          ? ({ type: 'single', name: 'default', connectionString: REDIS_URL, password: REDIS_PASSWORD } as const)
          : ({
              type: 'single',
              name: 'default',
              host: REDIS_HOST,
              port: Number(REDIS_PORT),
              password: REDIS_PASSWORD,
              db: REDIS_DB ? Number(REDIS_DB) : undefined,
            } as const),
      ],
    }),
  ],
  providers: [DemoService],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  await app.close();
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});


