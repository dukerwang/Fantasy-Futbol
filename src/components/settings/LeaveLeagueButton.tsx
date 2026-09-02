'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  leagueId: string;
  isCommissioner: boolean;
}

export default function LeaveLeagueButton({ leagueId, isCommissioner }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleAction = async () => {
    const confirmMessage = isCommissioner
      ? "Delete this league? This permanently deletes the league and every team in it."
      : "Leave this league? You can't undo this.";

    if (!window.confirm(confirmMessage)) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/leave`, {
        method: 'POST',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || (isCommissioner ? 'Failed to delete the league.' : 'Failed to leave the league.'));
      }

      window.dispatchEvent(new Event('navigation-start'));
      router.push('/dashboard');
      router.refresh();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : (isCommissioner ? 'Failed to delete the league.' : 'Failed to leave the league.'));
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleAction}
      disabled={loading}
      type="button"
      style={{
        backgroundColor: 'var(--color-accent-red)',
        color: 'white',
        border: 'none',
        padding: '0.5rem 1rem',
        borderRadius: '6px',
        fontWeight: '600',
        cursor: loading ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.7 : 1,
      }}
    >
      {loading ? (isCommissioner ? 'Deleting…' : 'Leaving…') : isCommissioner ? 'Delete League' : 'Leave League'}
    </button>
  );
}
