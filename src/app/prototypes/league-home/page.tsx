'use client';

import { useCallback, useEffect, useState } from 'react';
import Picker from './Picker';
import Ledger from './Ledger';
import Board from './Board';
import Spine from './Spine';

/**
 * PROTOTYPE HARNESS — League Home, three system directions.
 *
 * Isolated route. Nothing in production imports from this directory; it exists
 * only so the three directions can be judged full-size, side by side in time
 * rather than side by side in space. Delete the whole folder once a direction
 * is chosen.
 *
 * Theme: this route inherits the app's ThemeProvider, which reads
 * localStorage('theme'). Flip the theme anywhere in the app and it persists
 * here — the harness deliberately adds no chrome of its own beyond the picker.
 */

const VARIANTS = [
  { name: 'Ledger', render: () => <Ledger /> },
  { name: 'Board', render: () => <Board /> },
  { name: 'Spine', render: () => <Spine /> },
];

export default function PrototypeHarness() {
  const [current, setCurrent] = useState(0);
  // Bumped to force a re-mount so entrance animations re-run.
  const [nonce, setNonce] = useState(0);

  // Restore from ?v= on first paint.
  useEffect(() => {
    const v = parseInt(new URLSearchParams(window.location.search).get('v') ?? '', 10);
    if (v >= 1 && v <= VARIANTS.length) setCurrent(v - 1);
  }, []);

  const select = useCallback((i: number) => {
    if (i < 0 || i >= VARIANTS.length) return;
    setCurrent(i);
    setNonce((n) => n + 1);
    const url = new URL(window.location.href);
    url.searchParams.set('v', String(i + 1));
    window.history.replaceState(null, '', url);
  }, []);

  const replay = useCallback(() => setNonce((n) => n + 1), []);

  return (
    <>
      <main key={`${current}-${nonce}`}>{VARIANTS[current].render()}</main>
      <Picker
        names={VARIANTS.map((v) => v.name)}
        current={current}
        onSelect={select}
        onReplay={replay}
      />
    </>
  );
}
