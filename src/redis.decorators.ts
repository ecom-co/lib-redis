import { Inject } from '@nestjs/common';

import { getRedisClientToken, getRedisFacadeToken } from './redis.constants';

/**
 * Inject a Redis client by name. Name matching is case-insensitive.
 * Overloads preserve string literal types for better type inference downstream.
 */
export type InjectRedis = {
    (): ParameterDecorator;
    <TName extends string = 'default'>(name: TName): ParameterDecorator;
};

export const InjectRedis: InjectRedis = ((name?: string): ParameterDecorator =>
    Inject(getRedisClientToken(name))) as InjectRedis;

/** Inject a high-level RedisFacade by name (case-insensitive). */
export type InjectRedisFacade = {
    (): ParameterDecorator;
    <TName extends string = 'default'>(name: TName): ParameterDecorator;
};

export const InjectRedisFacade: InjectRedisFacade = ((name?: string): ParameterDecorator =>
    Inject(getRedisFacadeToken(name))) as InjectRedisFacade;
