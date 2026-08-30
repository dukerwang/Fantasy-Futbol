/** Twelve tactical roles used by Gaffa — mirrored here to keep the engine decoupled. */
export type GranularPosition =
  | 'GK'
  | 'CB'
  | 'LB'
  | 'RB'
  | 'LWB'
  | 'RWB'
  | 'DM'
  | 'CM'
  | 'AM'
  | 'LW'
  | 'RW'
  | 'ST';

export type OutlookAvailability =
  | 'available'
  | 'injured'
  | 'doubtful'
  | 'suspended'
  | 'unavailable'
  | 'unknown';

export type OutlookCareerPhase =
  | 'emerging'
  | 'peak'
  | 'plateau'
  | 'decline_risk'
  | 'unknown';

export type OutlookConfidence = 'high' | 'medium' | 'low';

export type OutlookHorizon = 'near' | 'long';

/**
 * Locked facts Gaffa supplies before any LLM call.
 * The model may not contradict these fields.
 */
export interface OutlookContextBag {
  player_id: string;
  name: string;
  display_name: string;
  age: number | null;
  nationality: string | null;
  club: string;
  primary_position: GranularPosition;
  secondary_positions: GranularPosition[];

  availability: OutlookAvailability;
  injury_news: string | null;

  market_value_eur_m: number | null;
  is_new_to_prem: boolean;
  academy_eligible: boolean;

  simulation_date: string;
  current_season: string;

  is_dynasty_league: boolean;

  /** Gaffa is PL-only — outlooks should treat exit from the Prem as materially reducing value. */
  pl_tenure: 'new_to_prem' | 'established';
}

/** Stage 3 extraction output — verified facts only, gaps explicit. */
export interface OutlookExtraction {
  verified_facts: string[];
  status_summary: string;
  role_summary: string;
  career_phase: OutlookCareerPhase;
  data_gaps: string[];
  conflicting_reports: string[];
  /** Only set when the factual foundation confirms the appointment as of simulation_date. */
  current_head_coach: string | null;
  /** Premier League roster mobility — critical for Gaffa eligibility. */
  pl_mobility:
    | 'stable'
    | 'recent_pl_arrival'
    | 'linked_exit'
    | 'confirmed_exit'
    | 'linked_pl_move'
    | 'unknown';
  mobility_summary: string;
}

/** Machine sidecar — not rendered as structure in the UI. */
export interface PlayerOutlookSidecar {
  evaluation_tags: string[];
  confidence: OutlookConfidence;
  horizons_touched: OutlookHorizon[];
  evidence_gaps: string[];
  generated_at: string;
  model_id: string;
  pipeline_version: string;
}

/** Final stored outlook. */
export interface PlayerOutlook {
  outlook: string;
  sidecar: PlayerOutlookSidecar;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface SynthesisTemperatureConfig {
  /** Fixed value, or `'auto'` from extraction richness (default). */
  mode?: 'auto' | 'fixed';
  /** Used when mode is `'fixed'`. */
  fixed?: number;
  /** ± band applied on auto mode — seeded by player_id for stable per-player variance. */
  jitter?: number;
}

export interface GenerateOutlookOptions {
  apiKey: string;
  contextBag: OutlookContextBag;
  /** Optional hook for batch cost tracking. */
  onUsage?: (usage: TokenUsage) => void;
  synthesisTemperature?: SynthesisTemperatureConfig;
}

export interface CompareSynthesisTemperaturesOptions {
  apiKey: string;
  contextBag: OutlookContextBag;
  /** Explicit temps to try. Defaults to [0.6, 0.7, 0.85, 0.95] when omitted. */
  temperatures?: number[];
  /** Also run one pass at auto-resolved temp (+ optional jitter). Default true. */
  includeAuto?: boolean;
  autoJitter?: number;
}

export interface TemperatureComparisonRow {
  label: string;
  temperature: number;
  outlook: string;
  sidecar: PlayerOutlookSidecar;
  wordCount: number;
  validation: { ok: true } | { ok: false; errors: string[] };
}

export interface GenerateOutlookResult extends PlayerOutlook {
  extraction: OutlookExtraction;
  groundingSourceCount: number;
}
