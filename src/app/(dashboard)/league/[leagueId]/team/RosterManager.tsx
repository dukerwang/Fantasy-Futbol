'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Player, RosterEntry } from '@/types';
import PlayerDetailsModal from '@/components/players/PlayerDetailsModal';
import styles from './my-team.module.css';

interface Props {
    teamId: string;
    rosterEntries: (RosterEntry & { player: Player })[];
}

export default function RosterManager({ teamId, rosterEntries }: Props) {
    const router = useRouter();
    const [loadingId, setLoadingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [viewingPlayer, setViewingPlayer] = useState<Player | null>(null);

    async function handleAction(playerId: string, actionType: 'drop' | 'transfer_out') {
        if (actionType === 'transfer_out') {
            const confirm = window.confirm("Are you sure? This should only be used if the player has genuinely left the Premier League in real life. You will be refunded their market value in FAAB.");
            if (!confirm) return;
        } else {
            const confirm = window.confirm("Are you sure you want to drop this player? They will become a free agent and you will receive £0 FAAB.");
            if (!confirm) return;
        }

        setLoadingId(playerId);
        setError(null);

        try {
            const res = await fetch(`/api/teams/${teamId}/drop`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerId, actionType }),
            });

            if (!res.ok) {
                const data = await res.json();
                setError(data.error ?? 'Failed to process request');
            } else {
                router.refresh();
            }
        } catch {
            setError('Network error. Please try again.');
        } finally {
            setLoadingId(null);
        }
    }

    // Sort by name
    const sortedEntries = [...rosterEntries].sort((a, b) => {
        return (a.player.web_name || a.player.name).localeCompare(b.player.web_name || b.player.name);
    });

    if (rosterEntries.length === 0) return null;

    return (
        <>
            <div className={styles.rosterManager}>
                <h3 className={styles.rosterManagerTitle}>
                    <span className={styles.sectionDot} style={{ background: 'var(--color-accent-blue)' }} />
                    Roster Management
                </h3>
                {error && <p className={styles.errorText} style={{ marginBottom: '1rem' }}>{error}</p>}

                <div className={styles.rosterList}>
                    {sortedEntries.map((entry) => (
                        <div key={entry.id} className={styles.rosterItem}>
                            <div
                                className={styles.rosterItemInfo}
                                onClick={() => setViewingPlayer(entry.player)}
                                style={{ cursor: 'pointer' }}
                            >
                                <span className={styles.posBadge} style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                                    {entry.player.primary_position}
                                </span>
                                <button
                                    type="button"
                                    className={styles.rosterItemNameBtn}
                                    title="View player details"
                                >
                                    {entry.player.web_name ?? entry.player.name}
                                </button>
                                <span className={styles.rosterItemClub}>{entry.player.pl_team}</span>
                                <span className={styles.rosterItemValue}>£{Number(entry.player.market_value || 0).toFixed(1)}m</span>
                            </div>
                            <div className={styles.rosterItemActions}>
                                <button
                                    className={styles.dropBtn}
                                    onClick={() => handleAction(entry.player.id, 'drop')}
                                    disabled={loadingId !== null}
                                >
                                    {loadingId === entry.player.id ? '...' : 'Drop'}
                                </button>
                                <button
                                    className={styles.transferOutBtn}
                                    onClick={() => handleAction(entry.player.id, 'transfer_out')}
                                    disabled={loadingId !== null}
                                    title="Only use if player transferred out of the Premier League"
                                >
                                    Transfer Out
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <PlayerDetailsModal
                player={viewingPlayer}
                onClose={() => setViewingPlayer(null)}
            />
        </>
    );
}
