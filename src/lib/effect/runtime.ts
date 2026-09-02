import { Cause, Effect, Exit, Option } from 'effect';
import { NextResponse } from 'next/server';
import {
  ConfigError,
  DatabaseError,
  HttpError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from './errors';

export interface ApiEffectOptions {
  /**
   * HTTP status code for successful responses (default: 200).
   */
  readonly successStatus?: number;
}

/**
 * Maps known Effect domain errors to appropriate HTTP status codes.
 */
export function getHttpStatusForError(error: unknown): number {
  if (error instanceof UnauthorizedError || (typeof error === 'object' && error !== null && '_tag' in error && error._tag === 'UnauthorizedError')) {
    return 401;
  }
  if (error instanceof NotFoundError || (typeof error === 'object' && error !== null && '_tag' in error && error._tag === 'NotFoundError')) {
    return 404;
  }
  if (error instanceof ValidationError || (typeof error === 'object' && error !== null && '_tag' in error && error._tag === 'ValidationError')) {
    return 422;
  }
  if (error instanceof RateLimitError || (typeof error === 'object' && error !== null && '_tag' in error && error._tag === 'RateLimitError')) {
    return 429;
  }
  if (error instanceof HttpError || (typeof error === 'object' && error !== null && '_tag' in error && error._tag === 'HttpError')) {
    const status = (error as { status?: number }).status;
    return status && status >= 400 && status < 600 ? status : 502;
  }
  if (error instanceof DatabaseError || (typeof error === 'object' && error !== null && '_tag' in error && error._tag === 'DatabaseError')) {
    return 500;
  }
  if (error instanceof ConfigError || (typeof error === 'object' && error !== null && '_tag' in error && error._tag === 'ConfigError')) {
    return 500;
  }
  if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') {
    return error.status;
  }
  return 500;
}

/**
 * Executes an Effect program and returns a standard Next.js NextResponse.
 *
 * Catches typed domain errors, formats them as JSON with appropriate HTTP status codes,
 * and safely traps unhandled defects (panics).
 */
export async function runApiEffect<A, E>(
  effect: Effect.Effect<A, E, never>,
  options?: ApiEffectOptions
): Promise<NextResponse> {
  const exit = await Effect.runPromiseExit(effect);

  if (Exit.isSuccess(exit)) {
    const value = exit.value;
    if (value instanceof NextResponse) {
      return value;
    }
    return NextResponse.json(value, { status: options?.successStatus ?? 200 });
  }

  // Handle expected errors vs unexpected defects
  const failureOpt = Cause.failureOption(exit.cause);
  if (Option.isSome(failureOpt)) {
    const error = failureOpt.value;
    const status = getHttpStatusForError(error);

    if (typeof error === 'object' && error !== null) {
      const tag = '_tag' in error ? String(error._tag) : 'Error';
      const message =
        'message' in error && typeof error.message === 'string'
          ? error.message
          : undefined;

      return NextResponse.json(
        {
          error: tag,
          ...(message !== undefined ? { message } : {}),
          ...error,
        },
        { status }
      );
    }

    return NextResponse.json(
      {
        error: 'Error',
        message: String(error),
      },
      { status }
    );
  }

  // Defect / unexpected exception
  console.error('[runApiEffect] Unhandled defect:', Cause.pretty(exit.cause));
  return NextResponse.json(
    {
      error: 'InternalServerError',
      message: 'An unexpected internal error occurred',
    },
    { status: 500 }
  );
}
