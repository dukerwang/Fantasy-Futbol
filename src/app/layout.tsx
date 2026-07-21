import type { Metadata } from 'next';
import { ThemeProvider } from '@/context/ThemeContext';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://gaffa.live'),
  title: 'Gaffa — Tactical Fantasy Football',
  description: 'Twelve real tactical positions, a live transfer market, and a scoring engine that judges every player against the role they actually played.',
  openGraph: {
    title: 'Gaffa — Tactical Fantasy Football',
    description: 'Twelve real tactical positions, a live transfer market, and a scoring engine that judges every player against the role they actually played.',
    url: 'https://gaffa.live',
    siteName: 'Gaffa',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Gaffa — Tactical Fantasy Football',
    description: 'Twelve real tactical positions, a live transfer market, and a scoring engine that judges every player against the role they actually played.',
  },
  icons: {
    icon: [
      { url: '/icon.png', type: 'image/png' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [
      { url: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;0,6..72,700;1,6..72,400;1,6..72,500;1,6..72,600;1,6..72,700&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
