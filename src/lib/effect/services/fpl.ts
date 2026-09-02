import { Context, Data, Duration, Effect, Layer, Schedule, Schema } from 'effect';

const FPL_BASE = 'https://fantasy.premierleague.com/api';

// --- Domain Errors ---
export class FplHttpError extends Data.TaggedError('FplHttpError')<{
  readonly url: string;
  readonly status: number;
  readonly statusText: string;
  readonly cause?: unknown;
}> {}

export class FplParseError extends Data.TaggedError('FplParseError')<{
  readonly cause: unknown;
}> {}

export type FplError = FplHttpError | FplParseError;

// --- Schemas ---
export const FplEventSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.NullOr(Schema.String),
  deadline_time: Schema.NullOr(Schema.String),
  finished: Schema.Boolean,
  data_checked: Schema.Boolean,
});

export const FplFixtureSchema = Schema.Struct({
  id: Schema.Number,
  event: Schema.NullOr(Schema.Number),
  team_h: Schema.Number,
  team_a: Schema.Number,
  kickoff_time: Schema.NullOr(Schema.String),
  finished: Schema.Boolean,
  finished_provisional: Schema.Boolean,
});

export const FplBootstrapSchema = Schema.Struct({
  events: Schema.Array(FplEventSchema),
  teams: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      name: Schema.String,
      short_name: Schema.String,
      code: Schema.Number,
    })
  ),
  elements: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      web_name: Schema.String,
      first_name: Schema.String,
      second_name: Schema.String,
      element_type: Schema.Number,
      team: Schema.Number,
      now_cost: Schema.Number,
    })
  ),
});

export type FplBootstrap = typeof FplBootstrapSchema.Type;
export type FplFixture = typeof FplFixtureSchema.Type;
export type FplEvent = typeof FplEventSchema.Type;

export interface CurrentGameweekInfo {
  readonly currentGw: number;
  readonly isFinished: boolean;
  readonly nextGw: number | null;
}

// --- Service Interface ---
export interface IFplService {
  readonly getBootstrapStatic: () => Effect.Effect<FplBootstrap, FplError>;
  readonly getFixtures: (event?: number) => Effect.Effect<ReadonlyArray<FplFixture>, FplError>;
  readonly getCurrentGameweek: () => Effect.Effect<CurrentGameweekInfo, FplError>;
}

export class FplService extends Context.Tag('FplService')<FplService, IFplService>() {}

const retrySchedule = Schedule.exponential(Duration.millis(300)).pipe(
  Schedule.compose(Schedule.recurs(3))
);

function fetchFplJson<A, I>(url: string, schema: Schema.Schema<A, I, never>): Effect.Effect<A, FplError> {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(url, { headers: { 'User-Agent': 'Gaffa-App/1.0' } }),
      catch: (err) =>
        new FplHttpError({
          url,
          status: 500,
          statusText: err instanceof Error ? err.message : String(err),
          cause: err,
        }),
    });

    if (!response.ok) {
      return yield* Effect.fail(
        new FplHttpError({
          url,
          status: response.status,
          statusText: response.statusText,
        })
      );
    }

    const raw = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (err) => new FplParseError({ cause: err }),
    });

    return yield* Schema.decodeUnknown(schema)(raw).pipe(
      Effect.mapError((err) => new FplParseError({ cause: err }))
    );
  }).pipe(
    Effect.retry({
      schedule: retrySchedule,
      while: (err) => err._tag === 'FplHttpError' && err.status >= 500,
    })
  );
}

export const FplServiceLive = Layer.succeed(
  FplService,
  FplService.of({
    getBootstrapStatic: () => fetchFplJson(`${FPL_BASE}/bootstrap-static/`, FplBootstrapSchema),

    getFixtures: (event?: number) => {
      const url = event ? `${FPL_BASE}/fixtures/?event=${event}` : `${FPL_BASE}/fixtures/`;
      return fetchFplJson(url, Schema.Array(FplFixtureSchema));
    },

    getCurrentGameweek: () =>
      Effect.gen(function* () {
        const bootstrap = yield* fetchFplJson(`${FPL_BASE}/bootstrap-static/`, FplBootstrapSchema);
        const now = new Date();
        let currentGw = 1;
        let isFinished = false;
        let nextGw: number | null = null;

        for (const ev of bootstrap.events) {
          if (ev.deadline_time && new Date(ev.deadline_time) <= now) {
            if (ev.id >= currentGw) {
              currentGw = ev.id;
              isFinished = ev.finished;
            }
          } else if (nextGw === null && ev.deadline_time && new Date(ev.deadline_time) > now) {
            nextGw = ev.id;
          }
        }

        return { currentGw, isFinished, nextGw };
      }),
  })
);

export function createMockFplLayer(mocks: {
  getBootstrapStatic?: () => Effect.Effect<FplBootstrap, FplError>;
  getFixtures?: (event?: number) => Effect.Effect<ReadonlyArray<FplFixture>, FplError>;
  getCurrentGameweek?: () => Effect.Effect<CurrentGameweekInfo, FplError>;
}) {
  return Layer.succeed(
    FplService,
    FplService.of({
      getBootstrapStatic:
        mocks.getBootstrapStatic ??
        (() =>
          Effect.succeed({
            events: [],
            teams: [],
            elements: [],
          })),
      getFixtures: mocks.getFixtures ?? (() => Effect.succeed([])),
      getCurrentGameweek:
        mocks.getCurrentGameweek ??
        (() =>
          Effect.succeed({
            currentGw: 1,
            isFinished: false,
            nextGw: 2,
          })),
    })
  );
}
