import type { GoogleGenAI } from '@google/genai';
import { FLASH_MODEL } from '../constants';
import { logUsage } from '../gemini/usage';

export interface SearchResult {
  text: string;
  sourceCount: number;
}

function countGroundingSources(response: unknown): number {
  const chunks = (response as {
    candidates?: Array<{ groundingMetadata?: { groundingChunks?: unknown[] } }>;
  })?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  return chunks?.filter((c: unknown) => (c as { web?: { uri?: string } })?.web?.uri).length ?? 0;
}

function formatSources(response: unknown): string {
  const chunks = (response as {
    candidates?: Array<{
      groundingMetadata?: {
        groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      };
    }>;
  })?.candidates?.[0]?.groundingMetadata?.groundingChunks;

  const sources =
    chunks
      ?.filter((c) => c.web?.uri)
      ?.slice(0, 3)
      ?.map((c) => (c.web!.title ? `${c.web!.title} (${c.web!.uri})` : c.web!.uri))
      ?.join(' | ') ?? '';

  return sources ? `\n[SOURCES: ${sources}]` : '';
}

async function runSingleSearch(
  ai: GoogleGenAI,
  query: string,
  dateLabel: string,
  attempt = 0,
): Promise<SearchResult> {
  try {
    const response = await ai.models.generateContent({
      model: FLASH_MODEL,
      contents: `[Date: ${dateLabel}] ${query}`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    logUsage('search', response);

    const text = response.text ?? '';
    const sourceCount = countGroundingSources(response);
    return {
      text: `[QUERY: ${query}]\n${text}${formatSources(response)}`,
      sourceCount,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const status = (error as { status?: number })?.status;
    const is429 =
      status === 429 || message.includes('429') || message.includes('RESOURCE_EXHAUSTED');

    if (is429 && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 3000));
      return runSingleSearch(ai, query, dateLabel, attempt + 1);
    }

    console.warn(`[engine:search] failed for: ${query}`, error);
    return { text: `[QUERY: ${query}]\nData unavailable.`, sourceCount: 0 };
  }
}

export async function runParallelSearch(
  ai: GoogleGenAI,
  queries: string[],
  simulationDate: string,
): Promise<{ foundation: string; sourceCount: number; groundedRequests: number }> {
  const dateLabel = simulationDate;
  const results = await Promise.all(
    queries.map((q) => runSingleSearch(ai, q, dateLabel)),
  );

  return {
    foundation: results.map((r) => r.text).join('\n\n---\n\n'),
    sourceCount: results.reduce((sum, r) => sum + r.sourceCount, 0),
    // One grounded request per query, issued whether or not it found anything.
    // This is the billable unit, so it is what the budget governor counts.
    groundedRequests: queries.length,
  };
}
