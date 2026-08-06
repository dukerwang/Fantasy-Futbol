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
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // A dismiss requires the press to both start and end on the scrim. Closing on
  // mousedown alone would fire when a native <select> menu (which renders
  // outside the panel) is dismissed over the backdrop, and would also dismiss
  // mid-drag when the user releases outside after selecting text in an input.
  const scrimPointerDown = useRef(false);

  // Escape closes; body scroll is frozen while open so the page behind does not
  // drift under a dialog the user is typing a price into. onClose is read from
  // a ref so parent re-renders (inline lambdas, countdown ticks) do not re-run
  // this effect and steal focus from an input mid-edit.
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      // The squad-peek drawer can sit on top of this dialog. Both listen on
      // `document`, so without this check one Escape would close the drawer and
      // discard the offer being composed underneath it.
      if (document.body.dataset.squadPeekOpen) return;
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    panelRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={styles.scrim}
      onMouseDown={(e) => {
        scrimPointerDown.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (scrimPointerDown.current && e.target === e.currentTarget) {
          onCloseRef.current();
        }
        scrimPointerDown.current = false;
      }}
    >
      <div
        ref={panelRef}
        className={`${styles.panel} ${wide ? styles.panelWide : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
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
