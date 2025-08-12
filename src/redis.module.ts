import { DynamicModule, Global, Module, Provider } from '@nestjs/common';

import chain from 'lodash/chain';
import compact from 'lodash/compact';
import get from 'lodash/get';
import isArray from 'lodash/isArray';
import isObject from 'lodash/isObject';
import isString from 'lodash/isString';
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

const createClientProviders = (options: RedisModuleOptions): Provider[] => {
    if (!isObject(options) || !isArray(options.clients)) {
        return [];
    }

    return chain(options.clients)
        .filter(isObject)
        .map((clientOptions: RedisClientOptions) => {
            const name = normalizeName(get(clientOptions, 'name'));
            const token = getRedisClientToken(name);
            return {
                provide: token,
                useFactory: (service: RedisService): RedisClient => service.get(name),
                inject: [RedisService],
            } satisfies Provider;
        })
        .compact()
        .value();
};

const createFacadeProviders = (options: RedisModuleOptions): Provider[] => {
    if (!isObject(options) || !isArray(options.clients)) {
        return [];
    }

    return chain(options.clients)
        .filter(isObject)
        .map((clientOptions: RedisClientOptions) => {
            const name = normalizeName(get(clientOptions, 'name'));
            const clientToken = getRedisClientToken(name);
            const facadeToken = getRedisFacadeToken(name);
            return {
                provide: facadeToken,
                useFactory: (client: RedisClient): RedisFacade => new RedisFacade(client),
                inject: [clientToken],
            } satisfies Provider;
        })
        .compact()
        .value();
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

        const clientTokens = chain(options.clients)
            .filter(isObject)
            .map((c) => getRedisClientToken(normalizeName(get(c, 'name'))))
            .compact()
            .value();

        const facadeTokens = chain(options.clients)
            .filter(isObject)
            .map((c) => getRedisFacadeToken(normalizeName(get(c, 'name'))))
            .compact()
            .value();

        return {
            module: RedisModule,
            providers: compact([
                optionProvider,
                serviceProvider,
                defaultProvider,
                ...clientProviders,
                ...facadeProviders,
            ]),
            exports: compact([
                RedisService,
                getRedisClientToken(REDIS_DEFAULT_CLIENT_NAME),
                ...clientTokens,
                getRedisFacadeToken(REDIS_DEFAULT_CLIENT_NAME),
                ...facadeTokens,
            ]),
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

        // We cannot add providers after Nest compiles module metadata.
        // So we predeclare proxy providers for the default client and any names listed in options.predeclare.
        const predeclareList = isArray(options.predeclare) ? options.predeclare : [];

        const predeclaredProviders: Provider[] = chain(predeclareList)
            .filter(isString)
            .map((rawName): Provider => {
                const name = normalizeName(rawName);
                return {
                    provide: getRedisClientToken(name),
                    useFactory: (service: RedisService): RedisClient => service.get(name),
                    inject: [RedisService],
                } satisfies Provider;
            })
            .compact()
            .value();

        const proxyProviders: Provider[] = compact([
            {
                provide: getRedisClientToken(REDIS_DEFAULT_CLIENT_NAME),
                useFactory: (service: RedisService): RedisClient => service.get(REDIS_DEFAULT_CLIENT_NAME),
                inject: [RedisService],
            },
            ...predeclaredProviders,
        ]);

        const facadeProxyProviders: Provider[] = compact([
            {
                provide: getRedisFacadeToken(REDIS_DEFAULT_CLIENT_NAME),
                useFactory: (service: RedisService): RedisFacade =>
                    new RedisFacade(service.get(REDIS_DEFAULT_CLIENT_NAME)),
                inject: [RedisService],
            },
            ...chain(predeclareList)
                .filter(isString)
                .map((rawName): Provider => {
                    const name = normalizeName(rawName);
                    return {
                        provide: getRedisFacadeToken(name),
                        useFactory: (service: RedisService): RedisFacade => new RedisFacade(service.get(name)),
                        inject: [RedisService],
                    } satisfies Provider;
                })
                .compact()
                .value(),
        ]);

        const predeclaredTokens = chain(predeclareList)
            .filter(isString)
            .map((n) => getRedisClientToken(normalizeName(n)))
            .compact()
            .value();

        const predeclaredFacadeTokens = chain(predeclareList)
            .filter(isString)
            .map((n) => getRedisFacadeToken(normalizeName(n)))
            .compact()
            .value();

        return {
            module: RedisModule,
            imports: isArray(options.imports) ? options.imports : [],
            providers: compact([asyncOptionsProvider, serviceProvider, ...proxyProviders, ...facadeProxyProviders]),
            exports: compact([
                RedisService,
                getRedisClientToken(REDIS_DEFAULT_CLIENT_NAME),
                ...predeclaredTokens,
                getRedisFacadeToken(REDIS_DEFAULT_CLIENT_NAME),
                ...predeclaredFacadeTokens,
            ]),
        };
    }
}
