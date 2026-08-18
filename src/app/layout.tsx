import type { Metadata, Viewport } from 'next';
import { Archivo_Narrow, Hanken_Grotesk, JetBrains_Mono, Newsreader } from 'next/font/google';
import { ThemeProvider } from '@/context/ThemeContext';
import './globals.css';

/**
 * Self-hosted via next/font rather than a Google Fonts <link>. Two reasons:
 * the files are preloaded alongside the HTML instead of costing an extra
 * origin round trip, and next/font generates a size-adjusted local fallback so
 * the swap to the real face doesn't reflow any text. That FOUT was a source of
 * visible pop-in on every page, not just the player card.
 */
const newsreader = Newsreader({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  axes: ['opsz'],
  display: 'swap',
  variable: '--font-newsreader',
});

const hankenGrotesk = Hanken_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-hanken-grotesk',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

/**
 * The condensed face (Gaffa 2.0). It carries column heads, club names and axis
 * labels — the role that had no face in 1.0 and so fell to JetBrains Mono.
 * Mono is now reserved for values that genuinely tick: countdowns, lot numbers,
 * bid clocks. Archivo Narrow is a variable font, so the whole 400–700 range
 * ships in one file and no per-weight list is needed.
 */
const archivoNarrow = Archivo_Narrow({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-archivo-narrow',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://gaffa.live'),
  title: 'Gaffa — Dynasty Fantasy Football',
  description: 'Dynasty fantasy football for the Premier League, with granular tactical positions, a live transfer market, and a scoring engine that judges every player against the role they actually played.',
  openGraph: {
    title: 'Gaffa — Dynasty Fantasy Football',
    description: 'Dynasty fantasy football for the Premier League, with granular tactical positions, a live transfer market, and a scoring engine that judges every player against the role they actually played.',
    url: 'https://gaffa.live',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Gaffa — Dynasty Fantasy Football',
    description: 'Dynasty fantasy football for the Premier League, with granular tactical positions, a live transfer market, and a scoring engine that judges every player against the role they actually played.',
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

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F7F3ED' },
    { media: '(prefers-color-scheme: dark)', color: '#1A1F2E' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${hankenGrotesk.variable} ${jetbrainsMono.variable} ${archivoNarrow.variable}`}
    >
      <body>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
