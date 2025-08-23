import toUpper from 'lodash/toUpper';
import trim from 'lodash/trim';

export const REDIS_DEFAULT_CLIENT_NAME = 'default';

export const REDIS_MODULE_OPTIONS = Symbol('REDIS_MODULE_OPTIONS');

/**
 * Get the dependency injection token for a Redis client by name.
 * @param {string} [name] - Optional client name (case-insensitive)
 * @returns {string} DI token for the Redis client
 * @example
 * const token = getRedisClientToken('cache'); // 'REDIS_CLIENT_CACHE'
 * const defaultToken = getRedisClientToken(); // 'REDIS_CLIENT'
 */
export const getRedisClientToken = (name?: string): string => {
    const keyUpper = toUpper(trim(name) || REDIS_DEFAULT_CLIENT_NAME);

    return keyUpper === toUpper(REDIS_DEFAULT_CLIENT_NAME) ? 'REDIS_CLIENT' : `REDIS_CLIENT_${keyUpper}`;
};

/**
 * Get the dependency injection token for a RedisFacade by name.
 * @param {string} [name] - Optional facade name (case-insensitive)
 * @returns {string} DI token for the RedisFacade
 * @example
 * const token = getRedisFacadeToken('cache'); // 'REDIS_FACADE_CACHE'
 * const defaultToken = getRedisFacadeToken(); // 'REDIS_FACADE'
 */
export const getRedisFacadeToken = (name?: string): string => {
    const keyUpper = toUpper(trim(name) || REDIS_DEFAULT_CLIENT_NAME);

    return keyUpper === toUpper(REDIS_DEFAULT_CLIENT_NAME) ? 'REDIS_FACADE' : `REDIS_FACADE_${keyUpper}`;
};
