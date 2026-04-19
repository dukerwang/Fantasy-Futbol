'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Player, RosterEntry } from '@/types';
import PlayerDetailsModal from '@/components/players/PlayerDetailsModal';
import { formatPlayerName } from '@/lib/formatName';
import styles from './roster.module.css';

// ─── Position ordering ────────────────────────────────────────────────────────

const POS_ORDER = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'LM', 'RM', 'AM', 'LW', 'RW', 'ST'];

const POS_COLOR: Record<string, string> = {
    GK: '#f59e0b',
    CB: '#3b82f6', LB: '#6366f1', RB: '#6366f1',
    DM: '#8b5cf6', CM: '#8b5cf6', LM: '#8b5cf6', RM: '#8b5cf6', AM: '#8b5cf6',
    LW: '#3A6B4A', RW: '#3A6B4A',
    ST: '#ef4444',
};

const STATUS_LABEL: Record<string, string> = {
    active: 'Active',
    bench: 'Bench',
    ir: 'IR',
    taxi: 'Taxi',
};

const SECTION_ORDER = ['active', 'bench', 'taxi', 'ir'];

// ─── Types ────────────────────────────────────────────────────────────────────

type RosterEntryWithPlayer = RosterEntry & { player: Player };

interface Props {
    teamId: string;
    leagueId: string;
    rosterEntries: RosterEntryWithPlayer[];
    taxiAgeCutoffYear: number;
    taxiSize: number;
}

type ConfirmState = {
    playerId: string;
    action: 'drop' | 'transfer_out';
    playerName: string;
    message: string;
} | null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isU21Eligible(player: Player, taxiAgeCutoffYear: number): boolean {
    if (!player.date_of_birth) return false;
    return new Date(player.date_of_birth).getFullYear() >= taxiAgeCutoffYear;
}

function isIrEligible(player: Player): boolean {
    return player.fpl_status === 'i' || player.fpl_status === 'u' || player.fpl_status === 'd';
}

function fplStatusLabel(status: string | null | undefined): string {
    if (!status || status === 'a') return '';
    const map: Record<string, string> = { i: 'Injured', d: 'Doubtful', s: 'Suspended', u: 'Unavailable', n: 'Ineligible' };
    return map[status] ?? status.toUpperCase();
}

// ─── Row component ────────────────────────────────────────────────────────────

interface RowProps {
    entry: RosterEntryWithPlayer;
    teamId: string;
    taxiAgeCutoffYear: number;
    taxiSize: number;
    currentTaxiCount: number;
    loadingId: string | null;
    onAction: (action: string, entry: RosterEntryWithPlayer) => void;
    onViewPlayer: (player: Player) => void;
}

