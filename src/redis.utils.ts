import IORedis, { Cluster } from 'ioredis';

import type { RedisClientOptions, RedisClient, ClusterClientOptions } from './redis.interfaces';

const toClusterNodes = (nodes: ClusterClientOptions['nodes']): ClusterClientOptions['nodes'] => nodes.map((n) => n);

export const createRedisClient = (options: RedisClientOptions): RedisClient => {
    if (options.type === 'cluster') {
        const { nodes, ...clusterOptions } = options;
        const normalizedNodes = toClusterNodes(nodes);
        return new Cluster(normalizedNodes, clusterOptions);
    }

    const single = options;
    if (single.connectionString) {
        return new IORedis(single.connectionString, single);
    }
    return new IORedis(single);
};

/**
 * Create a typed map of client names to avoid `as` assertions when injecting.
 * Example:
 *   const NAMES = ['FORWARD', 'CACHE'] as const;
 *   const RedisNames = defineRedisNames(NAMES);
 *   // InjectRedis(RedisNames.FORWARD)
 */
export const defineRedisNames = <const T extends readonly string[]>(names: T): { [K in T[number]]: K } => {
    const map = Object.create(null) as { [K in T[number]]: K };
    for (const n of names) {
        (map as Record<string, string>)[n] = n as unknown as typeof n;
    }
    return map;
};
