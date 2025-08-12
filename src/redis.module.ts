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
import type { RedisClient, RedisClientOptions, RedisModuleAsyncOptions, RedisModuleOptions } from './redis.interfaces';
import { RedisService } from './redis.service';

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
            provide: token,
            useFactory: (service: RedisService): RedisClient => service.get(name),
            inject: [RedisService],
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
            provide: facadeToken,
            useFactory: (client: RedisClient): RedisFacade => new RedisFacade(client),
            inject: [clientToken],
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

        const clientTokens = (options.clients || [])
            .filter(isRedisClientOptions)
            .map((c) => getRedisClientToken(normalizeName(get(c, 'name'))));

        const facadeTokens = (options.clients || [])
            .filter(isRedisClientOptions)
            .map((c) => getRedisFacadeToken(normalizeName(get(c, 'name'))));

        return {
            module: RedisModule,
            providers: [optionProvider, serviceProvider, defaultProvider, ...clientProviders, ...facadeProviders],
            exports: [
                RedisService,
                getRedisClientToken(REDIS_DEFAULT_CLIENT_NAME),
                ...clientTokens,
                getRedisFacadeToken(REDIS_DEFAULT_CLIENT_NAME),
                ...facadeTokens,
            ],
        };
    }

    static forRootAsync(options: RedisModuleAsyncOptions): DynamicModule {
        if (!isObject(options)) {
            throw new Error('RedisModuleAsyncOptions must be a valid object');
        }

        const asyncOptionsProvider: Provider = {
            provide: REDIS_MODULE_OPTIONS,
            useFactory: options.useFactory,
            inject: isArray(options.inject) ? options.inject : [],
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

        const predeclareList = isArray(options.predeclare) ? options.predeclare : [];
        const stringPredeclares = predeclareList.filter(isStringName);

        const predeclaredProviders: Provider[] = stringPredeclares.map((rawName): Provider => {
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

        const predeclaredFacadeProxyProviders: Provider[] = stringPredeclares.map((rawName): Provider => {
            const name = normalizeName(rawName);
            return {
                provide: getRedisFacadeToken(name),
                useFactory: (service: RedisService): RedisFacade => new RedisFacade(service.get(name)),
                inject: [RedisService],
            } satisfies Provider;
        });

        const facadeProxyProviders: Provider[] = [
            {
                provide: getRedisFacadeToken(REDIS_DEFAULT_CLIENT_NAME),
                useFactory: (service: RedisService): RedisFacade =>
                    new RedisFacade(service.get(REDIS_DEFAULT_CLIENT_NAME)),
                inject: [RedisService],
            },
            ...predeclaredFacadeProxyProviders,
        ];

        const predeclaredTokens = stringPredeclares.map((n) => getRedisClientToken(normalizeName(n)));
        const predeclaredFacadeTokens = stringPredeclares.map((n) => getRedisFacadeToken(normalizeName(n)));

        return {
            module: RedisModule,
            imports: isArray(options.imports) ? options.imports : [],
            providers: [asyncOptionsProvider, serviceProvider, ...proxyProviders, ...facadeProxyProviders],
            exports: [
                RedisService,
                getRedisClientToken(REDIS_DEFAULT_CLIENT_NAME),
                ...predeclaredTokens,
                getRedisFacadeToken(REDIS_DEFAULT_CLIENT_NAME),
                ...predeclaredFacadeTokens,
            ],
        };
    }
}
