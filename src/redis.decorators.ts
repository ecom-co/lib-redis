import { Inject } from '@nestjs/common';

import { getRedisClientToken, getRedisFacadeToken } from './redis.constants';

/**
 * Inject a Redis client by name. Name matching is case-insensitive.
 * Overloads preserve string literal types for better type inference downstream.
 * @template TName - String literal type for client name
 */
export type InjectRedis = {
    (): ParameterDecorator;
    <TName extends string = 'default'>(name: TName): ParameterDecorator;
};

/**
 * Decorator factory to inject a Redis client by name.
 * @param {string} [name] - Optional Redis client name (case-insensitive)
 * @returns {ParameterDecorator} Parameter decorator for dependency injection
 * @example
 * constructor(@InjectRedis() private redis: RedisClient) {}
 * constructor(@InjectRedis('cache') private cache: RedisClient) {}
 */
export const InjectRedis: InjectRedis = ((name?: string): ParameterDecorator =>
    Inject(getRedisClientToken(name))) as InjectRedis;

/**
 * Inject a high-level RedisFacade by name (case-insensitive).
 * @template TName - String literal type for facade name
 */
export type InjectRedisFacade = {
    (): ParameterDecorator;
    <TName extends string = 'default'>(name: TName): ParameterDecorator;
};

/**
 * Decorator factory to inject a RedisFacade by name.
 * @param {string} [name] - Optional RedisFacade name (case-insensitive)
 * @returns {ParameterDecorator} Parameter decorator for dependency injection
 * @example
 * constructor(@InjectRedisFacade() private cache: RedisFacade) {}
 * constructor(@InjectRedisFacade('session') private session: RedisFacade) {}
 */
export const InjectRedisFacade: InjectRedisFacade = ((name?: string): ParameterDecorator =>
    Inject(getRedisFacadeToken(name))) as InjectRedisFacade;
