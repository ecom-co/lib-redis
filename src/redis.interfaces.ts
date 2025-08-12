import type { LoggerService, ModuleMetadata } from '@nestjs/common';

import type { Redis, Cluster, RedisOptions, ClusterNode, ClusterOptions } from 'ioredis';

export type RedisClient = Redis | Cluster;

export type SingleClientOptions = {
    type: 'single';
    name?: string;
    /** Optional connection string: e.g. redis://:pass@host:port/db or rediss:// */
    connectionString?: string;
} & RedisOptions;

export type ClusterClientOptions = {
    type: 'cluster';
    name?: string;
    /** Nodes may be host/port objects or connection strings */
    nodes: Array<ClusterNode | string>;
} & ClusterOptions;

export type SentinelAddress = { host: string; port: number };

export type SentinelClientOptions = {
    type: 'sentinel';
    /** Logical DI client name (case-insensitive) */
    name?: string;
    /** Sentinel nodes */
    sentinels: SentinelAddress[];
    /** Master name registered in Sentinel (ioredis option `name`) */
    sentinelName: string;
    /** Optional credentials for sentinel nodes */
    sentinelUsername?: string;
    sentinelPassword?: string;
} & Omit<RedisOptions, 'sentinels' | 'name' | 'sentinelUsername' | 'sentinelPassword'>;

export type RedisClientOptions = SingleClientOptions | ClusterClientOptions | SentinelClientOptions;

export interface RedisModuleOptions {
    clients: RedisClientOptions[];
    /** Optional Nest logger to receive connection lifecycle messages */
    logger?: LoggerService;
}

export interface RedisModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
    useFactory: (...args: any[]) => Promise<RedisModuleOptions> | RedisModuleOptions;
    inject?: any[];
    /**
     * Optional list of client names to predeclare DI tokens for when using forRootAsync.
     * This allows injecting `@InjectRedis(name)` even with async configuration.
     * Names are case-insensitive.
     */
    predeclare?: string[];
}

// Utility types to derive client name unions at compile time
export type RedisClientNamesFromOptions<T extends { clients: ReadonlyArray<{ name?: string }> }> =
    | Lowercase<Extract<T['clients'][number]['name'], string>>
    | 'default';

export type RedisClientNamesFromPredeclare<TNames extends ReadonlyArray<string>> =
    | Lowercase<TNames[number]>
    | 'default';
