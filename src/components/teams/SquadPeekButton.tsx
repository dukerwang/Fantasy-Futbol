'use client';

import { useSquadPeek } from './SquadPeekProvider';

import styles from './SquadPeekButton.module.css';

/**
 * Any control that opens the squad peek.
 *
 * Exists so server components (the clubs index, standings, matchup headers) can
 * drop in a peek trigger without becoming client components themselves.
 *
 * Outside a SquadPeekProvider it renders its children bare instead of throwing
 * or disappearing. That matters because the thing it usually wraps is a crest:
 * on the share pages, which have no drawer, the badge must still be a badge.
 */
export default function SquadPeekButton({
  teamId,
  teamName,
  className,
  title,
  children,
}: {
  /** Present for symmetry with callers that pass route params; the provider reads the league from the URL. */
  leagueId?: string;
  teamId: string;
  teamName?: string;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const peek = useSquadPeek();
  if (!peek) return <>{children}</>;

  const btnClass = className ? `${styles.peekButton} ${className}` : styles.peekButton;

  return (
    <button
      type="button"
      className={btnClass}
      title={title}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        peek.openPeek(teamId, teamName);
      }}
      onPointerEnter={() => peek.prefetchPeek(teamId)}
      onFocus={() => peek.prefetchPeek(teamId)}
    >
      {children}
    </button>
  );
}
