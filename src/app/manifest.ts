import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Gaffa — Dynasty Fantasy Football',
    short_name: 'Gaffa',
    description: 'Dynasty fantasy football for the Premier League, with granular tactical positions, a live transfer market, and a scoring engine that judges every player against the role they actually played.',
    start_url: '/',
    display: 'standalone',
    background_color: '#F7F3ED',
    theme_color: '#F7F3ED',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
