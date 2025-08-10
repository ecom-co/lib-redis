import { DynamicModule, Global, Module, Provider } from '@nestjs/common';

import {
    getRedisClientToken,
    getRedisFacadeToken,
    REDIS_DEFAULT_CLIENT_NAME,
    REDIS_MODULE_OPTIONS,
} from './redis.constants';
import { RedisFacade } from './redis.facade';
import type { RedisClient, RedisClientOptions, RedisModuleAsyncOptions, RedisModuleOptions } from './redis.interfaces';
import { RedisService } from './redis.service';

const normalizeName = (name?: string): string => (name?.trim() || REDIS_DEFAULT_CLIENT_NAME).toLowerCase();

const createClientProviders = (options: RedisModuleOptions): Provider[] =>
    options.clients.map((clientOptions: RedisClientOptions) => {
        const name = normalizeName(clientOptions.name);
        const token = getRedisClientToken(name);
        return {
            provide: token,
            useFactory: (service: RedisService): RedisClient => service.get(name),
            inject: [RedisService],
        } satisfies Provider;
    });

const createFacadeProviders = (options: RedisModuleOptions): Provider[] =>
    options.clients.map((clientOptions: RedisClientOptions) => {
        const name = normalizeName(clientOptions.name);
        const clientToken = getRedisClientToken(name);
        const facadeToken = getRedisFacadeToken(name);
        return {
            provide: facadeToken,
            useFactory: (client: RedisClient): RedisFacade => new RedisFacade(client, name),
            inject: [clientToken],
        } satisfies Provider;
    });

@Global()
@Module({})
export class RedisModule {
    static forRoot(options: RedisModuleOptions): DynamicModule {
        const optionProvider: Provider = { provide: REDIS_MODULE_OPTIONS, useValue: options };
        const serviceProvider: Provider = {
            provide: RedisService,
            useFactory: (opts: RedisModuleOptions): RedisService => {
                const service = new RedisService();
                service.configure(opts);
                return service;
            },
            inject: [REDIS_MODULE_OPTIONS],
        };
        const clientProviders = createClientProviders(options);
        const facadeProviders = createFacadeProviders(options);
        const defaultProvider: Provider = {
            provide: getRedisClientToken(REDIS_DEFAULT_CLIENT_NAME),
            useFactory: (service: RedisService) => service.get(REDIS_DEFAULT_CLIENT_NAME),
            inject: [RedisService],
        };
        return {
            module: RedisModule,
            providers: [optionProvider, serviceProvider, defaultProvider, ...clientProviders, ...facadeProviders],
            exports: [
                RedisService,
                getRedisClientToken(REDIS_DEFAULT_CLIENT_NAME),
                ...options.clients.map((c) => getRedisClientToken(normalizeName(c.name))),
                getRedisFacadeToken(REDIS_DEFAULT_CLIENT_NAME),
                ...options.clients.map((c) => getRedisFacadeToken(normalizeName(c.name))),
            ],
        };
    }

    static forRootAsync(options: RedisModuleAsyncOptions): DynamicModule {
        const asyncOptionsProvider: Provider = {
            provide: REDIS_MODULE_OPTIONS,
            useFactory: options.useFactory,
            inject: options.inject || [],
        };
        const serviceProvider: Provider = {
            provide: RedisService,
            useFactory: (opts: RedisModuleOptions): RedisService => {
                const service = new RedisService();
                service.configure(opts);
                return service;
            },
            inject: [REDIS_MODULE_OPTIONS],
        };

        // We cannot add providers after Nest compiles module metadata.
        // So we predeclare proxy providers for the default client and any names listed in options.predeclare.
        const predeclaredProviders: Provider[] = (options.predeclare ?? []).map((rawName): Provider => {
            const name = normalizeName(rawName);
            return {
                provide: getRedisClientToken(name),
                useFactory: (service: RedisService): RedisClient => service.get(name),
                inject: [RedisService],
            } satisfies Provider;
        });
        const proxyProviders: Provider[] = [
            {
                provide: getRedisClientToken(REDIS_DEFAULT_CLIENT_NAME),
                useFactory: (service: RedisService): RedisClient => service.get(REDIS_DEFAULT_CLIENT_NAME),
                inject: [RedisService],
            },
            ...predeclaredProviders,
        ];

        const facadeProxyProviders: Provider[] = [
            {
                provide: getRedisFacadeToken(REDIS_DEFAULT_CLIENT_NAME),
                useFactory: (service: RedisService): RedisFacade =>
                    new RedisFacade(service.get(REDIS_DEFAULT_CLIENT_NAME), REDIS_DEFAULT_CLIENT_NAME),
                inject: [RedisService],
            },
            ...(options.predeclare ?? []).map((rawName): Provider => {
                const name = normalizeName(rawName);
                return {
                    provide: getRedisFacadeToken(name),
                    useFactory: (service: RedisService): RedisFacade => new RedisFacade(service.get(name), name),
                    inject: [RedisService],
                } satisfies Provider;
            }),
        ];

        return {
            module: RedisModule,
            imports: options.imports || [],
            providers: [asyncOptionsProvider, serviceProvider, ...proxyProviders, ...facadeProxyProviders],
            exports: (() => {
                const predeclaredTokens = (options.predeclare ?? []).map((n) => getRedisClientToken(normalizeName(n)));
                const predeclaredFacadeTokens = (options.predeclare ?? []).map((n) =>
                    getRedisFacadeToken(normalizeName(n)),
                );
                return [
                    RedisService,
                    getRedisClientToken(REDIS_DEFAULT_CLIENT_NAME),
                    ...predeclaredTokens,
                    getRedisFacadeToken(REDIS_DEFAULT_CLIENT_NAME),
                    ...predeclaredFacadeTokens,
                ];
            })(),
        };
    }
}
