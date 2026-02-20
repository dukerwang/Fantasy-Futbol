import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Fantasy Futbol',
  description: 'Dynasty-style Fantasy Premier League with granular positions and real transfer values.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
