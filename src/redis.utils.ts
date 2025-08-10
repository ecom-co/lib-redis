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
