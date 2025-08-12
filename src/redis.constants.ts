import toUpper from 'lodash/toUpper';
import trim from 'lodash/trim';

export const REDIS_DEFAULT_CLIENT_NAME = 'default';

export const REDIS_MODULE_OPTIONS = Symbol('REDIS_MODULE_OPTIONS');

export const getRedisClientToken = (name?: string): string => {
    const keyUpper = toUpper(trim(name) || REDIS_DEFAULT_CLIENT_NAME);
    return keyUpper === toUpper(REDIS_DEFAULT_CLIENT_NAME) ? 'REDIS_CLIENT' : `REDIS_CLIENT_${keyUpper}`;
};

export const getRedisFacadeToken = (name?: string): string => {
    const keyUpper = toUpper(trim(name) || REDIS_DEFAULT_CLIENT_NAME);
    return keyUpper === toUpper(REDIS_DEFAULT_CLIENT_NAME) ? 'REDIS_FACADE' : `REDIS_FACADE_${keyUpper}`;
};
