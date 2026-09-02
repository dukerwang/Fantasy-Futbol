# Effect Architecture in Gaffa

Gaffa incorporates [Effect-TS](https://effect.website) (v3.x) to provide typed error handling, structured concurrency, declarative retries/backoff, and type-safe dependency injection across background syncs, cron jobs, external API clients, and route handlers.

---

## Directory Structure

All core Effect primitives, error definitions, and services live in [`src/lib/effect/`](file:///Users/dukewang/Fantasy%20Futbol/src/lib/effect):

```
src/lib/effect/
├── index.ts               # Barrel export for Effect modules, errors, runtime, and services
├── errors.ts              # Domain and infrastructure TaggedError classes
├── runtime.ts             # Next.js Route Handler adapter (runApiEffect)
├── services/
│   ├── supabase.ts        # Supabase Admin Service & Layer
│   ├── apiFootball.ts     # API-Football Service, Schemas, Retries & Layers
│   └── fpl.ts             # FPL Bootstrap/Fixtures Service, Schemas & Layers
└── __tests__/             # Unit test suite for Effect modules & services
```

---

## Core Principles & Patterns

### 1. Strongly Typed Domain Errors (`errors.ts`)

Instead of throwing untyped exceptions (`throw new Error(...)`), all failure modes are modeled with `Data.TaggedError`:

```typescript
import { Data } from 'effect';

export class NotFoundError extends Data.TaggedError('NotFoundError')<{
  readonly resource: string;
  readonly id?: string | number;
  readonly message?: string;
}> {}
```

Supported core error types:
- `ConfigError` (Missing environment variables)
- `HttpError` (HTTP 4xx/5xx responses or network drops)
- `RateLimitError` (429 Rate limiting)
- `ValidationError` (Schema validation / business rule violations)
- `DatabaseError` (PostgREST / Supabase RPC failures)
- `NotFoundError` (Resource not found)
- `UnauthorizedError` (Cron secret / session verification failures)

---

### 2. Next.js Route Handler Adapter (`runtime.ts`)

Use `runApiEffect` to execute Effect programs in Next.js Route Handlers. It automatically translates tagged errors into corresponding HTTP status codes:

- `UnauthorizedError` $\rightarrow$ **401**
- `NotFoundError` $\rightarrow$ **404**
- `ValidationError` $\rightarrow$ **422**
- `RateLimitError` $\rightarrow$ **429**
- `HttpError` $\rightarrow$ status code / **502**
- `DatabaseError` / `ConfigError` $\rightarrow$ **500**
- Unexpected defects (panics) $\rightarrow$ **500 Internal Server Error** (sanitized)

#### Example Route Handler:

```typescript
// src/app/api/admin/effect-demo/route.ts
import { NextRequest } from 'next/server';
import { Effect, FplService, FplServiceLive, UnauthorizedError, runApiEffect } from '@/lib/effect';

export async function POST(req: NextRequest) {
  const program = Effect.gen(function* () {
    const secret = req.headers.get('x-cron-secret');
    if (secret !== process.env.CRON_SECRET) {
      return yield* Effect.fail(new UnauthorizedError({ message: 'Invalid cron secret' }));
    }

    const fpl = yield* FplService;
    const gwInfo = yield* fpl.getCurrentGameweek();

    return { ok: true, gwInfo };
  }).pipe(Effect.provide(FplServiceLive));

  return runApiEffect(program);
}
```

---

### 3. Services and Dependency Injection (`Layer`)

Services decouple business logic from runtime implementations (e.g. real HTTP vs mock data):

```typescript
import { Context, Effect, Layer } from 'effect';

// Service Tag
export class NotificationService extends Context.Tag('NotificationService')<
  NotificationService,
  { readonly notify: (userId: string, message: string) => Effect.Effect<void, HttpError> }
>() {}

// Live Layer
export const NotificationServiceLive = Layer.succeed(
  NotificationService,
  NotificationService.of({
    notify: (userId, message) => Effect.sync(() => { /* send notification */ }),
  })
);
```

---

### 4. Schemas & Parsing (`Schema`)

Use `Schema` from `effect` to validate external APIs and untyped payloads at runtime:

```typescript
import { Schema } from 'effect';

export const ApiTeamSchema = Schema.Struct({
  team: Schema.Struct({
    id: Schema.Number,
    name: Schema.String,
  }),
});

// Parse unknown JSON safely:
const decoded = yield* Schema.decodeUnknown(ApiTeamSchema)(rawJson);
```

---

### 5. Testing with Vitest and Test Layers

Mocking external services is completely deterministic without monkey-patching global `fetch`:

```typescript
import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { ApiFootballService, createMockApiFootballLayer } from '@/lib/effect';

describe('Player Sync', () => {
  it('handles mock service responses', async () => {
    const mockLayer = createMockApiFootballLayer({
      fetchPLTeams: () => Effect.succeed([{ team: { id: 33, name: 'Manchester United' } }]),
    });

    const program = Effect.gen(function* () {
      const service = yield* ApiFootballService;
      return yield* service.fetchPLTeams();
    }).pipe(Effect.provide(mockLayer));

    const result = await Effect.runPromise(program);
    expect(result[0].team.name).toBe('Manchester United');
  });
});
```

---

## When to use Effect in Gaffa

- **Strongly recommended**:
  - Background sync routes (`/api/sync/*`)
  - Cron processors (`/api/cron/*`)
  - External API clients (FPL, API-Football, SoFIFA, Transfermarkt)
  - Complex batch transactions and financial reconciliations
- **Optional / Keep standard**:
  - Standard React Server Components & UI client hooks
  - Simple static page loads
