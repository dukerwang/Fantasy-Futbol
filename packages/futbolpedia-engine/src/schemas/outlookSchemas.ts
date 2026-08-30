import { Type } from '@google/genai';

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
        evaluation_tags: { type: Type.ARRAY, items: { type: Type.STRING } },
        confidence: {
          type: Type.STRING,
          enum: ['high', 'medium', 'low'],
        },
        horizons_touched: { type: Type.ARRAY, items: { type: Type.STRING } },
        evidence_gaps: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['evaluation_tags', 'confidence', 'horizons_touched', 'evidence_gaps'],
    },
  },
  required: ['outlook', 'sidecar'],
};
