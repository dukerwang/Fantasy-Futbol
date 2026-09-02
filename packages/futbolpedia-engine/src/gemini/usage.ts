import type { TokenUsage } from '../types/outlook';

interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
}

export function extractTokenUsage(response: unknown): TokenUsage {
  const u = (response as { usageMetadata?: UsageMetadata })?.usageMetadata;
  if (!u) return {};
  return {
    promptTokens: u.promptTokenCount,
    completionTokens: u.candidatesTokenCount,
    totalTokens: u.totalTokenCount,
  };
}

export function logUsage(label: string, response: unknown): void {
  const u = (response as { usageMetadata?: UsageMetadata })?.usageMetadata;
  if (!u) return;
  console.log(
    `[engine:${label}] tokens — prompt: ${u.promptTokenCount ?? '?'}, cached: ${u.cachedContentTokenCount ?? 0}, thoughts: ${u.thoughtsTokenCount ?? 0}, output: ${u.candidatesTokenCount ?? '?'}, total: ${u.totalTokenCount ?? '?'}`,
  );
}
