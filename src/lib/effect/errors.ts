import { Data } from 'effect';

/**
 * Thrown when an environment variable or required configuration is missing.
 */
export class ConfigError extends Data.TaggedError('ConfigError')<{
  readonly key?: string;
  readonly message?: string;
}> {}

/**
 * Thrown when an external HTTP request fails with a non-2xx status code or network error.
 */
export class HttpError extends Data.TaggedError('HttpError')<{
  readonly url: string;
  readonly status: number;
  readonly statusText: string;
  readonly cause?: unknown;
}> {}

/**
 * Thrown when an API rate limit has been exceeded.
 */
export class RateLimitError extends Data.TaggedError('RateLimitError')<{
  readonly service: string;
  readonly retryAfterSeconds?: number;
  readonly message?: string;
}> {}

/**
 * Thrown when schema parsing or data validation fails.
 */
export class ValidationError extends Data.TaggedError('ValidationError')<{
  readonly message: string;
  readonly details?: unknown;
}> {}

/**
 * Thrown when a database query or RPC fails.
 */
export class DatabaseError extends Data.TaggedError('DatabaseError')<{
  readonly operation: string;
  readonly table?: string;
  readonly message: string;
  readonly details?: unknown;
  readonly cause?: unknown;
}> {}

/**
 * Thrown when a requested resource is not found.
 */
export class NotFoundError extends Data.TaggedError('NotFoundError')<{
  readonly resource: string;
  readonly id?: string | number;
  readonly message?: string;
}> {}

/**
 * Thrown when authorization fails (e.g. invalid cron secret or session).
 */
export class UnauthorizedError extends Data.TaggedError('UnauthorizedError')<{
  readonly message?: string;
}> {}
