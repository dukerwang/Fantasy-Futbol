'use client';

import { usePalette, type Palette } from '@/context/ThemeContext';
import styles from './PalettePreview.module.css';

/**
 * Preview chrome — not a product control. Lets the lock palette be judged
 * against the shipped tokens without a git revert. Remove this component
 * (and the [data-palette="shipped"] override in globals.css) once a side
 * is chosen.
 */
export default function PalettePreview() {
  const { palette, setPalette } = usePalette();

  return (
    <nav className={styles.chip} aria-label="Palette preview">
      {(['lock', 'shipped'] as Palette[]).map((id) => (
        <button
          key={id}
          type="button"
          className={styles.item}
          onClick={() => setPalette(id)}
          {...(palette === id ? { 'data-active': '', 'aria-current': 'true' as const } : {})}
        >
          {id === 'lock' ? 'Lock' : 'Shipped'}
        </button>
      ))}
    </nav>
  );
}
