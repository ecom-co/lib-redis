import IORedis, { Cluster } from 'ioredis';
import type { RedisClientOptions, RedisClient, ClusterClientOptions, SingleClientOptions } from './redis.interfaces';

function toClusterNodes(nodes: ClusterClientOptions['nodes']): ClusterClientOptions['nodes'] {
  return nodes.map((n) => n);
}

export function createRedisClient(options: RedisClientOptions): RedisClient {
  if (options.type === 'cluster') {
    const { nodes, ...clusterOptions } = options as ClusterClientOptions;
    const normalizedNodes = toClusterNodes(nodes);
    return new Cluster(normalizedNodes, clusterOptions);
  }

  const single = options as SingleClientOptions;
  if (single.connectionString) {
    return new IORedis(single.connectionString, single);
  }
  return new IORedis(single);
}


