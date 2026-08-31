import { buildComputedFactsBlock, computeSetPieces } from '../facets/compute';
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

export async function synthesizeOutlook(
  ai: GoogleGenAI,
  bag: OutlookContextBag,
  factualFoundation: string,
  extraction: OutlookExtraction,
  temperature = 0.7,
  facts?: FacetInputs,
): Promise<PlayerOutlook> {
  const lockedFacts = buildLockedFactsBlock(bag);
  const systemInstruction = buildOutlookSystemInstruction();
  const prompt = buildOutlookSynthesisPrompt({
    lockedFacts,
    computedFacts: facts ? buildComputedFactsBlock(facts) : '',
    factualFoundation: factualFoundation.substring(0, 8000),
    extractionJson: JSON.stringify(extraction, null, 2),
  });

  let payload: SynthesisPayload;
  try {
    payload = await runSynthesisAttempt(ai, prompt, systemInstruction, temperature);
  } catch (firstError) {
    console.warn('[engine:synthesize] first attempt failed, retrying once:', firstError);
    payload = await runSynthesisAttempt(ai, prompt, systemInstruction, temperature);
  }

  return {
    outlook: payload.outlook.trim(),
    sidecar: {
      quality: payload.sidecar.quality ?? 'solid',
      minutes_role: payload.sidecar.minutes_role ?? 'rotation_risk',
      career_phase: payload.sidecar.career_phase ?? 'unknown',
      dynasty_value: payload.sidecar.dynasty_value ?? 'win_now',
      pl_mobility: payload.sidecar.pl_mobility ?? extraction.pl_mobility ?? 'unknown',
      risk_flags: payload.sidecar.risk_flags ?? [],
      style: payload.sidecar.style ?? [],
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
