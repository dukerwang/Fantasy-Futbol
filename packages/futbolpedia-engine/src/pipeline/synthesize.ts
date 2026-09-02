import { buildComputedFactsBlock, computeSetPieces } from '../facets/compute';
import { openingAngleFor } from '../gates/openingPatterns';
import { stylesFor } from '../facets/types';
import type { OutlookCareerPhase } from '../types/outlook';
import type {
  DynastyValue,
  FacetInputs,
  MinutesRole,
  OutlookStyle,
  PlMobility,
  QualityTier,
  RiskFlag,
} from '../facets/types';
import type { GoogleGenAI } from '@google/genai';
import { FLASH_MODEL } from '../constants';
import { logUsage } from '../gemini/usage';
import {
  buildLockedFactsBlock,
  buildOutlookSynthesisPrompt,
  buildOutlookSystemInstruction,
} from '../prompts/outlook';
import { OUTLOOK_SYNTHESIS_SCHEMA } from '../schemas/outlookSchemas';
import type {
  OutlookContextBag,
  OutlookExtraction,
  OutlookConfidence,
  OutlookHorizon,
  PlayerOutlook,
} from '../types/outlook';

function parseJsonText(text: string): unknown {
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

interface SynthesisPayload {
  outlook: string;
  sidecar: {
    quality?: QualityTier;
    minutes_role?: MinutesRole;
    career_phase?: OutlookCareerPhase;
    dynasty_value?: DynastyValue;
    pl_mobility?: PlMobility;
    risk_flags?: RiskFlag[];
    style?: OutlookStyle[];
    confidence: OutlookConfidence;
    horizons_touched: OutlookHorizon[];
    evidence_gaps: string[];
  };
}

async function runSynthesisAttempt(
  ai: GoogleGenAI,
  prompt: string,
  systemInstruction: string,
  temperature: number,
): Promise<SynthesisPayload> {
  // Omit thinkingConfig — conflicts with responseSchema on Flash (Futbolpedia quirk).
  const response = await ai.models.generateContent({
    model: FLASH_MODEL,
    contents: prompt,
    config: {
      systemInstruction,
      temperature,
      responseMimeType: 'application/json',
      responseSchema: OUTLOOK_SYNTHESIS_SCHEMA,
    },
  });

  logUsage('synthesize', response);

  const text = response.text;
  if (!text) throw new Error('Synthesis returned no text');

  return parseJsonText(text) as SynthesisPayload;
}

/**
 * Grounded search returns page text, and some of it carries HTML entities the
 * model then copies verbatim — one stored outlook reads "Hugo Ekitik&eacute;".
 * Decoded here rather than at render time: the string is read by the gate, the
 * card lede, the hub and anything Futbolpedia does with it later, and only one
 * of those is HTML.
 */
const HTML_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
  aacute: 'á', agrave: 'à', acirc: 'â', auml: 'ä', aring: 'å', atilde: 'ã',
  iacute: 'í', igrave: 'ì', icirc: 'î', iuml: 'ï',
  oacute: 'ó', ograve: 'ò', ocirc: 'ô', ouml: 'ö', otilde: 'õ', oslash: 'ø',
  uacute: 'ú', ugrave: 'ù', ucirc: 'û', uuml: 'ü',
  ccedil: 'ç', ntilde: 'ñ', szlig: 'ß', yacute: 'ý',
  rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d',
  ndash: '\u2013', mdash: '\u2014', hellip: '\u2026',
};

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    // Entity names are case-SENSITIVE: &Oslash; is Ø and &oslash; is ø. The
    // table holds the lowercase forms, so an initial-capital name resolves
    // through it and then has its character upper-cased.
    .replace(/&([a-zA-Z]+);/g, (whole, name: string) => {
      const exact = HTML_ENTITIES[name];
      if (exact) return exact;
      const isCapitalised = name[0] === name[0].toUpperCase();
      const lower = HTML_ENTITIES[name.toLowerCase()];
      if (!lower) return whole;
      return isCapitalised ? lower.toUpperCase() : lower;
    });
}

export async function synthesizeOutlook(
  ai: GoogleGenAI,
  bag: OutlookContextBag,
  factualFoundation: string,
  extraction: OutlookExtraction,
  temperature = 0.7,
  facts?: FacetInputs,
): Promise<PlayerOutlook> {
  const permitted = stylesFor(bag.primary_position, bag.secondary_positions);
  const lockedFacts = buildLockedFactsBlock(bag);
  const systemInstruction = buildOutlookSystemInstruction();
  const prompt = buildOutlookSynthesisPrompt({
    lockedFacts,
    computedFacts: facts ? buildComputedFactsBlock(facts) : '',
    factualFoundation: factualFoundation.substring(0, 8000),
    extractionJson: JSON.stringify(extraction, null, 2),
    openingAngle: openingAngleFor(bag.player_id),
    permittedStyles: permitted.join(', '),
  });

  let payload: SynthesisPayload;
  try {
    payload = await runSynthesisAttempt(ai, prompt, systemInstruction, temperature);
  } catch (firstError) {
    console.warn('[engine:synthesize] first attempt failed, retrying once:', firstError);
    payload = await runSynthesisAttempt(ai, prompt, systemInstruction, temperature);
  }

  return {
    outlook: decodeHtmlEntities(payload.outlook.trim()),
    sidecar: {
      quality: payload.sidecar.quality ?? 'solid',
      minutes_role: payload.sidecar.minutes_role ?? 'rotation_risk',
      career_phase: payload.sidecar.career_phase ?? 'unknown',
      dynasty_value: payload.sidecar.dynasty_value ?? 'win_now',
      pl_mobility: payload.sidecar.pl_mobility ?? extraction.pl_mobility ?? 'unknown',
      risk_flags: payload.sidecar.risk_flags ?? [],
      // Enforced, not merely requested: the schema's enum is the whole
      // vocabulary, and only this filter knows his positions.
      style: (payload.sidecar.style ?? []).filter((v) => permitted.includes(v)),
      // Fact, not judgment: FPL publishes the set-piece hierarchy.
      set_pieces: facts ? computeSetPieces(facts) : [],
      confidence: payload.sidecar.confidence ?? 'medium',
      horizons_touched: (payload.sidecar.horizons_touched ?? []) as OutlookHorizon[],
      evidence_gaps: payload.sidecar.evidence_gaps ?? [],
      generated_at: '',
      model_id: FLASH_MODEL,
      pipeline_version: '',
    },
  };
}
