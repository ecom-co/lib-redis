import type { LoggerService, ModuleMetadata } from '@nestjs/common';

import type { Cluster, ClusterNode, ClusterOptions, Redis, RedisOptions } from 'ioredis';

export type ClusterClientOptions = ClusterOptions & {
    name?: string;
    type: 'cluster';
    /** Nodes may be host/port objects or connection strings */
    nodes: Array<ClusterNode | string>;
};

export type RedisClient = Cluster | Redis;

export type RedisClientOptions = ClusterClientOptions | SentinelClientOptions | SingleClientOptions;

export interface RedisModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
    inject?: ((new (...args: unknown[]) => unknown) | string | symbol)[];
    useFactory: (
        ...args: ((new (...args: unknown[]) => unknown) | string | symbol)[]
    ) => Promise<RedisModuleOptions> | RedisModuleOptions;
    /**
     * Optional list of client names to predeclare DI tokens for when using forRootAsync.
     * This allows injecting `@InjectRedis(name)` even with async configuration.
     * Names are case-insensitive.
     */
    predeclare?: string[];
}

export interface RedisModuleOptions {
    clients: RedisClientOptions[];
    /** Optional Nest logger to receive connection lifecycle messages */
    logger?: LoggerService;
}

export type SentinelAddress = { host: string; port: number };

export type SentinelClientOptions = Omit<
    RedisOptions,
    'name' | 'sentinelPassword' | 'sentinels' | 'sentinelUsername'
> & {
    type: 'sentinel';
    /** Logical DI client name (case-insensitive) */
    name?: string;
    /** Sentinel nodes */
    sentinels: SentinelAddress[];
    /** Master name registered in Sentinel (ioredis option `name`) */
    sentinelName: string;
    /** Optional credentials for sentinel nodes */
    sentinelPassword?: string;
    sentinelUsername?: string;
};

export type SingleClientOptions = RedisOptions & {
    name?: string;
    type: 'single';
    /** Optional connection string: e.g. redis://:pass@host:port/db or rediss:// */
    connectionString?: string;
};

// Utility types to derive client name unions at compile time
export type RedisClientNamesFromOptions<T extends { clients: ReadonlyArray<{ name?: string }> }> =
    | 'default'
    | Lowercase<Extract<T['clients'][number]['name'], string>>;

export type RedisClientNamesFromPredeclare<TNames extends ReadonlyArray<string>> =
    | 'default'
    | Lowercase<TNames[number]>;
