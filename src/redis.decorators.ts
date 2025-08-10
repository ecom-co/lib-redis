import { Inject } from '@nestjs/common';

import { getRedisClientToken } from './redis.constants';

export const InjectRedis = (name?: string): ParameterDecorator => Inject(getRedisClientToken(name));
