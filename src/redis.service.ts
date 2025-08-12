import { Injectable, Logger, OnModuleDestroy, type LoggerService } from '@nestjs/common';

import { REDIS_DEFAULT_CLIENT_NAME } from './redis.constants';
import { RedisFacade } from './redis.facade';
import type { RedisClient, RedisModuleOptions } from './redis.interfaces';
import { createRedisClient } from './redis.utils';

@Injectable()
export class RedisService implements OnModuleDestroy {
    private readonly nameToClient = new Map<string, RedisClient>();
    private logger: LoggerService = new Logger(RedisService.name);

    configure(options: RedisModuleOptions): void {
        if (options.logger) {
            this.logger = options.logger;
        }
        for (const def of options.clients) {
            const name = (def.name || REDIS_DEFAULT_CLIENT_NAME).toLowerCase();
            const client = createRedisClient(def);
            this.nameToClient.set(name, client);
            this.attachLogs(name, client);
        }
    }

    get(name = REDIS_DEFAULT_CLIENT_NAME): RedisClient {
        const key = name.toLowerCase();
        const client = this.nameToClient.get(key);
        if (!client) throw new Error(`Redis client not found: ${name}`);
        return client;
    }

    private attachLogs(name: string, client: RedisClient): void {
        const label = `redis:${name}`;
        type RedisLikeOn = {
            (event: 'connect' | 'ready' | 'end', listener: () => void): void;
            (event: 'reconnecting', listener: (time: number) => void): void;
            (event: 'error', listener: (err: unknown) => void): void;
        };
        type RedisLikeEmitter = { on: RedisLikeOn };
        const emitter = client as unknown as RedisLikeEmitter;
        emitter.on('connect', () => {
            this.logger.log?.(`${label} connect`);
        });
        emitter.on('ready', () => {
            this.logger.log?.(`${label} ready`);
        });
        emitter.on('reconnecting', (time: number) => {
            this.logger.warn?.(`${label} reconnecting in ${time}ms`);
        });
        emitter.on('end', () => {
            this.logger.warn?.(`${label} end`);
        });
        emitter.on('error', (err: unknown) => {
            this.logger.error?.(`${label} error`, (err as Error)?.stack);
        });
    }

    // Ergonomic wrapper with helpers (JSON, prefix, caching, locks, ...)
    use(name = REDIS_DEFAULT_CLIENT_NAME, prefix = ''): RedisFacade {
        const client = this.get(name);
        return new RedisFacade(client, prefix);
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
