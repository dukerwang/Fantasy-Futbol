export interface PaletteColor {
  hex: string;
  label: string;
}

export const CREST_PALETTE: PaletteColor[] = [
  // Row 1: Deep / Dark Athletic tones (Columns 1-8)
  { hex: '#A62626', label: 'Striker Red' },
  { hex: '#4E2A1E', label: 'Trophy Brown' },
  { hex: '#8C6212', label: 'Dark Gold' },
  { hex: '#146B40', label: 'Gaffa Green' },
  { hex: '#1B4A5A', label: 'Deep Teal' },
  { hex: '#0F1E36', label: 'Midnight Navy' },
  { hex: '#582E60', label: 'Imperial Purple' },
  { hex: '#1C1C1C', label: 'Pitch Ink' },

  // Row 2: Mid tones (Columns 1-8)
  { hex: '#DC2626', label: 'Crimson' },
  { hex: '#B54E7F', label: 'Plum Rose' },
  { hex: '#D4A017', label: 'Amber Gold' },
  { hex: '#2F7A4E', label: 'Sage Green' },
  { hex: '#2E7D82', label: 'Ocean Teal' },
  { hex: '#2A5A92', label: 'Steel Blue' },
  { hex: '#8B5CF6', label: 'Classic Purple' },
  { hex: '#4A4A4A', label: 'Charcoal' },

  // Row 3: Light / Neutral accents (Columns 1-8)
  { hex: '#F87171', label: 'Soft Red' },
  { hex: '#E8E2D5', label: 'Sand' },
  { hex: '#FBBF24', label: 'Soft Yellow' },
  { hex: '#A7F3D0', label: 'Mint Green' },
  { hex: '#D9D4CD', label: 'Warm Grey' },
  { hex: '#60A5FA', label: 'Sky Blue' },
  { hex: '#C084FC', label: 'Lavender' },
  { hex: '#F7F3ED', label: 'Gaffa Cream' }
];
