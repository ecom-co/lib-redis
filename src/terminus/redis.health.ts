// Optional health indicator for @nestjs/terminus users.
// This file imports from @nestjs/terminus only when used in the app.

import type { HealthIndicatorResult } from '@nestjs/terminus';
import type { Redis } from 'ioredis';

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