function RosterRow({ entry, taxiAgeCutoffYear, taxiSize, currentTaxiCount, loadingId, onAction, onViewPlayer }: RowProps) {
    const { player, status } = entry;
    const isLoading = loadingId === entry.player.id;
    const u21 = isU21Eligible(player, taxiAgeCutoffYear);
    const irEligible = isIrEligible(player);
    const taxiFull = currentTaxiCount >= taxiSize;
    const canMoveTaxi = u21 && status !== 'taxi' && status !== 'ir' && !taxiFull;

    return (
        <div className={`${styles.tableRow} ${isLoading ? styles.tableRowLoading : ''}`}>
            {/* Pos badge */}
            <div className={styles.colPos}>
                <span className={styles.posBadge} style={{ background: POS_COLOR[player.primary_position] ?? '#6b7280' }}>
                    {player.primary_position}
                </span>
            </div>

            {/* Name + meta */}
            <div className={styles.colName}>
                <button type="button" className={styles.playerNameBtn} onClick={() => onViewPlayer(player)}>
                    {formatPlayerName(player, 'full')}
                </button>
                <div className={styles.playerMeta}>
                    <span>{player.pl_team}</span>
                    {player.fpl_status && player.fpl_status !== 'a' && (
                        <span className={styles.fplStatusBadge} data-status={player.fpl_status}>
                            {fplStatusLabel(player.fpl_status)}
                        </span>
                    )}
                    {u21 && <span className={styles.u21Tag}>U21</span>}
                </div>
            </div>

            {/* Market value */}
            <div className={styles.colValue}>
                £{Number(player.market_value ?? 0).toFixed(1)}m
            </div>

            {/* PPG */}
            <div className={styles.colPpg}>
                {player.ppg != null ? Number(player.ppg).toFixed(2) : '—'}
            </div>

            {/* Status badge */}
            <div className={styles.colStatus}>
                <span className={`${styles.statusBadge} ${styles[`status_${status}`]}`}>
                    {STATUS_LABEL[status] ?? status}
                </span>
            </div>

            {/* Actions */}
            <div className={styles.colActions}>
                {/* Trade block toggle */}
                {status !== 'ir' && status !== 'taxi' && (
                    <button
                        type="button"
                        className={`${styles.actionBtn} ${(entry as any).on_trade_block ? styles.actionBtnActive : ''}`}
                        onClick={() => onAction('trade_block', entry)}
                        disabled={isLoading}
                        title={`${(entry as any).on_trade_block ? 'Remove from' : 'Add to'} trade block`}
                    >
                        {(entry as any).on_trade_block ? 'On Block' : 'Trade Block'}
                    </button>
                )}

                {/* Move to taxi (U21 only, non-IR, non-taxi, slots available) */}
                {status !== 'taxi' && status !== 'ir' && u21 && (
                    <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={() => onAction('move_to_taxi', entry)}
                        disabled={isLoading || taxiFull}
                        title={taxiFull ? 'Taxi squad is full' : 'Move to taxi squad'}
                    >
                        → Taxi
                    </button>
                )}

                {/* Activate from taxi */}
                {status === 'taxi' && (
                    <button
                        type="button"
                        className={`${styles.actionBtn} ${styles.actionBtnGreen}`}
                        onClick={() => onAction('activate_taxi', entry)}
                        disabled={isLoading}
                    >
                        Activate
                    </button>
                )}

                {/* Move to IR (only if injured/doubtful and not already on IR) */}
                {status !== 'ir' && status !== 'taxi' && irEligible && (
                    <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={() => onAction('move_to_ir', entry)}
                        disabled={isLoading}
                        title="Move injured player to IR"
                    >
                        → IR
                    </button>
                )}

                {/* Activate from IR */}
                {status === 'ir' && (
                    <button
                        type="button"
                        className={`${styles.actionBtn} ${styles.actionBtnGreen}`}
                        onClick={() => onAction('activate_ir', entry)}
                        disabled={isLoading}
                    >
                        Activate
                    </button>
                )}

                {/* Drop */}
                <button
                    type="button"
                    className={`${styles.actionBtn} ${styles.actionBtnRed}`}
                    onClick={() => onAction('drop', entry)}
                    disabled={isLoading}
                >
                    Drop
                </button>
            </div>
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function RosterTable({ teamId, rosterEntries, taxiAgeCutoffYear, taxiSize }: Props) {
    const router = useRouter();
    const [loadingId, setLoadingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [confirmState, setConfirmState] = useState<ConfirmState>(null);
    const [viewingPlayer, setViewingPlayer] = useState<Player | null>(null);

    const currentTaxiCount = rosterEntries.filter((e) => e.status === 'taxi').length;

    // Group and sort by position within each status section
    const grouped: Record<string, RosterEntryWithPlayer[]> = {};
    for (const section of SECTION_ORDER) grouped[section] = [];
    for (const entry of rosterEntries) {
        const sec = SECTION_ORDER.includes(entry.status) ? entry.status : 'active';
        grouped[sec].push(entry);
    }
    for (const section of SECTION_ORDER) {
        grouped[section].sort((a, b) => {
            const ai = POS_ORDER.indexOf(a.player.primary_position);
            const bi = POS_ORDER.indexOf(b.player.primary_position);
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });
    }

    async function handleAction(action: string, entry: RosterEntryWithPlayer) {
        const playerName = formatPlayerName(entry.player, 'full');
        const marketValue = Number(entry.player.market_value ?? 0);

        // Inline confirm for destructive actions
        if (action === 'drop') {
            const severanceFee = Math.floor(marketValue * 0.1);
            const feeMsg = severanceFee > 0
                ? `This will cost £${severanceFee}m FAAB in severance.`
                : 'No severance fee (market value too low).';
            setConfirmState({ playerId: entry.player.id, action: 'drop', playerName, message: `Drop ${playerName}? ${feeMsg}` });
            return;
        }
        if (action === 'transfer_out') {
            setConfirmState({ playerId: entry.player.id, action: 'transfer_out', playerName, message: `Transfer ${playerName} out of the Premier League? You will receive their market value in FAAB. Only use if they have genuinely left the PL.` });
            return;
        }

        await executeAction(action, entry.player.id);
    }

    async function executeAction(action: string, playerId: string) {
        setLoadingId(playerId);
        setError(null);
        setConfirmState(null);

        try {
            let res: Response;

            if (action === 'drop' || action === 'transfer_out') {
                res = await fetch(`/api/teams/${teamId}/drop`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ playerId, actionType: action === 'transfer_out' ? 'transfer_out' : 'drop' }),
                });
            } else if (action === 'move_to_ir') {
                res = await fetch(`/api/teams/${teamId}/ir`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ playerId, action: 'move_to_ir' }),
                });
            } else if (action === 'activate_ir') {
                res = await fetch(`/api/teams/${teamId}/ir`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ playerId, action: 'activate' }),
                });
            } else if (action === 'move_to_taxi') {
                res = await fetch(`/api/teams/${teamId}/taxi`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ playerId, action: 'move_to_taxi' }),
                });
            } else if (action === 'activate_taxi') {
                res = await fetch(`/api/teams/${teamId}/taxi`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ playerId, action: 'activate' }),
                });
            } else if (action === 'trade_block') {
                const entry = rosterEntries.find((e) => e.player.id === playerId);
                const currentStatus = !!(entry as any)?.on_trade_block;
                res = await fetch(`/api/teams/${teamId}/trade-block`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ playerId, onTradeBlock: !currentStatus }),
                });
            } else {
                return;
            }

            if (!res!.ok) {
                const data = await res!.json();
                setError(data.error ?? 'Action failed');
            } else {
                router.refresh();
            }
        } catch {
            setError('Network error — please try again.');
        } finally {
            setLoadingId(null);
        }
    }

    return (
        <>
            {error && (
                <div className={styles.errorBanner}>
                    {error}
                    <button type="button" onClick={() => setError(null)} className={styles.errorDismiss}>✕</button>
                </div>
            )}

            {/* Inline confirm dialog */}
            {confirmState && (
                <div className={styles.confirmBanner}>
                    <span className={styles.confirmMsg}>{confirmState.message}</span>
                    <div className={styles.confirmActions}>
                        <button
                            type="button"
                            className={styles.confirmYes}
                            onClick={() => executeAction(confirmState.action, confirmState.playerId)}
                        >
                            Confirm
                        </button>
                        <button
                            type="button"
                            className={styles.confirmNo}
                            onClick={() => setConfirmState(null)}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Table header */}
            <div className={styles.tableHeader}>
                <div className={styles.colPos}>Pos</div>
                <div className={styles.colName}>Player</div>
                <div className={styles.colValue}>Value</div>
                <div className={styles.colPpg}>PPG</div>
                <div className={styles.colStatus}>Status</div>
                <div className={styles.colActions}>Actions</div>
            </div>

            {/* Sections */}
            {SECTION_ORDER.map((section) => {
                const entries = grouped[section];
                if (entries.length === 0) return null;
                return (
                    <div key={section} className={styles.section}>
                        <div className={styles.sectionHeader}>
                            <span className={`${styles.sectionDot} ${styles[`dot_${section}`]}`} />
                            {STATUS_LABEL[section]}
                            <span className={styles.sectionCount}>{entries.length}</span>
                        </div>
                        <div className={styles.tableBody}>
                            {entries.map((entry) => (
                                <RosterRow
                                    key={entry.id}
                                    entry={entry}
                                    teamId={teamId}
                                    taxiAgeCutoffYear={taxiAgeCutoffYear}
                                    taxiSize={taxiSize}
                                    currentTaxiCount={currentTaxiCount}
                                    loadingId={loadingId}
                                    onAction={handleAction}
                                    onViewPlayer={setViewingPlayer}
                                />
                            ))}
                        </div>
                    </div>
                );
            })}

            <PlayerDetailsModal player={viewingPlayer} onClose={() => setViewingPlayer(null)} />
        </>
    );
}
