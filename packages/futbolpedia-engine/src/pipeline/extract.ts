import type { GoogleGenAI } from '@google/genai';
import { FLASH_MODEL } from '../constants';
import { logUsage } from '../gemini/usage';
import { buildLockedFactsBlock, buildOutlookExtractionPrompt } from '../prompts/outlook';
import { OUTLOOK_EXTRACTION_SCHEMA } from '../schemas/outlookSchemas';
import type { OutlookContextBag, OutlookExtraction } from '../types/outlook';

function parseJsonText(text: string): unknown {
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

export async function extractOutlookFacts(
  ai: GoogleGenAI,
  bag: OutlookContextBag,
  factualFoundation: string,
): Promise<OutlookExtraction> {
  const lockedFacts = buildLockedFactsBlock(bag);
  const prompt = buildOutlookExtractionPrompt({
    lockedFacts,
    factualFoundation: factualFoundation.substring(0, 8000),
  });

  const response = await ai.models.generateContent({
    model: FLASH_MODEL,
    contents: prompt,
    config: {
      systemInstruction: 'You extract verified football facts. Never infer from training memory.',
      responseMimeType: 'application/json',
      responseSchema: OUTLOOK_EXTRACTION_SCHEMA,
    },
  });

  logUsage('extract', response);

  const text = response.text;
  if (!text) throw new Error('Extraction returned no text');

  const parsed = parseJsonText(text) as OutlookExtraction;
  return {
    verified_facts: parsed.verified_facts ?? [],
    status_summary: parsed.status_summary ?? '',
    role_summary: parsed.role_summary ?? '',
    career_phase: parsed.career_phase ?? 'unknown',
    data_gaps: parsed.data_gaps ?? [],
    conflicting_reports: parsed.conflicting_reports ?? [],
    current_head_coach: parsed.current_head_coach ?? null,
    pl_mobility: parsed.pl_mobility ?? 'unknown',
    mobility_summary: parsed.mobility_summary ?? '',
  };
}
