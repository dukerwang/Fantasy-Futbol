export interface ShieldShape {
  id: string;
  label: string;
  path: string;
}

export const SHIELDS: ShieldShape[] = [
  {
    id: 'classic',
    label: 'Classic Shield',
    path: 'M 10 10 L 90 10 C 90 45, 90 80, 50 110 C 10 80, 10 45, 10 10 Z'
  },
  {
    id: 'continental',
    label: 'Continental Shield',
    path: 'M 10 10 L 90 10 L 90 70 C 90 95, 75 110, 50 110 C 25 110, 10 95, 10 70 Z'
  },
  {
    id: 'heraldic',
    label: 'Pointed Heraldic',
    path: 'M 10 20 L 50 12 L 90 20 L 88 65 C 88 92, 72 110, 50 110 C 28 110, 12 92, 12 65 Z'
  },
  {
    id: 'arch',
    label: 'Crest Arch',
    path: 'M 10 38 C 10 12, 90 12, 90 38 L 90 78 C 90 100, 72 110, 50 110 C 28 110, 10 100, 10 78 Z'
  },
  {
    id: 'circle',
    label: 'Circular Badge',
    path: 'M 50 12 A 48 48 0 1 0 50 108 A 48 48 0 1 0 50 12 Z'
  },
  {
    id: 'pennant',
    label: 'Pennant Banner',
    path: 'M 12 10 L 88 10 L 78 72 L 50 110 L 22 72 Z'
  }
];
