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
    const actionName = isCommissioner ? 'delete this league' : 'leave this league';
    const confirmMessage = `Are you absolutely sure you want to ${actionName}? This action cannot be undone and all associated data will be permanently lost.`;

    if (!window.confirm(confirmMessage)) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/leave`, {
        method: 'POST',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to process request');
      }

      window.dispatchEvent(new Event('navigation-start'));
      router.push('/dashboard');
      router.refresh();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to process request');
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
      {loading ? 'Processing...' : isCommissioner ? 'Delete League' : 'Leave League'}
    </button>
  );
}
