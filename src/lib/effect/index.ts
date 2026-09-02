/**
 * Gaffa Effect Integration Index
 *
 * Core standard library and runtime infrastructure for typed errors,
 * dependency injection, structured concurrency, and resilient integrations.
 */

// Re-export common Effect modules for ergonomic imports
export {
  Effect,
  Layer,
  Context,
  Schema,
  Schedule,
  Duration,
  Data,
  Option,
  Either,
  Exit,
  Cause,
  pipe,
} from 'effect';

// Export Gaffa-specific domain errors
export * from './errors';

// Export Next.js API runner and runtime utilities
export * from './runtime';

// Export Services and Layers
export * from './services/supabase';
export * from './services/apiFootball';
export * from './services/fpl';
