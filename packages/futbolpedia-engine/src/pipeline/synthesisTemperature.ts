import type { OutlookExtraction } from '../types/outlook';

export interface SynthesisTemperatureOptions {
  /** Override auto resolution — use this exact value. */
  fixed?: number;
  /** Add ± jitter (default 0). Use player_id as seed for reproducible per-player variance. */
  jitter?: number;
  jitterSeed?: string;
}

/** Evidence-rich extractions get warmer synthesis; thin/gappy → stay conservative. */
export function resolveSynthesisTemperature(
  extraction: OutlookExtraction,
  options: SynthesisTemperatureOptions = {},
): number {
  if (options.fixed !== undefined) {
    return clampTemperature(options.fixed);
  }

  const factScore = Math.min(extraction.verified_facts.length, 8) / 8;
  const gapPenalty = Math.min(extraction.data_gaps.length, 4) * 0.08;
  const conflictPenalty = extraction.conflicting_reports.length > 0 ? 0.1 : 0;
  const unknownPhasePenalty = extraction.career_phase === 'unknown' ? 0.05 : 0;

  // ~0.55 when evidence is thin, ~0.90 when rich.
  let temp = 0.55 + factScore * 0.35 - gapPenalty - conflictPenalty - unknownPhasePenalty;

  if (options.jitter && options.jitter > 0 && options.jitterSeed) {
    temp += (hashSeed(options.jitterSeed) * 2 - 1) * options.jitter;
  }

  return clampTemperature(temp);
}

function clampTemperature(value: number): number {
  return Math.round(Math.max(0.5, Math.min(0.98, value)) * 100) / 100;
}

/** Deterministic 0..1 from a string seed. */
function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}
