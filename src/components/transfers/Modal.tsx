'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './Modal.module.css';

/**
 * The shell every transfers dialog sits in.
 *
 * Portalled to <body> so a dialog opened from inside a listing card is not
 * clipped by the card's `overflow: hidden`, and so its stacking context is the
 * page rather than whatever grid cell it was triggered from.
 */

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Rendered to the left of the title — a crest, usually. */
  lead?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Wider frame for the two-sided propose builder. */
  wide?: boolean;
}

export default function Modal({ open, onClose, title, lead, children, footer, wide }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes; body scroll is frozen while open so the page behind does not
  // drift under a dialog the user is typing a price into.
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    panelRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={styles.scrim}
      onMouseDown={(e) => {
        // Only a press that both starts and ends on the scrim closes — otherwise
        // a drag that begins on a text input and releases outside would dismiss
        // the dialog mid-edit.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`${styles.panel} ${wide ? styles.panelWide : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className={styles.header}>
          {lead}
          <h2 className={styles.title}>{title}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className={styles.body}>{children}</div>

        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
