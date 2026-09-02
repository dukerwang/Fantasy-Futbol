import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/privacy', '/terms', '/guide', '/help', '/share/'],
        disallow: ['/api/', '/league/', '/admin/', '/dashboard/', '/settings/'],
      },
    ],
  };
}
