/* eslint-disable max-lines */
import attempt from 'lodash/attempt';
import chunk from 'lodash/chunk';
import cloneDeep from 'lodash/cloneDeep';
import debounce from 'lodash/debounce';
import every from 'lodash/every';
import filter from 'lodash/filter';
import flatten from 'lodash/flatten';
import forEach from 'lodash/forEach';
import get from 'lodash/get';
import has from 'lodash/has';
import isArray from 'lodash/isArray';
import isBoolean from 'lodash/isBoolean';
import isEmpty from 'lodash/isEmpty';
import isError from 'lodash/isError';
import isFinite from 'lodash/isFinite';
import isFunction from 'lodash/isFunction';
import isNil from 'lodash/isNil';
import isNumber from 'lodash/isNumber';
import isObject from 'lodash/isObject';
import isPlainObject from 'lodash/isPlainObject';
import isString from 'lodash/isString';
import keyBy from 'lodash/keyBy';
import map from 'lodash/map';
import memoize from 'lodash/memoize';
import reduce from 'lodash/reduce';
import set from 'lodash/set';
import some from 'lodash/some';
import toNumber from 'lodash/toNumber';
import toSafeInteger from 'lodash/toSafeInteger';
import toString from 'lodash/toString';
import trim from 'lodash/trim';
import uniq from 'lodash/uniq';

const lodashMemoize = memoize;

import type { RedisClient } from './redis.interfaces';
import type { Redis } from 'ioredis';

export type BatchOperation = {
    amount?: number;
    key: string;
    operation: 'decr' | 'del' | 'get' | 'incr' | 'set';
    options?: RedisSetOptions;
    value?: unknown;
};

export type CacheStats = {
    hitRate: number;
    memoryUsage: string;
    missRate: number;
    totalKeys: number;
    totalRequests: number;
};

export type HealthCheckResult = {
    error?: string;
    latency: number;
    status: 'healthy' | 'unhealthy';
    timestamp: number;
};

export type LockResult = {
    error?: string;
    ok: boolean;
    release?: () => Promise<boolean>;
    token?: string;
    ttl?: number;
};

export type RateLimitResult = {
    allowed: boolean;
    remaining: number;
    resetTime?: number;
    retryAfter?: number;
};

export type RedisSetOptions = {
    /** Expire after N seconds (EX) */
    ttlSeconds?: number;
    /** Expire after N milliseconds (PX) */
    pxMs?: number;
    /** Expire at UNIX time in seconds (EXAT) */
    exAtSec?: number;
    /** Expire at UNIX time in milliseconds (PXAT) */
    pxAtMs?: number;
    /** Keep existing TTL (KEEPTTL) */
    keepTtl?: boolean;
    /** NX: only set if not exists; XX: only set if exists */
    mode?: 'NX' | 'XX';
    /** Return the old value (GET) */
    get?: boolean;
};

type Primitive = boolean | null | number | string;

// ========== NEW INTERFACES ==========
interface CircuitBreaker {
    failures: number;
    nextAttempt: number;
    threshold: number;
    timeout: number;
}

interface ConnectionHealth {
    isConnected: boolean;
    lastError: Error | null;
    reconnectAttempts: number;
}

interface Logger {
    debug: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, error?: Error, meta?: Record<string, unknown>) => void;
    info: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
}

interface RedisFacadeConfig {
    bulkOperationChunkSize: number;
    circuitBreakerThreshold: number;
    circuitBreakerTimeout: number;
    lockDefaultTtl: number;
    maxRetries: number;
    retryDelay: number;
    scanCount: number;
    statsFlushInterval: number;
}

const SAFE_JSON_INDICATORS = ['{', '[', '"'];

const DEFAULT_CONFIG: RedisFacadeConfig = {
    bulkOperationChunkSize: 1000,
    circuitBreakerThreshold: 5,
    circuitBreakerTimeout: 60000,
    lockDefaultTtl: 30000,
    maxRetries: 3,
    retryDelay: 100,
    scanCount: 1000,
    statsFlushInterval: 5000,
};

// ========== UTILITY FUNCTIONS ==========
const safeToStringValue = (value: unknown): string => {
    try {
        if (isNil(value)) return 'null';

        if (isString(value)) return trim(value);

        if (isNumber(value) || isBoolean(value)) return toString(value);

        if (isObject(value)) return JSON.stringify(value);

        return toString(value);
    } catch (error) {
        /* eslint-disable-next-line no-console */
        console.warn('Failed to convert value to string:', error);

        return 'null';
    }
};

const safeTryParseJson = <T>(raw: null | string): null | T => {
    if (isNil(raw) || isEmpty(trim(raw))) return null;

    const trimmed = trim(raw);
    const firstChar = trimmed.charAt(0);

    if (!some(SAFE_JSON_INDICATORS, (indicator) => firstChar === indicator)) {
        return trimmed as unknown as T;
    }

    try {
        return JSON.parse(trimmed) as T;
    } catch {
        return trimmed as unknown as T;
    }
};

const safeParseNumber = (value: unknown, defaultValue = 0): number => {
    if (isNumber(value) && isFinite(value)) return value;

    if (isString(value)) {
        const parsed = toNumber(value);

        return isFinite(parsed) ? parsed : defaultValue;
    }

    return defaultValue;
};

const safeParseInteger = (value: unknown, defaultValue = 0): number => {
    const num = safeParseNumber(value, defaultValue);

    return toSafeInteger(num);
};

const validateKey = (key: string): boolean => isString(key) && !isEmpty(trim(key));

export class RedisFacade {
    private readonly circuitBreaker: CircuitBreaker;
    private cleanup?: () => void;
    private readonly config: RedisFacadeConfig;

    private readonly connectionHealth: ConnectionHealth = {
        isConnected: true,
        lastError: null,
        reconnectAttempts: 0,
    };

    private debouncedSaveStats: ReturnType<typeof debounce> = debounce(() => {
        // Empty function
    }, 0);

    private readonly logger: Logger;

    private readonly stats = {
        errors: 0,
        hits: 0,
        misses: 0,
        operations: 0,
    };

    constructor(
        private readonly client: RedisClient,
        private readonly keyPrefix = '',
        config: Partial<RedisFacadeConfig> = {},
        logger?: Logger,
    ) {
        // Validate inputs
        if (isNil(client)) {
            throw new Error('Redis client is required');
        }

        if (!isString(keyPrefix)) {
            throw new Error('Key prefix must be a string');
        }

        this.config = { ...DEFAULT_CONFIG, ...config };
        this.logger = logger || console;

        this.circuitBreaker = {
            failures: 0,
            nextAttempt: 0,
            threshold: this.config.circuitBreakerThreshold,
            timeout: this.config.circuitBreakerTimeout,
        };

        this.setupDebouncedStats();
        this.setupConnectionHandlers();
    }

    // ========== SETUP & CLEANUP METHODS ==========
    private setupConnectionHandlers(): void {
        if (this.isRedisClient(this.client)) {
            this.client.on?.('error', (error: Error) => {
                this.connectionHealth.isConnected = false;
                this.connectionHealth.lastError = error;
                this.recordError();
            });

            this.client.on?.('connect', () => {
                this.connectionHealth.isConnected = true;
                this.connectionHealth.lastError = null;
                this.connectionHealth.reconnectAttempts = 0;
            });

            this.client.on?.('reconnecting', () => {
                this.connectionHealth.reconnectAttempts++;
            });
        }
    }

    private setupDebouncedStats(): void {
        this.debouncedSaveStats = debounce(() => {
            void this.persistStats();
        }, this.config.statsFlushInterval);

        this.cleanup = () => {
            this.debouncedSaveStats.cancel();
        };
    }

