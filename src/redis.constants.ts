export const REDIS_DEFAULT_CLIENT_NAME = 'default';

export const REDIS_MODULE_OPTIONS = Symbol('REDIS_MODULE_OPTIONS');

export const getRedisClientToken = (name?: string): string => {
    const keyUpper = (name?.trim() || REDIS_DEFAULT_CLIENT_NAME).toUpperCase();
    return keyUpper === REDIS_DEFAULT_CLIENT_NAME.toUpperCase() ? 'REDIS_CLIENT' : `REDIS_CLIENT_${keyUpper}`;
};

export const getRedisFacadeToken = (name?: string): string => {
    const keyUpper = (name?.trim() || REDIS_DEFAULT_CLIENT_NAME).toUpperCase();
    return keyUpper === REDIS_DEFAULT_CLIENT_NAME.toUpperCase() ? 'REDIS_FACADE' : `REDIS_FACADE_${keyUpper}`;
};
