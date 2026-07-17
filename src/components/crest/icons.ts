export interface CrestIcon {
  id: string;
  label: string;
  // A function that returns the SVG path or elements inside a 50x50 viewBox
  path: string;
}

export const CURATED_ICONS: CrestIcon[] = [
  {
    id: 'football',
    label: 'Football',
    path: 'M25,5C14,5,5,14,5,25s9,20,20,20s20-9,20-20S36,5,25,5z M25,13.5l4.1,3l-1.6,4.8h-5l-1.6-4.8L25,13.5z M13.7,18.7l3-4.1l3.5,3.5 l-1.3,4.9L13.7,18.7z M15.4,31.3l-1.7-4.8l5.2-1.2l3,4.1L15.4,31.3z M25,36.5l-4.1-3l1.6-4.8h5l1.6,4.8L25,36.5z M34.6,31.3l-3.5-3.5 l3-4.1l5.2,1.2L34.6,31.3z M36.3,18.7l-5.2,1.2l-1.3-4.9l3.5-3.5L36.3,18.7z'
  },
  {
    id: 'crown',
    label: 'Imperial Crown',
    path: 'M8,36h34v-4H8V36z M8,30l3-14l8,8l6-14l6,14l8-8l3,14H8z'
  },
  {
    id: 'star',
    label: 'Star',
    path: 'M25,6.2l5.9,12l13.2,1.9l-9.6,9.3l2.3,13.1L25,36.3l-11.8,6.2l2.3-13.1l-9.6-9.3L19.1,18.2L25,6.2z'
  },
  {
    id: 'crossed-swords',
    label: 'Crossed Swords',
    path: 'M9.4,38.6l2,2l2-2l-2-2L9.4,38.6z M12.8,35.2l22-22l2.8-2.8c0.8-0.8,0.8-2,0-2.8c-0.8-0.8-2-0.8-2.8,0l-2.8,2.8l-22,22L12.8,35.2z M31.2,13.8l5,5l-2.8,2.8l-5-5L31.2,13.8z M18.8,26.2l-5-5l2.8-2.8l5,5L18.8,26.2z'
  },
  {
    id: 'lion',
    label: 'Lion Rampant',
    path: 'M16,40h4l1-6h4v-3h-2v-3l2-6h3v-3h-1l3-8l-6,3l1,3h-3l2,4h-4l2,4h-4l3,6h-3l1,1v5z'
  },
  {
    id: 'eagle',
    label: 'Heraldic Eagle',
    path: 'M25,5l3,5l7-2l-3,7l10,1l-11,7l4,9l-10-4l-10,4l4-9l-11-7l10-1l-3-7l7,2L25,5z'
  },
  {
    id: 'trophy',
    label: 'Championship Cup',
    path: 'M15,10h20v12c0,6-5,11-10,11S15,28,15,22V10z M23,33v7h-7v4h18v-4h-7v-7H23z M15,14H10v6h5V14z M35,14h5v6h-5V14z'
  },
  {
    id: 'cannon',
    label: 'Arsenal Cannon',
    path: 'M38,20h-8v-3c0-1.1-0.9-2-2-2h-6c-1.1,0-2,0.9-2,2v3H12c-3.9,0-7,3.1-7,7s3.1,7,7,7h26c2.2,0,4-1.8,4-4v-6C42,21.8,40.2,20,38,20z M25,27c-1.1,0-2-0.9-2-2s0.9-2,2-2s2,0.9,2,2S26.1,27,25,27z'
  },
  {
    id: 'anchor',
    label: 'Port Anchor',
    path: 'M25,6c1.6,0,3,1.4,3,3s-1.4,3-3,3s-3-1.4-3-3S23.4,6,25,6z M23,12h4v22h9c0,0,2-3,2-6h4c0,6-5,12-17,12S8,34,8,28h4c0,3,2,6,2,6h9V12z'
  },
  {
    id: 'lightning',
    label: 'Lightning Bolt',
    path: 'M30,5L14,25h10l-4,20l16-20H26L30,5z'
  },
  {
    id: 'fleur-de-lis',
    label: 'Fleur-de-lis',
    path: 'M25,5c0,0-3,13-10,17c-4,2-7,0-7,3c0,3,4,5,8,3c3-2,6,6,6,12h6c0-6,3-14,6-12c4,2,8,0,8-3c0-3-3-1-7-3C28,18,25,5,25,5z'
  },
  {
    id: 'flame',
    label: 'Passion Flame',
    path: 'M25,5c0,0,8,10,8,19c0,6-4,12-8,12s-8-6-8-12C17,15,25,5,25,5z M25,14c0,0,4,6,4,10c0,3-2,6-4,6s-4-3-4-6C21,20,25,14,25,14z'
  },
  {
    id: 'castle',
    label: 'Fortress Tower',
    path: 'M10,44h30V20h-4v-8h-6v4h-2v-4h-6v4h-2v-4h-6v8h-4V44z M22,30h6v14h-6V30z'
  },
  {
    id: 'gaffa-pulse',
    label: 'Gaffa Pulse Wave',
    path: 'M5,25h8l4-13l4,26l4-18l4,10l4-5h12'
  },
  {
    id: 'rose',
    label: 'Lancashire Rose',
    path: 'M25,15c-5.5,0-10,4.5-10,10s4.5,10,10,10s10-4.5,10-10S30.5,15,25,15z M25,21c2.2,0,4,1.8,4,4s-1.8,4-4,4s-4-1.8-4-4S22.8,21,25,21z M25,7c-3,0-5.5,2.5-5.5,5.5S22,18,25,18s5.5-2.5,5.5-5.5S28,7,25,7z M25,32c-3,0-5.5,2.5-5.5,5.5s2.5,5.5,5.5,5.5s5.5-2.5,5.5-5.5S28,32,25,32z M7,25c0,3,2.5,5.5,5.5,5.5s5.5-2.5,5.5-5.5S15.5,19.5,12.5,19.5S7,22,7,25z M32.5,25c0,3,2.5,5.5,5.5,5.5s5.5-2.5,5.5-5.5S41,19.5,38,19.5S32.5,22,32.5,25z'
  },
  {
    id: 'shield-mini',
    label: 'Inner Shield',
    path: 'M15,10h20v15c0,9-10,17-10,17s-10-8-10-17V10z'
  },
  {
    id: 'laurel',
    label: 'Laurel Wreath',
    path: 'M11,27c0-4,1.5-8,4-11l3,3c-2,2.5-3,5.5-3,8c0,5.5,4,10.5,10,11.5v3.5C17,41,11,35,11,27z M39,27c0-4-1.5-8-4-11l-3,3c2,2.5,3,5.5,3,8c0,5.5-4,10.5-10,11.5v3.5C33,41,39,35,39,27z'
  },
  {
    id: 'moon',
    label: 'Crescent Moon',
    path: 'M28.1,9.3c-7.9,0.8-14,7.4-14,15.5c0,8.7,7.1,15.7,15.7,15.7c3.9,0,7.5-1.4,10.3-3.8c-2.4,1.4-5.3,2.2-8.3,2.2c-8.7,0-15.7-7.1-15.7-15.7c0-6,3.4-11.2,8.4-13.8C25.7,9.3,26.9,9.3,28.1,9.3z'
  },
  {
    id: 'sun',
    label: 'Editorial Sun',
    path: 'M25,15c-5.5,0-10,4.5-10,10s4.5,10,10,10s10-4.5,10-10S30.5,15,25,15z M25,5l3,7l-3,3l-3-3L25,5z M25,45l-3-7l3-3l3,3L25,45z M5,25l7-3l3,3l-3,3L5,25z M45,25l-7,3l-3-3l3-3L45,25z'
  },
  {
    id: 'sword-single',
    label: 'Broadsword',
    path: 'M23,6L29,12L12,29L9,26ZM9,26L6,29L5,32L8,31L11,28ZM8,31L9,32L6,35L5,32Z'
  }
];
