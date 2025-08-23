// Optional health indicator for @nestjs/terminus users.
// This file imports from @nestjs/terminus only when used in the app.

import type { HealthIndicatorResult } from '@nestjs/terminus';
import type { Redis } from 'ioredis';

/**
 * Check Redis client health status by sending a PING command.
 * @param {Redis} client - Redis client instance to check
 * @param {string} [key='redis'] - Key name for the health check result
 * @returns {Promise<HealthIndicatorResult>} Promise with health check result including status and latency
 * @throws {Error} If the Redis client is not accessible
 * @example
 * const healthResult = await checkRedisHealthy(redisClient, 'cache');
 * // { cache: { status: 'up', latencyMs: 5 } }
 */
export const checkRedisHealthy = async (client: Redis, key = 'redis'): Promise<HealthIndicatorResult> => {
    const start = Date.now();
    // Using PING ensures connectivity without side effects
    const reply = await client.ping();
    const ms = Date.now() - start;
    const isHealthy = reply === 'PONG';

    return {
        [key]: {
            status: isHealthy ? 'up' : 'down',
            latencyMs: ms,
        },
    } satisfies HealthIndicatorResult;
};
