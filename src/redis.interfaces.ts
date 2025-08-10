import type { ModuleMetadata } from '@nestjs/common';

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

export type RedisClientOptions = SingleClientOptions | ClusterClientOptions;

export interface RedisModuleOptions {
    clients: RedisClientOptions[];
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
