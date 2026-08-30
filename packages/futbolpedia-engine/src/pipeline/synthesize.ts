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
    evaluation_tags: string[];
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
): Promise<PlayerOutlook> {
  const lockedFacts = buildLockedFactsBlock(bag);
  const systemInstruction = buildOutlookSystemInstruction();
  const prompt = buildOutlookSynthesisPrompt({
    lockedFacts,
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
      evaluation_tags: payload.sidecar.evaluation_tags ?? [],
      confidence: payload.sidecar.confidence ?? 'medium',
      horizons_touched: (payload.sidecar.horizons_touched ?? []) as OutlookHorizon[],
      evidence_gaps: payload.sidecar.evidence_gaps ?? [],
      generated_at: '',
      model_id: FLASH_MODEL,
      pipeline_version: '',
    },
  };
}
