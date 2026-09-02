import { Context, Data, Duration, Effect, Layer, Schedule, Schema } from 'effect';

const BASE_URL = 'https://v3.football.api-sports.io';
const PL_LEAGUE_ID = 39; // Premier League
const CURRENT_SEASON = 2024;

// --- Domain Errors ---
export class ApiFootballConfigError extends Data.TaggedError('ApiFootballConfigError')<{
  readonly message?: string;
}> {
  override get message(): string {
    return this.message ?? 'API_FOOTBALL_KEY is not configured';
  }
}

export class ApiFootballHttpError extends Data.TaggedError('ApiFootballHttpError')<{
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
  readonly cause?: unknown;
}> {}

export class ApiFootballRateLimitError extends Data.TaggedError('ApiFootballRateLimitError')<{
  readonly message?: string;
}> {
  override get message(): string {
    return this.message ?? 'API-Football daily rate limit reached (100 requests/day)';
  }
}

export class ApiFootballParseError extends Data.TaggedError('ApiFootballParseError')<{
  readonly cause: unknown;
}> {}

export type ApiFootballError =
  | ApiFootballConfigError
  | ApiFootballHttpError
  | ApiFootballRateLimitError
  | ApiFootballParseError;

// --- Schemas ---
export const ApiTeamSchema = Schema.Struct({
  team: Schema.Struct({
    id: Schema.Number,
    name: Schema.String,
  }),
});

export const ApiPlayerSchema = Schema.Struct({
  player: Schema.Struct({
    id: Schema.Number,
    name: Schema.String,
    firstname: Schema.NullOr(Schema.String),
    lastname: Schema.NullOr(Schema.String),
    birth: Schema.Struct({
      date: Schema.NullOr(Schema.String),
    }),
    nationality: Schema.NullOr(Schema.String),
    height: Schema.NullOr(Schema.String),
    weight: Schema.NullOr(Schema.String),
    photo: Schema.String,
  }),
  statistics: Schema.Array(
    Schema.Struct({
      team: Schema.Struct({
        id: Schema.Number,
        name: Schema.String,
      }),
      games: Schema.Struct({
        position: Schema.NullOr(Schema.String),
      }),
    })
  ),
});

export type ApiPlayer = typeof ApiPlayerSchema.Type;
export type ApiTeam = typeof ApiTeamSchema.Type;

// --- Service Interface ---
export interface IApiFootballService {
  readonly fetchPLTeams: () => Effect.Effect<ReadonlyArray<ApiTeam>, ApiFootballError>;
  readonly fetchPlayersByTeam: (
    teamId: number,
    page?: number
  ) => Effect.Effect<ReadonlyArray<ApiPlayer>, ApiFootballError>;
}

export class ApiFootballService extends Context.Tag('ApiFootballService')<
  ApiFootballService,
  IApiFootballService
>() {}

/**
 * Retry schedule for transient network/5xx server errors:
 * Exponential backoff starting at 300ms, max 3 retries.
 */
const retrySchedule = Schedule.exponential(Duration.millis(300)).pipe(
  Schedule.compose(Schedule.recurs(3))
);

function makeApiFetch(path: string, params: Record<string, string | number> = {}) {
  return Effect.gen(function* () {
    const apiKey = process.env.API_FOOTBALL_KEY;
    if (!apiKey) {
      return yield* Effect.fail(new ApiFootballConfigError({}));
    }

    const url = new URL(`${BASE_URL}${path}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const urlString = url.toString();

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(urlString, {
          headers: {
            'x-apisports-key': apiKey,
          },
          next: { revalidate: 3600 },
        }),
      catch: (err) =>
        new ApiFootballHttpError({
          url: urlString,
          status: 500,
          statusText: err instanceof Error ? err.message : String(err),
          cause: err,
        }),
    });

    if (response.status === 429) {
      return yield* Effect.fail(new ApiFootballRateLimitError({}));
    }

    if (!response.ok) {
      return yield* Effect.fail(
        new ApiFootballHttpError({
          url: urlString,
          status: response.status,
          statusText: response.statusText,
        })
      );
    }

    const rawJson = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (err) => new ApiFootballParseError({ cause: err }),
    });

    return rawJson.response;
  });
}

export const ApiFootballServiceLive = Layer.succeed(
  ApiFootballService,
  ApiFootballService.of({
    fetchPLTeams: () =>
      Effect.gen(function* () {
        const raw = yield* makeApiFetch('/teams', {
          league: PL_LEAGUE_ID,
          season: CURRENT_SEASON,
        });
        return yield* Schema.decodeUnknown(Schema.Array(ApiTeamSchema))(raw).pipe(
          Effect.mapError((err) => new ApiFootballParseError({ cause: err }))
        );
      }).pipe(
        // Retry transient errors with backoff
        Effect.retry({
          schedule: retrySchedule,
          while: (err) => err._tag === 'ApiFootballHttpError' && err.status >= 500,
        })
      ),

    fetchPlayersByTeam: (teamId: number, page = 1) =>
      Effect.gen(function* () {
        const raw = yield* makeApiFetch('/players', {
          team: teamId,
          season: CURRENT_SEASON,
          page,
        });
        return yield* Schema.decodeUnknown(Schema.Array(ApiPlayerSchema))(raw).pipe(
          Effect.mapError((err) => new ApiFootballParseError({ cause: err }))
        );
      }).pipe(
        // Retry transient errors with backoff
        Effect.retry({
          schedule: retrySchedule,
          while: (err) => err._tag === 'ApiFootballHttpError' && err.status >= 500,
        })
      ),
  })
);

/**
 * Creates a mock ApiFootballService Layer for testing.
 */
export function createMockApiFootballLayer(mocks: {
  fetchPLTeams?: () => Effect.Effect<ReadonlyArray<ApiTeam>, ApiFootballError>;
  fetchPlayersByTeam?: (teamId: number, page?: number) => Effect.Effect<ReadonlyArray<ApiPlayer>, ApiFootballError>;
}) {
  return Layer.succeed(
    ApiFootballService,
    ApiFootballService.of({
      fetchPLTeams: mocks.fetchPLTeams ?? (() => Effect.succeed([])),
      fetchPlayersByTeam: mocks.fetchPlayersByTeam ?? (() => Effect.succeed([])),
    })
  );
}
