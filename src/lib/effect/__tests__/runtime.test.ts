import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { NextResponse } from 'next/server';
import {
  runApiEffect,
  UnauthorizedError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  HttpError,
  DatabaseError,
} from '../index';

describe('runApiEffect Runtime Adapter', () => {
  it('returns 200 JSON on successful effect', async () => {
    const program = Effect.succeed({ message: 'hello world', value: 42 });
    const response = await runApiEffect(program);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ message: 'hello world', value: 42 });
  });

  it('respects custom successStatus', async () => {
    const program = Effect.succeed({ created: true });
    const response = await runApiEffect(program, { successStatus: 201 });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ created: true });
  });

  it('passes through existing NextResponse instance', async () => {
    const customResponse = new NextResponse('custom-body', { status: 202 });
    const program = Effect.succeed(customResponse);
    const response = await runApiEffect(program);

    expect(response.status).toBe(202);
    expect(await response.text()).toBe('custom-body');
  });

  it('maps UnauthorizedError to 401', async () => {
    const program = Effect.fail(new UnauthorizedError({ message: 'Secret is missing' }));
    const response = await runApiEffect(program);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('UnauthorizedError');
    expect(body.message).toBe('Secret is missing');
  });

  it('maps NotFoundError to 404', async () => {
    const program = Effect.fail(new NotFoundError({ resource: 'Player', id: 'player_123' }));
    const response = await runApiEffect(program);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe('NotFoundError');
    expect(body.resource).toBe('Player');
  });

  it('maps ValidationError to 422', async () => {
    const program = Effect.fail(new ValidationError({ message: 'Invalid formation', details: { slot: 'GK' } }));
    const response = await runApiEffect(program);

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toBe('ValidationError');
    expect(body.message).toBe('Invalid formation');
  });

  it('maps RateLimitError to 429', async () => {
    const program = Effect.fail(new RateLimitError({ service: 'API-Football', retryAfterSeconds: 60 }));
    const response = await runApiEffect(program);

    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error).toBe('RateLimitError');
    expect(body.service).toBe('API-Football');
  });

  it('maps HttpError to status code', async () => {
    const program = Effect.fail(new HttpError({ url: 'https://api.test', status: 503, statusText: 'Service Unavailable' }));
    const response = await runApiEffect(program);

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe('HttpError');
  });

  it('maps DatabaseError to 500', async () => {
    const program = Effect.fail(new DatabaseError({ operation: 'insert_claim', message: 'duplicate key' }));
    const response = await runApiEffect(program);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('DatabaseError');
    expect(body.operation).toBe('insert_claim');
  });

  it('safely traps unhandled defects (panics) with 500', async () => {
    const program = Effect.dieMessage('Fatal unexpected crash');
    const response = await runApiEffect(program);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('InternalServerError');
    expect(body.message).toBe('An unexpected internal error occurred');
  });
});
