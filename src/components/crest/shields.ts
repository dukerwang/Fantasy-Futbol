export interface ShieldShape {
  id: string;
  label: string;
  path: string;
}

export const SHIELDS: ShieldShape[] = [
  {
    id: 'classic',
    label: 'Classic English',
    path: 'M 10 10 L 90 10 C 90 45, 90 80, 50 115 C 10 80, 10 45, 10 10 Z'
  },
  {
    id: 'continental',
    label: 'Continental',
    path: 'M 10 10 L 90 10 L 90 70 C 90 100, 75 115, 50 115 C 25 115, 10 100, 10 70 Z'
  },
  {
    id: 'heraldic',
    label: 'Heraldic Pointed',
    path: 'M 10 25 C 10 25, 25 15, 50 20 C 75 15, 90 25, 90 25 L 85 60 C 85 90, 70 110, 50 115 C 30 110, 15 90, 15 60 Z'
  },
  {
    id: 'arch',
    label: 'Crest Arch',
    path: 'M 10 40 C 10 15, 90 15, 90 40 L 90 80 C 90 102, 72 115, 50 115 C 28 115, 10 102, 10 80 Z'
  },
  {
    id: 'round',
    label: 'Rounded Badge',
    path: 'M 50 10 C 77.6 10, 90 32.4, 90 60 C 90 87.6, 77.6 110, 50 110 C 22.4 110, 10 87.6, 10 60 C 10 32.4, 22.4 10, 50 10 Z'
  },
  {
    id: 'pennant',
    label: 'Pennant',
    path: 'M 15 10 L 85 10 L 75 75 L 50 115 L 25 75 Z'
  }
];
