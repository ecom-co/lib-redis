import { Injectable, Logger, type LoggerService, OnModuleDestroy } from '@nestjs/common';

import compact from 'lodash/compact';
import forEach from 'lodash/forEach';
import get from 'lodash/get';
import isArray from 'lodash/isArray';
import isFunction from 'lodash/isFunction';
import isObject from 'lodash/isObject';
import isString from 'lodash/isString';
import map from 'lodash/map';
import toLower from 'lodash/toLower';
import trim from 'lodash/trim';

import { REDIS_DEFAULT_CLIENT_NAME } from './redis.constants';
import { RedisFacade } from './redis.facade';
import { createRedisClient } from './redis.utils';

import type { RedisClient, RedisModuleOptions } from './redis.interfaces';

@Injectable()
export class RedisService implements OnModuleDestroy {
    private logger: LoggerService = new Logger(RedisService.name);
    private readonly nameToClient = new Map<string, RedisClient>();

    get(name = REDIS_DEFAULT_CLIENT_NAME): RedisClient {
        if (!isString(name)) {
            throw new Error('Redis client name must be a string');
        }

        const key = toLower(trim(name));
        const client = this.nameToClient.get(key);

        if (!client) {
            const availableClients = Array.from(this.nameToClient.keys());

            throw new Error(`Redis client not found: ${name}. Available clients: [${availableClients.join(', ')}]`);
        }

        return client;
    }

    configure(options: RedisModuleOptions): void {
        if (!isObject(options)) {
            throw new Error('RedisModuleOptions must be a valid object');
        }

        if (options.logger && isObject(options.logger)) {
            this.logger = options.logger;
        }

        const clients = get(options, 'clients', []);

        if (!isArray(clients)) {
            throw new Error('RedisModuleOptions.clients must be an array');
        }

        forEach(clients, (def) => {
            if (!isObject(def)) {
                this.logger.warn?.('Skipping invalid client definition - not an object');

                return;
            }

            const rawName = get(def, 'name', REDIS_DEFAULT_CLIENT_NAME);
            const name = toLower(trim(isString(rawName) ? rawName : REDIS_DEFAULT_CLIENT_NAME));

            try {
                const client = createRedisClient(def);

                this.nameToClient.set(name, client);
                this.attachLogs(name, client);
            } catch (error) {
                this.logger.error?.(`Failed to create Redis client '${name}':`, get(error, 'stack', error));
                throw error;
            }
        });
    }

    private attachLogs(name: string, client: RedisClient): void {
        if (!isString(name) || !isObject(client)) {
            this.logger.warn?.('Invalid parameters for attachLogs');

            return;
        }

        const label = `redis:${name}`;

        type RedisLikeOn = {
            (event: 'connect' | 'end' | 'ready', listener: () => void): void;
            (event: 'reconnecting', listener: (time: number) => void): void;
            (event: 'error', listener: (err: unknown) => void): void;
        };
        type RedisLikeEmitter = { on: RedisLikeOn };

        const emitter = client as unknown as RedisLikeEmitter;

        if (!isFunction(get(emitter, 'on'))) {
            this.logger.warn?.(`Redis client '${name}' does not support event listeners`);

            return;
        }

        try {
            emitter.on('connect', () => {
                this.logger?.log?.(`${label} connect`);
            });

            emitter.on('ready', () => {
                this.logger?.log?.(`${label} ready`);
            });

            emitter.on('reconnecting', (time: number) => {
                const timeStr = isFinite(time) ? `${time}ms` : 'unknown time';

                this.logger?.warn?.(`${label} reconnecting in ${timeStr}`);
            });

            emitter.on('end', () => {
                this.logger?.warn?.(`${label} end`);
            });

            emitter.on('error', (err: unknown) => {
                const errorStack = get(err, 'stack', get(err, 'message', 'Unknown error'));

                this.logger?.error?.(`${label} error`, errorStack);
            });
        } catch (error) {
            this.logger.warn?.(
                `Failed to attach event listeners for Redis client '${name}':`,
                get(error, 'message', error),
            );
        }
    }

    // Ergonomic wrapper with helpers (JSON, prefix, caching, locks, ...)
    async onModuleDestroy(): Promise<void> {
        const clientEntries = Array.from(this.nameToClient.entries());

        const closePromises = compact(
            map(clientEntries, ([clientName, client]) => {
                try {
                    // Both standalone and cluster support quit()
                    const anyClient = client as unknown as { quit: () => Promise<unknown> };

                    if (isFunction(get(anyClient, 'quit'))) {
                        return anyClient.quit().catch((error) => {
                            this.logger?.warn?.(
                                `Failed to gracefully close Redis client '${clientName}':`,
                                get(error, 'message', error),
                            );
                        });
                    }

                    this.logger?.warn?.(`Redis client '${clientName}' does not support quit() method`);

                    return null;
                } catch (error) {
                    this.logger?.warn?.(
                        `Error during Redis client '${clientName}' shutdown:`,
                        get(error, 'message', error),
                    );

                    return null;
                }
            }),
        );

        if (closePromises.length > 0) {
            try {
                await Promise.allSettled(closePromises);
            } catch (error) {
                this.logger?.error?.('Error during Redis clients shutdown:', get(error, 'message', error));
            }
        }

        this.nameToClient.clear();

        this.logger?.log?.('All Redis clients have been closed');
    }

    use(name = REDIS_DEFAULT_CLIENT_NAME, prefix = ''): RedisFacade {
        const normalizedName = isString(name) ? name : REDIS_DEFAULT_CLIENT_NAME;
        const normalizedPrefix = isString(prefix) ? prefix : '';

        const client = this.get(normalizedName);

        return new RedisFacade(client, normalizedPrefix);
    }
}
