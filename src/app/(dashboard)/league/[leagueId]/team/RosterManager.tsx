'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Player, RosterEntry } from '@/types';
import PlayerDetailsModal from '@/components/players/PlayerDetailsModal';
import { formatPlayerName } from '@/lib/formatName';
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

    async function handleAction(
        playerId: string,
        actionType: 'drop' | 'transfer_out',
        playerName: string,
        marketValue: number,
    ) {
        if (actionType === 'transfer_out') {
            const ok = window.confirm(
                "Are you sure? This should only be used if the player has genuinely left the Premier League in real life. You will be refunded their market value in FAAB.",
            );
            if (!ok) return;
        } else {
            const severanceFee = Math.floor(marketValue * 0.1);
            const feeMsg = severanceFee > 0
                ? `This will cost £${severanceFee}m FAAB in contract buyout fees.`
                : 'No severance fee applies (market value too low).';
            const ok = window.confirm(
                `Are you sure you want to drop ${playerName}? ${feeMsg}`,
            );
            if (!ok) return;
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

    async function handleIrAction(playerId: string, action: 'move_to_ir' | 'activate') {
        const verb = action === 'move_to_ir' ? 'move this player to Injured Reserve' : 'activate this player from IR';
        const ok = window.confirm(`Are you sure you want to ${verb}?`);
        if (!ok) return;

        setLoadingId(playerId);
        setError(null);

        try {
            const res = await fetch(`/api/teams/${teamId}/ir`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerId, action }),
            });

            if (!res.ok) {
                const data = await res.json();
                setError(data.error ?? 'Failed to process IR request');
            } else {
                router.refresh();
            }
        } catch {
            setError('Network error. Please try again.');
        } finally {
            setLoadingId(null);
        }
    }

    async function handleTradeBlockToggle(playerId: string, currentStatus: boolean) {
        setLoadingId(playerId);
        setError(null);
        try {
            const res = await fetch(`/api/teams/${teamId}/trade-block`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerId, onTradeBlock: !currentStatus }),
            });
            if (!res.ok) throw new Error();
            router.refresh();
        } catch {
            setError('Failed to update Trade Block status. Make sure you applied the DB migration.');
        } finally {
            setLoadingId(null);
        }
    }

    const sortedEntries = [...rosterEntries].sort((a, b) => {
        return formatPlayerName(a.player, 'full').localeCompare(formatPlayerName(b.player, 'full'));
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
                                    {formatPlayerName(entry.player, 'full')}
                                </button>
                                <span className={styles.rosterItemClub}>{entry.player.pl_team}</span>
                                {entry.player.projected_points !== undefined && entry.player.projected_points !== null && (
                                    <span className={styles.rosterItemValue} style={{ color: 'var(--color-text-secondary)', marginRight: 'var(--space-2)' }}>Proj: {Number(entry.player.projected_points).toFixed(1)}</span>
                                )}
                                <span className={styles.rosterItemValue}>£{Number(entry.player.market_value || 0).toFixed(1)}m</span>
                            </div>
                            <div className={styles.rosterItemActions}>
                                {entry.status !== 'ir' && (
                                    <button
                                        className={styles.transferOutBtn}
                                        style={{
                                            border: (entry as any).on_trade_block ? '1px solid #10b981' : '1px solid var(--color-border)',
                                            color: (entry as any).on_trade_block ? '#10b981' : 'var(--color-text-muted)',
                                            background: (entry as any).on_trade_block ? 'rgba(16,185,129,0.1)' : 'transparent',
                                            marginRight: '0.5rem'
                                        }}
                                        onClick={() => handleTradeBlockToggle(entry.player.id, !!(entry as any).on_trade_block)}
                                        disabled={loadingId !== null}
                                        title="Mark this player as actively available for trade"
                                    >
                                        {(entry as any).on_trade_block ? 'On Block' : 'Trade Block'}
                                    </button>
                                )}
                                <button
                                    className={styles.dropBtn}
                                    onClick={() => handleAction(
                                        entry.player.id,
                                        'drop',
                                        formatPlayerName(entry.player, 'full'),
                                        Number(entry.player.market_value || 0),
                                    )}
                                    disabled={loadingId !== null}
                                >
                                    {loadingId === entry.player.id ? '...' : 'Drop'}
                                </button>
                                <button
                                    className={styles.transferOutBtn}
                                    onClick={() => handleAction(
                                        entry.player.id,
                                        'transfer_out',
                                        formatPlayerName(entry.player, 'full'),
                                        Number(entry.player.market_value || 0),
                                    )}
                                    disabled={loadingId !== null}
                                    title="Only use if player transferred out of the Premier League"
                                >
                                    Transfer Out
                                </button>
                                {entry.status === 'ir' ? (
                                    <button
                                        className={styles.dropBtn}
                                        style={{ backgroundColor: 'var(--color-bg-tertiary)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                                        onClick={() => handleIrAction(entry.player.id, 'activate')}
                                        disabled={loadingId !== null}
                                        title="Activate player from Injured Reserve to the Bench"
                                    >
                                        {loadingId === entry.player.id ? '...' : 'Activate'}
                                    </button>
                                ) : (
                                    entry.player.fpl_status === 'i' || entry.player.fpl_status === 'u' ? (
                                        <button
                                            className={styles.dropBtn}
                                            style={{ backgroundColor: 'var(--color-bg-tertiary)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                                            onClick={() => handleIrAction(entry.player.id, 'move_to_ir')}
                                            disabled={loadingId !== null}
                                            title="Move injured player to IR to open up a roster spot"
                                        >
                                            {loadingId === entry.player.id ? '...' : 'Move to IR'}
                                        </button>
                                    ) : null
                                )}
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
