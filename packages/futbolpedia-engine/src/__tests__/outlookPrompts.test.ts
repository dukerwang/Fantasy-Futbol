import { describe, expect, it } from 'vitest';
import {
  buildLockedFactsBlock,
  buildOutlookSystemInstruction,
  buildOutlookSynthesisPrompt,
} from '../prompts/outlook';
import type { OutlookContextBag } from '../types/outlook';

const SAMPLE_BAG: OutlookContextBag = {
  player_id: '11111111-1111-1111-1111-111111111111',
  name: 'James Tarkowski',
  display_name: 'James Tarkowski',
  age: 32,
  nationality: 'England',
  club: 'Everton',
  primary_position: 'CB',
  secondary_positions: [],
  availability: 'available',
  injury_news: null,
  market_value_eur_m: 12,
  is_new_to_prem: false,
  academy_eligible: false,
  simulation_date: '2026-08-26',
  current_season: '2026-27',
  is_dynasty_league: true,
  pl_tenure: 'established',
};

describe('buildLockedFactsBlock', () => {
  it('includes identity and availability fields', () => {
    const block = buildLockedFactsBlock(SAMPLE_BAG);
    expect(block).toContain('James Tarkowski');
    expect(block).toContain('Everton');
    expect(block).toContain('Primary position: CB');
    expect(block).toContain('Availability: Available');
    expect(block).toContain('Dynasty league context: yes');
  });

  it('includes PL scope and tenure', () => {
    const block = buildLockedFactsBlock(SAMPLE_BAG);
    expect(block).toContain('PREMIER LEAGUE SCOPE');
    expect(block).toContain('PL tenure for evaluation');
  });
});

describe('buildOutlookSystemInstruction', () => {
  it('bans trade advice and cringe meta labels', () => {
    const instruction = buildOutlookSystemInstruction();
    expect(instruction).toContain('Buy / hold / sell');
    expect(instruction).toContain('"In Gaffa"');
    expect(instruction).toContain('FORM VS CLASS');
  });

  it('requires coverage brief anchors', () => {
    const instruction = buildOutlookSystemInstruction();
    expect(instruction).toContain('Status');
    expect(instruction).toContain('Role');
    expect(instruction).toContain('Expectation');
    expect(instruction).toContain('Career point');
    expect(instruction).toContain('Evaluation');
  });

  it('includes manager and PL mobility laws', () => {
    const instruction = buildOutlookSystemInstruction();
    expect(instruction).toContain('HEAD COACH / MANAGER LAW');
    expect(instruction).toContain('PREMIER LEAGUE MOBILITY');
  });
});

describe('buildOutlookSynthesisPrompt', () => {
  it('inlines locked facts, foundation, and extraction', () => {
    const locked = buildLockedFactsBlock(SAMPLE_BAG);
    const prompt = buildOutlookSynthesisPrompt({
      computedFacts: '',
      lockedFacts: locked,
      factualFoundation: 'Everton kept a clean sheet at home.',
      extractionJson: JSON.stringify({ data_gaps: ['set-piece role unclear'] }),
    });
    expect(prompt).toContain('LOCKED FACTS');
    expect(prompt).toContain('<factual_foundation>');
    expect(prompt).toContain('<verified_extraction>');
    expect(prompt).toContain('Do NOT give buy/hold/sell advice');
  });
});
