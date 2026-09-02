import { describe, it, expect } from 'vitest';
import { Effect, Schema } from 'effect';
import {
  ApiFootballService,
  createMockApiFootballLayer,
  ApiFootballConfigError,
  ApiFootballRateLimitError,
  ApiTeamSchema,
  ApiPlayerSchema,
} from '../index';

describe('ApiFootball Effect Service & Schemas', () => {
  it('decodes valid team schemas', () => {
    const rawTeam = {
      team: {
        id: 33,
        name: 'Manchester United',
      },
    };

    const decoded = Schema.decodeUnknownSync(ApiTeamSchema)(rawTeam);
    expect(decoded.team.id).toBe(33);
    expect(decoded.team.name).toBe('Manchester United');
  });

  it('decodes valid player schemas with nullables', () => {
    const rawPlayer = {
      player: {
        id: 101,
        name: 'Bruno Fernandes',
        firstname: 'Bruno Miguel',
        lastname: 'Borges Fernandes',
        birth: { date: '1994-09-08' },
        nationality: 'Portugal',
        height: '179 cm',
        weight: '69 kg',
        photo: 'https://media.api-sports.io/football/players/101.png',
      },
      statistics: [
        {
          team: { id: 33, name: 'Manchester United' },
          games: { position: 'Midfielder' },
        },
      ],
    };

    const decoded = Schema.decodeUnknownSync(ApiPlayerSchema)(rawPlayer);
    expect(decoded.player.id).toBe(101);
    expect(decoded.player.name).toBe('Bruno Fernandes');
    expect(decoded.statistics[0].games.position).toBe('Midfielder');
  });

  it('executes via mock layer in Effect programs', async () => {
    const mockTeams = [
      { team: { id: 33, name: 'Manchester United' } },
      { team: { id: 40, name: 'Liverpool' } },
    ];

    const mockLayer = createMockApiFootballLayer({
      fetchPLTeams: () => Effect.succeed(mockTeams),
    });

    const program = Effect.gen(function* () {
      const service = yield* ApiFootballService;
      return yield* service.fetchPLTeams();
    }).pipe(Effect.provide(mockLayer));

    const result = await Effect.runPromise(program);
    expect(result).toHaveLength(2);
    expect(result[0].team.name).toBe('Manchester United');
  });

  it('handles rate limit and config errors correctly in type-safe failure branches', async () => {
    const rateLimitLayer = createMockApiFootballLayer({
      fetchPLTeams: () => Effect.fail(new ApiFootballRateLimitError({})),
    });

    const program = Effect.gen(function* () {
      const service = yield* ApiFootballService;
      return yield* service.fetchPLTeams();
    }).pipe(
      Effect.catchTag('ApiFootballRateLimitError', () => Effect.succeed('rate_limited_fallback')),
      Effect.catchTag('ApiFootballConfigError', () => Effect.succeed('config_error_fallback')),
      Effect.provide(rateLimitLayer)
    );

    const result = await Effect.runPromise(program);
    expect(result).toBe('rate_limited_fallback');
  });
});
