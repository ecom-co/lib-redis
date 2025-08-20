import IORedis, { Cluster, type RedisOptions } from 'ioredis';
import forEach from 'lodash/forEach';
import set from 'lodash/set';

import type { ClusterClientOptions, RedisClient, RedisClientOptions } from './redis.interfaces';

const toClusterNodes = (nodes: ClusterClientOptions['nodes']): ClusterClientOptions['nodes'] => nodes.map((n) => n);

export const createRedisClient = (options: RedisClientOptions): RedisClient => {
    if (options.type === 'cluster') {
        const { nodes, ...clusterOptions } = options;
        const normalizedNodes = toClusterNodes(nodes);

        return new Cluster(normalizedNodes, clusterOptions);
    }

    if (options.type === 'sentinel') {
        const { sentinelName, sentinelPassword, sentinels, sentinelUsername, ...rest } = options;
        const config: RedisOptions = {
            ...rest,
            name: sentinelName,
            sentinelPassword,
            sentinels,
            sentinelUsername,
        };

        return new IORedis(config);
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
    const result = {} as { [K in T[number]]: K };

    forEach(names, (name) => {
        set(result, name, name);
    });

    return result;
};