    dispose(): void {
        this.cleanup?.();
    }

    // ========== UTILITY METHODS ==========
    private isRedisClient(client: RedisClient): client is Redis {
        return client && typeof client === 'object' && 'set' in client && typeof client.set === 'function';
    }

    // log method removed

    private buildKey(key: string): string {
        if (!validateKey(key)) {
            throw new Error(`Invalid key: ${key}`);
        }

        return isEmpty(this.keyPrefix) ? key : `${this.keyPrefix}:${key}`;
    }

    private createEnhancedError(message: string, originalError: unknown, context?: Record<string, unknown>): Error {
        const errorMessage = `${message}: ${get(originalError, 'message', 'Unknown error')}`;
        const enhancedError = new Error(errorMessage);

        // Preserve original error
        if (originalError instanceof Error) {
            Object.assign(enhancedError, { cause: originalError, stack: originalError.stack });
        }

        // Add context
        if (context) {
            Object.assign(enhancedError, { context });
        }

        return enhancedError;
    }

    withPrefix(prefix: string): RedisFacade {
        if (!isString(prefix) || isEmpty(trim(prefix))) {
            throw new Error('Prefix must be a non-empty string');
        }

        const nextPrefix = isEmpty(this.keyPrefix) ? prefix : `${this.keyPrefix}:${prefix}`;

        return new RedisFacade(this.client, nextPrefix, this.config, this.logger);
    }

    private async persistStats(): Promise<void> {
        try {
            const statsKey = this.buildKey('__facade_stats__');

            await (this.client as Redis).hmset(statsKey, {
                errors: toString(this.stats.errors),
                hits: toString(this.stats.hits),
                misses: toString(this.stats.misses),
                operations: toString(this.stats.operations),
                timestamp: toString(Date.now()),
            });
        } catch {
            /* eslint-disable-next-line no-console */
            console.warn('Failed to persist stats');
        }
    }

    private recordError(): void {
        this.stats.errors++;
        this.stats.operations++;
        this.debouncedSaveStats();
    }

    private recordHit(): void {
        this.stats.hits++;
        this.stats.operations++;
        this.debouncedSaveStats();
    }

    private recordMiss(): void {
        this.stats.misses++;
        this.stats.operations++;
        this.debouncedSaveStats();
    }

    private async withCircuitBreaker<T>(operation: () => Promise<T>, operationName = 'redis_operation'): Promise<T> {
        // Check if circuit breaker is open
        if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
            if (Date.now() < this.circuitBreaker.nextAttempt) {
                throw new Error(`Circuit breaker is open for ${operationName}`);
            }
        }

        try {
            const result = await operation();

            // Reset failures on success
            if (this.circuitBreaker.failures > 0) {
                this.circuitBreaker.failures = 0;
            }

            return result;
        } catch (error) {
            this.circuitBreaker.failures++;

            if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
                this.circuitBreaker.nextAttempt = Date.now() + this.circuitBreaker.timeout;
            }

