import { Context, Effect, Layer } from 'effect';
import type { SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { DatabaseError } from '../errors';

export interface ISupabaseAdminService {
  readonly client: SupabaseClient;
  readonly query: <T>(
    operationName: string,
    fn: (client: SupabaseClient) => PromiseLike<{ data: T | null; error: PostgrestError | null }>
  ) => Effect.Effect<T, DatabaseError>;
  readonly rpc: <T>(
    fnName: string,
    params?: Record<string, unknown>
  ) => Effect.Effect<T, DatabaseError>;
}

export class SupabaseAdminService extends Context.Tag('SupabaseAdminService')<
  SupabaseAdminService,
  ISupabaseAdminService
>() {}

export const SupabaseAdminServiceLive = Layer.sync(SupabaseAdminService, () => {
  const client = createAdminClient();

  return SupabaseAdminService.of({
    client,
    query: <T>(
      operationName: string,
      fn: (c: SupabaseClient) => PromiseLike<{ data: T | null; error: PostgrestError | null }>
    ) =>
      Effect.tryPromise({
        try: () => fn(client),
        catch: (err) =>
          new DatabaseError({
            operation: operationName,
            message: err instanceof Error ? err.message : String(err),
            cause: err,
          }),
      }).pipe(
        Effect.flatMap(({ data, error }) => {
          if (error) {
            return Effect.fail(
              new DatabaseError({
                operation: operationName,
                message: error.message,
                details: error.details,
                cause: error,
              })
            );
          }
          return Effect.succeed(data as T);
        })
      ),

    rpc: <T>(fnName: string, params?: Record<string, unknown>) =>
      Effect.tryPromise({
        try: () => client.rpc(fnName, params),
        catch: (err) =>
          new DatabaseError({
            operation: `rpc:${fnName}`,
            message: err instanceof Error ? err.message : String(err),
            cause: err,
          }),
      }).pipe(
        Effect.flatMap(({ data, error }) => {
          if (error) {
            return Effect.fail(
              new DatabaseError({
                operation: `rpc:${fnName}`,
                message: error.message,
                details: error.details,
                cause: error,
              })
            );
          }
          return Effect.succeed(data as T);
        })
      ),
  });
});
