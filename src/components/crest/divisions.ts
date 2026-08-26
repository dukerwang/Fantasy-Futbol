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
  },
  {
    id: 'chevron',
    label: 'Chevron',
    renderLayers: (secondary) => `
      <polygon points="-10,130 120,130 50,40" fill="${secondary}" />
    `
  },
  {
    id: 'saltire',
    label: 'Per Saltire (X Quarters)',
    usesTertiary: true,
    renderLayers: (secondary, _border, tertiary) => `
      <polygon points="0,0 110,0 55,65" fill="${secondary}" />
      <polygon points="0,130 110,130 55,65" fill="${secondary}" />
      <polygon points="0,0 0,130 55,65" fill="${tertiary}" />
      <polygon points="110,0 110,130 55,65" fill="${tertiary}" />
    `
  },
  {
    id: 'bordure',
    label: 'Bordure (Ring Border)',
    renderLayers: (secondary) => `
      <rect x="0" y="0" width="100" height="14" fill="${secondary}" />
      <rect x="0" y="106" width="100" height="14" fill="${secondary}" />
      <rect x="0" y="0" width="14" height="120" fill="${secondary}" />
      <rect x="86" y="0" width="14" height="120" fill="${secondary}" />
    `
  }
];
