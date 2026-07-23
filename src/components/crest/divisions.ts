export interface DivisionPattern {
  id: string;
  label: string;
  // Whether this pattern uses a third (tertiary) color layer, distinct from the shield border.
  usesTertiary?: boolean;
  // A function that returns SVG elements representing the layers of the pattern.
  renderLayers: (secondaryColor: string, borderColor: string, tertiaryColor: string) => string;
}

export const DIVISIONS: DivisionPattern[] = [
  {
    id: 'solid',
    label: 'Solid Field',
    renderLayers: () => ''
  },
  {
    id: 'vertical-half',
    label: 'Per Pale (Vertical Half)',
    renderLayers: (secondary) => `<rect x="50" y="0" width="55" height="130" fill="${secondary}" />`
  },
  {
    id: 'horizontal-half',
    label: 'Per Fess (Horizontal Half)',
    renderLayers: (secondary) => `<rect x="0" y="60" width="110" height="70" fill="${secondary}" />`
  },
  {
    id: 'quartered',
    label: 'Quartered',
    renderLayers: (secondary) => `
      <rect x="50" y="0" width="55" height="60" fill="${secondary}" />
      <rect x="0" y="60" width="50" height="70" fill="${secondary}" />
    `
  },
  {
    id: 'sash',
    label: 'Bend (Diagonal Sash)',
    renderLayers: (secondary) => `
      <polygon points="-10,-10 30,-10 110,70 110,105 70,105 -10,25" fill="${secondary}" />
    `
  },
  {
    id: 'thirds',
    label: 'Fess Tierced (Horizontal Thirds)',
    usesTertiary: true,
    renderLayers: (secondary, _border, tertiary) => `
      <rect x="0" y="40" width="110" height="40" fill="${secondary}" />
      <rect x="0" y="80" width="110" height="50" fill="${tertiary}" />
    `
  }
];
