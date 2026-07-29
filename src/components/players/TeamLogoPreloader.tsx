'use client';

import { useEffect } from 'react';
import { warmImages } from '@/lib/players/cardCache';
import { allBadgePaths } from '@/lib/clubs/registry';

/**
 * Pre-decodes every club crest once per session.
 *
 * They are a few KB each and appear on every player card, roster row and
 * fixture. Warming them at idle means a crest is never the thing that fades in
 * a beat after the card it belongs to.
 */
export default function TeamLogoPreloader() {
  useEffect(() => {
    const warm = () => warmImages(allBadgePaths());

    if ('requestIdleCallback' in window) {
      const handle = window.requestIdleCallback(warm, { timeout: 2000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = setTimeout(warm, 300);
    return () => clearTimeout(timer);
  }, []);

  return null;
}
