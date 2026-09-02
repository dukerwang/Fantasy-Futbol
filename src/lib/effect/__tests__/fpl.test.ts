import { describe, it, expect } from 'vitest';
import { Effect, Schema } from 'effect';
import {
  FplService,
  createMockFplLayer,
  FplEventSchema,
  FplFixtureSchema,
} from '../index';

describe('Fpl Effect Service & Schemas', () => {
  it('decodes FPL event schema', () => {
    const rawEvent = {
      id: 1,
      name: 'Gameweek 1',
      deadline_time: '2026-08-21T17:30:00Z',
      finished: false,
      data_checked: false,
    };

    const decoded = Schema.decodeUnknownSync(FplEventSchema)(rawEvent);
    expect(decoded.id).toBe(1);
    expect(decoded.name).toBe('Gameweek 1');
    expect(decoded.finished).toBe(false);
  });

  it('decodes FPL fixture schema', () => {
    const rawFixture = {
      id: 10,
      event: 1,
      team_h: 1,
      team_a: 14,
      kickoff_time: '2026-08-21T19:00:00Z',
      finished: false,
      finished_provisional: false,
    };

    const decoded = Schema.decodeUnknownSync(FplFixtureSchema)(rawFixture);
    expect(decoded.id).toBe(10);
    expect(decoded.team_h).toBe(1);
    expect(decoded.team_a).toBe(14);
  });

  it('computes current gameweek and next gameweek properly in mock layer', async () => {
    const mockLayer = createMockFplLayer({
      getCurrentGameweek: () =>
        Effect.succeed({
          currentGw: 5,
          isFinished: true,
          nextGw: 6,
        }),
    });

    const program = Effect.gen(function* () {
      const fpl = yield* FplService;
      return yield* fpl.getCurrentGameweek();
    }).pipe(Effect.provide(mockLayer));

    const result = await Effect.runPromise(program);
    expect(result.currentGw).toBe(5);
    expect(result.isFinished).toBe(true);
    expect(result.nextGw).toBe(6);
  });
});