            throw error;
        }
    }

    // ========== BASIC OPERATIONS ==========

    async get<T = string>(key: string): Promise<null | T> {
        return this.withCircuitBreaker(async () => {
            try {
                if (!this.isRedisClient(this.client)) {
                    throw new Error('Invalid Redis client');
                }

                const raw = await this.client.get(this.buildKey(key));
                const result = safeTryParseJson<T>(raw);

                if (!isNil(result)) {
                    this.recordHit();
                } else {
                    this.recordMiss();
                }

                return result;
            } catch (error) {
                this.recordError();
                throw this.createEnhancedError(`Failed to get key ${key}`, error, { key });
            }
        }, 'get');
    }

    async getJson<T = unknown>(key: string): Promise<null | T> {
        try {
            const raw = await (this.client as Redis).get(this.buildKey(key));

            if (isNil(raw)) {
                this.recordMiss();

                return null;
            }

            const parseResult = attempt<unknown>(() => JSON.parse(raw));

            if (isError(parseResult)) {
                throw new Error(`Failed to parse JSON for key ${key}: ${parseResult.message}`);
            }

            this.recordHit();

            return parseResult as T;
        } catch (error) {
            this.recordError();
            throw error;
        }
    }

    async set(
        key: string,
        value: Primitive | Record<string, unknown>,
        options?: RedisSetOptions,
    ): Promise<null | string> {
        return this.withCircuitBreaker(async () => {
            try {
                if (!this.isRedisClient(this.client)) {
                    throw new Error('Invalid Redis client');
                }

                const redisKey = this.buildKey(key);
                const redisValue = safeToStringValue(value);

                if (!options) {
                    return await this.client.set(redisKey, redisValue);
                }

                const { exAtSec, get: returnOld, keepTtl, mode, pxAtMs, pxMs, ttlSeconds } = options;

                let result: null | string;

                if (keepTtl === true) {
                    result = await this.client.set(redisKey, redisValue, 'KEEPTTL');
                } else if (isNumber(pxAtMs)) {
                    result = await this.client.set(redisKey, redisValue, 'PXAT', toSafeInteger(pxAtMs));
                } else if (isNumber(exAtSec)) {
                    result = await this.client.set(redisKey, redisValue, 'EXAT', toSafeInteger(exAtSec));
                } else if (isNumber(pxMs)) {
                    result = await this.client.set(redisKey, redisValue, 'PX', toSafeInteger(pxMs));
                } else if (isNumber(ttlSeconds)) {
                    result = await this.client.set(redisKey, redisValue, 'EX', toSafeInteger(ttlSeconds));
                } else {
                    result = await this.client.set(redisKey, redisValue);
                }

                if (mode === 'NX') {
                    result = await this.client.set(redisKey, redisValue, 'NX');
                } else if (mode === 'XX') {
                    result = await this.client.set(redisKey, redisValue, 'XX');
                }

                if (returnOld === true) {
                    result = await this.client.set(redisKey, redisValue, 'GET');
                }

                return result;
            } catch (error) {
                this.recordError();
                throw this.createEnhancedError(`Failed to set key ${key}`, error, { key, options });
            }
        }, 'set');
    }

    async setJson(key: string, value: unknown, options?: RedisSetOptions): Promise<null | string> {
        try {
            const payload = JSON.stringify(value);

            return this.set(key, payload, options);
        } catch {
            throw new Error(`Failed to stringify value for key ${key}`);
        }
    }

    // ========== CACHE OPERATIONS WITH LODASH ==========

    async getOrSet<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
        if (!isFunction(loader)) {
            throw new Error('Loader must be a function');
        }

        const cached = await this.get<T>(key);

        if (!isNil(cached)) return cached;

        const fresh = await loader();

        await this.set(key, fresh as Record<string, unknown>, { ttlSeconds: safeParseInteger(ttlSeconds) });

        return fresh;
    }

    async getOrSetWithOptions<T>(key: string, loader: () => Promise<T>, options: RedisSetOptions): Promise<T> {
        if (!isFunction(loader)) {
            throw new Error('Loader must be a function');
        }

        const cached = await this.get<T>(key);

        if (!isNil(cached)) return cached;

        const fresh = await loader();

        await this.set(key, fresh as Record<string, unknown>, options);

        return fresh;
    }

    memoize<TArgs extends unknown[], TReturn>(
        fn: (...args: TArgs) => Promise<TReturn>,
        keyGenerator: (...args: TArgs) => string,
        ttlSeconds = 3600,
    ): (...args: TArgs) => Promise<TReturn> {
        const resolver = (...args: TArgs) => keyGenerator(...args);

        return lodashMemoize(async (...args: TArgs): Promise<TReturn> => {
            const cacheKey = keyGenerator(...args);

            return this.getOrSet(cacheKey, ttlSeconds, () => fn(...args));
        }, resolver);
    }

    async refresh<T>(key: string, loader: () => Promise<T>, options?: RedisSetOptions): Promise<T> {
        if (!isFunction(loader)) {
            throw new Error('Loader must be a function');
        }

        const fresh = await loader();

        await this.set(key, fresh as Record<string, unknown>, options);

        return fresh;
    }

    // ========== BATCH OPERATIONS WITH LODASH ==========

    async executeBatch(operations: BatchOperation[]): Promise<unknown[]> {
        if (!isArray(operations) || isEmpty(operations)) return [];

        const validOps = filter(
            operations,
            (op) => isPlainObject(op) && validateKey(get(op, 'key')) && isString(get(op, 'operation')),
        );

        if (isEmpty(validOps)) return [];

        const pipeline = (this.client as Redis).pipeline();

        forEach(validOps, (op) => {
            const prefixedKey = this.buildKey(op.key);

            switch (op.operation) {
                case 'decr':
                    pipeline.decrby(prefixedKey, safeParseInteger(op.amount, 1));
                    break;

                case 'del':
                    pipeline.del(prefixedKey);
                    break;

                case 'get':
                    pipeline.get(prefixedKey);
                    break;

                case 'incr':
                    pipeline.incrby(prefixedKey, safeParseInteger(op.amount, 1));
                    break;

                case 'set':
                    pipeline.set(prefixedKey, safeToStringValue(op.value));
                    break;
            }
        });

        const results = await pipeline.exec();

        return map(results, ([_err, result]) => (isNil(_err) ? result : null));
    }

    async mget<T = string>(keys: string[]): Promise<Array<null | T>> {
        return this.withCircuitBreaker(async () => {
            try {
                if (!isArray(keys) || isEmpty(keys)) return [];

                const validKeys = filter(keys, validateKey);

                if (isEmpty(validKeys)) {
                    return [];
                }

                // Process in chunks for large key sets
                if (validKeys.length > this.config.bulkOperationChunkSize) {
                    const chunks = chunk(validKeys, this.config.bulkOperationChunkSize);
                    const results: Array<null | T> = [];

                    for (const keyChunk of chunks) {
                        const prefixedKeys = map(keyChunk, (key) => this.buildKey(key));
                        const chunkValues = await (this.client as Redis).mget(...prefixedKeys);

                        results.push(...map(chunkValues, (value) => safeTryParseJson<T>(value)));
                    }

                    return results;
                }

                const prefixedKeys = map(validKeys, (key) => this.buildKey(key));
                const values = await (this.client as Redis).mget(...prefixedKeys);

                return map(values, (value) => safeTryParseJson<T>(value));
            } catch (error) {
                this.recordError();
                throw this.createEnhancedError('Failed to execute mget operation', error, {
                    keysCount: keys.length,
                });
            }
        }, 'mget');
    }

    async mset(keyValuePairs: Array<{ key: string; options?: RedisSetOptions; value: unknown }>): Promise<void> {
        return this.withCircuitBreaker(async () => {
            try {
                if (!isArray(keyValuePairs) || isEmpty(keyValuePairs)) return;

                const validPairs = filter(
                    keyValuePairs,
                    (pair) => isPlainObject(pair) && validateKey(get(pair, 'key')),
                );

                if (isEmpty(validPairs)) {
                    return;
                }

                // Separate pairs with and without options
                const simplePairs = filter(validPairs, (pair) => !pair.options);
                const complexPairs = filter(validPairs, (pair) => !!pair.options);

                // Handle simple pairs with pipeline
                if (!isEmpty(simplePairs)) {
                    const chunks = chunk(simplePairs, this.config.bulkOperationChunkSize);

                    for (const pairChunk of chunks) {
                        const pipeline = (this.client as Redis).pipeline();

                        forEach(pairChunk, ({ key, value }) => {
                            pipeline.set(this.buildKey(key), safeToStringValue(value));
                        });

                        await pipeline.exec();
                    }
                }

                // Handle complex pairs individually
                if (!isEmpty(complexPairs)) {
                    for (const { key, options, value } of complexPairs) {
                        await this.set(key, value as Primitive | Record<string, unknown>, options);
                    }
                }
            } catch (error) {
                throw this.createEnhancedError('Failed to execute mset operation', error, {
                    pairsCount: keyValuePairs.length,
                });
            }
        }, 'mset');
    }

    // ========== COUNTER OPERATIONS WITH LODASH ==========

    async getCounter(key: string): Promise<number> {
        const value = await this.get<string>(key);

        return safeParseInteger(value, 0);
    }

    async setCounter(key: string, value: number, ttlSeconds?: number): Promise<void> {
        const safeValue = safeParseInteger(value, 0);
        const options = isNumber(ttlSeconds) ? { ttlSeconds: safeParseInteger(ttlSeconds) } : undefined;

        await this.set(key, safeValue, options);
    }

    async decr(key: string, amount = 1): Promise<number> {
        const safeAmount = safeParseInteger(amount, 1);
        const prefixedKey = this.buildKey(key);

        return safeAmount === 1
            ? (this.client as Redis).decr(prefixedKey)
            : (this.client as Redis).decrby(prefixedKey, safeAmount);
    }

    async incr(key: string, amount = 1): Promise<number> {
        const safeAmount = safeParseInteger(amount, 1);
        const prefixedKey = this.buildKey(key);

        return safeAmount === 1
            ? (this.client as Redis).incr(prefixedKey)
            : (this.client as Redis).incrby(prefixedKey, safeAmount);
    }

    async incrFloat(key: string, amount: number): Promise<string> {
        const safeAmount = safeParseNumber(amount, 0);

        return (this.client as Redis).incrbyfloat(this.buildKey(key), safeAmount);
    }

    async multiIncr(counters: Array<{ amount?: number; key: string }>): Promise<number[]> {
        if (!isArray(counters) || isEmpty(counters)) return [];

        const validCounters = filter(counters, (counter) => isPlainObject(counter) && validateKey(get(counter, 'key')));

        const pipeline = (this.client as Redis).pipeline();

        forEach(validCounters, ({ amount, key }) => {
            const safeAmount = safeParseInteger(amount, 1);
            const prefixedKey = this.buildKey(key);

            if (safeAmount === 1) {
                pipeline.incr(prefixedKey);
            } else {
                pipeline.incrby(prefixedKey, safeAmount);
            }
        });

        const results = await pipeline.exec();

        return map(results, ([_err, result]) => safeParseInteger(result, 0));
    }

    // ========== KEY MANAGEMENT WITH LODASH ==========

    async exists(...keys: string[]): Promise<number> {
        const validKeys = filter(keys, validateKey);

        if (isEmpty(validKeys)) return 0;

        const prefixedKeys = map(validKeys, (key) => this.buildKey(key));

        return (this.client as Redis).exists(...prefixedKeys);
    }

    async del(keyOrPattern: string): Promise<number> {
        return this.withCircuitBreaker(async () => {
            try {
                if (!validateKey(keyOrPattern)) return 0;

                if (!keyOrPattern.includes('*')) {
                    return await (this.client as Redis).del(this.buildKey(keyOrPattern));
                }

                const keys = await this.scanKeys(keyOrPattern);

                if (isEmpty(keys)) {
                    return 0;
                }

                // Process in chunks to avoid overwhelming Redis
                const chunks = chunk(keys, this.config.bulkOperationChunkSize);
                let totalDeleted = 0;

                for (const [, keyChunk] of chunks.entries()) {
                    try {
                        // Use UNLINK for non-blocking deletion when available
                        const client = this.client as Redis;
                        const deleted = client.unlink
                            ? await client.unlink(...keyChunk)
                            : await client.del(...keyChunk);

                        totalDeleted += deleted;
                    } catch {
                        // Continue with other chunks
                    }
                }

                return totalDeleted;
            } catch (error) {
                throw this.createEnhancedError(`Failed to delete keys for pattern ${keyOrPattern}`, error, {
                    pattern: keyOrPattern,
                });
            }
        }, 'del');
    }

    async expire(key: string, ttlSeconds: number): Promise<boolean> {
        const safeTtl = safeParseInteger(ttlSeconds);
        const result = await (this.client as Redis).expire(this.buildKey(key), safeTtl);

        return result === 1;
    }

    async expireAt(key: string, timestamp: number): Promise<boolean> {
        const safeTimestamp = safeParseInteger(timestamp);
        const result = await (this.client as Redis).expireat(this.buildKey(key), safeTimestamp);

        return result === 1;
    }

    async keys(pattern = '*'): Promise<string[]> {
        const fullPattern = isEmpty(this.keyPrefix) ? pattern : `${this.keyPrefix}:${pattern}`;
        const keys = await (this.client as Redis).keys(fullPattern);

        return isArray(keys) ? keys : [];
    }

    async keysByPattern(patterns: string[]): Promise<Record<string, string[]>> {
        if (!isArray(patterns) || isEmpty(patterns)) return {};

        const result: Record<string, string[]> = {};

        await Promise.all(
            map(patterns, async (pattern) => {
                set(result, pattern, await this.scanKeys(pattern));
            }),
        );

        return result;
    }

    async persist(key: string): Promise<boolean> {
        const result = await (this.client as Redis).persist(this.buildKey(key));

        return result === 1;
    }

    async randomKey(): Promise<null | string> {
        return (this.client as Redis).randomkey();
    }

    async rename(oldKey: string, newKey: string): Promise<'OK'> {
        return (this.client as Redis).rename(this.buildKey(oldKey), this.buildKey(newKey));
    }

    async scanKeys(pattern: string, count = this.config.scanCount): Promise<string[]> {
        return this.withCircuitBreaker(async () => {
            try {
                const safeCount = safeParseInteger(count, this.config.scanCount);
                const keys: Set<string> = new Set(); // Use Set to avoid duplicates
                let cursor = '0';
                const fullPattern = isEmpty(this.keyPrefix) ? pattern : `${this.keyPrefix}:${pattern}`;

                do {
                    const [next, foundKeys] = await (this.client as Redis).scan(
                        cursor,
                        'MATCH',
                        fullPattern,
                        'COUNT',
                        safeCount,
                    );

                    cursor = next;

                    if (isArray(foundKeys) && !isEmpty(foundKeys)) {
                        foundKeys.forEach((key) => keys.add(key));
                    }

                    // Safety check to prevent infinite loops
                    if (keys.size > 100000) {
                        break;
                    }
                } while (cursor !== '0');

                return Array.from(keys);
            } catch (error) {
                throw this.createEnhancedError(`Failed to scan keys for pattern ${pattern}`, error, {
                    count,
                    pattern,
                });
            }
        }, 'scan');
    }

    async ttl(key: string): Promise<number> {
        return (this.client as Redis).ttl(this.buildKey(key));
    }

    async type(key: string): Promise<string> {
        return (this.client as Redis).type(this.buildKey(key));
    }

    // ========== HASH OPERATIONS WITH LODASH ==========

    async hdel(key: string, ...fields: string[]): Promise<number> {
        const validFields = filter(fields, (field) => isString(field) && !isEmpty(field));

        if (isEmpty(validFields)) return 0;

        return (this.client as Redis).hdel(this.buildKey(key), ...validFields);
    }

    async hexists(key: string, field: string): Promise<boolean> {
        if (!isString(field) || isEmpty(field)) return false;

        const result = await (this.client as Redis).hexists(this.buildKey(key), field);

        return result === 1;
    }

    async hget<T = string>(key: string, field: string): Promise<null | T> {
        if (!isString(field) || isEmpty(field)) return null;

        const raw = await (this.client as Redis).hget(this.buildKey(key), field);

        return safeTryParseJson<T>(raw);
    }

    async hgetall<T = Record<string, string>>(key: string): Promise<T> {
        const result = await (this.client as Redis).hgetall(this.buildKey(key));

        if (!isPlainObject(result)) return {} as T;

        const parsed = reduce(
            result,
            (acc, value, field) => {
                set(acc, field, safeTryParseJson(value));

                return acc;
            },
            {} as Record<string, unknown>,
        );

        return parsed as T;
    }

    async hincrby(key: string, field: string, amount: number): Promise<number> {
        if (!isString(field) || isEmpty(field)) {
            throw new Error('Field must be a non-empty string');
        }

        const safeAmount = safeParseInteger(amount, 1);

        return (this.client as Redis).hincrby(this.buildKey(key), field, safeAmount);
    }

    async hkeys(key: string): Promise<string[]> {
        const keys = await (this.client as Redis).hkeys(this.buildKey(key));

        return isArray(keys) ? keys : [];
    }

    async hlen(key: string): Promise<number> {
        return (this.client as Redis).hlen(this.buildKey(key));
    }

    async hmgetObject<T extends Record<string, unknown>>(key: string, fields: Array<keyof T & string>): Promise<T> {
        if (!isArray(fields) || isEmpty(fields)) {
            return {} as T;
        }

        const validFields = filter(fields, (field) => isString(field) && !isEmpty(field));

        if (isEmpty(validFields)) return {} as T;

        const values = await (this.client as Redis).hmget(this.buildKey(key), ...(validFields as string[]));

        const result = reduce(
            validFields,
            (acc, field, index) => {
                set(acc, field, safeTryParseJson(get(values, index)));

                return acc;
            },
            {} as Record<string, unknown>,
        );

        return result as T;
    }

    async hmsetMultiple(operations: Array<{ key: string; obj: Record<string, Primitive> }>): Promise<void> {
        if (!isArray(operations) || isEmpty(operations)) return;

        const validOps = filter(
            operations,
            (op) => isPlainObject(op) && validateKey(get(op, 'key')) && isPlainObject(get(op, 'obj')),
        );

        if (isEmpty(validOps)) return;

        const pipeline = (this.client as Redis).pipeline();

        forEach(validOps, ({ key, obj }) => {
            const flat = flatten(map(obj, (value, field) => [field, safeToStringValue(value)]));

            pipeline.hmset(this.buildKey(key), ...(flat as [string, string]));
        });

        await pipeline.exec();
    }

    async hmsetObject(key: string, obj: Record<string, Primitive>): Promise<'OK'> {
        if (!isPlainObject(obj) || isEmpty(obj)) {
            throw new Error('hmsetObject requires a non-empty plain object');
        }

        const flat: string[] = flatten(map(obj, (value, field) => [field, safeToStringValue(value)]));

        return (this.client as Redis).hmset(this.buildKey(key), ...(flat as [string, string]));
    }

    async hset(key: string, field: string, value: unknown): Promise<number> {
        if (!isString(field) || isEmpty(field)) {
            throw new Error('Field must be a non-empty string');
        }

        return (this.client as Redis).hset(this.buildKey(key), field, safeToStringValue(value));
    }

    async hvals(key: string): Promise<string[]> {
        const values = await (this.client as Redis).hvals(this.buildKey(key));

        return isArray(values) ? values : [];
    }

    // ========== LIST OPERATIONS WITH LODASH ==========

    async lindex<T = string>(key: string, index: number): Promise<null | T> {
        const safeIndex = safeParseInteger(index, 0);
        const raw = await (this.client as Redis).lindex(this.buildKey(key), safeIndex);

        return safeTryParseJson<T>(raw);
    }

    async linsert<T = string>(key: string, position: 'AFTER' | 'BEFORE', pivot: T, element: T): Promise<number> {
        const k = this.buildKey(key);
        const p = safeToStringValue(pivot);
        const e = safeToStringValue(element);

        return position === 'BEFORE'
            ? (this.client as Redis).linsert(k, 'BEFORE', p, e)
            : (this.client as Redis).linsert(k, 'AFTER', p, e);
    }

    async llen(key: string): Promise<number> {
        return (this.client as Redis).llen(this.buildKey(key));
    }

    async lpop<T = string>(key: string, count?: number): Promise<null | T | T[]> {
        const prefixedKey = this.buildKey(key);

        if (isNumber(count) && count > 1) {
            const values = await (this.client as Redis).lpop(prefixedKey, count);

            return isArray(values) ? map(values, (v) => safeTryParseJson<T>(v) as T) : null;
        }

        const raw = await (this.client as Redis).lpop(prefixedKey);

        return safeTryParseJson<T>(raw);
    }

    async lpush(key: string, ...values: unknown[]): Promise<number> {
        if (isEmpty(values)) return 0;

        const stringValues = map(values, safeToStringValue);

        return (this.client as Redis).lpush(this.buildKey(key), ...stringValues);
    }

    async lrange<T = string>(key: string, start: number, stop: number): Promise<T[]> {
        const safeStart = safeParseInteger(start, 0);
        const safeStop = safeParseInteger(stop, -1);

        const values = await (this.client as Redis).lrange(this.buildKey(key), safeStart, safeStop);

        return map(values, (v) => safeTryParseJson<T>(v) as T);
    }

    async lrem<T = string>(key: string, count: number, element: T): Promise<number> {
        const safeCount = safeParseInteger(count, 0);

        return (this.client as Redis).lrem(this.buildKey(key), safeCount, safeToStringValue(element));
    }

    async ltrim(key: string, start: number, stop: number): Promise<'OK'> {
        const safeStart = safeParseInteger(start, 0);
        const safeStop = safeParseInteger(stop, -1);

        return (this.client as Redis).ltrim(this.buildKey(key), safeStart, safeStop);
    }

    async rpop<T = string>(key: string, count?: number): Promise<null | T | T[]> {
        const prefixedKey = this.buildKey(key);

        if (isNumber(count) && count > 1) {
            const values = await (this.client as Redis).rpop(prefixedKey, count);

            return isArray(values) ? map(values, (v) => safeTryParseJson<T>(v) as T) : null;
        }

        const raw = await (this.client as Redis).rpop(prefixedKey);

        return safeTryParseJson<T>(raw);
    }

    async rpush(key: string, ...values: unknown[]): Promise<number> {
        if (isEmpty(values)) return 0;

        const stringValues = map(values, safeToStringValue);

        return (this.client as Redis).rpush(this.buildKey(key), ...stringValues);
    }

    // ========== SET OPERATIONS WITH LODASH ==========

    async sadd(key: string, ...members: unknown[]): Promise<number> {
        if (isEmpty(members)) return 0;

        const stringMembers = uniq(map(members, safeToStringValue));

        return (this.client as Redis).sadd(this.buildKey(key), ...stringMembers);
    }

    async scard(key: string): Promise<number> {
        return (this.client as Redis).scard(this.buildKey(key));
    }

    async sdiff<T = string>(...keys: string[]): Promise<T[]> {
        const validKeys = filter(keys, validateKey);

        if (isEmpty(validKeys)) return [];

        const prefixedKeys = map(validKeys, (key) => this.buildKey(key));
        const members = await (this.client as Redis).sdiff(...prefixedKeys);

        return map(members, (m) => safeTryParseJson<T>(m) as T);
    }

    async sinter<T = string>(...keys: string[]): Promise<T[]> {
        const validKeys = filter(keys, validateKey);

        if (isEmpty(validKeys)) return [];

        const prefixedKeys = map(validKeys, (key) => this.buildKey(key));
        const members = await (this.client as Redis).sinter(...prefixedKeys);

        return map(members, (m) => safeTryParseJson<T>(m) as T);
    }

    async sismember(key: string, member: unknown): Promise<boolean> {
        const result = await (this.client as Redis).sismember(this.buildKey(key), safeToStringValue(member));

        return result === 1;
    }

    async smembers<T = string>(key: string): Promise<T[]> {
        const members = await (this.client as Redis).smembers(this.buildKey(key));

        return map(members, (m) => safeTryParseJson<T>(m) as T);
    }

    async spop<T = string>(key: string, count?: number): Promise<null | T | T[]> {
        const prefixedKey = this.buildKey(key);

        if (isNumber(count) && count > 1) {
            const members = await (this.client as Redis).spop(prefixedKey, count);

            return isArray(members) ? map(members, (m) => safeTryParseJson<T>(m) as T) : null;
        }

        const member = await (this.client as Redis).spop(prefixedKey);

        return member ? safeTryParseJson<T>(member) : null;
    }

    async srandmember<T = string>(key: string, count?: number): Promise<null | T | T[]> {
        const prefixedKey = this.buildKey(key);

        if (isNumber(count)) {
            const members = await (this.client as Redis).srandmember(prefixedKey, count);

            return isArray(members) ? map(members, (m) => safeTryParseJson<T>(m) as T) : null;
        }

        const member = await (this.client as Redis).srandmember(prefixedKey);

        return member ? safeTryParseJson<T>(member) : null;
    }

    async srem(key: string, ...members: unknown[]): Promise<number> {
        if (isEmpty(members)) return 0;

        const stringMembers = map(members, safeToStringValue);

        return (this.client as Redis).srem(this.buildKey(key), ...stringMembers);
    }

    async sunion<T = string>(...keys: string[]): Promise<T[]> {
        const validKeys = filter(keys, validateKey);

        if (isEmpty(validKeys)) return [];

        const prefixedKeys = map(validKeys, (key) => this.buildKey(key));
        const members = await (this.client as Redis).sunion(...prefixedKeys);

        return map(members, (m) => safeTryParseJson<T>(m) as T);
    }

    // ========== SORTED SET OPERATIONS WITH LODASH ==========

    async zadd(key: string, ...scoreMembers: Array<number | string>): Promise<number> {
        if (isEmpty(scoreMembers) || scoreMembers.length % 2 !== 0) {
            throw new Error('Score-member pairs must be provided');
        }

        const safePairs: Array<number | string> = [];

        for (let i = 0; i < scoreMembers.length; i += 2) {
            const score = safeParseNumber(get(scoreMembers, i), 0);
            const member = safeToStringValue(get(scoreMembers, i + 1));

            safePairs.push(score, member);
        }

        return (this.client as Redis).zadd(this.buildKey(key), ...safePairs);
    }

    async zaddObject(key: string, members: Array<{ member: unknown; score: number }>): Promise<number> {
        if (!isArray(members) || isEmpty(members)) return 0;

        const validMembers = filter(members, (m) => isPlainObject(m) && has(m, 'score') && has(m, 'member'));

        if (isEmpty(validMembers)) return 0;

        const scoreMembers = flatten(
            map(validMembers, ({ member, score }) => [safeParseNumber(score, 0), safeToStringValue(member)]),
        );

        return (this.client as Redis).zadd(this.buildKey(key), ...scoreMembers);
    }

    async zcard(key: string): Promise<number> {
        return (this.client as Redis).zcard(this.buildKey(key));
    }

    async zincrby(key: string, increment: number, member: unknown): Promise<string> {
        const safeIncrement = safeParseNumber(increment, 0);

        return (this.client as Redis).zincrby(this.buildKey(key), safeIncrement, safeToStringValue(member));
    }

    async zrange<T = string>(
        key: string,
        start: number,
        stop: number,
        withScores = false,
    ): Promise<Array<{ member: T; score: number }> | T[]> {
        const safeStart = safeParseInteger(start, 0);
        const safeStop = safeParseInteger(stop, -1);
        const prefixedKey = this.buildKey(key);

        if (withScores) {
            const result = await (this.client as Redis).zrange(prefixedKey, safeStart, safeStop, 'WITHSCORES');
            const pairs: Array<{ member: T; score: number }> = [];

            for (let i = 0; i < result.length; i += 2) {
                pairs.push({
                    member: safeTryParseJson<T>(get(result, i)) as T,
                    score: safeParseNumber(get(result, i + 1), 0),
                });
            }

            return pairs;
        }

        const members = await (this.client as Redis).zrange(prefixedKey, safeStart, safeStop);

        return map(members, (m) => safeTryParseJson<T>(m) as T);
    }

    async zrangebyscore<T = string>(
        key: string,
        min: number | string,
        max: number | string,
        options?: { limit?: { count: number; offset: number }; withScores?: boolean },
    ): Promise<Array<{ member: T; score: number }> | T[]> {
        const prefixedKey = this.buildKey(key);
        const flags: string[] = [];

        if (options?.withScores) flags.push('WITHSCORES');

        if (options?.limit) {
            flags.push(
                'LIMIT',
                String(safeParseInteger(options.limit.offset, 0)),
                String(safeParseInteger(options.limit.count, -1)),
            );
        }

        const zrs = (
            this.client as unknown as { zrangebyscore: (...args: unknown[]) => Promise<string[]> }
        ).zrangebyscore.bind(this.client as unknown as object);
        const result = await zrs(prefixedKey, String(min), String(max), ...flags);

        if (options?.withScores) {
            const pairs: Array<{ member: T; score: number }> = [];

            for (let i = 0; i < result.length; i += 2) {
                pairs.push({
                    member: safeTryParseJson<T>(get(result, i)) as T,
                    score: safeParseNumber(get(result, i + 1), 0),
                });
            }

            return pairs;
        }

        return map(result, (m) => safeTryParseJson<T>(m) as T);
    }

    async zrank(key: string, member: unknown): Promise<null | number> {
        return (this.client as Redis).zrank(this.buildKey(key), safeToStringValue(member));
    }

    async zrem(key: string, ...members: unknown[]): Promise<number> {
        if (isEmpty(members)) return 0;

        const stringMembers = map(members, safeToStringValue);

        return (this.client as Redis).zrem(this.buildKey(key), ...stringMembers);
    }

    async zrevrank(key: string, member: unknown): Promise<null | number> {
        return (this.client as Redis).zrevrank(this.buildKey(key), safeToStringValue(member));
    }

    async zscore(key: string, member: unknown): Promise<null | number> {
        const score = await (this.client as Redis).zscore(this.buildKey(key), safeToStringValue(member));

        return score ? safeParseNumber(score) : null;
    }

    // ========== PUB/SUB OPERATIONS WITH LODASH ==========

    async publish(channel: string, message: string): Promise<number> {
        if (!isString(message)) {
            throw new Error('Message must be a string');
        }

        return (this.client as Redis).publish(this.buildKey(channel), message);
    }

    async publishBatch(messages: Array<{ channel: string; data: unknown }>): Promise<number[]> {
        if (!isArray(messages) || isEmpty(messages)) return [];

        const validMessages = filter(messages, (msg) => isPlainObject(msg) && validateKey(get(msg, 'channel')));

        if (isEmpty(validMessages)) return [];

        const pipeline = (this.client as Redis).pipeline();

        forEach(validMessages, ({ channel, data }) => {
            try {
                const payload = JSON.stringify(data);

                pipeline.publish(this.buildKey(channel), payload);
            } catch {
                // skip invalid message
            }
        });

        const results = await pipeline.exec();

        return map(results, ([, result]) => safeParseInteger(result, 0));
    }

    async publishJson(channel: string, data: unknown): Promise<number> {
        try {
            const payload = JSON.stringify(data);

            return (this.client as Redis).publish(this.buildKey(channel), payload);
        } catch {
            throw new Error(`Failed to stringify data for channel ${channel}`);
        }
    }

    // ========== ADVANCED LOCKING WITH LODASH ==========

    async acquireLock(key: string, ttlMs: number): Promise<LockResult> {
        return this.withCircuitBreaker(async () => {
            const safeTtl = safeParseInteger(ttlMs, this.config.lockDefaultTtl);
            const token = `${Date.now()}-${Math.random().toString(36).slice(2)}-${process.pid || 'web'}`;
            const prefixedKey = this.buildKey(`lock:${key}`);

            try {
                const res = await (this.client as Redis).set(prefixedKey, token, 'PX', safeTtl, 'NX');

                if (res !== 'OK') {
                    return { ok: false };
                }

                const release = async (): Promise<boolean> => {
                    const script = `
                        if redis.call('get', KEYS[1]) == ARGV[1] then 
                            return redis.call('del', KEYS[1]) 
                        else 
                            return 0 
                        end
                    `;

                    try {
                        const result = await (this.client as Redis).eval(script, 1, prefixedKey, token);

                        return result === 1;
                    } catch {
                        return false;
                    }
                };

                return {
                    ok: true,
                    release,
                    token,
                    ttl: safeTtl,
                };
            } catch (error) {
                return {
                    error: get(error, 'message', 'Unknown error'),
                    ok: false,
                };
            }
        }, 'acquire_lock');
    }

    async acquireLockWithRetry(
        key: string,
        ttlMs: number,
        maxRetries = this.config.maxRetries,
        retryDelayMs = this.config.retryDelay,
    ): Promise<LockResult> {
        const safeMaxRetries = safeParseInteger(maxRetries, this.config.maxRetries);
        const safeRetryDelay = safeParseInteger(retryDelayMs, this.config.retryDelay);

        for (let i = 0; i <= safeMaxRetries; i++) {
            const result = await this.acquireLock(key, ttlMs);

            if (result.ok) return result;

            if (i < safeMaxRetries) {
                const backoffDelay = safeRetryDelay * Math.pow(2, i);

                await new Promise((resolve) => setTimeout(resolve, backoffDelay));
            }
        }

        return { error: 'Failed to acquire lock after retries', ok: false };
    }

    async extendLock(key: string, token: string, additionalTtlMs: number): Promise<boolean> {
        const safeAdditionalTtl = safeParseInteger(additionalTtlMs, 30000);
        const prefixedKey = this.buildKey(`lock:${key}`);

        const script = `
            if redis.call('get', KEYS[1]) == ARGV[1] then 
                return redis.call('pexpire', KEYS[1], ARGV[2]) 
            else 
                return 0 
            end
        `;

        const result = await (this.client as Redis).eval(script, 1, prefixedKey, token, safeAdditionalTtl);

        return result === 1;
    }

    async withLock<T>(
        key: string,
        ttlMs: number,
        fn: () => Promise<T>,
        options?: { maxRetries?: number; retryDelayMs?: number },
    ): Promise<T> {
        if (!isFunction(fn)) {
            throw new Error('Function must be provided');
        }

        const lock = options?.maxRetries
            ? await this.acquireLockWithRetry(key, ttlMs, options.maxRetries, options.retryDelayMs)
            : await this.acquireLock(key, ttlMs);

        if (!lock.ok) {
            throw new Error(`Failed to acquire lock for key: ${key}`);
        }

        try {
            return await fn();
        } finally {
            if (lock.release) {
                await lock.release();
            }
        }
    }

    // ========== RATE LIMITING WITH LODASH ==========

    async rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
        const safeLimit = safeParseInteger(limit, 100);
        const safeWindow = safeParseInteger(windowMs, 60000); // Default 1 minute
        const now = Date.now();
        const windowStart = Math.floor(now / safeWindow) * safeWindow;
        const windowKey = this.buildKey(`rate:${key}:${windowStart}`);

        try {
            const current = await this.incr(windowKey);

            if (current === 1) {
                await this.expire(windowKey, Math.ceil(safeWindow / 1000));
            }

            return {
                allowed: current <= safeLimit,
                remaining: Math.max(0, safeLimit - current),
                resetTime: windowStart + safeWindow,
            };
        } catch {
            return {
                allowed: false,
                remaining: 0,
                resetTime: windowStart + safeWindow,
                retryAfter: safeWindow,
            };
        }
    }

    async rateLimitMultiple(
        requests: Array<{ key: string; limit: number; windowMs: number }>,
    ): Promise<RateLimitResult[]> {
        if (!isArray(requests) || isEmpty(requests)) return [];

        const validRequests = filter(requests, (req) => isPlainObject(req) && validateKey(get(req, 'key')));

        return Promise.all(map(validRequests, ({ key, limit, windowMs }) => this.rateLimit(key, limit, windowMs)));
    }

    async slidingWindowRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
        const safeLimit = safeParseInteger(limit, 100);
        const safeWindow = safeParseInteger(windowMs, 60000);
        const now = Date.now();
        const windowStart = now - safeWindow;
        const rateLimitKey = this.buildKey(`sliding_rate:${key}`);

        const script = `
            redis.call('zremrangebyscore', KEYS[1], 0, ARGV[1])
            local current = redis.call('zcard', KEYS[1])
            if current < tonumber(ARGV[2]) then
                redis.call('zadd', KEYS[1], ARGV[3], ARGV[3])
                redis.call('expire', KEYS[1], ARGV[4])
                return {1, tonumber(ARGV[2]) - current - 1}
            else
                return {0, 0}
            end
        `;

        try {
            const result = (await (this.client as Redis).eval(
                script,
                1,
                rateLimitKey,
                windowStart,
                safeLimit,
                now,
                Math.ceil(safeWindow / 1000),
            )) as [number, number];

            return {
                allowed: result[0] === 1,
                remaining: result[1],
            };
        } catch {
            return {
                allowed: false,
                remaining: 0,
                retryAfter: safeWindow,
            };
        }
    }

    // ========== STATISTICS & MONITORING WITH LODASH ==========

    async getCacheStats(): Promise<CacheStats & { connectionHealth: ConnectionHealth }> {
        try {
            const keyCount = await this.scanKeys('*');
            const info = await this.info('memory');
            const memoryMatch = info.match(/used_memory_human:([^\r\n]+)/);
            const memoryUsage = memoryMatch ? trim(memoryMatch[1]) : 'N/A';

            const total = this.stats.hits + this.stats.misses;

            return {
                connectionHealth: cloneDeep(this.connectionHealth),
                hitRate: total > 0 ? Number(((this.stats.hits / total) * 100).toFixed(2)) : 0,
                memoryUsage,
                missRate: total > 0 ? Number(((this.stats.misses / total) * 100).toFixed(2)) : 0,
                totalKeys: keyCount.length,
                totalRequests: total,
            };
        } catch {
            return {
                connectionHealth: cloneDeep(this.connectionHealth),
                hitRate: 0,
                memoryUsage: 'Error',
                missRate: 0,
                totalKeys: 0,
                totalRequests: 0,
            };
        }
    }

    async getKeyStats(pattern = '*'): Promise<Array<{ key: string; size?: number; ttl: number; type: string }>> {
        const keys = await this.scanKeys(pattern);

        if (isEmpty(keys)) return [];

        const pipeline = (this.client as Redis).pipeline();

        forEach(keys, (key) => {
            pipeline.type(key);
            pipeline.ttl(key);
        });

        const results = await pipeline.exec();

        return reduce(
            keys,
            (acc, key, index) => {
                const typeResult = get(results, [index * 2, 1]);
                const ttlResult = get(results, [index * 2 + 1, 1]);

                acc.push({
                    type: toString(typeResult),
                    key,
                    ttl: safeParseInteger(ttlResult, -1),
                });

                return acc;
            },
            [] as Array<{ key: string; ttl: number; type: string }>,
        );
    }

    getLocalStats() {
        const total = this.stats.operations;

        return {
            errorRate: total > 0 ? Number(((this.stats.errors / total) * 100).toFixed(2)) : 0,
            errors: this.stats.errors,
            hitRate: total > 0 ? Number(((this.stats.hits / total) * 100).toFixed(2)) : 0,
            hits: this.stats.hits,
            misses: this.stats.misses,
            operations: total,
        };
    }

    resetStats(): void {
        this.stats.hits = 0;
        this.stats.misses = 0;
        this.stats.errors = 0;
        this.stats.operations = 0;
    }

    // ========== UTILITY FUNCTIONS WITH LODASH ==========

    async dbsize(): Promise<number> {
        return (this.client as Redis).dbsize();
    }

    async eval(script: string, numKeys: number, ...args: Array<number | string>): Promise<unknown> {
        const safeNumKeys = safeParseInteger(numKeys, 0);

        return (this.client as Redis).eval(script, safeNumKeys, ...args);
    }

    async flushdb(): Promise<'OK'> {
        return (this.client as Redis).flushdb();
    }

    async info(section?: string): Promise<string> {
        return isString(section) && !isEmpty(section)
            ? (this.client as Redis).info(section)
            : (this.client as Redis).info();
    }

    multi() {
        return (this.client as Redis).multi();
    }

    async ping(): Promise<string> {
        return (this.client as Redis).ping();
    }

    pipeline() {
        return (this.client as Redis).pipeline();
    }

    // ========== SERIALIZATION HELPERS WITH LODASH ==========

    async getDecompressed<T = unknown>(key: string): Promise<null | T> {
        // For demonstration - in real implementation you'd use decompression
        const result = await this.getJson<T>(key);

        return result ? cloneDeep(result) : null;
    }

    async setBulkJson(items: Array<{ key: string; options?: RedisSetOptions; value: unknown }>): Promise<void> {
        const validItems = filter(items, (item) => isPlainObject(item) && validateKey(get(item, 'key')));

        if (isEmpty(validItems)) return;

        const chunks = chunk(validItems, 100); // Process in chunks

        for (const itemChunk of chunks) {
            await this.mset(
                map(itemChunk, ({ key, options, value }) => ({
                    key,
                    options,
                    value,
                })),
            );
        }
    }

    async setCompressed(key: string, value: unknown, options?: RedisSetOptions): Promise<null | string> {
        // For demonstration - in real implementation you'd use compression
        const clonedValue = cloneDeep(value);

        return this.setJson(key, clonedValue, options);
    }

    // ========== PATTERN MATCHING WITH LODASH ==========

    async findKeysByPattern(pattern: string): Promise<string[]> {
        return this.scanKeys(pattern);
    }

    async getKeysByPrefix(prefix: string): Promise<string[]> {
        if (!isString(prefix) || isEmpty(prefix)) return [];

        return this.scanKeys(`${prefix}*`);
    }

    async getKeysWithMetadata(pattern = '*'): Promise<
        Array<{
            key: string;
            size: number;
            ttl: number;
            type: string;
        }>
    > {
        const keys = await this.scanKeys(pattern);

        if (isEmpty(keys)) return [];

        const pipeline = (this.client as Redis).pipeline();

        forEach(keys, (key) => {
            pipeline.type(key);
            pipeline.ttl(key);
            pipeline.memory('USAGE', key);
        });

        const results = await pipeline.exec();

        return reduce(
            keys,
            (acc, key, index) => {
                const baseIndex = index * 3;
                const typeResult = get(results, [baseIndex, 1]);
                const ttlResult = get(results, [baseIndex + 1, 1]);
                const sizeResult = get(results, [baseIndex + 2, 1]);

                acc.push({
                    type: toString(typeResult),
                    key,
                    size: safeParseInteger(sizeResult, 0),
                    ttl: safeParseInteger(ttlResult, -1),
                });

                return acc;
            },
            [] as Array<{ key: string; size: number; ttl: number; type: string }>,
        );
    }

    async deleteKeysByPattern(pattern: string): Promise<number> {
        return this.del(pattern);
    }

    async groupKeysByPattern(patterns: string[]): Promise<Record<string, string[]>> {
        if (!isArray(patterns) || isEmpty(patterns)) return {};

        const results = await Promise.all(
            map(patterns, async (pattern) => ({
                keys: await this.scanKeys(pattern),
                pattern,
            })),
        );

        const dict = keyBy(results, 'pattern');
        const out: Record<string, string[]> = {};

        forEach(dict, (v, k) => {
            set(out, k, v.keys);
        });

        return out;
    }

    // ========== HEALTH CHECK WITH LODASH ==========

    async deepHealthCheck(): Promise<{
        checks: Record<string, { error?: string; latency: number; ok: boolean }>;
        circuitBreakerStatus: {
            failures: number;
            isOpen: boolean;
            nextAttempt?: string;
        };
        connectionHealth: ConnectionHealth;
        overallLatency: number;
        status: 'healthy' | 'unhealthy';
    }> {
        const start = Date.now();
        const checks: Record<string, { error?: string; latency: number; ok: boolean }> = {};

        // Ping check
        await this.performHealthCheck('ping', checks, async () => {
            await (this.client as Redis).ping();
        });

        // Set/Get check
        await this.performHealthCheck('setGet', checks, async () => {
            const testKey = `health_check_${Date.now()}`;
            const testValue = { test: true, timestamp: Date.now() };

            await this.setJson(testKey, testValue, { ttlSeconds: 10 });
            const retrieved = await this.getJson(testKey);

            await this.del(testKey);

            if (isNil(retrieved)) {
                throw new Error('Set/Get test failed - value not retrieved');
            }
        });

        // Info check
        await this.performHealthCheck('info', checks, async () => {
            await this.info('server');
        });

        // Memory usage check
        await this.performHealthCheck('memory', checks, async () => {
            const info = await this.info('memory');

            if (!info.includes('used_memory')) {
                throw new Error('Memory info not available');
            }
        });

        const allHealthy = every(checks, 'ok');
        const overallLatency = Date.now() - start;

        return {
            status: allHealthy ? ('healthy' as const) : ('unhealthy' as const),
            checks,
            circuitBreakerStatus: {
                failures: this.circuitBreaker.failures,
                isOpen: this.circuitBreaker.failures >= this.circuitBreaker.threshold,
                nextAttempt:
                    this.circuitBreaker.nextAttempt > Date.now()
                        ? new Date(this.circuitBreaker.nextAttempt).toISOString()
                        : undefined,
            },
            connectionHealth: cloneDeep(this.connectionHealth),
            overallLatency,
        };
    }

    async healthCheck(): Promise<HealthCheckResult> {
        const start = Date.now();

        try {
            await this.withCircuitBreaker(async () => (this.client as Redis).ping(), 'health_ping');

            const latency = Date.now() - start;

            return {
                status: 'healthy',
                latency,
                timestamp: Date.now(),
            };
        } catch (error) {
            const latency = Date.now() - start;

            return {
                status: 'unhealthy' as const,
                error: get(error, 'message', 'Unknown error'),
                latency,
                timestamp: Date.now(),
            };
        }
    }

    private async performHealthCheck(
        checkName: string,
        checks: Record<string, { error?: string; latency: number; ok: boolean }>,
        operation: () => Promise<void>,
    ): Promise<void> {
        const checkStart = Date.now();

        try {
            await operation();
            set(checks, checkName, {
                latency: Date.now() - checkStart,
                ok: true,
            });
        } catch (error) {
            set(checks, checkName, {
                error: get(error, 'message', 'Unknown error'),
                latency: Date.now() - checkStart,
                ok: false,
            });
        }
    }

    // ========== ADVANCED CACHE PATTERNS ==========

    async cacheAside<T>(
        key: string,
        loader: () => Promise<T>,
        options: { refreshThreshold?: number; ttlSeconds: number },
    ): Promise<T> {
        const cached = await this.getJson<{ data: T; timestamp: number }>(key);

        if (cached) {
            const age = Date.now() - cached.timestamp;
            const refreshThreshold = (options.refreshThreshold || 0.8) * options.ttlSeconds * 1000;

            // Background refresh if near expiry
            if (age > refreshThreshold) {
                // Fire and forget refresh
                this.refresh(
                    key,
                    async () => ({
                        data: await loader(),
                        timestamp: Date.now(),
                    }),
                    { ttlSeconds: options.ttlSeconds },
                ).catch(() => undefined);
            }

            return cached.data;
        }

        const fresh = await loader();

        await this.setJson(
            key,
            {
                data: fresh,
                timestamp: Date.now(),
            },
            { ttlSeconds: options.ttlSeconds },
        );

        return fresh;
    }

    async writeBehind<T>(
        key: string,
        value: T,
        writer: (value: T) => Promise<void>,
        options?: RedisSetOptions,
    ): Promise<void> {
        await this.setJson(key, value, options);

        // Queue for background writing
        const writeKey = this.buildKey(`write_queue:${key}`);

        await this.lpush(writeKey, { timestamp: Date.now(), value });

        // Fire and forget the actual write
        // eslint-disable-next-line no-console
        writer(value).catch(console.error);
    }

    async writeThrough<T>(
        key: string,
        value: T,
        writer: (value: T) => Promise<void>,
        options?: RedisSetOptions,
    ): Promise<void> {
        await Promise.all([this.setJson(key, value, options), writer(value)]);
    }

    // ========== CONNECTION MANAGEMENT ==========

    getCircuitBreakerStatus() {
        return {
            failures: this.circuitBreaker.failures,
            isOpen: this.circuitBreaker.failures >= this.circuitBreaker.threshold,
            nextAttempt:
                this.circuitBreaker.nextAttempt > Date.now()
                    ? new Date(this.circuitBreaker.nextAttempt).toISOString()
                    : undefined,
            threshold: this.circuitBreaker.threshold,
            timeout: this.circuitBreaker.timeout,
        };
    }

    getConnectionHealth(): ConnectionHealth {
        return cloneDeep(this.connectionHealth);
    }

    resetCircuitBreaker(): void {
        this.circuitBreaker.failures = 0;
        this.circuitBreaker.nextAttempt = 0;
    }

    // ========== CONFIGURATION ACCESS ==========

    getConfig(): RedisFacadeConfig {
        return cloneDeep(this.config);
    }

    getKeyPrefix(): string {
        return this.keyPrefix;
    }
}
