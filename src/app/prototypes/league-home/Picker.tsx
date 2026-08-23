'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import styles from './picker.module.css';

interface Props {
  names: string[];
  current: number;
  onSelect: (i: number) => void;
  onReplay: () => void;
  /** Rendered only when at least one variant has motion worth re-triggering. */
  hasMotion?: boolean;
}

/**
 * Harness chrome. Behavior contract is fixed by the skill's PICKER.md:
 * 1–N / ←→ switch, R replays, selection persists in ?v=, and the highlight
 * takes its initial position without animating.
 */
export default function Picker({ names, current, onSelect, onReplay, hasMotion = true }: Props) {
  const navRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [box, setBox] = useState({ left: 0, width: 0 });
  const [ready, setReady] = useState(false);

  const measure = useCallback(() => {
    const el = itemRefs.current[current];
    if (el) setBox({ left: el.offsetLeft, width: el.offsetWidth });
  }, [current]);

  useLayoutEffect(measure, [measure]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  // Enable the slide only after first paint, so load doesn't animate.
  useEffect(() => {
    const a = requestAnimationFrame(() => {
      const b = requestAnimationFrame(() => setReady(true));
      return () => cancelAnimationFrame(b);
    });
    return () => cancelAnimationFrame(a);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= names.length) onSelect(num - 1);
      else if (e.key === 'ArrowRight') onSelect((current + 1) % names.length);
      else if (e.key === 'ArrowLeft') onSelect((current - 1 + names.length) % names.length);
      else if (e.key === 'r' || e.key === 'R') onReplay();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [current, names.length, onSelect, onReplay]);

  return (
    <nav
      ref={navRef}
      className={styles['proto-picker']}
      aria-label="Prototype variants"
      {...(ready ? { 'data-ready': '' } : {})}
    >
      <span
        className={styles['proto-picker-highlight']}
        aria-hidden="true"
        style={{ width: box.width, transform: `translateX(${box.left}px)` }}
      />
      {names.map((name, i) => (
        <button
          key={name}
          ref={(el) => {
            itemRefs.current[i] = el;
          }}
          className={styles['proto-picker-item']}
          onClick={() => onSelect(i)}
          {...(i === current ? { 'data-active': '', 'aria-current': 'true' as const } : {})}
        >
          {name}
        </button>
      ))}
      {hasMotion && (
        <>
          <span className={styles['proto-picker-divider']} aria-hidden="true" />
          <button
            className={`${styles['proto-picker-item']} ${styles['proto-picker-replay']}`}
            aria-label="Replay animation (R)"
            onClick={onReplay}
          >
            ↻
          </button>
        </>
      )}
    </nav>
  );
}
