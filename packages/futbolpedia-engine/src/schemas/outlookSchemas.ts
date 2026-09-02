import { Type } from '@google/genai';
import { OUTLOOK_STYLES } from '../facets/types';

export const OUTLOOK_EXTRACTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    verified_facts: { type: Type.ARRAY, items: { type: Type.STRING } },
    status_summary: { type: Type.STRING },
    role_summary: { type: Type.STRING },
    career_phase: {
      type: Type.STRING,
      enum: ['emerging', 'peak', 'plateau', 'decline_risk', 'unknown'],
    },
    data_gaps: { type: Type.ARRAY, items: { type: Type.STRING } },
    conflicting_reports: { type: Type.ARRAY, items: { type: Type.STRING } },
    current_head_coach: { type: Type.STRING, nullable: true },
    pl_mobility: {
      type: Type.STRING,
      enum: [
        'stable',
        'recent_pl_arrival',
        'linked_exit',
        'confirmed_exit',
        'linked_pl_move',
        'unknown',
      ],
    },
    mobility_summary: { type: Type.STRING },
  },
  required: [
    'verified_facts',
    'status_summary',
    'role_summary',
    'career_phase',
    'data_gaps',
    'conflicting_reports',
    'current_head_coach',
    'pl_mobility',
    'mobility_summary',
  ],
};

export const OUTLOOK_SYNTHESIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    outlook: { type: Type.STRING },
    sidecar: {
      type: Type.OBJECT,
      properties: {
        // Closed enums, all of them. The free-text tag array this replaces
        // produced 158 distinct values across 75 players.
        quality: { type: Type.STRING, enum: ['elite', 'high', 'solid', 'squad'] },
        minutes_role: {
          type: Type.STRING,
          enum: ['nailed', 'likely_starter', 'rotation_risk', 'fringe'],
        },
        career_phase: {
          type: Type.STRING,
          enum: ['emerging', 'peak', 'plateau', 'decline_risk', 'unknown'],
        },
        dynasty_value: {
          type: Type.STRING,
          enum: ['cornerstone', 'long_term_hold', 'win_now', 'declining_asset'],
        },
        pl_mobility: {
          type: Type.STRING,
          enum: [
            'stable',
            'recent_pl_arrival',
            'linked_exit',
            'confirmed_exit',
            'linked_pl_move',
            'unknown',
          ],
        },
        risk_flags: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING,
            enum: ['injury_prone', 'minutes_competition', 'contract_year', 'tactical_misfit'],
          },
        },
        style: {
          type: Type.ARRAY,
          items: { type: Type.STRING, enum: [...OUTLOOK_STYLES] },
        },
        confidence: {
          type: Type.STRING,
          enum: ['high', 'medium', 'low'],
        },
        horizons_touched: { type: Type.ARRAY, items: { type: Type.STRING } },
        evidence_gaps: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: [
        'quality',
        'minutes_role',
        'career_phase',
        'dynasty_value',
        'pl_mobility',
        'risk_flags',
        'style',
        'confidence',
        'horizons_touched',
        'evidence_gaps',
      ],
    },
  },
  required: ['outlook', 'sidecar'],
};
