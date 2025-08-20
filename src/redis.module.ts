import { DynamicModule, Global, Module, Provider } from '@nestjs/common';

// Thêm filter, map và xóa các import không cần thiết
// Removed lodash/filter in favor of native Array#filter with type guards to avoid overload ambiguity
import get from 'lodash/get';
import isArray from 'lodash/isArray';
import isObject from 'lodash/isObject';
import isString from 'lodash/isString';
// Removed lodash/map in favor of native Array#map
import toLower from 'lodash/toLower';
import trim from 'lodash/trim';

import {
    getRedisClientToken,
    getRedisFacadeToken,
    REDIS_DEFAULT_CLIENT_NAME,
    REDIS_MODULE_OPTIONS,
} from './redis.constants';
import { RedisFacade } from './redis.facade';
import { RedisService } from './redis.service';

import type { RedisClient, RedisClientOptions, RedisModuleAsyncOptions, RedisModuleOptions } from './redis.interfaces';

const normalizeName = (name?: string): string => {
    const trimmedName = trim(name) || REDIS_DEFAULT_CLIENT_NAME;

    return toLower(trimmedName);
};

const isRedisClientOptions = (value: unknown): value is RedisClientOptions => isObject(value);
const isStringName = (value: unknown): value is string => isString(value);

const createClientProviders = (options: RedisModuleOptions): Provider[] => {
    if (!isObject(options) || !isArray(options.clients)) {
        return [];
    }

    const objectClients = options.clients.filter(isRedisClientOptions);
    const mappedProviders: Provider[] = objectClients.map((clientOptions: RedisClientOptions) => {
        const name = normalizeName(get(clientOptions, 'name'));
        const token = getRedisClientToken(name);

        return {
            inject: [RedisService],
            provide: token,
            useFactory: (service: RedisService): RedisClient => service.get(name),
        } satisfies Provider;
    });

    return mappedProviders;
};

const createFacadeProviders = (options: RedisModuleOptions): Provider[] => {
    if (!isObject(options) || !isArray(options.clients)) {
        return [];
    }

    const objectClients = options.clients.filter(isRedisClientOptions);
    const mappedProviders: Provider[] = objectClients.map((clientOptions: RedisClientOptions) => {
        const name = normalizeName(get(clientOptions, 'name'));
        const clientToken = getRedisClientToken(name);
        const facadeToken = getRedisFacadeToken(name);

        return {
            inject: [clientToken],
            provide: facadeToken,
            useFactory: (client: RedisClient): RedisFacade => new RedisFacade(client),
        } satisfies Provider;
    });

    return mappedProviders;
};

@Global()
@Module({})
export class RedisModule {
    static forRoot(options: RedisModuleOptions): DynamicModule {
        if (!isObject(options)) {
            throw new Error('RedisModuleOptions must be a valid object');
        }

        const optionProvider: Provider = { provide: REDIS_MODULE_OPTIONS, useValue: options };
        const serviceProvider: Provider = {
            inject: [REDIS_MODULE_OPTIONS],
            provide: RedisService,
            useFactory: (opts: RedisModuleOptions): RedisService => {
                const service = new RedisService();

                service.configure(opts);

                return service;
            },
        };

        const clientProviders = createClientProviders(options);
        const facadeProviders = createFacadeProviders(options);

        const defaultProvider: Provider = {
            inject: [RedisService],
            provide: getRedisClientToken(REDIS_DEFAULT_CLIENT_NAME),
            useFactory: (service: RedisService) => service.get(REDIS_DEFAULT_CLIENT_NAME),
        };

        const clientTokens = (options.clients || [])
            .filter(isRedisClientOptions)
            .map((c) => getRedisClientToken(normalizeName(get(c, 'name'))));

        const facadeTokens = (options.clients || [])
            .filter(isRedisClientOptions)
            .map((c) => getRedisFacadeToken(normalizeName(get(c, 'name'))));

        return {
            providers: [optionProvider, serviceProvider, defaultProvider, ...clientProviders, ...facadeProviders],
            exports: [
                RedisService,
                getRedisClientToken(REDIS_DEFAULT_CLIENT_NAME),
                ...clientTokens,
                getRedisFacadeToken(REDIS_DEFAULT_CLIENT_NAME),
                ...facadeTokens,
            ],
            module: RedisModule,
        };
    }

    static forRootAsync(options: RedisModuleAsyncOptions): DynamicModule {
        if (!isObject(options)) {
            throw new Error('RedisModuleAsyncOptions must be a valid object');
        }

        const asyncOptionsProvider: Provider = {
            inject: isArray(options.inject) ? options.inject : [],
            provide: REDIS_MODULE_OPTIONS,
            useFactory: options.useFactory,
        };

        const serviceProvider: Provider = {
            inject: [REDIS_MODULE_OPTIONS],
            provide: RedisService,
            useFactory: (opts: RedisModuleOptions): RedisService => {
                const service = new RedisService();

                service.configure(opts);

                return service;
            },
        };

        const predeclareList = isArray(options.predeclare) ? options.predeclare : [];
        const stringPredeclares = predeclareList.filter(isStringName);

        const predeclaredProviders: Provider[] = stringPredeclares.map((rawName): Provider => {
            const name = normalizeName(rawName);

            return {
                inject: [RedisService],
                provide: getRedisClientToken(name),
                useFactory: (service: RedisService): RedisClient => service.get(name),
            } satisfies Provider;
        });

        const proxyProviders: Provider[] = [
            {
                inject: [RedisService],
                provide: getRedisClientToken(REDIS_DEFAULT_CLIENT_NAME),
                useFactory: (service: RedisService): RedisClient => service.get(REDIS_DEFAULT_CLIENT_NAME),
            },
            ...predeclaredProviders,
        ];

        const predeclaredFacadeProxyProviders: Provider[] = stringPredeclares.map((rawName): Provider => {
            const name = normalizeName(rawName);

            return {
                inject: [RedisService],
                provide: getRedisFacadeToken(name),
                useFactory: (service: RedisService): RedisFacade => new RedisFacade(service.get(name)),
            } satisfies Provider;
        });

        const facadeProxyProviders: Provider[] = [
            {
                inject: [RedisService],
                provide: getRedisFacadeToken(REDIS_DEFAULT_CLIENT_NAME),
                useFactory: (service: RedisService): RedisFacade =>
                    new RedisFacade(service.get(REDIS_DEFAULT_CLIENT_NAME)),
            },
            ...predeclaredFacadeProxyProviders,
        ];

        const predeclaredTokens = stringPredeclares.map((n) => getRedisClientToken(normalizeName(n)));
        const predeclaredFacadeTokens = stringPredeclares.map((n) => getRedisFacadeToken(normalizeName(n)));

        return {
            imports: isArray(options.imports) ? options.imports : [],
            providers: [asyncOptionsProvider, serviceProvider, ...proxyProviders, ...facadeProxyProviders],
            exports: [
                RedisService,
                getRedisClientToken(REDIS_DEFAULT_CLIENT_NAME),
                ...predeclaredTokens,
                getRedisFacadeToken(REDIS_DEFAULT_CLIENT_NAME),
                ...predeclaredFacadeTokens,
            ],
            module: RedisModule,
        };
    }
}
