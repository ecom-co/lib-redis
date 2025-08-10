import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { RedisClient, RedisModuleOptions } from './redis.interfaces';
import { createRedisClient } from './redis.utils';
import { REDIS_DEFAULT_CLIENT_NAME } from './redis.constants';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly nameToClient = new Map<string, RedisClient>();

  configure(options: RedisModuleOptions): void {
    for (const def of options.clients) {
      const name = (def.name || REDIS_DEFAULT_CLIENT_NAME).toLowerCase();
      const client = createRedisClient(def);
      this.nameToClient.set(name, client);
    }
  }

  get(name = REDIS_DEFAULT_CLIENT_NAME): RedisClient {
    const key = name.toLowerCase();
    const client = this.nameToClient.get(key);
    if (!client) throw new Error(`Redis client not found: ${name}`);
    return client;
  }

  async onModuleDestroy(): Promise<void> {
    const closePromises: Array<Promise<unknown>> = [];
    for (const client of this.nameToClient.values()) {
      // Both standalone and cluster support quit()
      const anyClient = client as unknown as { quit: () => Promise<unknown> };
      try {
        closePromises.push(anyClient.quit());
      } catch {
        // ignore
      }
    }
    await Promise.allSettled(closePromises);
    this.nameToClient.clear();
  }
}


