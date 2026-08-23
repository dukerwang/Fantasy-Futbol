import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Archivo_Narrow, Hanken_Grotesk, JetBrains_Mono, Newsreader } from 'next/font/google';
import { ThemeProvider } from '@/context/ThemeContext';
import PalettePreview from '@/components/layout/PalettePreview';
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
 * Condensed face: column heads, club names in tables, axis labels, buttons.
 * Newsreader stays the display serif; JetBrains stays on values that tick.
 */
const archivoNarrow = Archivo_Narrow({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-archivo-narrow',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://gaffa.live'),
  title: 'Gaffa',
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
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Gaffa',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F8F4EC' },
    { media: '(prefers-color-scheme: dark)', color: '#1B1F29' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-palette="lock"
      className={`${newsreader.variable} ${hankenGrotesk.variable} ${jetbrainsMono.variable} ${archivoNarrow.variable}`}
      // The bootstrap script below writes data-theme and data-palette onto this
      // element before React hydrates — that is the whole point of it, since
      // waiting for hydration would flash the wrong theme. React then compares
      // server HTML against the mutated DOM and reports a mismatch on those two
      // attributes. Scoped to this element only: it does not suppress warnings
      // for any descendant, so real mismatches inside the app still surface.
      suppressHydrationWarning
    >
      <body>
        <Script
          id="gaffa-palette-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=localStorage.getItem('gaffa-palette');if(p==='shipped'||p==='lock')document.documentElement.setAttribute('data-palette',p);var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
        <ThemeProvider>
          {children}
          <PalettePreview />
        </ThemeProvider>
      </body>
    </html>
  );
}
